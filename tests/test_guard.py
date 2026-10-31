"""Other websites can't reach the app; its own page, phones and curl can."""
import asyncio

import pytest

from server.guard import LocalGuard, host_allowed, origin_allowed

NAMES = {"localhost", "mypc", "mypc.local"}


@pytest.mark.parametrize("host", [
    "localhost:8000", "LOCALHOST:8000", "127.0.0.1:8000", "192.168.1.20:8000", "[::1]:8000", "mypc:8000", "mypc.local",
])
def test_own_addresses_are_allowed(host):
    assert host_allowed(host, NAMES)


@pytest.mark.parametrize("host", ["", ":8000", "evil.example:8000", "localhost.evil.example", "mypc.evil.example"])
def test_other_names_are_refused(host):
    assert not host_allowed(host, NAMES)


def test_origin_must_match_the_host():
    assert origin_allowed("http://localhost:8000", "localhost:8000")
    assert origin_allowed("http://192.168.1.20:8000", "192.168.1.20:8000")
    assert not origin_allowed("https://evil.example", "localhost:8000")
    assert not origin_allowed("http://localhost:9999", "localhost:8000")  # another local app
    assert not origin_allowed("null", "localhost:8000")  # sandboxed iframes and file:// pages
    assert not origin_allowed("file://", "localhost:8000")


def _call(scope_type, headers):
    reached, sent = [], []

    async def app(scope, receive, send):
        reached.append(scope)

    async def send(msg):
        sent.append(msg)

    scope = {"type": scope_type, "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    asyncio.run(LocalGuard(app)(scope, None, send))
    return bool(reached), sent


def test_requests_without_an_origin_get_through():
    assert _call("http", {"host": "127.0.0.1:8000"})[0]  # curl, tools, same-origin GETs


def test_cross_site_post_is_blocked():
    reached, sent = _call("http", {"host": "127.0.0.1:8000", "origin": "https://evil.example"})
    assert not reached and sent[0]["status"] == 403


def test_rebound_host_is_blocked():
    reached, sent = _call("http", {"host": "evil.example:8000", "origin": "http://evil.example:8000"})
    assert not reached and sent[0]["status"] == 403


def test_websockets_are_checked_too():
    reached, sent = _call("websocket", {"host": "127.0.0.1:8000", "origin": "https://evil.example"})
    assert not reached and sent == [{"type": "websocket.close", "code": 1008}]
    assert _call("websocket", {"host": "127.0.0.1:8000", "origin": "http://127.0.0.1:8000"})[0]


def test_other_scopes_pass_through():
    reached = []

    async def app(scope, receive, send):
        reached.append(scope)

    asyncio.run(LocalGuard(app)({"type": "lifespan"}, None, None))
    assert reached


def test_the_app_uses_the_guard():
    from server.app import app
    assert any(m.cls is LocalGuard for m in app.user_middleware)
