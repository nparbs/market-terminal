import pytest

from server import impact

T0 = 1_700_000_000  # bar times are bar starts
STEP = 60


def bars(n, start=T0, first_close=100.0, step=0.1):
    out = []
    for i in range(n):
        c = round(first_close + i * step, 4)
        out.append({"time": start + i * STEP, "open": c, "high": c + 0.05, "low": c - 0.05, "close": c})
    return out


def series(b):
    return b, [x["time"] for x in b]


def test_live_post_measures_from_the_post_time():
    s = series(bars(200))
    ts = T0 + 10 * STEP + 30  # halfway through bar 10
    m = impact._measure(s, ts, STEP, now=T0 + 10**6)
    assert m["session"] == "live" and m["anchor"] == ts
    assert m["base"] == pytest.approx(100.9)  # close of bar 9, the last one finished before the post
    # +5 min: the last bar closed by ts + 5 min is bar 14
    assert m["r"]["r5"] == round((101.4 / 100.9 - 1) * 100, 3)
    assert m["r"]["r30"] == round((103.9 / 100.9 - 1) * 100, 3)
    assert m["r"]["r60"] == round((106.9 / 100.9 - 1) * 100, 3)
    assert m["peak"] > m["r"]["r30"]  # rising market: the hour's peak is near its end


def test_horizons_wait_until_their_bar_has_closed():
    s = series(bars(200))
    ts = T0 + 10 * STEP + 30
    m = impact._measure(s, ts, STEP, now=ts + 6 * 60)
    assert set(m["r"]) == {"r5"}


def test_post_after_the_last_bar_is_pending():
    s = series(bars(20))
    m = impact._measure(s, T0 + 40 * STEP, STEP, now=T0 + 10**6)
    assert m["session"] == "pending" and m["r"] == {}


def test_post_before_any_data_is_unmeasurable():
    assert impact._measure(series(bars(20)), T0 - 600, STEP, now=T0 + 10**6) is None


def test_overnight_post_measures_the_opening_gap():
    evening = bars(10)  # closes at 100.9
    reopen = T0 + 16 * 3600
    morning = bars(120, start=reopen, first_close=103.0, step=-0.01)
    s = series(evening + morning)
    ts = T0 + 3 * 3600  # posted while the market was closed
    m = impact._measure(s, ts, STEP, now=reopen + 10**5)
    assert m["session"] == "next-open" and m["anchor"] == reopen
    assert m["base"] == pytest.approx(100.9)
    assert m["r"]["r5"] == round((morning[4]["close"] / 100.9 - 1) * 100, 3)
    assert m["peak"] == round((morning[0]["high"] / 100.9 - 1) * 100, 3)


def test_track_record_aggregates_per_person_and_topic(monkeypatch):
    posts = [
        {"id": "1", "person": "Trump", "ts": 1, "text": "tariffs", "categories": ["Tariffs/Trade"],
         "impact": {"session": "live", "tickers": {"SPY": {"r5": -0.5, "r30": -1.0, "r60": -1.5}, "FXI": {"r60": -3.0}}}},
        {"id": "2", "person": "Trump", "ts": 2, "text": "tariffs again", "categories": ["Tariffs/Trade"],
         "impact": {"session": "live", "tickers": {"SPY": {"r5": 0.1, "r30": -0.2}}}},
        {"id": "3", "person": "Powell", "ts": 3, "text": "rates", "categories": [],
         "impact": {"session": "next-open", "tickers": {"SPY": {"r5": 0.3}}}},
        {"id": "4", "person": "Powell", "ts": 4, "text": "no data", "categories": [],
         "impact": {"tickers": {"SPY": {"error": "no data"}}}},
    ]
    monkeypatch.setattr(impact.db, "posts_with_impact", lambda: posts)
    tr = impact.track_record("SPY")

    trump = next(p for p in tr["people"] if p["person"] == "Trump")
    assert trump["n"] == 2 and trump["avg30"] == -0.6 and trump["abs5"] == 0.3 and trump["up5"] == 50
    assert "avg60" in trump and trump["avg60"] == -1.5
    assert [p["person"] for p in tr["people"]] == ["Trump", "Powell"]
    assert [(c["person"], c["category"], c["n"]) for c in tr["categories"]] == [("Trump", "Tariffs/Trade", 2)]
    assert tr["movers"][0] == {"id": "1", "person": "Trump", "ts": 1, "text": "tariffs", "ticker": "FXI",
                               "move": -3.0, "session": "live"}
    assert len(tr["movers"]) == 3
