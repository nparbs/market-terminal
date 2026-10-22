"""Post-impact measurement: how did the benchmark and tagged tickers move after each post?

If the post landed during market hours we measure from the post time.
If the market was closed we measure from the prior close to the first minutes after the next open,
so an overnight post's reaction shows up as the opening gap.
"""
import time
from bisect import bisect_left, bisect_right
from collections import defaultdict

from . import db, market

HORIZONS = (5, 30, 60)  # minutes
MAX_TICKERS = 5
STEP = {"1m": 60, "5m": 300}


async def _series(sym, interval):
    rng = "7d" if interval == "1m" else "60d"

    async def fetch():
        res = await market.chart_raw(sym, range=rng, interval=interval, includePrePost="false")
        bars = market._bars(res)
        return bars, [b["time"] for b in bars]
    return await market._cached(("series", sym, interval), 90, fetch)


def _measure(series, ts, step, now):
    bars, times = series
    # bar i covers [time, time + step); it is "before" the post if it closed by the post time
    start = bisect_right(times, ts - step)
    if start == 0:
        return None
    base = bars[start - 1]["close"]
    if start == len(bars):
        return {"base": base, "session": "pending", "r": {}}  # nothing traded since the post yet
    first = bars[start]
    live = first["time"] <= ts + 15 * 60
    anchor = ts if live else first["time"]
    r = {}
    for h in HORIZONS:
        p = anchor + h * 60
        if now < p + step:
            continue
        j = bisect_right(times, p - step) - 1
        if j >= start:
            r[f"r{h}"] = round((bars[j]["close"] / base - 1) * 100, 3)
    window = bars[start:bisect_left(times, anchor + 60 * 60)]
    peak = None
    if window:
        hi = max(b["high"] for b in window); lo = min(b["low"] for b in window)
        peak = round(max(hi / base - 1, lo / base - 1, key=abs) * 100, 3)
    return {"base": base, "session": "live" if live else "next-open", "anchor": anchor, "r": r, "peak": peak}


async def compute(post, benchmark):
    now = time.time()
    ts = post["ts"]
    interval = "1m" if now - ts < 6.5 * 86400 else "5m"
    step = STEP[interval]
    syms = [benchmark] + [t for t in post["tickers"] if t != benchmark][: MAX_TICKERS - 1]
    out = {"interval": interval, "tickers": {}, "session": None}
    done = True
    for s in syms:
        try:
            m = _measure(await _series(s, interval), ts, step, now)
        except Exception as e:
            out["tickers"][s] = {"error": str(e)[:80]}
            continue
        if m is None:
            out["tickers"][s] = {"error": "no data"}
            continue
        out["tickers"][s] = {**m["r"], "peak": m.get("peak")}
        if s == benchmark:
            out["session"] = m["session"]
        if len(m["r"]) < len(HORIZONS):
            done = False
    return out, done


async def run_pending(benchmark):
    now = time.time()
    db.give_up_old(now - 58 * 86400)
    for p in db.pending_impact(now - 58 * 86400, now - 4 * 60):
        try:
            impact, done = await compute(p, benchmark)
        except Exception:
            continue
        # Weekend posts wait for Monday's open; give up after 4 days with no complete reading.
        if not done and now - p["ts"] > 4 * 86400:
            done = True
        db.save_impact(p["id"], impact, done)


def track_record(benchmark):
    """Aggregate benchmark reactions per person and per (person, category)."""
    by_person = defaultdict(list)
    by_cat = defaultdict(list)
    movers = []
    for p in db.posts_with_impact():
        b = (p["impact"] or {}).get("tickers", {}).get(benchmark) or {}
        if "r30" not in b and "r5" not in b:
            continue
        by_person[p["person"]].append(b)
        for c in p["categories"] or ["(untagged)"]:
            by_cat[(p["person"], c)].append(b)
        best = max(((t, v.get("r60", v.get("r30", v.get("r5")))) for t, v in p["impact"]["tickers"].items()
                    if isinstance(v.get("r60", v.get("r30", v.get("r5"))), (int, float))),
                   key=lambda x: abs(x[1]), default=None)
        if best:
            movers.append({"id": p["id"], "person": p["person"], "ts": p["ts"], "text": p["text"][:200],
                           "ticker": best[0], "move": best[1], "session": p["impact"].get("session")})

    def agg(rows):
        d = {"n": len(rows)}
        for h in HORIZONS:
            vals = [r[f"r{h}"] for r in rows if f"r{h}" in r]
            if vals:
                d[f"avg{h}"] = round(sum(vals) / len(vals), 3)
                d[f"abs{h}"] = round(sum(abs(v) for v in vals) / len(vals), 3)
                d[f"up{h}"] = round(sum(v > 0 for v in vals) / len(vals) * 100)
        return d

    people = sorted(({"person": k, **agg(v)} for k, v in by_person.items()), key=lambda x: -x["n"])
    cats = sorted(({"person": k[0], "category": k[1], **agg(v)} for k, v in by_cat.items() if len(v) >= 2),
                  key=lambda x: -abs(x.get("avg30", 0)))
    movers.sort(key=lambda x: -abs(x["move"]))
    return {"benchmark": benchmark, "people": people, "categories": cats[:40], "movers": movers[:25]}
