import asyncio
import json

import httpx
import pytest

from server import push


@pytest.fixture(autouse=True)
def fresh_throttle():
    push._sent.clear()


def cfg(**kw):
    return {"push": {"topic": "mt-test", **kw}}


def test_settings_defaults_and_kinds():
    assert push.settings({}) == {"topic": "", "server": "https://ntfy.sh",
                                 "kinds": {"post": True, "flow": True, "brief": True, "prediction": True}}
    c = cfg(server="https://ntfy.example.com/", kinds={"flow": False})
    assert push.settings(c)["server"] == "https://ntfy.example.com"
    assert push.enabled(c, "post") and not push.enabled(c, "flow")
    assert not push.enabled({"push": {"topic": "  "}}, "post")


def test_custom_keywords_match_whole_words():
    assert push.matches_keyword("Rate CUT incoming", ["rate cut"])
    assert not push.matches_keyword("nvidiax", ["nvidia"])
    assert not push.matches_keyword("anything", ["", None])


def test_throttle():
    assert all(push._allow(1000 + i) for i in range(push.MAX_PER_MINUTE))
    assert not push._allow(1030)
    assert push._allow(1000 + 61 + push.MAX_PER_MINUTE)


def test_message_is_utf8_json_with_click_and_priority():
    m = push.message(cfg(), "post", "Trump · $SPY", "Tariffs — effective immediately", "https://x.y/1")
    assert m == {"topic": "mt-test", "title": "Trump · $SPY", "message": "Tariffs — effective immediately",
                 "priority": 4, "tags": ["rotating_light"], "click": "https://x.y/1"}


def _mock(monkeypatch, status=200):
    seen = []

    def handler(request):
        seen.append((str(request.url), json.loads(request.content)))
        return httpx.Response(status)

    real = httpx.AsyncClient
    monkeypatch.setattr(push.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return seen


def test_send_posts_to_the_server_root(monkeypatch):
    seen = _mock(monkeypatch)
    assert asyncio.run(push.send(cfg(), "brief", "Brief ready", "SPY +0.4% pre-market"))
    assert seen == [("https://ntfy.sh/", {"topic": "mt-test", "title": "Brief ready", "message": "SPY +0.4% pre-market",
                                          "priority": 3, "tags": ["newspaper"]})]
    assert not asyncio.run(push.send(cfg(kinds={"brief": False}), "brief", "x"))
    assert not asyncio.run(push.send({}, "post", "x"))
    assert len(seen) == 1


def test_send_reports_failures(monkeypatch):
    _mock(monkeypatch, status=429)
    assert not asyncio.run(push.send(cfg(), "post", "x"))
    assert "429" in push.last_error


def test_fire_runs_in_the_background(monkeypatch):
    seen = _mock(monkeypatch)

    async def run():
        push.fire(cfg(), "flow", "Unusual options: NVDA", "big")
        push.fire(cfg(kinds={"flow": False}), "flow", "ignored")
        await asyncio.gather(*push._tasks)
    asyncio.run(run())
    assert [s[1]["title"] for s in seen] == ["Unusual options: NVDA"]
