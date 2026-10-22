"""Unusual options activity from CBOE's free delayed option chains (~15 min delay).

A contract is "unusual" when today's volume is large in absolute terms, large in dollars, and large
relative to open interest (volume > OI suggests new positions being opened rather than closed).
Trade side is estimated from where the last trade printed inside the bid/ask spread.
"""
import asyncio
import json
import math
import re
import time
from datetime import date, datetime

from . import db
from .feeds import client

CHAIN = "https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json"
OCC = re.compile(r"^(?P<root>[A-Z.]+?)(?P<exp>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")

state = {"by_symbol": {}, "last_scan": None, "scanning": False, "errors": {}}


def optionable(sym):
    return bool(re.fullmatch(r"[A-Z]{1,5}", sym))


def universe(cfg):
    o = cfg.get("options", {})
    syms = list(o.get("universe", []))
    if o.get("include_watchlist", True):
        syms += cfg.get("watchlist", [])
    hours = o.get("include_mentioned_hours", 24)
    if hours:
        for p in db.recent_posts(500, since=time.time() - hours * 3600):
            if p["source"] != "gnews":
                syms += p["tickers"]
    out = []
    for s in syms:
        if optionable(s) and s not in out:
            out.append(s)
    return out


def analyze(raw, opts):
    """Turn a CBOE chain JSON into per-ticker totals plus a list of unusual contracts."""
    d = raw["data"]
    sym = d["symbol"]
    spot = d.get("current_price") or d.get("close") or 0
    asof = d.get("last_trade_time") or ""
    day = asof[:10] or date.today().isoformat()
    today = date.fromisoformat(day)
    totals = {"call_vol": 0, "put_vol": 0, "call_prem": 0.0, "put_prem": 0.0, "call_oi": 0, "put_oi": 0,
              "iv30": d.get("iv30"), "iv30_change": d.get("iv30_change")}
    unusual = []
    for o in d.get("options", []):
        m = OCC.match(o.get("option", ""))
        if not m:
            continue
        vol = int(o.get("volume") or 0)
        oi = int(o.get("open_interest") or 0)
        cp = m["cp"]
        price = o.get("last_trade_price") or o.get("theo") or 0
        prem = vol * price * 100
        side = "C" if cp == "C" else "P"
        totals[f"{'call' if side == 'C' else 'put'}_vol"] += vol
        totals[f"{'call' if side == 'C' else 'put'}_prem"] += prem
        totals[f"{'call' if side == 'C' else 'put'}_oi"] += oi
        if vol < opts["min_volume"] or prem < opts["min_premium"]:
            continue
        ratio = vol / oi if oi else float(vol)
        if ratio < opts["min_vol_oi"]:
            continue
        exp = datetime.strptime(m["exp"], "%y%m%d").date()
        strike = int(m["strike"]) / 1000
        bid, ask = o.get("bid") or 0, o.get("ask") or 0
        spread = ask - bid
        if ask and spread >= 0 and price >= ask - 0.25 * spread:
            fill = "ASK"
        elif bid and spread >= 0 and price <= bid + 0.25 * spread:
            fill = "BID"
        else:
            fill = "MID"
        otm = ((strike / spot - 1) if cp == "C" else (1 - strike / spot)) * 100 if spot else None
        # Buying calls / selling puts at the ask/bid leans bullish; the reverse leans bearish.
        lean = {("C", "ASK"): "bull", ("P", "BID"): "bull", ("P", "ASK"): "bear", ("C", "BID"): "bear"}.get((cp, fill), "")
        unusual.append({
            "contract": o["option"], "symbol": sym, "type": cp, "strike": strike, "exp": exp.isoformat(),
            "dte": (exp - today).days, "volume": vol, "oi": oi, "vol_oi": round(min(ratio, 999), 1),
            "last": price, "bid": bid, "ask": ask, "fill": fill, "lean": lean, "premium": round(prem),
            "iv": round((o.get("iv") or 0) * 100, 1), "delta": o.get("delta"), "otm_pct": round(otm, 1) if otm is not None else None,
            "spot": spot, "score": round(min(ratio, 20) * math.log10(max(prem, 10)), 2),
        })
    unusual.sort(key=lambda x: -x["score"])
    totals["call_prem"] = round(totals["call_prem"])
    totals["put_prem"] = round(totals["put_prem"])
    return {"symbol": sym, "day": day, "asof": asof, "spot": spot, "change_pct": d.get("price_change_percent"),
            "totals": totals, "unusual": unusual[:30]}


