# Roadmap

## Done (v0.1)

### Core terminal
- [x] Local web app: FastAPI backend, vanilla JS frontend, SQLite storage
- [x] Bloomberg-style dark UI with a command bar: tickers, `ADD`/`DEL`, `NEWS`, `CONG`, `INS`, `PRED`, `TRACK`, `FEED`, `ALERT`, `HELP`
- [x] Keyboard shortcuts: type anywhere to focus the command bar, `Alt+1…0` switch tabs, `Esc` clears
- [x] Ticker tape: futures, indexes, VIX, 10Y yield, DXY, oil, gold, BTC, FX
- [x] Watchlist with live quotes, sparklines, price-change flashes and a post-mention count. Saved in the browser
- [x] Candlestick chart (TradingView lightweight-charts), ranges 1D–5Y
- [x] ET clock and market-session indicator: open, pre-market, after-hours, closed
- [x] One-click launcher (`run.bat`) that installs dependencies

### Market-mover tracking
- [x] Truth Social: Trump and the White House through the public API. It goes through the system `curl` because Cloudflare blocks Python's TLS fingerprint
- [x] Fallback to the trumpstruth.org mirror, keeping the original post IDs so nothing is duplicated
- [x] Backfills about 100 recent posts on first start
- [x] Official RSS feeds: Fed press releases, Fed speeches, White House presidential actions, USTR, SEC
- [x] News coverage through Google News for Musk, the Fed Chair, Bessent, Lutnick, Huang, Ackman, Saylor, China's Commerce Ministry (MOFCOM) and OPEC
- [x] X API support. Turns on when a bearer token is set
- [x] Generic RSS sources, e.g. rss.app feeds for X accounts
- [x] Live push to the browser over SSE
- [x] Feed filters: by person, direct posts only, alerts only

### Tagging and alerts
- [x] Keyword topic rules (15 topics) mapped to tickers, e.g. tariffs → SPY/EEM/FXI, chips → SMH/NVDA
- [x] Cashtags (`$NVDA`), exchange tags (`NASDAQ:XYZ`), company names and watchlist tickers
- [x] Alert triggers: an alert topic, a trigger phrase, a watchlist company, or a custom keyword
- [x] Alert output: sound, red flash, blinking tab title, desktop notifications
- [x] News-coverage sources don't trigger alerts by default, to cut noise

### Post impact
- [x] Background worker measures SPY plus up to 4 tagged tickers at +5, +30 and +60 minutes, plus the peak move within 60 minutes
- [x] Posts made while the market is closed are measured from the prior close to after the next open, so the gap is included
- [x] Chart markers for posts. Hover to read, click for detail. KEY / ALL / OFF modes
- [x] Track record per person and per person × topic, plus the biggest moves after a post

### Side panels
- [x] Congress trades (Quiver Quant): filter by ticker or member, buys/sales, excess return
- [x] Insider trades (OpenInsider / Form 4): latest, buys over $25K, buys over $100K, cluster buys, per ticker
- [x] 13F filings (SEC EDGAR)
- [x] Polymarket (by topic) and Kalshi (Fed, CPI, jobs, GDP, recession, S&P, Nasdaq, oil, BTC)
- [x] Economic calendar (Forex Factory) with an impact filter and next-event highlight
- [x] Market news wire (CNBC, MarketWatch, Investing) plus per-ticker Yahoo headlines
- [x] Source-health tab

## Done (v0.2)

### Pre-market brief
- [x] Built automatically each weekday at a configurable ET time; stored per day with history
- [x] Desktop notification and a BRIEF tab badge when it's ready; `BRIEF` command; BUILD NOW button
- [x] Headline line: futures, VIX, 10Y, oil, BTC, alert count, key releases
- [x] Overnight direct posts by person and topic, with alert posts in full
- [x] Futures, macro and global indexes (Nikkei, Hang Seng, Shanghai, DAX, FTSE, Stoxx 50)
- [x] Pre-market movers across the watchlist, the options universe and mentioned tickers
- [x] Calendar: today's releases, or the next session's after the close
- [x] Biggest 24h prediction-market swings (Polymarket + Kalshi), with stale and near-certain markets filtered out
- [x] Last session's unusual options (excluding 0DTE), volume vs average, flow on mentioned tickers
- [x] Congress disclosures and $100K+ insider buys filed since the close

