"""Collectors for market-moving posts: Truth Social, X (optional API), RSS and Google News."""
import asyncio
import hashlib
import html
import json
import re
import shutil
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from urllib.parse import quote_plus

import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
client = httpx.AsyncClient(headers={"User-Agent": UA}, timeout=20, follow_redirects=True)

TRUTH = "https://truthsocial.com/api/v1"
_truth_ids = {}
_x_ids = {}


def strip_html(s):
    s = re.sub(r'<span class="quote-inline">.*?</span>', "", s or "", flags=re.S)  # Truth "RT: <url>" stub
    s = re.sub(r"<br\s*/?>|</p>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(s)).strip()


def parse_time(s, clamp=True):
    if not s:
        return time.time()
    s = s.strip()
    try:
        dt = parsedate_to_datetime(s)
    except Exception:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return time.time()
    if dt.tzinfo is None:  # feeds without a zone (e.g. Investing.com) publish UTC
        dt = dt.replace(tzinfo=timezone.utc)
    # Feeds occasionally carry future-dated items; clamp those (but not calendar events).
    return min(dt.timestamp(), time.time()) if clamp else dt.timestamp()


# ---------------------------------------------------------------- Truth Social

CURL = shutil.which("curl")


async def _get_json(url, params):
    """Truth Social sits behind Cloudflare, which rejects Python's TLS fingerprint but lets the system
    curl through. Use curl when it is available and fall back to httpx."""
    if CURL:
        full = str(httpx.URL(url, params=params))
        proc = await asyncio.create_subprocess_exec(
            CURL, "-s", "-m", "15", "-A", UA, "-H", "Accept: application/json", "-w", "\n%{http_code}", full,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await proc.communicate()
        body, _, code = out.decode("utf8", "replace").rpartition("\n")
        if code.strip() == "200":
            return json.loads(body)
        raise RuntimeError(f"Truth Social HTTP {code.strip() or 'error'}")
    r = await client.get(url, params=params)
    r.raise_for_status()
    return r.json()


async def _truth_account_id(handle, known=None):
    if known:
        return known
    if handle not in _truth_ids:
        _truth_ids[handle] = (await _get_json(f"{TRUTH}/accounts/lookup", {"acct": handle}))["id"]
    return _truth_ids[handle]


async def fetch_truth(src, pages=1):
    try:
        acct = await _truth_account_id(src["handle"], src.get("id"))
        statuses = []
        params = {"exclude_replies": "true", "limit": 20}
        for i in range(max(1, pages)):  # pages > 1 only on the first poll, to backfill history
            try:
                batch = await _get_json(f"{TRUTH}/accounts/{acct}/statuses", params)
            except Exception:
                if i == 0:
                    raise
                break  # keep the pages we already have
            if not batch:
                break
            statuses += batch
            params = {**params, "max_id": batch[-1]["id"]}
    except Exception:
        if src["handle"].lower() == "realdonaldtrump":
            return await fetch_rss({**src, "url": "https://www.trumpstruth.org/feed"}, source="truth")
        raise

    out = []
    for s in statuses:
        body = s
        prefix = ""
        if s.get("reblog"):
            body = s["reblog"]
            prefix = f"ReTruth @{body.get('account', {}).get('acct', '?')}: "
        text = strip_html(body.get("content"))
        if body.get("quote"):
            text += "\n\n» " + strip_html(body["quote"].get("content"))
        if body.get("card") and body["card"].get("title"):
            text += f"\n[link] {body['card']['title']}"
        media = body.get("media_attachments") or []
        if media:
            text += "\n" + " ".join(f"[{m.get('type', 'media')}]" for m in media)
        out.append({
            "id": f"truth:{s['id']}",
            "person": src["person"],
            "source": "truth",
            "url": s.get("url") or body.get("url"),
            "text": (prefix + text).strip() or "[no text]",
            "ts": parse_time(s.get("created_at")),
        })
    return out


# ---------------------------------------------------------------- X / Twitter (needs a paid API token)

async def fetch_x(src, token):
    if not token:
        return []
    h = {"Authorization": f"Bearer {token}"}
    handle = src["handle"]
    if handle not in _x_ids:
        r = await client.get(f"https://api.x.com/2/users/by/username/{handle}", headers=h)
        r.raise_for_status()
        _x_ids[handle] = r.json()["data"]["id"]
    r = await client.get(f"https://api.x.com/2/users/{_x_ids[handle]}/tweets", headers=h,
                         params={"max_results": 10, "tweet.fields": "created_at", "exclude": "replies"})
    r.raise_for_status()
    return [{
        "id": f"x:{t['id']}",
        "person": src["person"],
        "source": "x",
        "url": f"https://x.com/{handle}/status/{t['id']}",
        "text": html.unescape(t["text"]),
        "ts": parse_time(t.get("created_at")),
    } for t in r.json().get("data", [])]


# ---------------------------------------------------------------- RSS / Atom

def _local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_text):
    """Return [{title, link, summary, ts}] for RSS 2.0 or Atom."""
    root = ET.fromstring(xml_text)
    items = []
    for el in root.iter():
        name = _local(el.tag)
        if name not in ("item", "entry"):
            continue
        d = {"title": "", "link": "", "summary": "", "ts": None, "source": ""}
        for c in el:
            n = _local(c.tag)
            if n == "title":
                d["title"] = strip_html(c.text or "")
            elif n == "link":
                d["link"] = c.get("href") or (c.text or "").strip() or d["link"]
            elif n in ("description", "summary", "encoded") and not d["summary"]:
                d["summary"] = strip_html(c.text or "")
            elif n in ("pubDate", "updated", "published", "date") and not d["ts"]:
                d["ts"] = parse_time(c.text)
            elif n == "source":
                d["source"] = (c.text or "").strip()
            elif n == "originalId":  # trumpstruth.org mirror carries the real Truth Social id
                d["orig_id"] = (c.text or "").strip()
            elif n == "originalUrl":
                d["orig_url"] = (c.text or "").strip()
        d["ts"] = d["ts"] or time.time()
        items.append(d)
    return items


async def fetch_rss(src, source="rss"):
    r = await client.get(src["url"])
    r.raise_for_status()
    out = []
    for it in parse_feed(r.text)[:30]:
        text = it["title"]
        summ = it["summary"]
        if summ and summ[:60] != text[:60]:
            text = f"{text}\n{summ[:600]}" if text else summ[:600]
        key = it["link"] or text
        pid = it.get("orig_id") or hashlib.sha1(key.encode()).hexdigest()[:16]
        out.append({
            "id": f"{source}:{pid}",
            "person": src["person"],
            "source": source,
            "url": it.get("orig_url") or it["link"],
            "text": text.strip() or "[no text]",
            "ts": it["ts"],
        })
    return out


async def fetch_gnews(src):
    q = src["query"] + " when:1d"
    url = f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=en-US&gl=US&ceid=US:en"
    posts = await fetch_rss({**src, "url": url}, source="gnews")
    for p in posts:
        # Google News descriptions just repeat the headline as a link list.
        p["text"] = p["text"].split("\n")[0]
    return posts


async def fetch_news(feeds, limit=80):
    """General market headlines for the news panel."""
    out = []
    for f in feeds:
        try:
            r = await client.get(f["url"])
            r.raise_for_status()
            for it in parse_feed(r.text)[:30]:
                out.append({"source": f["name"], "title": it["title"], "url": it["link"], "ts": it["ts"]})
        except Exception:
            continue
    out.sort(key=lambda x: x["ts"], reverse=True)
    return out[:limit]


async def ticker_news(sym):
    r = await client.get("https://feeds.finance.yahoo.com/rss/2.0/headline",
                         params={"s": sym, "region": "US", "lang": "en-US"})
    r.raise_for_status()
    return [{"source": "Yahoo", "title": it["title"], "url": it["link"], "ts": it["ts"]}
            for it in parse_feed(r.text)[:30]]