async def fetch_chain(sym):
    r = await client.get(CHAIN.format(sym=sym))
    r.raise_for_status()
    return r.content


async def scan(cfg, on_new=None):
    """Scan the whole universe. on_new(item) is called for contracts that became unusual since the last scan."""
    opts = {"min_volume": 500, "min_premium": 100_000, "min_vol_oi": 1.5, **cfg.get("options", {})}
    syms = universe(cfg)
    sem = asyncio.Semaphore(4)
    state["scanning"] = True
    first = not state["by_symbol"]

    async def one(sym):
        async with sem:
            try:
                body = await fetch_chain(sym)
                res = await asyncio.to_thread(lambda: analyze(json.loads(body), opts))
            except Exception as e:
                state["errors"][sym] = f"{type(e).__name__}: {str(e)[:80]}"
                return
        state["errors"].pop(sym, None)
        avg, n = db.avg_options_volume(sym, res["day"])
        tot = res["totals"]
        res["vol_vs_avg"] = round((tot["call_vol"] + tot["put_vol"]) / avg, 2) if avg and n >= 3 else None
        res["history_days"] = n
        prev = state["by_symbol"].get(sym)
        seen = {u["contract"] for u in prev["unusual"]} if prev else set()
        if first:  # don't re-alert on contracts already recorded today before a restart
            seen |= {u["contract"] for u in db.unusual_for_day(res["day"], 500) if u["symbol"] == sym}
        state["by_symbol"][sym] = res
        db.save_options_day(res["day"], sym, tot)
        if res["unusual"]:
            db.save_unusual(res["day"], res["unusual"])
        if on_new:
            for u in res["unusual"]:
                if u["contract"] not in seen:
                    on_new(u)

    try:
        await asyncio.gather(*(one(s) for s in syms))
    finally:
        state["scanning"] = False
        state["last_scan"] = time.time()


def flow(symbol=None):
    """Current view: per-ticker summary rows and the unusual contracts across the universe."""
    rows, items = [], []
    for sym, r in state["by_symbol"].items():
        if symbol and sym != symbol:
            continue
        t = r["totals"]
        cv, pv = t["call_vol"], t["put_vol"]
        rows.append({"symbol": sym, "spot": r["spot"], "change_pct": r["change_pct"], "call_vol": cv, "put_vol": pv,
                     "pc_ratio": round(pv / cv, 2) if cv else None, "call_prem": t["call_prem"], "put_prem": t["put_prem"],
                     "iv30": t.get("iv30"), "iv30_change": t.get("iv30_change"), "vol_vs_avg": r.get("vol_vs_avg"), "history_days": r.get("history_days"),
                     "unusual_count": len(r["unusual"]), "unusual_prem": sum(u["premium"] for u in r["unusual"]),
                     "asof": r["asof"], "day": r["day"]})
        items += r["unusual"]
    rows.sort(key=lambda x: -x["unusual_prem"])
    items.sort(key=lambda x: -x["premium"])
    return {"last_scan": state["last_scan"], "scanning": state["scanning"], "errors": state["errors"],
            "summary": rows, "unusual": items[:300]}


def market_open_now():
    from zoneinfo import ZoneInfo
    n = datetime.now(ZoneInfo("America/New_York"))
    mins = n.hour * 60 + n.minute
    return n.weekday() < 5 and 9 * 60 + 30 <= mins <= 16 * 60 + 30
