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
| Watchlist | Live quotes and sparklines, plus pre-market (`PRE`) and after-hours (`AH`) moves. `●2` means 2 posts mentioned this ticker in the last 24h |
| Chart | Candles with arrow markers where posts landed. Hover a marker to read the post, click it to open the impact view. **KEY** shows posts tagged with this ticker plus alert posts straight from Truth Social or X. **ALL** shows every post |
| Market movers | Live feed. Each post shows ticker chips (click one to chart it), topic tags, and SPY/ticker moves at +5, +30 and +60 minutes |
| Bottom tabs | Brief, News, Economic Calendar, Options Flow, Congress trades, Insider trades (Form 4), Polymarket/Kalshi, Track Record, Post Impact, 13F filings, Source health, Help. `MAX` (or the ⤢ button) hides the chart so the tab fills the space |

### Search and commands

Start typing anywhere and the command bar opens a search dropdown with matching commands, your recent commands, and tickers. Ticker matches come from your watchlist and Yahoo Finance search, so typing `nvid` or `palantir` works. Use ↑/↓ to pick a result, Tab to complete it, and Enter to run it. Every ticker result has a **+ WATCH** button. The chart header has the same button, and each watchlist row has a ✕ on hover to remove it.

### Sorting the watchlist

Use the dropdown in the watchlist header, or the `SORT` command:

| Option | What it does |
|---|---|
| Manual | Your own order. Drag rows to reorder them |
| A → Z | Alphabetical |
| % change ↓ / ↑ | Gainers first, or losers first |
| Biggest move | Largest move in either direction |
| Pre / after-hours move | Largest extended-hours move |
| Volume | Day volume |
| Group: sector / industry / asset type | Collapsible groups, each showing its average move, ordered strongest to weakest. Click a group header to collapse it |
| Post mentions | Tickers mentioned most in posts over the last 24h |
| Unusual options $ | Today's unusual-options premium per ticker |

Sector and industry come from Yahoo for stocks and from a built-in category map for common ETFs (Index ETFs, Bonds & Rates, Commodities, International…). Crypto, futures, indices and FX are grouped by asset type. Lookups are cached in the database (`profiles` table) for 30 days. Your sort choice and collapsed groups are saved with your settings.

### Customising the layout

Open **⚙ Settings** (or type `SETTINGS`) to change:
- **Theme:** 8 dark themes: Bloomberg Amber, Phosphor Green, Midnight Blue, Synthwave, Crimson, Arctic Cyan, Graphite Mono, OLED Gold. You can also set a custom accent color.
- **Up/down colors:** green/red, blue/orange (colorblind-friendly), red-up (Asian convention) or mono.
- **Display:** text size, ticker tape speed, dense rows, compact feed.
- **Panels:** show or hide the watchlist, chart, feed, bottom tabs or ticker tape, or swap sides so the feed is on the left.
- **Watchlist and custom alert keywords.**

To resize panels, drag the borders between them. `LAYOUT` resets the layout, and `THEME <name>` switches themes from the command bar.

Type a ticker anywhere to chart it. Type `HELP` for all commands, for example `NVDA 1Y`, `ADD PLTR`, `FIND tariff`, `ALERTS`, `THEME midnight`, `BRIEF`, `OPT NVDA`, `OPT MENTIONED`, `CONG NVDA`, `INS BUYS`, `KALSHI`, `FEED TRUMP` and `ALERT nvidia`. `Alt+1`…`Alt+0` switch tabs.

## Alerts

A new post triggers an alert (sound, red flash and optional desktop notification) if it comes from a direct source (Truth Social, X or an official feed) and either:
- hits an alert topic: tariffs, China, Fed/rates, war/geopolitics or fiscal policy, or
- contains an alert keyword (`breaking`, `effective immediately`, `executive order`, `sanctions`…), a watchlist company, or one of your `ALERT` keywords.

News-coverage sources (the NEWS badge) don't trigger alerts by default, because they mention companies constantly. To change that, set `"alerts": true` on that source.

Click **🔔 NOTIFY** once to allow desktop notifications. They work while the tab is in the background.

### Phone alerts (ntfy)

