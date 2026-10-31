"""Keeps other websites out of this local app.

A page you have open elsewhere can send requests to a server on your own machine, and a POST with
no body needs no permission from the browser. The Origin check stops those requests. The Host check
stops DNS rebinding, where a site points its own name at this machine to count as same-origin.
"""
import ipaddress
import os
import socket
from urllib.parse import urlsplit

EXTRA_HOSTS_ENV = "MT_ALLOWED_HOSTS"  # comma-separated names, e.g. for a reverse proxy


def _name_only(host: str) -> str:
    """The Host header without its port."""
    host = host.strip().lower()
    if host.startswith("["):
        return host[1:].split("]")[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def _allowed_names() -> set[str]:
    me = socket.gethostname().lower()
    extra = os.environ.get(EXTRA_HOSTS_ENV, "")
    return {"localhost", me, f"{me}.local"} | {n.strip().lower() for n in extra.split(",") if n.strip()}


def host_allowed(host: str, names: set[str] | None = None) -> bool:
    """IP addresses and this machine's own names. An attacker's domain name is neither."""
    name = _name_only(host)
    if not name:
        return False
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return name in (_allowed_names() if names is None else names)


def origin_allowed(origin: str, host: str) -> bool:
    """The page making the request must have come from this server."""
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and parts.netloc.lower() == host.strip().lower()


class LocalGuard:
    """ASGI middleware applying both checks to HTTP requests and WebSockets."""

    def __init__(self, app):
        self.app = app
        self.names = _allowed_names()

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = {k.lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        host, origin = headers.get(b"host", ""), headers.get(b"origin")
        if host_allowed(host, self.names) and (origin is None or origin_allowed(origin, host)):
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        body = b"Blocked: this request didn't come from this app's own page."
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"text/plain"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
