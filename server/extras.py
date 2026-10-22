"""Side panels: congressional trades, insider trades, 13F filings, prediction markets, econ calendar."""
import ast
import asyncio
import html
import json
import re
from urllib.parse import quote

from .feeds import client, parse_feed, parse_time
from .market import _cached

# ---------------------------------------------------------------- Congress (Quiver Quant public page)


async def congress(ticker=None, member=None):
    async def fetch():
        r = await client.get("https://www.quiverquant.com/congresstrading/")
        r.raise_for_status()
        s = r.text
        i = s.index("recentTradesData = ") + len("recentTradesData = ")
        depth = 0
        for j in range(i, len(s)):
            if s[j] == "[":
                depth += 1
            elif s[j] == "]":
                depth -= 1
                if depth == 0:
                    break
        rows = ast.literal_eval(s[i:j + 1])
        out = []
        for r_ in rows:
            out.append({
                "ticker": r_[0] if re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", str(r_[0])) else None,
                "asset": r_[1], "asset_type": r_[2], "txn": r_[3], "amount": r_[4],
                "member": r_[5], "chamber": r_[6], "party": r_[7],
                "filed": str(r_[8])[:10], "traded": str(r_[9])[:10],
                "excess_return": r_[12] if len(r_) > 12 and isinstance(r_[12], (int, float)) else None,
                "id": str(r_[11]) if len(r_) > 11 else f"{r_[5]}|{r_[0]}|{r_[9]}|{r_[3]}|{r_[4]}",
                "member_url": (f"https://www.quiverquant.com/congresstrading/politician/{quote(str(r_[5]))}-{r_[15]}"
                               if len(r_) > 15 and r_[15] else None),
            })
        return out

    rows = await _cached(("congress",), 1800, fetch)
    if ticker:
        rows = [r for r in rows if (r["ticker"] or "").upper() == ticker.upper()]
    if member:
        rows = [r for r in rows if member.lower() in r["member"].lower()]
    return rows


# ---------------------------------------------------------------- Insider trades (OpenInsider)

OI_PAGES = {
    "latest": "http://openinsider.com/latest-insider-trading",
    "buys": "http://openinsider.com/insider-purchases-25k",
    "cluster": "http://openinsider.com/latest-cluster-buys",
    "big": "http://openinsider.com/latest-insider-purchases-100k",
}


def _href(row, pattern, prefix=""):
    m = re.search(pattern, row)
    return prefix + m.group(1) if m else None


def _cell(c):
    return html.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0", " ").strip()