To get alerts on your phone, install the [ntfy](https://ntfy.sh) app, subscribe to a hard-to-guess topic, and enter the same topic under **⚙ Settings → Phone alerts**. **SEND TEST** checks it works. You can turn each kind on or off: alert posts (including your custom `ALERT` keywords), unusual options alerts, and the pre-market brief. Pushes are capped at 10 a minute. They only go out while the terminal is running, and anyone who knows the topic name can read them, so pick one nobody will guess (or use your own ntfy server).

## Alert history and links

The **ALERTS** tab lists every alert the terminal has fired: posts, options flow and briefs. Each row links to its source:
- the original post on Truth Social, X or the official site,
- the option contract on Yahoo Finance,
- or the brief.

Links also appear in other places:
- the feed (↗),
- brief alert posts,
- congress members (their Quiver Quant page),
- insider trades (the SEC Form 4 filing and the insider's OpenInsider page),
- unusual-options rows,
- the track record's biggest moves,
- 13F filings, prediction markets and the calendar.

Clicking the alert message in the top bar jumps to the alert.

## Database

Everything is stored in SQLite at `data/terminal.db`:

| Table | Contents |
|---|---|
| `posts` | Every collected post with tags and impact measurements (searchable with `FIND` or the feed's search box) |
| `alerts_log` | Every alert fired |
| `news` | Every headline seen (NEWS → ARCHIVE to search) |
| `congress_trades`, `insider_trades` | Permanent archive of disclosures (ARCHIVE mode in those tabs) |
| `prediction_snapshots` | Hourly Polymarket and Kalshi odds, for history |
| `options_daily`, `options_unusual` | Options flow history |
| `briefs` | Every brief |
| `settings` | Watchlist, custom alerts, theme, layout, watchlist sort and command history. These sync to any browser that opens the terminal |
| `profiles` | Sector / industry / asset type per ticker (30-day cache) |

A background archiver saves news every 10 minutes, congress and insider trades every 30 minutes, and prediction odds every hour. Row counts appear in **⚙ Settings → Database** and the SOURCES tab. Set `MT_DB` to use a different database file.

## Pre-market brief

The brief is built automatically each weekday at 08:30 ET (set `brief.time_et` in config). It covers everything since the last 4:00 PM close:
- **Headline:** S&P and Nasdaq futures, VIX, 10Y, oil, BTC, the number of alert posts, and the day's high-impact releases.
- **Overnight posts:** direct posts by person and topic, plus the full text of alert posts.
- **Futures, macro and global markets:** Nikkei, Hang Seng, Shanghai, DAX, FTSE, Stoxx 50.
- **Biggest movers:** pre-market moves for watchlist and scanned names, plus tickers mentioned overnight.
- **Calendar:** today's US high- and medium-impact releases. A brief built after the close shows the next session's releases instead.
- **Prediction markets:** the biggest 24h swings on Polymarket and Kalshi, skipping near-certain outcomes.
- **Unusual options:** the last session's biggest unusual contracts (excluding 0DTE), tickers with volume far above average, and flow on tickers mentioned overnight.
- **Congress and insiders:** congress disclosures and $100K+ insider buys filed since the close.

When a brief is ready you get a desktop notification. A red dot appears on the BRIEF tab if you are on another tab. Press **BUILD NOW** to build one at any time. Past briefs are kept and can be picked from the dropdown.

## Unusual options flow

Every 10 minutes during market hours (hourly when closed), the app downloads CBOE's free delayed option chains for:
- the `options.universe` list (about 40 liquid names and ETFs),
- your watchlist,
- every ticker mentioned in a direct post in the last 24 hours.

A contract counts as **unusual** when all three hold:
- volume ≥ 500,
- premium (volume × price × 100) ≥ $100K,
- volume ≥ 1.5× open interest. This suggests new positions rather than existing ones being closed.

All three thresholds can be changed in config.

The OPT FLOW tab has two panels:
- **Per-ticker summary:** call and put volume, put/call ratio, IV30 and its change, volume vs the ticker's own average, and the number and dollar value of unusual contracts.
- **Contracts table:** DTE, estimated lean (BULL/BEAR) and fill side (ASK/BID/MID), premium, volume vs OI, IV and % out of the money.

★ marks tickers that were mentioned in a post. Filters: mentioned, watchlist or the current ticker; calls or puts; with or without 0DTE; minimum premium. Sort by unusualness, premium or vol/OI.

**Options alerts** fire when a new unusual contract has $500K+ premium and at least 3× open interest on a ticker mentioned in a post in the last 24 hours. Set `options.alert_scope` to `"watchlist"` or `"all"` to widen this.

Limits:
- CBOE data is delayed about 15 minutes, and it's a snapshot, not trade-by-trade data.
- The fill side compares the last print with the current bid/ask, so treat lean as a hint.
- "Volume vs average" appears once a ticker has 3 days of recorded history.

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
| Option chains | CBOE delayed quotes (cdn.cboe.com) | ~15 min delayed; volume, OI, IV, greeks |
| Economic calendar | Forex Factory weekly JSON | |

These are scraped or unofficial endpoints, so any of them can change or rate-limit without notice. The **SOURCES** tab shows each source's status, and a broken source never takes down the rest of the app.

### Getting real X posts

No free X feed works anymore (Nitter is dead, and xcancel blocks RSS). Two options:
1. **X API:** paid; read access starts around $200/month. Set the `X_BEARER_TOKEN` environment variable, or put the token in `x_bearer_token` in `config.json`. The `x` sources (Musk, Bessent, Ackman) switch on automatically.
2. **An RSS bridge such as rss.app:** create a feed for an account, then add `{"type": "rss", "person": "Elon Musk", "url": "<feed url>"}` to `sources`.

## Tests

```
python -m pip install pytest
python -m pytest tests
```

They cover the keyword tagger, the post-impact math (live, overnight and pending posts, and the track record) and phone pushes. No network access is needed.

## Customising (`config.json`)

- `sources`: add or remove people.
  - `truth`: handle plus account id.
  - `rss`: any feed URL.
  - `gnews`: a Google News query.
  - `x`: a handle (needs an API token).
- `rules`: topic → keywords → tickers to tag, plus whether the topic triggers alerts.
- `companies`: company name → ticker.
- `alert_keywords`, `watchlist`, `tape`, `impact_benchmark`.
- `options`: scan universe, thresholds, alert settings.
- `brief`: build time, futures and global symbols, Polymarket tags.

Restart the server after editing. To run a second copy on another port, `set PORT=8766` before `python -m server.app`. Posts and impact data are stored in `data/terminal.db`; delete that file to start fresh.

## Layout

```
server/app.py      FastAPI app, pollers, live stream (SSE), API routes
server/feeds.py    Truth Social / X / RSS / Google News collectors
server/tagger.py   keyword → topics, tickers, alert flag
server/impact.py   post-impact measurement and track record
server/market.py   Yahoo quotes and candles
server/extras.py   congress, insiders, 13F, Polymarket, Kalshi, calendar
server/options.py  CBOE option-chain scanner and unusual-activity detection
server/brief.py    pre-market brief builder and schedule
static/            terminal UI (vanilla JS + TradingView lightweight-charts)
```