### Unusual options activity
- [x] Scanner using CBOE's free delayed chains: universe + watchlist + tickers mentioned in the last 24h
- [x] Unusual = volume, premium and vol/OI thresholds (configurable); score ranks by vol/OI and premium
- [x] Estimated fill side (ASK/BID/MID) and bull/bear lean; DTE, IV, delta, % OTM
- [x] Per-ticker summary: put/call ratio, call/put premium, IV30 and change, volume vs recorded average
- [x] Daily totals and unusual contracts stored for history
- [x] OPT FLOW tab: scope / type / 0DTE / min-premium filters and sort options; RESCAN button; `OPT` command
- [x] Live alerts for big unusual contracts on tickers that were just mentioned in a post

### Other
- [x] Pre-market and after-hours moves in the watchlist and chart header
- [x] Maximize toggle for the bottom panel (`MAX`)
- [x] `PORT` environment override for running a second copy
- [x] Fixed: calendar events were being clamped to "now"; timezone-less RSS timestamps are now read as UTC

## Done (v0.3)

### Database
- [x] Settings table: watchlist, custom alerts, theme, layout and command history are saved server-side (migrated from browser storage)
- [x] Alert log of every post, options and brief alert
- [x] Archives: news headlines, congress trades, insider trades (with SEC links), hourly prediction-market snapshots
- [x] Full-text post search (`FIND`, feed search box) and news archive search
- [x] Database stats in Settings and the SOURCES tab; `MT_DB` override

### Customisable UI
- [x] Drag-to-resize panels (watchlist, feed, chart/bottom split), saved per user
- [x] Show or hide any panel or the ticker tape; swap sides; reset layout
- [x] 8 dark themes + custom accent color; 4 up/down palettes including colorblind-friendly
- [x] Text size, dense rows, compact feed, ticker tape speed
- [x] Settings drawer (⚙ / `SETTINGS`) with watchlist and alert keyword management

### Search and watchlist
- [x] Command-bar autocomplete: commands, history, people, themes, local and Yahoo ticker search
- [x] Keyboard navigation (↑↓ / Tab / Enter / Esc)
- [x] + WATCH buttons in the chart header and search results; ✕ on watchlist rows

### Links
- [x] ALERTS tab with links to source posts, option contracts and briefs
- [x] Links on brief alerts, congress members, insider filings, options contracts, track-record moves, the calendar
- [x] Clicking the alert in the top bar jumps to it

## Done (v0.4)

### Watchlist sorting
- [x] Sort menu + `SORT` command: manual, A→Z, % change ↑/↓, biggest move, pre/after-hours move, volume, post mentions, unusual-options premium
- [x] Group by sector, industry or asset type, with collapsible groups showing each group's average move, strongest group first
- [x] Sector/industry lookups (Yahoo for stocks, built-in category map for ETFs) cached in the `profiles` table
- [x] Drag-to-reorder rows in manual mode
- [x] Sort mode and collapsed groups saved in settings

---

## Next up

### Always-on and mobile
- [ ] Run on a home server or cheap VPS (Docker image + systemd) so tracking and alerts continue while the PC is off
- [x] Phone push alerts through ntfy.sh (posts, custom keywords, unusual options, brief ready)
- [ ] Password protection or a Tailscale guide for remote access
- [ ] Better mobile layout, tuned for phones beyond the current stacked panels

### Data
- [ ] Backtest mode: import the full Trump archive from trumpstruth.org and score every post against daily (or 5-minute) history, so the track record doesn't need weeks to fill
- [ ] More Truth Social accounts: Vance, cabinet members, Trump Media
- [ ] Reliable X source: paid API, or a self-hosted RSS bridge
- [ ] Treasury and Commerce press releases, Federal Register executive orders
- [ ] China's Commerce Ministry (MOFCOM) and PBoC official feeds instead of news coverage
- [ ] Earnings calendar plus earnings-time markers on the chart

