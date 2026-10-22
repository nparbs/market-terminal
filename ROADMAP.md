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

---

## Next up

### Always-on and mobile
- [ ] Run on a home server or cheap VPS (Docker image + systemd) so tracking and alerts continue while the PC is off
- [ ] Phone push alerts through ntfy.sh or a Telegram bot
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
- [ ] Pre-market brief at 8:30 ET: overnight posts, futures, today's data releases, biggest prediction-market swings
- [ ] Prediction-market swing alerts, e.g. rate-cut odds move more than 10 points in an hour
- [ ] Unusual options activity on tickers that were just mentioned (needs a paid feed)
- [ ] Congress and insider cross-check: flag trades in tickers that were recently mentioned in posts
- [ ] Topic heatmap: which topics moved which sectors most
- [ ] Optional AI tagging (Claude API) for sentiment, urgency and better ticker detection, with the keyword tagger kept as a fallback

### Terminal UX
- [ ] Multiple chart panes, or a compare overlay (e.g. NVDA vs SMH vs SPY)
- [ ] Pop-out panels and saved layouts
- [ ] Edit topics and keywords in the UI instead of `config.json`
- [ ] Mark a post's exact time on intraday charts with a vertical line
- [ ] Export the track record to CSV

### Reliability
- [ ] Back off automatically on 429s per source
- [ ] Tests for the tagger and impact math
- [ ] Health check if a source has been silent too long
