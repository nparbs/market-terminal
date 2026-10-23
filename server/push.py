"""Phone push alerts through ntfy (https://ntfy.sh or a self-hosted server). No account needed:
install the ntfy app, subscribe to a hard-to-guess topic, and enter the same topic in Settings."""
import asyncio
import logging
import re
import time
from collections import deque

import httpx

log = logging.getLogger("push")

KINDS = ("post", "flow", "brief")
PRIORITY = {"post": 4, "flow": 3, "brief": 3}  # ntfy: 3 = default, 4 = high
TAGS = {"post": ["rotating_light"], "flow": ["chart_with_upwards_trend"], "brief": ["newspaper"]}
MAX_PER_MINUTE = 10  # a burst of posts shouldn't flood the phone (or hit ntfy.sh's rate limit)

_sent: deque[float] = deque()
_tasks: set[asyncio.Task] = set()
last_error: str | None = None


def settings(cfg) -> dict:
    p = cfg.get("push") or {}
    kinds = p.get("kinds") or {}
    return {"topic": (p.get("topic") or "").strip(), "server": (p.get("server") or "https://ntfy.sh").rstrip("/"),
            "kinds": {k: kinds.get(k, True) is not False for k in KINDS}}


def enabled(cfg, kind: str) -> bool:
    s = settings(cfg)
    return bool(s["topic"]) and s["kinds"].get(kind, False)


def matches_keyword(text: str, keywords) -> bool:
    """The browser's custom ALERT keywords, applied server-side so they reach the phone too."""
    return any(re.search(rf"(?<![A-Za-z0-9]){re.escape(k)}(?![A-Za-z0-9])", text or "", re.I)
               for k in keywords if k)


def _allow(now: float) -> bool:
    while _sent and now - _sent[0] > 60:
        _sent.popleft()
    if len(_sent) >= MAX_PER_MINUTE:
        return False
    _sent.append(now)
    return True


def message(cfg, kind: str, title: str, body: str = "", url: str | None = None) -> dict:
    s = settings(cfg)
    msg = {"topic": s["topic"], "title": title[:200], "message": (body or title)[:3500],
           "priority": PRIORITY.get(kind, 3), "tags": TAGS.get(kind, [])}
    if url:
        msg["click"] = url
    return msg


async def send(cfg, kind: str, title: str, body: str = "", url: str | None = None, force: bool = False) -> bool:
    """Publish one alert. Returns False if push is off for this kind, throttled, or ntfy failed."""
    global last_error
    if not (force or enabled(cfg, kind)) or not settings(cfg)["topic"]:
        return False
    if not force and not _allow(time.time()):
        log.info("push throttled: %s", title)
        return False
    try:
        # JSON publishing to the server root keeps titles UTF-8 safe (headers would be ASCII only).
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.post(settings(cfg)["server"] + "/", json=message(cfg, kind, title, body, url))
            r.raise_for_status()
        last_error = None
        return True
    except httpx.HTTPError as e:
        last_error = f"{type(e).__name__}: {str(e)[:150]}"
        log.warning("ntfy push failed: %s", last_error)
        return False


def fire(cfg, kind: str, title: str, body: str = "", url: str | None = None) -> None:
    """send() in the background, from sync or async code running on the event loop."""
    if not enabled(cfg, kind):
        return
    task = asyncio.get_running_loop().create_task(send(cfg, kind, title, body, url))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
