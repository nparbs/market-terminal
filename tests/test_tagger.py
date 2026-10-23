from server.tagger import Tagger

CFG = {
    "rules": [
        {"name": "Tariffs/Trade", "keywords": ["tariff", "tariffs", "trade deal"], "tickers": ["SPY", "EEM"], "alert": True},
        {"name": "Semis/AI", "keywords": ["chip", "semiconductor"], "tickers": ["SMH", "NVDA"]},
    ],
    "companies": {"apple": "AAPL", "tesla": "TSLA"},
    "alert_keywords": ["breaking", "executive order"],
    "watchlist": ["PLTR", "F", "BRK-B"],
}


def tag(text, cfg=CFG):
    return Tagger(cfg).tag(text)


def test_cashtags_and_companies():
    r = tag("Loving $tsla and $BRK.B today, Apple too")
    assert r["tickers"] == ["TSLA", "BRK.B", "AAPL"]
    assert not r["alert"] and r["categories"] == []


def test_rules_add_tickers_and_alert():
    r = tag("New TARIFFS on every chip coming")
    assert r["categories"] == ["Tariffs/Trade", "Semis/AI"]
    assert r["tickers"] == ["SPY", "EEM", "SMH", "NVDA"]
    assert r["alert"] and "tariffs" in r["matched"]


def test_keywords_match_whole_words_only():
    r = tag("The chipmunk ate a tariffless snack")
    assert r["categories"] == [] and r["tickers"] == [] and not r["alert"]


def test_alert_keywords():
    r = tag("BREAKING: new executive order signed")
    assert r["alert"] and r["matched"] == ["breaking", "executive order"]


def test_exchange_tags_give_the_ticker_but_not_rule_hits():
    # "CHIP" inside the exchange tag is the ticker, not the Semis topic.
    r = tag("Great company (NASDAQ:CHIP) is up")
    assert r["tickers"] == ["CHIP"] and r["categories"] == []
    r = tag("Ford (NYSE: F) announces a buyback")
    assert r["tickers"] == ["F"] and r["alert"]  # F is on the watchlist


def test_watchlist_caps_need_three_letters():
    r = tag("PLTR is moving, F is not mentioned plainly")
    assert r["tickers"] == ["PLTR"] and r["alert"]
    assert tag("pltr in lowercase")["tickers"] == []
    assert tag("$PLTR")["tickers"] == ["PLTR"]


def test_ticker_list_is_capped():
    text = " ".join(f"${s}" for s in ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ"])
    assert len(tag(text)["tickers"]) == 8
