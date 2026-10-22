"""Pre-market brief: everything that happened since the last close, assembled at a fixed time each weekday."""
import asyncio
import time
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import db, extras, market, options

NY = ZoneInfo("America/New_York")


def now_et():
    return datetime.now(NY)


def last_close(ref=None):
    """Unix time of the most recent regular-session close (16:00 ET on a weekday) before ref."""
    d = ref or now_et()
    close = d.replace(hour=16, minute=0, second=0, microsecond=0)
    if d < close or d.weekday() >= 5:
        close -= timedelta(days=1)
    while close.weekday() >= 5:
        close -= timedelta(days=1)
    return close.timestamp()


def kind_for(d):
    m = d.hour * 60 + d.minute
    if d.weekday() >= 5:
        return "Weekend brief"
    if m < 570:
        return "Pre-market brief"
    if m < 960:
        return "Intraday brief"
    return "After-hours brief"


def _move(q):
    """Best current move for a quote: pre/post-market change when trading extended hours, else the day change."""
    ext = q.get("ext")
    if ext and ext["session"] == "pre":
        return ext["pct"], "pre"
    return q.get("pct"), "day"


def _slim(q):
    mv, basis = _move(q)
    return {"symbol": q["symbol"], "name": q.get("name"), "price": q.get("price"), "pct": q.get("pct"),
            "move": mv, "basis": basis, "ext": q.get("ext"), "error": q.get("error")}


async def _section(errors, name, coro):
    try:
        return await coro
    except Exception as e:
        errors.append(f"{name}: {type(e).__name__}: {str(e)[:120]}")
        return None