async def insiders(mode="latest", ticker=None):
    url = f"http://openinsider.com/screener?s={ticker}&cnt=100" if ticker else OI_PAGES.get(mode, OI_PAGES["latest"])

    async def fetch():
        r = await client.get(url)
        r.raise_for_status()
        t = r.text[r.text.find('class="tinytable"'):]
        t = t[: t.find("</table>")]
        # Column sets differ between pages (cluster buys, per-ticker screener), so map by header name.
        heads = [_cell(h).lower().replace(" ", "") for h in re.findall(r"<th[^>]*>(.*?)</th>", t, re.S)]
        idx = {h: i for i, h in enumerate(heads)}
        body = t[t.find("<tbody"):]
        out = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = [_cell(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < len(heads) - 4:
                continue
            g = lambda *names: next((cells[idx[n]] for n in names if n in idx and idx[n] < len(cells)), "")
            tick = re.search(r'href="/([A-Z.\-]+)"', row)
            ins = g("ins")
            out.append({
                "filed": g("filingdate")[:16], "traded": g("tradedate"),
                "ticker": tick.group(1) if tick else g("ticker"),
                "company": g("companyname") or (ticker or ""),
                "insider": g("insidername") or (f"{ins} insiders" if ins else ""),
                "title": g("title") or g("industry"), "type": g("tradetype"), "price": g("price"),
                "qty": g("qty"), "owned": g("owned"), "delta_own": g("δown"),
                "value": g("value"),
                "filing_url": _href(row, r'href="(https?://www\.sec\.gov/[^"]+)"'),
                "insider_url": _href(row, r'href="(/insider/[^"]+)"', "http://openinsider.com"),
            })
        return out

    return await _cached(("oi", url), 600, fetch)


# ---------------------------------------------------------------- 13F filings (SEC EDGAR current feed)


async def filings_13f(ua):
    async def fetch():
        r = await client.get("https://www.sec.gov/cgi-bin/browse-edgar",
                             params={"action": "getcurrent", "type": "13F-HR", "count": 100, "output": "atom"},
                             headers={"User-Agent": ua})
        r.raise_for_status()
        out = []
        for it in parse_feed(r.text):
            m = re.match(r"(13F-HR(?:/A)?) - (.+?) \((\d+)\)", it["title"])
            if not m:
                continue
            out.append({"form": m.group(1), "filer": m.group(2), "cik": m.group(3),
                        "url": it["link"], "ts": it["ts"]})
        return out
    return await _cached(("13f",), 1800, fetch)


# ---------------------------------------------------------------- Prediction markets

POLY_TAGS = ["economy", "fed-rates", "finance", "business", "crypto", "politics", "geopolitics", "tariffs"]


async def polymarket(tag="economy"):
    async def fetch():
        r = await client.get("https://gamma-api.polymarket.com/events",
                             params={"limit": 30, "active": "true", "closed": "false",
                                     "order": "volume24hr", "ascending": "false", "tag_slug": tag})
        r.raise_for_status()
        out = []
        for e in r.json():
            mkts = []
            for m in e.get("markets", []):
                if m.get("closed"):
                    continue
                try:
                    outcomes = json.loads(m.get("outcomes") or "[]")
                    prices = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
                except Exception:
                    continue
                if not prices:
                    continue
                label = m.get("groupItemTitle") or m.get("question")
                mkts.append({"label": label, "outcomes": outcomes, "prices": prices,
                             "yes": prices[0], "change": m.get("oneDayPriceChange")})
            mkts.sort(key=lambda x: -x["yes"])
            out.append({"title": e.get("title"), "volume24h": e.get("volume24hr") or 0,
                        "end": (e.get("endDate") or "")[:10],
                        "url": f"https://polymarket.com/event/{e.get('slug')}", "markets": mkts[:6]})
        return out
    return await _cached(("poly", tag), 120, fetch)


KALSHI_SERIES = ["KXFEDDECISION", "KXFED", "KXRATECUTCOUNT", "KXCPIYOY", "KXPAYROLLS", "KXU3", "KXGDP",
                 "KXRECSSNBER", "KXINX", "KXNASDAQ100", "KXINXY", "KXWTI", "KXBTCD"]


async def _kalshi_series(series):
    r = await client.get("https://api.elections.kalshi.com/trade-api/v2/events",
                         params={"status": "open", "series_ticker": series,
                                 "with_nested_markets": "true", "limit": 2})
    r.raise_for_status()
    out = []
    for e in r.json().get("events", []):
        mkts = []
        for m in e.get("markets", []):
            def f(k):
                try:
                    return float(m.get(k) or 0)
                except ValueError:
                    return 0.0
            bid, ask, last = f("yes_bid_dollars"), f("yes_ask_dollars"), f("last_price_dollars")
            yes = (bid + ask) / 2 if bid and ask else last
            mkts.append({"label": m.get("yes_sub_title") or m.get("subtitle") or m.get("ticker"),
                         "yes": yes, "change": yes - f("previous_price_dollars") if f("previous_price_dollars") else None,
                         "volume": m.get("volume_24h_fp") or m.get("volume_24h")})
        mkts.sort(key=lambda x: -x["yes"])
        out.append({"title": e.get("title"), "series": series, "event": e.get("event_ticker"),
                    "url": f"https://kalshi.com/markets/{series.lower()}", "markets": mkts[:6]})
    return out


async def kalshi():
    async def fetch():
        res = await asyncio.gather(*(_kalshi_series(s) for s in KALSHI_SERIES), return_exceptions=True)
        return [e for r in res if isinstance(r, list) for e in r]
    return await _cached(("kalshi",), 120, fetch)


# ---------------------------------------------------------------- Economic calendar (Forex Factory weekly JSON)


async def calendar():
    async def fetch():
        r = await client.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
        r.raise_for_status()
        out = []
        for e in r.json():
            out.append({"title": e.get("title"), "country": e.get("country"), "impact": e.get("impact"),
                        "forecast": e.get("forecast"), "previous": e.get("previous"),
                        "actual": e.get("actual"), "ts": parse_time(e.get("date"), clamp=False)})
        out.sort(key=lambda x: x["ts"])
        return out
    return await _cached(("cal",), 900, fetch)
