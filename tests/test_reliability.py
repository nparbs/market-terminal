import csv
import io
import time

import httpx
import pytest

from server import db, feeds, impact


def http_error(status, headers=None):
    req = httpx.Request("GET", "https://example.com/feed")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(status, headers=headers, request=req))


def test_rate_limited_reads_retry_after():
    assert feeds.rate_limited(http_error(429, {"Retry-After": "120"})) == 120
    assert feeds.rate_limited(http_error(429)) == 0
    assert feeds.rate_limited(http_error(429, {"Retry-After": "soon"})) == 0
    assert feeds.rate_limited(feeds.RateLimited("Truth Social HTTP 429")) == 0


def test_rate_limited_reads_an_http_date():
    wait = feeds.rate_limited(http_error(429, {"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"}))
    assert wait > 86400
    assert feeds.rate_limited(http_error(429, {"Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT"})) == 0


@pytest.mark.parametrize("err", [http_error(500), http_error(403), ValueError("bad xml")])
def test_other_errors_are_not_rate_limits(err):
    assert feeds.rate_limited(err) is None


def test_backoff_doubles_up_to_the_cap():
    assert [feeds.backoff_delay(60, n) for n in (1, 2, 3)] == [120, 240, 480]
    assert feeds.backoff_delay(60, 30) == feeds.MAX_BACKOFF
    assert feeds.backoff_delay(60, 1, retry_after=600) == 600
    assert feeds.backoff_delay(60, 30, retry_after=7200) == 7200  # the server's word beats our cap


def test_silent_warning_depends_on_source_type():
    now = 1_700_000_000
    hours = lambda h: now - h * 3600
    assert feeds.silent_warning({"type": "truth"}, hours(47), hours(100), now) is None
    assert "silent for 2.1 days" in feeds.silent_warning({"type": "truth"}, hours(50), hours(100), now)
    assert feeds.silent_warning({"type": "rss"}, hours(50), hours(100), now) is None
    assert feeds.silent_warning({"type": "rss"}, hours(24 * 15), hours(1000), now)


def test_silent_warning_honors_config_and_counts_from_start():
    now = 1_700_000_000
    assert feeds.silent_warning({"type": "rss", "silent_hours": 1}, now - 7200, now - 9000, now)
    # nothing seen yet: measured from when polling began
    assert feeds.silent_warning({"type": "gnews"}, None, now - 3600, now) is None
    assert feeds.silent_warning({"type": "gnews"}, None, now - 49 * 3600, now)


def post(pid, ts, text="tariffs", r=None, **kw):
    return {"id": pid, "ts": ts, "person": "Trump", "source": "truth", "url": f"https://x/{pid}", "text": text,
            "categories": ["trade"], "tickers": ["SPY", "FXI"],
            "impact": {"session": "live", "tickers": {"SPY": r if r is not None else {"r5": 0.1, "r30": -0.2, "peak": 0.4}}},
            **kw}


def test_track_record_csv(monkeypatch):
    t = time.time()
    posts = [post("old", t - 100), post("new", t, text="=HYPERLINK(1)"), post("pending", t - 50, r={})]
    monkeypatch.setattr(db, "posts_with_impact", lambda: posts)
    rows = list(csv.DictReader(io.StringIO(impact.track_record_csv("SPY"))))
    assert [r["url"] for r in rows] == ["https://x/new", "https://x/old"]  # newest first, unmeasured left out
    assert rows[0]["text"] == "'=HYPERLINK(1)"
    assert rows[1]["text"] == "tariffs"
    assert rows[1]["move_5m_pct"] == "0.1" and rows[1]["move_30m_pct"] == "-0.2"
    assert rows[1]["move_60m_pct"] == "" and rows[1]["peak_60m_pct"] == "0.4"
    assert rows[1]["tickers"] == "SPY FXI"


def swing_row(yes, label="Cut", event="Fed in March", venue="Kalshi"):
    return {"venue": venue, "event": event, "label": label, "yes": yes}


def test_prediction_swings_finds_big_moves_biggest_first():
    from server.extras import prediction_swings
    before = [swing_row(0.40), swing_row(0.50, label="Hold"), swing_row(0.20, label="Hike")]
    after = [swing_row(0.55), swing_row(0.38, label="Hold"), swing_row(0.25, label="Hike")]
    swings = prediction_swings(before, after, 10)
    assert [(s["label"], s["points"]) for s in swings] == [("Cut", 15.0), ("Hold", -12.0)]
    assert swings[0]["was"] == 0.40


def test_prediction_swings_ignores_new_markets_gaps_and_the_extremes():
    from server.extras import prediction_swings
    assert prediction_swings([], [swing_row(0.9)], 10) == []  # no earlier price to compare
    assert prediction_swings([swing_row(None)], [swing_row(0.9)], 10) == []
    assert prediction_swings([swing_row(0.4, venue="Polymarket")], [swing_row(0.9)], 10) == []
    assert prediction_swings([swing_row(0.002)], [swing_row(0.029)], 1) == []  # dust near zero
    assert prediction_swings([swing_row(0.98)], [swing_row(0.999)], 1) == []
    assert prediction_swings([swing_row(0.02)], [swing_row(0.40)], 10)  # really moved off the floor


def test_swing_alerts_are_logged_capped_and_can_be_turned_off(monkeypatch):
    from server import app as app_mod
    logged, pushed = [], []
    monkeypatch.setattr(db, "log_alert", lambda *a, **k: logged.append(a))
    monkeypatch.setattr(app_mod.push, "fire", lambda *a, **k: pushed.append(a))
    before = [swing_row(0.1, label=str(i)) for i in range(8)]
    after = [swing_row(0.5, label=str(i)) for i in range(8)]
    monkeypatch.setitem(app_mod.CFG, "prediction_alert_points", 10)
    app_mod.alert_prediction_swings(before, after)
    assert len(logged) == app_mod.SWING_MAX_ALERTS == len(pushed)
    assert logged[0][0] == "prediction" and "10% to 50%" in logged[0][2]
    logged.clear()
    monkeypatch.setitem(app_mod.CFG, "prediction_alert_points", 0)
    app_mod.alert_prediction_swings(before, after)
    assert not logged


def test_last_prediction_snapshot_returns_only_the_newest(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db", raising=False)
    monkeypatch.setattr(db, "_conn", None, raising=False)
    assert db.last_prediction_snapshot() == (None, [])
    monkeypatch.setattr(time, "time", lambda: 1000)
    db.snapshot_predictions([swing_row(0.1)])
    monkeypatch.setattr(time, "time", lambda: 2000)
    db.snapshot_predictions([swing_row(0.2)])
    ts, rows = db.last_prediction_snapshot()
    assert ts == 2000 and rows == [swing_row(0.2)]
