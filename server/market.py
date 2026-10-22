"""Market data from Yahoo Finance's public chart endpoint (free, no key, ~delayed for some venues)."""
import asyncio
import time

import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"

_client = httpx.AsyncClient(headers={"User-Agent": UA}, timeout=15, follow_redirects=True)
_cache = {}  # key -> (expires, value)


async def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    val = await fn()
    _cache[key] = (time.time() + ttl, val)
    return val


async def chart_raw(sym, **params):
    r = await _client.get(CHART.format(sym=sym), params=params)
    r.raise_for_status()
    res = r.json()["chart"]["result"]
    if not res:
        raise ValueError(f"no data for {sym}")
    return res[0]


def _bars(res):
    ts = res.get("timestamp") or []
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(ts):
        o, h, l, c, v = (q.get(k, [None] * len(ts))[i] for k in ("open", "high", "low", "close", "volume"))
        if c is None or o is None:
            continue
        out.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v or 0})
    return out


async def quote(sym):
    async def fetch():
        res = await chart_raw(sym, range="1d", interval="5m", includePrePost="true")
        m = res["meta"]
        closes = [b["close"] for b in _bars(res)]
        price = m.get("regularMarketPrice") or (closes[-1] if closes else None)
        prev = m.get("chartPreviousClose") or m.get("previousClose")
        chg = (price - prev) if (price is not None and prev) else None
        # Pre/post-market: the last extended-hours bar vs the regular-session price.
        ext = None
        period = m.get("currentTradingPeriod") or {}
        reg = period.get("regular") or {}
        pre_start = (period.get("pre") or {}).get("start", 0)
        bars = _bars(res)
        if bars and reg and m.get("instrumentType") in ("EQUITY", "ETF") and price:
            last = bars[-1]
            if last["time"] >= reg.get("end", 1e12) or last["time"] < reg.get("start", 0):
                # Bars before today's pre-market opens are still yesterday's after-hours session.
                pre = reg.get("start", 0) > last["time"] >= pre_start
                ext = {"session": "pre" if pre else "post",
                       "price": last["close"], "pct": (last["close"] / price - 1) * 100, "time": last["time"]}
        return {
            "symbol": sym,
            "name": m.get("shortName") or m.get("longName") or sym,
            "price": price,
            "prev": prev,
            "change": chg,
            "pct": (chg / prev * 100) if chg is not None else None,
            "high": m.get("regularMarketDayHigh"),
            "low": m.get("regularMarketDayLow"),
            "volume": m.get("regularMarketVolume"),
            "currency": m.get("currency"),
            "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
            "spark": closes[-78:],
            "time": m.get("regularMarketTime"),
            "ext": ext,
        }
    try:
        return await _cached(("q", sym), 12, fetch)
    except Exception as e:
        return {"symbol": sym, "error": str(e)[:120]}


async def quotes(symbols):
    return await asyncio.gather(*(quote(s) for s in symbols))


RANGE_INTERVAL = {"1d": "1m", "5d": "5m", "1mo": "30m", "3mo": "1d", "6mo": "1d", "1y": "1d", "5y": "1wk"}


async def candles(sym, rng="5d", interval=None):
    interval = interval or RANGE_INTERVAL.get(rng, "1d")

    async def fetch():
        res = await chart_raw(sym, range=rng, interval=interval, includePrePost="false")
        m = res["meta"]
        return {"symbol": sym, "name": m.get("shortName") or sym, "interval": interval,
                "bars": _bars(res), "gmtoffset": m.get("gmtoffset", 0)}
    return await _cached(("c", sym, rng, interval), 30, fetch)


async def close():
    await _client.aclose()


SEARCH_TYPES = {"EQUITY", "ETF", "INDEX", "FUTURE", "CRYPTOCURRENCY", "CURRENCY", "MUTUALFUND"}


async def search(q):
    """Ticker search for the command bar (Yahoo Finance autocomplete)."""
    q = q.strip()
    if not q:
        return []

    async def fetch():
        r = await _client.get("https://query2.finance.yahoo.com/v1/finance/search",
                              params={"q": q, "quotesCount": 10, "newsCount": 0, "listsCount": 0})
        r.raise_for_status()
        return [{"symbol": x["symbol"], "name": x.get("shortname") or x.get("longname") or "",
                 "type": x.get("quoteType"), "exchange": x.get("exchDisp")}
                for x in r.json().get("quotes", []) if x.get("symbol") and x.get("quoteType") in SEARCH_TYPES]
    return await _cached(("search", q.lower()), 3600, fetch)
