# Market Terminal

A Bloomberg-style terminal that runs on your own machine. It watches market-moving posts and puts them next to live prices:

- Trump's Truth Social posts, the White House, the Fed, USTR and SEC.
- News coverage of Musk, Bessent, Lutnick, Huang, Ackman, Saylor, China's Commerce Ministry (MOFCOM) and OPEC.
- How the market moved after each post.

## Run

Double-click `run.bat`, or:

```
pip install -r requirements.txt
python -m server.app
```

Then open http://127.0.0.1:8765. Use 127.0.0.1 rather than `localhost`. `localhost` can try IPv6 first, which makes each new connection slow.

## Screen layout

| Panel | What it shows |
|---|---|
| Ticker tape | Futures, indexes, VIX, 10Y yield, DXY, oil, gold, BTC, FX |
| Watchlist | Live quotes and sparklines. `●2` means 2 posts mentioned this ticker in the last 24h |
| Chart | Candles with arrow markers where posts landed. Hover a marker to read the post, click it to open the impact view. **KEY** shows posts tagged with this ticker plus alert posts straight from Truth Social or X. **ALL** shows every post |
| Market movers | Live feed. Each post shows ticker chips (click one to chart it), topic tags, and SPY/ticker moves at +5, +30 and +60 minutes |
| Bottom tabs | News, Economic Calendar, Congress trades, Insider trades (Form 4), 13F filings, Polymarket/Kalshi, Track Record, Post Impact, Source health, Help |

Type a ticker anywhere to chart it. Type `HELP` for all commands, for example `NVDA 1Y`, `ADD PLTR`, `CONG NVDA`, `INS BUYS`, `KALSHI`, `FEED TRUMP` and `ALERT nvidia`. `Alt+1`…`Alt+0` switch tabs.

## Alerts

A new post triggers an alert (sound, red flash and optional desktop notification) if it comes from a direct source (Truth Social, X or an official feed) and either:
- hits an alert topic: tariffs, China, Fed/rates, war/geopolitics or fiscal policy, or
- contains an alert keyword (`breaking`, `effective immediately`, `executive order`, `sanctions`…), a watchlist company, or one of your `ALERT` keywords.

News-coverage sources (the NEWS badge) don't trigger alerts by default, because they mention companies constantly. To change that, set `"alerts": true` on that source.

Click **🔔 NOTIFY** once to allow desktop notifications. They work while the tab is in the background.

## Post impact and track record

For every post, a background worker measures how SPY and up to 4 tagged tickers moved 5, 30 and 60 minutes later, using Yahoo intraday bars:
- **During market hours:** measured from the last price before the post.
- **While the market is closed:** measured from the previous close to 5/30/60 minutes after the next open, so the opening gap is included.

The **Track Record** tab averages these per person and per person × topic, and lists the biggest moves.

Limits:
- Intraday history only goes back about 58 days, so the stats build up while the app runs.
- These moves are correlation, not causation.

## Data sources (all free, no keys)

| Data | Source | Notes |
|---|---|---|
| Truth Social | truthsocial.com public API | Cloudflare blocks Python's HTTP client, so the app uses your system `curl`. If that is rate-limited (HTTP 429), Trump's feed falls back to the trumpstruth.org mirror |
| Officials | Fed, White House, USTR and SEC RSS feeds | |
| People on X | Google News RSS: news about their posts | Not the posts themselves; see below |
| Quotes and charts | Yahoo Finance chart endpoint | Some venues are delayed |
| Congress | Quiver Quant public page (latest 300 trades) | Filings can lag trades by up to 45 days |
| Insiders | OpenInsider (SEC Form 4) | |
| 13F filings | SEC EDGAR current-filings feed | |
| Prediction markets | Polymarket Gamma API, Kalshi public API | |
| Economic calendar | Forex Factory weekly JSON | |

These are scraped or unofficial endpoints, so any of them can change or rate-limit without notice. The **SOURCES** tab shows each source's status, and a broken source never takes down the rest of the app.

### Getting real X posts

No free X feed works anymore (Nitter is dead, and xcancel blocks RSS). Two options:
1. **X API:** paid; read access starts around $200/month. Set the `X_BEARER_TOKEN` environment variable, or put the token in `x_bearer_token` in `config.json`. The `x` sources (Musk, Bessent, Ackman) switch on automatically.
2. **An RSS bridge such as rss.app:** create a feed for an account, then add `{"type": "rss", "person": "Elon Musk", "url": "<feed url>"}` to `sources`.

## Customising (`config.json`)

- `sources`: add or remove people.
  - `truth`: handle plus account id.
  - `rss`: any feed URL.
  - `gnews`: a Google News query.
  - `x`: a handle (needs an API token).
- `rules`: topic → keywords → tickers to tag, plus whether the topic triggers alerts.
- `companies`: company name → ticker.
- `alert_keywords`, `watchlist`, `tape`, `impact_benchmark`.

Restart the server after editing. Posts and impact data are stored in `data/terminal.db`; delete that file to start fresh.

## Layout

```
server/app.py      FastAPI app, pollers, live stream (SSE), API routes
server/feeds.py    Truth Social / X / RSS / Google News collectors
server/tagger.py   keyword → topics, tickers, alert flag
server/impact.py   post-impact measurement and track record
server/market.py   Yahoo quotes and candles
server/extras.py   congress, insiders, 13F, Polymarket, Kalshi, calendar
static/            terminal UI (vanilla JS + TradingView lightweight-charts)
```
