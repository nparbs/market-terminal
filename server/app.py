"""Market Terminal backend. Run from the project root:  python -m server.app"""
import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db, extras, feeds, impact, market
from .tagger import Tagger

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf8"))
X_TOKEN = os.environ.get("X_BEARER_TOKEN") or CFG.get("x_bearer_token") or ""
BENCH = CFG.get("impact_benchmark", "SPY")
tagger = Tagger(CFG)

subscribers: set[asyncio.Queue] = set()
status: dict[str, dict] = {}
FRESH_SECONDS = 30 * 60  # only alert on posts newer than this (feeds sometimes surface old items)


def broadcast(event):
    for q in list(subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _key(src):
    return f"{src['type']}:{src.get('handle') or src.get('query') or src.get('url')}"


async def fetch_source(src, first=False):
    t = src["type"]
    if t == "truth":
        return await feeds.fetch_truth(src, pages=src.get("backfill_pages", 5) if first else 1)
    if t == "x":
        return await feeds.fetch_x(src, X_TOKEN)
    if t == "gnews":
        return await feeds.fetch_gnews(src)
    return await feeds.fetch_rss(src)


async def poll_loop(src):
    key = _key(src)
    st = status[key] = {"person": src["person"], "type": src["type"], "ok": None, "last": None,
                        "error": None, "new": 0}
    if src["type"] == "x" and not X_TOKEN:
        st.update(ok=False, error="disabled: no X API token (set X_BEARER_TOKEN)")
        return
    # News-coverage sources mention companies constantly; by default only direct posts raise alerts.
    can_alert = src.get("alerts", src["type"] != "gnews")
    first = True
    while True:
        try:
            posts = await fetch_source(src, first)
            fresh = []
            for p in posts:
                p.update(tagger.tag(p["text"]))
                p["alert"] = p["alert"] and can_alert
                if db.insert_post(p) and not first:
                    fresh.append(p)
            for p in sorted(fresh, key=lambda x: x["ts"]):
                p["notify"] = p["alert"] and time.time() - p["ts"] < FRESH_SECONDS
                broadcast({"type": "post", "post": p})
            st.update(ok=True, last=time.time(), error=None, new=st["new"] + len(fresh))
        except Exception as e:
            st.update(ok=False, last=time.time(), error=f"{type(e).__name__}: {str(e)[:150]}")
        first = False
        await asyncio.sleep(max(15, src.get("interval", 120)))


async def impact_loop():
    await asyncio.sleep(20)
    while True:
        try:
            await impact.run_pending(BENCH)
        except Exception as e:
            status["impact"] = {"person": "Impact engine", "type": "internal", "ok": False,
                                "error": str(e)[:150], "last": time.time()}
        else:
            status["impact"] = {"person": "Impact engine", "type": "internal", "ok": True,
                                "error": None, "last": time.time()}
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app):
    db.conn()
    tasks = [asyncio.create_task(poll_loop(s)) for s in CFG["sources"] if s.get("enabled", True)]
    tasks.append(asyncio.create_task(impact_loop()))
    yield
    for t in tasks:
        t.cancel()
    await market.close()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def safe(fn):
    """Wrap a data call so a broken upstream source returns an error JSON instead of a 500."""
    async def run(*a, **kw):
        try:
            return await fn(*a, **kw)
        except Exception as e:
            return JSONResponse({"error": f"{type(e).__name__}: {str(e)[:200]}"}, status_code=502)
    return run


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
async def config():
    return {
        "watchlist": CFG["watchlist"], "tape": CFG["tape"], "benchmark": BENCH,
        "people": sorted({s["person"] for s in CFG["sources"] if s.get("enabled", True)} | set(db.persons())),
        "alert_keywords": CFG.get("alert_keywords", []),
        "categories": [r["name"] for r in CFG.get("rules", [])],
        "x_enabled": bool(X_TOKEN),
    }


@app.get("/api/posts")
async def posts(limit: int = 200, person: str | None = None, ticker: str | None = None,
                alerts: bool = False, since: int | None = None):
    return db.recent_posts(min(limit, 1000), person, ticker, since, alerts)


@app.get("/api/post/{pid:path}")
async def post(pid: str):
    p = db.get_post(pid)
    if p and not p["impact"]:
        try:
            p["impact"], _ = await impact.compute(p, BENCH)
        except Exception:
            pass
    return p or JSONResponse({"error": "not found"}, status_code=404)


@app.get("/api/quotes")
async def quotes(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:60]
    return await market.quotes(syms)


@app.get("/api/chart")
async def chart(symbol: str, range: str = "5d"):
    return await safe(market.candles)(symbol.upper(), range)


@app.get("/api/news")
async def news(symbol: str | None = None):
    async def get():
        if symbol:
            return await market._cached(("tn", symbol), 180, lambda: feeds.ticker_news(symbol.upper()))
        items = await market._cached(("news",), 120, lambda: feeds.fetch_news(CFG["news_feeds"]))
        for it in items:
            it.update({k: v for k, v in tagger.tag(it["title"]).items() if k in ("tickers", "alert")})
        return items
    return await safe(get)()


@app.get("/api/calendar")
async def calendar():
    return await safe(extras.calendar)()


@app.get("/api/congress")
async def congress(ticker: str | None = None, member: str | None = None):
    return await safe(extras.congress)(ticker, member)


@app.get("/api/insiders")
async def insiders(mode: str = "latest", ticker: str | None = None):
    return await safe(extras.insiders)(mode, ticker.upper() if ticker else None)


@app.get("/api/13f")
async def filings_13f():
    return await safe(extras.filings_13f)(CFG["sec_user_agent"])


@app.get("/api/predictions")
async def predictions(venue: str = "poly", tag: str = "economy"):
    if venue == "kalshi":
        return await safe(extras.kalshi)()
    return await safe(extras.polymarket)(tag)


@app.get("/api/trackrecord")
async def trackrecord():
    return impact.track_record(BENCH)


@app.get("/api/status")
async def get_status():
    return status


@app.get("/api/stream")
async def stream():
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    subscribers.add(q)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    print(f"\n  MARKET TERMINAL  ->  http://127.0.0.1:{CFG.get('port', 8765)}\n")
    uvicorn.run(app, host="127.0.0.1", port=CFG.get("port", 8765), log_level="warning")