### Signals and analytics
- [ ] Prediction-market swing alerts, e.g. rate-cut odds move more than 10 points in an hour
- [ ] Closing brief at 16:15 ET: the day's biggest post reactions, options flow summary, after-hours movers
- [ ] Send the brief to phone or email (ntfy / Telegram / SMTP)
- [ ] Options: trade-level flow (sweeps, blocks) from a paid feed (Polygon, Unusual Whales, Tradier)
- [ ] Options: track whether flagged contracts paid off (next-day OI change, price move) to score the signal
- [ ] Options: IV-rank and skew history per ticker; flag IV spikes right after a post
- [ ] Options: mark unusual contracts on the price chart
- [ ] Congress and insider cross-check: flag trades in tickers that were recently mentioned in posts
- [ ] Topic heatmap: which topics moved which sectors most
- [ ] Optional AI tagging (Claude API) for sentiment, urgency and better ticker detection, with the keyword tagger kept as a fallback

### Terminal UX
- [ ] Multiple chart panes, or a compare overlay (e.g. NVDA vs SMH vs SPY)
- [ ] Pop-out panels and multiple named layouts
- [ ] Edit topics, sources and options thresholds in the UI instead of `config.json`
- [ ] Prediction-market history charts from the stored snapshots
- [ ] Watchlist groups / multiple watchlists
- [ ] Mark a post's exact time on intraday charts with a vertical line
- [ ] Export the track record to CSV

### Reliability
- [ ] Back off automatically on 429s per source
- [x] Tests for the tagger and impact math (`tests/`, plus phone pushes)
- [ ] Health check if a source has been silent too long

---

## Ideas backlog

### Watchlist
- [ ] Custom columns: sector, market cap, 52-week range position, distance from 50/200-day average, RSI, earnings date
- [ ] Sort by relative strength vs SPY or vs the stock's own sector ETF (who is beating their group?)
- [ ] Sort by distance from 52-week high/low, gap %, or relative volume (today vs 20-day average)
- [ ] Sparkline period choice (1D / 5D / 1M) and intraday VWAP marker
- [ ] Price alerts per ticker (above / below / % move) with the same notification pipeline
- [ ] Multiple named watchlists or tabs (e.g. "Tariff exposure", "AI", "Trump trades")
- [ ] Smart lists that fill themselves: "mentioned by Trump this week", "unusual options today", "insider cluster buys"
- [ ] Notes and tags per ticker

### Market overview
- [ ] Sector heatmap / treemap from the grouped watchlist and the 11 sector ETFs (1D / 1W / 1M)
- [ ] Sector rotation panel: which sectors lead or lag after tariff, Fed and China posts
- [ ] Market breadth: advancers vs decliners, new highs/lows, % above the 50-day average
- [ ] Rates and FX strip with the yield curve (2s10s) and Fed funds futures-implied path
- [ ] Earnings calendar with expected move (from option prices) and the actual post-earnings move

### Posts and signals
- [ ] Per-sector post exposure: which sectors a person's posts hit most, and how those sectors reacted
- [ ] Fed speaker hawk/dove keyword score and how yields moved after each speech
- [ ] Economic surprise tracker: actual vs forecast for each release, plus the market's reaction
- [ ] VIX and futures spike detector that looks back for the post or headline that likely caused it
- [ ] Social sentiment sources: StockTwits trending, Reddit (r/wallstreetbets) mention counts, Google Trends
- [ ] Short interest and FINRA dark-pool volume per ticker

### Tools
- [ ] Trade journal: log trades and link them to the post or alert that prompted them; review P&L by signal
- [ ] Portfolio tracking with P&L, exposure by sector, and alerts on posts that touch your holdings
- [ ] CSV export for any table; import/export settings as JSON
- [ ] Database retention settings and automatic backups of `terminal.db`
- [ ] Customisable keyboard shortcuts and per-alert-type sounds
- [ ] Installable PWA with push notifications for phone use