async def build(cfg):
    bcfg = cfg.get("brief", {})
    d = now_et()
    since = last_close(d)
    errors = []

    # ---- overnight posts (direct sources only: Truth Social, X, official feeds)
    posts = [p for p in db.recent_posts(1000, since=since) if p["source"] != "gnews"]
    news = [p for p in db.recent_posts(1000, since=since) if p["source"] == "gnews"]
    alerts = [p for p in posts if p["alert"]]
    topics = Counter(c for p in posts for c in p["categories"])
    mentioned = Counter(t for p in posts for t in p["tickers"])
    post_section = {
        "count": len(posts), "alert_count": len(alerts), "news_count": len(news),
        "by_person": Counter(p["person"] for p in posts).most_common(),
        "topics": topics.most_common(8), "tickers": mentioned.most_common(12),
        "alerts": [{k: p[k] for k in ("id", "person", "source", "ts", "text", "tickers", "categories", "url")} for p in alerts[:15]],
    }

    # ---- futures, global markets and movers
    fut_syms = bcfg.get("futures", [])
    glob_syms = bcfg.get("global", [])
    mover_syms = list(dict.fromkeys(
        [s for s in cfg.get("watchlist", []) + cfg.get("options", {}).get("universe", []) + [t for t, _ in mentioned.most_common(15)]
         if options.optionable(s)]))
    fut, glob, movers = await asyncio.gather(market.quotes(fut_syms), market.quotes(glob_syms), market.quotes(mover_syms))
    movers = [_slim(q) for q in movers if q.get("price") and _move(q)[0] is not None]
    movers.sort(key=lambda q: -(q["move"] or 0))
    mover_section = {"up": movers[:8], "down": [m for m in reversed(movers[-8:]) if (m["move"] or 0) < 0],
                     "mentioned": [m for m in movers if m["symbol"] in mentioned][:10]}

    # ---- calendar, predictions, congress, insiders in parallel
    # After the close (or on weekends) the useful calendar is the next session's.
    target = d.date()
    if d.weekday() >= 5 or d.hour >= 16:
        target += timedelta(days=1)
        while target.weekday() >= 5:
            target += timedelta(days=1)
    cal_label = "TODAY'S CALENDAR" if target == d.date() else f"NEXT SESSION · {target.strftime('%a %b %d').upper()}"

    async def cal():
        rows = await extras.calendar()
        return [e for e in rows if e["country"] == "USD" and e["impact"] in ("High", "Medium")
                and datetime.fromtimestamp(e["ts"], NY).date() == target]

    async def preds():
        out = []
        polys = await asyncio.gather(*(extras.polymarket(t) for t in bcfg.get("poly_tags", ["economy"])), return_exceptions=True)
        seen = set()
        today = d.date().isoformat()
        for evs in polys:
            if isinstance(evs, Exception):
                continue
            for e in evs:
                if e.get("end") and e["end"] < today:  # resolved-in-all-but-name markets
                    continue
                for m in e["markets"]:
                    key = (e["title"], m["label"])
                    if key in seen or not m.get("change"):
                        continue
                    seen.add(key)
                    out.append({"venue": "Polymarket", "event": e["title"], "label": m["label"], "yes": m["yes"],
                                "change": m["change"], "url": e["url"], "volume24h": e.get("volume24h")})
        try:
            for e in await extras.kalshi():
                for m in e["markets"]:
                    if m.get("change"):
                        out.append({"venue": "Kalshi", "event": e["title"], "label": m["label"], "yes": m["yes"],
                                    "change": m["change"], "url": e["url"]})
        except Exception:
            pass
        # Ignore near-certain / near-impossible outcomes; a 1pt wiggle at 99% isn't news.
        out = [o for o in out if 0.03 < o["yes"] < 0.97]
        out.sort(key=lambda o: -abs(o["change"]))
        return out[:10]

    since_day = datetime.fromtimestamp(since, NY).date().isoformat()

    async def congress():
        rows = await extras.congress()
        return [r for r in rows if r["filed"] >= since_day and r["ticker"]][:12]

    async def insiders():
        rows = await extras.insiders("big")
        return [r for r in rows if r["filed"][:10] >= since_day][:10]

    cal_rows, pred_rows, cong_rows, ins_rows = await asyncio.gather(
        _section(errors, "calendar", cal()), _section(errors, "predictions", preds()),
        _section(errors, "congress", congress()), _section(errors, "insiders", insiders()))

    # ---- options: the most recent completed session's biggest unusual trades
    opt_day = db.last_options_day()
    # Skip same-day expiries: 0DTE index flow is mostly intraday hedging/speculation noise.
    opt_top = [u for u in (db.unusual_for_day(opt_day, 300) if opt_day else []) if u["dte"] > 0][:15]
    hot = sorted((r for r in options.flow()["summary"] if r.get("vol_vs_avg")), key=lambda r: -r["vol_vs_avg"])[:8]
    opt_section = {"day": opt_day, "top": opt_top, "hot": hot,
                   "mentioned": [u for u in (db.unusual_for_day(opt_day, 300) if opt_day else []) if u["symbol"] in mentioned][:10]}

    # ---- one-line headline
    fq = {q["symbol"]: q for q in fut}
    parts = []
    for sym, label in (("ES=F", "S&P fut"), ("NQ=F", "Nasdaq fut"), ("^VIX", "VIX"), ("^TNX", "10Y"), ("CL=F", "Oil"), ("BTC-USD", "BTC")):
        q = fq.get(sym)
        if not q or q.get("price") is None:
            continue
        if sym in ("^VIX", "^TNX"):
            parts.append(f"{label} {q['price']:.2f}{'%' if sym == '^TNX' else ''}")
        elif q.get("pct") is not None:
            parts.append(f"{label} {q['pct']:+.2f}%")
    if alerts:
        who = Counter(p["person"] for p in alerts).most_common(2)
        parts.append(f"{len(alerts)} alert post{'s' if len(alerts) != 1 else ''} ({', '.join(w for w, _ in who)})")
    if cal_rows:
        high = [e["title"] for e in cal_rows if e["impact"] == "High"]
        if high:
            parts.append(("Today: " if target == d.date() else "Next: ") + ", ".join(high[:3]))

    return {
        "day": d.date().isoformat(), "ts": time.time(), "kind": kind_for(d), "since": since,
        "headline": " · ".join(parts),
        "futures": [_slim(q) for q in fut], "global": [_slim(q) for q in glob], "movers": mover_section,
        "posts": post_section, "calendar": cal_rows or [], "calendar_label": cal_label, "predictions": pred_rows or [],
        "options": opt_section, "congress": cong_rows or [], "insiders": ins_rows or [], "errors": errors,
    }


def due(cfg, latest):
    """True when today's scheduled brief should be generated now."""
    bcfg = cfg.get("brief", {})
    if not bcfg.get("enabled", True):
        return False
    d = now_et()
    if d.weekday() >= 5:
        return False
    hh, mm = (int(x) for x in bcfg.get("time_et", "08:30").split(":"))
    sched = d.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if not (sched <= d < d.replace(hour=16, minute=0, second=0, microsecond=0)):
        return False
    return not latest or latest.get("day") != d.date().isoformat()
