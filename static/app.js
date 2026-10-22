"use strict";

/* ============================================================ state & utils */

const S = {
  cfg: null, watch: [], quotes: {}, posts: [], byId: {},
  sym: "SPY", range: "5d", mkmode: "key", fperson: "", fsrc: "",
  sel: null, tab: "news", sound: true, notify: false, customAlerts: [], profiles: {}, flowPrem: null,
  bars: [], gmt: 0, markerPosts: {}, sub: {},
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (p) => { const r = await fetch("/api/" + p); return r.json(); };
const store = {
  get(k, d) { try { const v = localStorage.getItem("mt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mt." + k, JSON.stringify(v)); } catch {} },
};

const LABELS = { "ES=F": "S&P FUT", "NQ=F": "NDX FUT", "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^DJI": "DOW", "^RUT": "R2K",
  "^VIX": "VIX", "^TNX": "US10Y", "DX-Y.NYB": "DXY", "CL=F": "WTI", "GC=F": "GOLD", "BTC-USD": "BTC",
  "EURUSD=X": "EUR/USD", "USDJPY=X": "USD/JPY", "USDCNY=X": "USD/CNY" };
const SRC = { truth: "TRUTH", x: "X", rss: "OFFICIAL", gnews: "NEWS" };
const PALETTE = ["#ff7a59", "#4aa8ff", "#2bd17e", "#c9a0ff", "#ffd166", "#5ce1e6", "#ff8fc7", "#a3e635", "#f59e0b", "#94a3b8"];
const PERSON_COLORS = { "Donald Trump": "#ff7a59", "White House": "#ffb199", "Elon Musk": "#e7e7e7" };

function personColor(name) {
  if (PERSON_COLORS[name]) return PERSON_COLORS[name];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function fmtPx(v, sym = "") {
  if (v == null || isNaN(v)) return "--";
  const d = sym.endsWith("=X") ? 4 : Math.abs(v) >= 1 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmtPct = (v, d = 2) => (v == null || isNaN(v) ? "--" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "dim");

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short",
  year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function etParts(d = new Date()) {
  const o = {}; for (const p of ET.formatToParts(d)) o[p.type] = p.value;
  o.hour = o.hour === "24" ? "00" : o.hour; return o;
}
function fmtET(ts, withDate) {
  if (!ts) return "";
  const p = etParts(new Date(ts * 1000)), n = etParts();
  const t = `${p.hour}:${p.minute}`;
  return !withDate && p.day === n.day && p.month === n.month ? t : `${p.month} ${p.day} ${t}`;
}
function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
function msg(t, isErr) { const m = $("#cmdmsg"); m.textContent = t; m.style.color = isErr ? "var(--down)" : ""; }

/* ============================================================ clock & market status */

function tickClock() {
  const p = etParts();
  $("#clock").textContent = `${p.weekday} ${p.hour}:${p.minute}:${p.second} ET`;
  const mins = +p.hour * 60 + +p.minute, wk = !["Sat", "Sun"].includes(p.weekday);
  const el = $("#mkt");
  let st = "CLOSED", c = "closed";
  if (wk && mins >= 570 && mins < 960) { st = "MKT OPEN"; c = "open"; }
  else if (wk && mins >= 240 && mins < 570) { st = "PRE-MKT"; c = "ext"; }
  else if (wk && mins >= 960 && mins < 1200) { st = "AFTER-HRS"; c = "ext"; }
  el.textContent = st; el.className = c;
}

/* ============================================================ quotes, watchlist, tape */

function spark(vals, up) {
  if (!vals || vals.length < 2) return "";
  const w = 54, h = 18, mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - mn) / r * h).toFixed(1)}`).join(" ");
  return `<svg class="spark" width="${w}" height="${h}"><polyline fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.2" points="${pts}"/></svg>`;
}

function mentionCount(sym) {
  const since = Date.now() / 1000 - 86400;
  return S.posts.filter((p) => p.ts > since && p.source !== "gnews" && p.tickers.includes(sym)).length;
}

async function refreshQuotes() {
  const syms = [...new Set([...S.watch, ...S.cfg.tape, S.sym])];
  let qs;
  try { qs = await api("quotes?symbols=" + encodeURIComponent(syms.join(","))); } catch { return; }
  const prev = S.quotes;
  S.quotes = {};
  for (const q of qs) S.quotes[q.symbol] = q;
  renderWatch(prev);
  renderTape();
  const ws = S.ui && S.ui.watchSort;
  if (["sector", "industry", "type"].includes(ws)) loadProfiles();
  if (ws === "flow" && (!S.flowAt || Date.now() - S.flowAt > 120000)) { S.flowAt = Date.now(); loadFlowPrem(); }
  renderChartHead();
  $("#wupd").title = "Quotes updated " + etParts().hour + ":" + etParts().minute + " ET";
}

const WSORTS = [
  ["manual", "Manual (drag rows)"], ["az", "Symbol A → Z"], ["chg_d", "% change ↓"], ["chg_a", "% change ↑"],
  ["abs", "Biggest move (either way)"], ["ext", "Pre / after-hours move"], ["vol", "Volume"],
  ["sector", "Group: sector"], ["industry", "Group: industry"], ["type", "Group: asset type"],
  ["mentions", "Post mentions (24h)"], ["flow", "Unusual options $ (today)"],
];
const TYPE_LABEL = { EQUITY: "Stocks", ETF: "ETFs", INDEX: "Indices", FUTURE: "Futures", CRYPTOCURRENCY: "Crypto", CURRENCY: "FX", MUTUALFUND: "Funds" };

function watchValue(mode, s) {
  const q = S.quotes[s] || {};
  switch (mode) {
    case "chg_d": case "chg_a": return q.pct;
    case "abs": return q.pct == null ? null : Math.abs(q.pct);
    case "ext": return q.ext ? Math.abs(q.ext.pct) : null;
    case "vol": return q.volume;
    case "mentions": return mentionCount(s);
    case "flow": return (S.flowPrem || {})[s] ?? null;
  }
  return null;
}

function sortSyms(syms, mode) {
  if (mode === "manual" || !mode) return [...syms];
  if (mode === "az") return [...syms].sort((a, b) => (LABELS[a] || a).localeCompare(LABELS[b] || b));
  const dir = mode === "chg_a" ? 1 : -1;
  return [...syms].sort((a, b) => {
    const x = watchValue(mode, a), y = watchValue(mode, b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;              // missing data always sinks to the bottom
    if (y == null) return -1;
    return (x - y) * dir;
  });
}

function groupOf(mode, s) {
  const p = S.profiles[s] || {};
  if (mode === "sector") return p.sector || "Unclassified";
  if (mode === "industry") return p.industry || p.sector || "Other";
  return TYPE_LABEL[p.type] || p.type || "Other";
}

function watchRow(s, prev, mode) {
  const q = S.quotes[s] || {}, o = prev[s], p = S.profiles[s] || {};
  const fl = o && q.price != null && o.price != null && q.price !== o.price ? (q.price > o.price ? "flash-up" : "flash-down") : "";
  const n = mentionCount(s);
  const sub = mode === "sector" || mode === "type" ? (p.industry || q.name || "") : mode === "industry" ? (q.name || p.sector || "") : (q.name || "");
  const extra = mode === "mentions" ? `${n} post${n === 1 ? "" : "s"}` : mode === "flow" && S.flowPrem && S.flowPrem[s] ? fmtMoney(S.flowPrem[s]) + " flow"
    : mode === "vol" && q.volume ? fmtVol(q.volume) + " vol" : "";
  return `<tr class="click ${s === S.sym ? "sel" : ""} ${fl}" data-sym="${esc(s)}" ${mode === "manual" ? 'draggable="true"' : ""}>
      <td><div class="wsym">${esc(LABELS[s] || s)}${n ? `<span class="dot" title="${n} post(s) mention this in 24h">●${n}</span>` : ""}</div>
          <div class="wname">${esc(q.error ? "no data" : extra || sub)}</div></td>
      <td class="num">${fmtPx(q.price, s)}</td>
      <td class="num ${cls(q.pct)}">${fmtPct(q.pct)}${q.ext ? `<div class="ext ${cls(q.ext.pct)}">${q.ext.session === "pre" ? "PRE" : "AH"} ${fmtPct(q.ext.pct)}</div>` : ""}</td>
      <td class="spk">${spark(q.spark, (q.pct || 0) >= 0)}</td><td><span class="wdel" data-wdel="${esc(s)}" title="Remove from watchlist">✕</span></td></tr>`;
}

function renderWatch(prev = {}) {
  const mode = (S.ui && S.ui.watchSort) || "manual";
  const sel = $("#wsort");
  if (sel && sel.value !== mode) sel.value = mode;
  if (!S.watch.length) { $("#wbody").innerHTML = `<tr><td colspan="5" class="empty">Empty. Search a ticker above and press + WATCH.</td></tr>`; return; }
  if (!["sector", "industry", "type"].includes(mode)) {
    $("#wbody").innerHTML = sortSyms(S.watch, mode).map((s) => watchRow(s, prev, mode)).join("");
    return;
  }
  // Grouped view: one header per group with its average move, groups ordered strongest → weakest.
  const groups = {};
  for (const s of S.watch) (groups[groupOf(mode, s)] ||= []).push(s);
  const avg = (syms) => { const v = syms.map((s) => (S.quotes[s] || {}).pct).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const collapsed = S.ui.watchCollapsed || {};
  const loadingProfiles = S.watch.some((s) => !S.profiles[s]);
  $("#wbody").innerHTML = Object.entries(groups)
    .map(([g, syms]) => [g, syms, avg(syms)])
    .sort((a, b) => (b[2] ?? -1e9) - (a[2] ?? -1e9))
    .map(([g, syms, a]) => {
      const key = mode + ":" + g, shut = !!collapsed[key];
      return `<tr class="wgrp" data-grp="${esc(key)}"><td colspan="5"><span class="caret">${shut ? "▸" : "▾"}</span> ${esc(g.toUpperCase())}
        <span class="dim">${syms.length}</span> <span class="gavg ${cls(a)}">${a != null ? fmtPct(a) : ""}</span></td></tr>`
        + (shut ? "" : sortSyms(syms, "chg_d").map((s) => watchRow(s, prev, mode)).join(""));
    }).join("") + (loadingProfiles ? `<tr><td colspan="5" class="dim" style="padding:6px">Looking up sectors…</td></tr>` : "");
}

const fmtVol = (v) => (v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(v));

async function loadProfiles() {
  const missing = S.watch.filter((s) => !S.profiles[s]);
  if (!missing.length) return;
  try { Object.assign(S.profiles, await api("profiles?symbols=" + encodeURIComponent(missing.join(",")))); } catch { return; }
  for (const s of missing) S.profiles[s] ||= { symbol: s, sector: "Unclassified" };   // don't retry forever
  renderWatch();
}

async function loadFlowPrem() {
  try {
    const d = await api("options/flow");
    S.flowPrem = Object.fromEntries(d.summary.map((r) => [r.symbol, r.unusual_prem]));
  } catch { S.flowPrem = {}; }
  renderWatch();
}

function setWatchSort(mode) {
  S.ui.watchSort = mode; saveUI();
  if (["sector", "industry", "type"].includes(mode)) loadProfiles();
  if (mode === "flow") loadFlowPrem();
  renderWatch();
}

function bindWatchDrag() {
  const body = $("#wbody");
  let dragSym = null;
  body.addEventListener("dragstart", (e) => {
    const tr = e.target.closest("tr[data-sym]");
    if (!tr) return;
    dragSym = tr.dataset.sym;
    e.dataTransfer.effectAllowed = "move";
    tr.classList.add("dragging-row");
  });
  body.addEventListener("dragover", (e) => {
    const tr = e.target.closest("tr[data-sym]");
    if (!dragSym || !tr) return;
    e.preventDefault();
    $$(".drop-before, .drop-after", body).forEach((x) => x.classList.remove("drop-before", "drop-after"));
    const r = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  body.addEventListener("drop", (e) => {
    const tr = e.target.closest("tr[data-sym]");
    if (!dragSym || !tr || tr.dataset.sym === dragSym) return;
    e.preventDefault();
    const after = tr.classList.contains("drop-after");
    const list = S.watch.filter((s) => s !== dragSym);
    list.splice(list.indexOf(tr.dataset.sym) + (after ? 1 : 0), 0, dragSym);
    S.watch = list;
    saveSetting("watchlist", S.watch);
    renderWatch();
  });
  body.addEventListener("dragend", () => {
    dragSym = null;
    $$(".dragging-row, .drop-before, .drop-after", body).forEach((x) => x.classList.remove("dragging-row", "drop-before", "drop-after"));
  });
}

function renderTape() {
  $("#tapeinner").innerHTML = S.cfg.tape.map((s) => {
    const q = S.quotes[s] || {};
    return `<span class="tp" data-sym="${esc(s)}"><b>${esc(LABELS[s] || s)}</b>${fmtPx(q.price, s)} <span class="${cls(q.pct)}">${fmtPct(q.pct)}</span></span>`;
  }).join("");
}

/* ============================================================ chart */

let chart, candles, volume;

function initChart() {
  const LC = window.LightweightCharts;
  chart = LC.createChart($("#chart"), {  // colours are replaced by applyChartTheme() from ui.js
    autoSize: true,
    layout: { background: { type: "solid", color: "#000" }, textColor: "#8b949e", fontFamily: "IBM Plex Mono, Consolas, monospace", fontSize: 11 },
    grid: { vertLines: { color: "#0d1013" }, horzLines: { color: "#0d1013" } },
    rightPriceScale: { borderColor: "#1d2227" },
    timeScale: { borderColor: "#1d2227", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  });
  candles = chart.addCandlestickSeries({ upColor: "#2bd17e", downColor: "#ff4d4f", borderVisible: false, wickUpColor: "#2bd17e", wickDownColor: "#ff4d4f" });
  volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#1f2a33" });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  chart.subscribeCrosshairMove((p) => {
    const tip = $("#tip");
    const posts = p.time && S.markerPosts[p.time];
    if (!posts || !p.point) { tip.style.display = "none"; return; }
    tip.innerHTML = posts.slice(0, 3).map((x) => `<div class="tp-p"><div class="tp-h">${esc(fmtET(x.ts, true))} · ${esc(x.person)}</div>${esc(x.text.slice(0, 220))}</div>`).join("")
      + (posts.length > 3 ? `<div class="dim">+${posts.length - 3} more</div>` : "");
    const box = $("#chartbox").getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = Math.min(p.point.x + 14, box.width - 350) + "px";
    tip.style.top = Math.max(4, p.point.y - 30) + "px";
  });
  chart.subscribeClick((p) => {
    const posts = p.time && S.markerPosts[p.time];
    if (posts) selectPost(posts[0].id, true);
  });
}

async function loadChart(sym, range) {
  S.sym = sym.toUpperCase();
  if (range) S.range = range;
  $$("#ranges button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.range));
  $("#csym").textContent = LABELS[S.sym] || S.sym;
  $("#cname").textContent = "loading…";
  renderWatch();
  const d = await api(`chart?symbol=${encodeURIComponent(S.sym)}&range=${S.range}`);
  if (d.error || !d.bars || !d.bars.length) {
    $("#cname").textContent = "no data for " + S.sym; candles.setData([]); volume.setData([]); S.bars = [];
    msg("No chart data for " + S.sym, true); return;
  }
  S.gmt = d.gmtoffset || 0;
  S.bars = d.bars;
  candles.setData(d.bars.map((b) => ({ time: b.time + S.gmt, open: b.open, high: b.high, low: b.low, close: b.close })));
  applyChartTheme();
  chart.timeScale().fitContent();
  saveSetting("sym", S.sym);
  renderWatchBtn();
  $("#cname").textContent = d.name || "";
  renderChartHead();
  updateMarkers();
  if (!S.quotes[S.sym]) refreshQuotes();
  if (S.tab === "news" && S.sub.newsSym) renderTab();
  if (S.tab === "ins" && S.sub.insMode === "sym") renderTab();
  if (S.tab === "flow" && S.sub.flowScope === "sym") renderTab();
}

function renderChartHead() {
  const q = S.quotes[S.sym];
  if (!q) return;
  $("#cpx").textContent = fmtPx(q.price, S.sym);
  $("#cchg").innerHTML = `<span class="${cls(q.change)}">${q.change != null ? (q.change > 0 ? "+" : "") + fmtPx(q.change, S.sym) : ""} ${fmtPct(q.pct)}</span>`
    + (q.ext ? ` <span class="dim">${q.ext.session === "pre" ? "PRE" : "AFTER"}</span> <span class="${cls(q.ext.pct)}">${fmtPx(q.ext.price, S.sym)} ${fmtPct(q.ext.pct)}</span>` : "");
}

function markerCandidates() {
  if (S.mkmode === "off" || !S.bars.length) return [];
  const t0 = S.bars[0].time;
  // KEY = posts tagged with this ticker, plus alert-level posts straight from people (Truth Social / X)
  return S.posts.filter((p) => p.ts >= t0 && (S.mkmode === "all" || p.tickers.includes(S.sym)
    || (isAlert(p) && (p.source === "truth" || p.source === "x"))));
}

function updateMarkers() {
  S.markerPosts = {};
  const bars = S.bars;
  if (!bars.length) { candles.setMarkers([]); return; }
  for (const p of markerCandidates()) {
    let lo = 0, hi = bars.length - 1;           // last bar starting at or before the post
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].time <= p.ts) lo = m; else hi = m - 1; }
    const t = bars[lo].time + S.gmt;
    (S.markerPosts[t] ||= []).push(p);
  }
  const markers = Object.entries(S.markerPosts).map(([t, ps]) => {
    const alert = ps.some(isAlert), sel = ps.some((p) => p.id === S.sel);
    const initials = [...new Set(ps.map((p) => p.person.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)))].join(",");
    return { time: +t, position: "aboveBar", shape: "arrowDown", size: sel ? 2 : 1,
      color: sel ? cssVar("amber") : alert ? "#ff3b3b" : personColor(ps[0].person), text: initials + (ps.length > 1 ? `×${ps.length}` : "") };
  }).sort((a, b) => a.time - b.time);
  candles.setMarkers(markers);
}

/* ============================================================ feed */

function customMatch(p) {
  const t = (p.text || "").toLowerCase();
  return S.customAlerts.find((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t));
}
const isAlert = (p) => p.alert || !!customMatch(p);

function filteredPosts() {
  return (S.search ? S.search.results : S.posts).filter((p) => (!S.fperson || p.person === S.fperson)
    && (S.fsrc !== "direct" || p.source !== "gnews")
    && (S.fsrc !== "alert" || isAlert(p)));
}

function impactLine(p) {
  const im = p.impact && p.impact.tickers;
  if (!im) return "";
  const b = S.cfg.benchmark;
  const order = [b, ...Object.keys(im).filter((t) => t !== b)].filter((t) => im[t] && !im[t].error).slice(0, 3);
  if (!order.length) return "";
  const parts = order.map((t) => {
    const v = im[t];
    const cells = ["r5", "r30", "r60"].filter((k) => v[k] != null).map((k) => `${k.slice(1)}m <b class="${cls(v[k])}">${fmtPct(v[k])}</b>`).join(" ");
    return cells ? `${esc(t)} ${cells}` : "";
  }).filter(Boolean);
  if (!parts.length) return `<div class="imp">Δ ${p.impact.session === "pending" ? "measured after the next market open" : "waiting for market data…"}</div>`;
  const sess = p.impact.session === "next-open" ? " <span title='Posted while market closed: measured from prior close to after next open'>(next open)</span>" : "";
  return `<div class="imp">Δ ${parts.join(" · ")}${sess}</div>`;
}

function postHTML(p) {
  const al = isAlert(p);
  return `<div class="post ${al ? "alert" : ""} ${p.id === S.sel ? "sel" : ""}" data-id="${esc(p.id)}">
    <div class="pmeta">
      <span class="ptime" title="${esc(fmtET(p.ts, true))} ET">${esc(fmtET(p.ts))}</span>
      <span class="pwho" style="color:${personColor(p.person)}">${esc(p.person)}</span>
      <span class="badge b-${esc(p.source)}">${SRC[p.source] || p.source}</span>
      ${al ? `<span class="badge b-alert">ALERT</span>` : ""}
      <span class="sp" style="flex:1"></span>
      <span class="dim">${ago(p.ts)}</span>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="Open original">↗</a>` : ""}
    </div>
    <div class="ptext">${esc(p.text)}</div>
    ${p.tickers.length || p.categories.length ? `<div class="ptags">${p.tickers.map((t) => `<span class="chip" data-sym="${esc(t)}">${esc(t)}</span>`).join("")}${p.categories.map((c) => `<span class="cat">${esc(c)}</span>`).join("")}</div>` : ""}
    ${impactLine(p)}
  </div>`;
}

function renderFeed() {
  const list = filteredPosts().slice(0, 300);
  const el = $("#feed"), top = el.scrollTop;
  el.innerHTML = (S.search ? `<div class="empty" style="padding:6px 9px">${list.length} stored posts match “${esc(S.search.q)}” · <a href="#" id="fclear">clear</a></div>` : "")
    + (list.map(postHTML).join("") || `<div class="empty">No posts for this filter.${S.search ? "" : " Sources poll every 30s-10m."}</div>`);
  el.scrollTop = top;
  $("#fcount").textContent = `${list.length}`;
}

function mergePosts(list) {
  for (const p of list) { S.byId[p.id] = Object.assign(S.byId[p.id] || {}, p); }
  S.posts = Object.values(S.byId).sort((a, b) => b.ts - a.ts);
}

function fillPeople() {
  const people = [...new Set([...S.cfg.people, ...S.posts.map((p) => p.person)])].sort();
  const sel = $("#fperson");
  sel.innerHTML = `<option value="">All people (${people.length})</option>` + people.map((p) => `<option ${p === S.fperson ? "selected" : ""}>${esc(p)}</option>`).join("");
}

async function reloadPosts() {
  try { mergePosts(await api("posts?limit=600")); } catch { return; }
  renderFeed(); updateMarkers(); renderWatch();
}

function selectPost(id, fromChart) {
  S.sel = id;
  $$(".post").forEach((e) => e.classList.toggle("sel", e.dataset.id === id));
  if (fromChart) {
    const el = $(`.post[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  updateMarkers();
  showTab("impact");
}

/* ============================================================ alerts & live stream */

let audioCtx = null;
function beep() {
  if (!S.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [660, 0.16], [880, 0.32]].forEach(([f, t]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "square"; g.gain.value = 0.06;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.12);
    });
  } catch {}
}

let titleTimer = null;
function notifyUser({ title, body, tag, blink, onclick }) {
  beep();
  msg(`⚠ ${title}: ${body.slice(0, 120)}`);
  S.lastAlertAction = onclick;
  $("#cmdmsg").style.cursor = onclick ? "pointer" : "";
  if (S.notify && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body: body.slice(0, 260), tag });
      n.onclick = () => { window.focus(); onclick && onclick(); };
    } catch {}
  }
  clearInterval(titleTimer);
  let i = 0;
  titleTimer = setInterval(() => {
    document.title = i % 2 ? "Market Terminal" : blink;
    if (++i > 30) { clearInterval(titleTimer); document.title = "Market Terminal"; }
  }, 1000);
}

function fireAlert(p) {
  notifyUser({
    title: `⚠ ${p.person} (${SRC[p.source] || p.source})`, tag: p.id,
    body: p.text.slice(0, 240) + (p.tickers.length ? `\n${p.tickers.join(" ")}` : ""),
    blink: `⚠ ${p.person.toUpperCase()} POSTED`, onclick: () => selectPost(p.id, true),
  });
}

const fmtMoney = (v) => v == null ? "--" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`;
const fmtInt = (v) => v == null ? "--" : Math.round(v).toLocaleString("en-US");
const contractLabel = (u) => `${u.symbol} ${u.exp.slice(5)} ${u.strike}${u.type}`;

let flowTimer = null;
function onFlow(ev) {
  const u = ev.item;
  if (S.tab === "flow" && !flowTimer) flowTimer = setTimeout(() => { flowTimer = null; renderTab(); }, 15000);
  if (!ev.notify) return;
  notifyUser({
    title: `⚡ Unusual options: ${contractLabel(u)}`, tag: u.contract,
    body: `${fmtMoney(u.premium)} premium · ${fmtInt(u.volume)} contracts (${u.vol_oi}× OI) · ${u.fill}${u.lean ? " · leans " + u.lean : ""}${u.mentioned ? " · mentioned in a post today" : ""}`,
    blink: `⚡ ${u.symbol} OPTIONS FLOW`, onclick: () => { loadChart(u.symbol); S.sub.flowScope = "sym"; showTab("flow"); },
  });
}

function onBrief(ev) {
  if (S.tab === "brief") renderTab();
  else { S.briefUnseen = true; renderTabs(); }
  notifyUser({ title: `☀ ${ev.kind} ready`, body: ev.headline || "Open the BRIEF tab", tag: "brief-" + ev.day,
    blink: "☀ BRIEF READY", onclick: () => showTab("brief") });
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onopen = () => { $("#conn").className = "ok"; };
  es.onerror = () => { $("#conn").className = "bad"; };
  es.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "flow") return onFlow(ev);
    if (ev.type === "brief") return onBrief(ev);
    if (ev.type !== "post") return;
    const p = ev.post;
    if (S.byId[p.id]) return;
    mergePosts([p]);
    renderFeed(); updateMarkers(); renderWatch();
    if (!S.cfg.people.includes(p.person)) { S.cfg.people.push(p.person); fillPeople(); }
    const fresh = Date.now() / 1000 - p.ts < 1800;
    const el = $(`.post[data-id="${CSS.escape(p.id)}"]`);
    if (p.notify || (fresh && customMatch(p) && p.source !== "gnews")) {
      if (el) el.classList.add("newalert");
      fireAlert(p);
    } else if (el) el.classList.add("new");
  };
}

/* ============================================================ bottom tabs */

const TABS = [
  ["brief", "BRIEF"], ["news", "NEWS"], ["cal", "ECO CAL"], ["flow", "OPT FLOW"], ["cong", "CONGRESS"], ["ins", "INSIDERS"],
  ["pred", "PREDICT"], ["track", "TRACK REC"], ["impact", "POST IMPACT"], ["alerts", "ALERTS"], ["f13", "13F"], ["status", "SOURCES"], ["help", "HELP"],
];

function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([id, label], i) => {
    const k = i < 10 ? (i + 1) % 10 : "";
    const dot = id === "brief" && S.briefUnseen ? `<span class="tabdot">●</span>` : "";
    return `<button data-tab="${id}" class="${S.tab === id ? "on" : ""}" ${k !== "" ? `title="Alt+${k}"` : ""}><span class="k">${k}</span>${label}${dot}</button>`;
  }).join("") + `<span style="flex:1"></span><button id="maxbtn" title="Maximize this panel (MAX)">${S.max ? "⤡ RESTORE" : "⤢ MAX"}</button>`;
}

function showTab(id) { S.tab = id; if (id === "brief") S.briefUnseen = false; saveSetting("tab", id); renderTabs(); renderTab(); }

function seg(name, opts, cur) {
  return `<span class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${v === cur ? "on" : ""}">${esc(l)}</button>`).join("")}</span>`;
}
const chip = (t) => (t ? `<span class="chip" data-sym="${esc(t)}">${esc(t)}</span>` : `<span class="dim">--</span>`);
const loading = () => { $("#tabbody").innerHTML = `<div class="empty">Loading…</div>`; };
const errBox = (d) => `<div class="empty">Source unavailable: ${esc(d.error)}<br>Free sources sometimes rate-limit or change layout; it will retry on next refresh.</div>`;

let tabSeq = 0;
async function renderTab() {
  const id = S.tab, my = ++tabSeq;
  const bar = $("#tabbar2"), body = $("#tabbody");
  const fn = TAB_RENDER[id];
  if (!fn) return;
  try {
    await fn(bar, body, () => my === tabSeq);
  } catch (e) {
    if (my === tabSeq) body.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

const TAB_RENDER = {
  async brief(bar, body, live) {
    const days = await api("brief/days");
    if (!live()) return;
    const day = S.sub.briefDay || "";
    const draw = (b) => {
      bar.innerHTML = `<select id="briefday"><option value="">Latest</option>${days.map((x) => `<option ${x === day ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <button class="tbtn" id="briefnow">↻ BUILD NOW</button>
        ${b && !b.empty ? `<span class="dim">${esc(b.kind)} · built ${esc(fmtET(b.ts, true))} ET · covers since ${esc(fmtET(b.since, true))} ET</span>` : ""}
        <span class="dim">Auto-builds weekdays at ${esc(S.cfg.brief_time || "08:30")} ET</span>`;
      $("#briefday").onchange = (e) => { S.sub.briefDay = e.target.value; renderTab(); };
      $("#briefnow").onclick = async () => { body.innerHTML = `<div class="empty">Building brief…</div>`; draw(await api("brief?refresh=1")); };
      if (!b || b.empty) { body.innerHTML = `<div class="empty">No brief yet. One is built automatically each weekday at ${esc(S.cfg.brief_time || "08:30")} ET, or press BUILD NOW.</div>`; return; }
      if (b.error) { body.innerHTML = errBox(b); return; }
      body.innerHTML = briefHTML(b);
    };
    const cached = await api(day ? "brief?day=" + day : "brief");
    if (live()) draw(cached);
  },

  async flow(bar, body, live) {
    const st = { flowType: "", flow0: "hide", flowMin: "100000", flowScope: "", flowSort: "score", ...S.sub };
    S.sub = { ...S.sub, ...st };
    const scopeOpts = [["", "ALL"], ["mentioned", "MENTIONED"], ["watch", "WATCHLIST"], ["sym", S.sym]];
    bar.innerHTML = seg("flowScope", scopeOpts, st.flowScope) + seg("flowType", [["", "C+P"], ["C", "CALLS"], ["P", "PUTS"]], st.flowType)
      + seg("flow0", [["hide", "NO 0DTE"], ["show", "+0DTE"]], st.flow0)
      + seg("flowMin", [["100000", "$100K+"], ["500000", "$500K+"], ["1000000", "$1M+"]], st.flowMin)
      + seg("flowSort", [["score", "UNUSUAL"], ["premium", "PREMIUM"], ["vol_oi", "VOL/OI"]], st.flowSort)
      + `<button class="tbtn" id="rescan">↻ RESCAN</button><span class="dim" id="flowasof"></span>`;
    if (!body.querySelector(".flowgrid")) loading();
    const d = await api("options/flow");
    if (!live()) return;
    $("#rescan").onclick = async () => { await fetch("/api/options/scan", { method: "POST" }); msg("Options rescan started (takes ~20s)"); setTimeout(renderTab, 20000); };
    if (!d.summary.length) { body.innerHTML = `<div class="empty">${d.scanning ? "First options scan in progress…" : "No options data yet."} Scanning ${d.universe_size} tickers from CBOE.</div>`; return; }
    const asof = d.summary[0].asof;
    $("#flowasof").textContent = `CBOE delayed · data as of ${asof.replace("T", " ")} ET · scanned ${ago(d.last_scan)} ago · ${d.summary.length} tickers`;
    const inScope = (s, mentioned) => !st.flowScope || (st.flowScope === "mentioned" && mentioned) || (st.flowScope === "watch" && S.watch.includes(s)) || (st.flowScope === "sym" && s === S.sym);
    const rows = d.summary.filter((r) => inScope(r.symbol, r.mentioned));
    const items = d.unusual.filter((u) => inScope(u.symbol, u.mentioned) && (!st.flowType || u.type === st.flowType)
      && (st.flow0 === "show" || u.dte > 0) && u.premium >= +st.flowMin).sort((a, b) => b[st.flowSort] - a[st.flowSort]);
    const star = (m) => (m ? `<span class="amber" title="Mentioned in a post in the last 24h">★</span>` : "");
    body.innerHTML = `<div class="flowgrid">
      <div class="fcol"><table><thead><tr><th>TICKER</th><th class="num">CHG</th><th class="num">CALL VOL</th><th class="num">PUT VOL</th><th class="num">P/C</th><th class="num">IV30</th><th class="num" title="Total contract volume vs this ticker's recorded average (needs 3+ days of history)">VOL/AVG</th><th class="num">UNUSUAL</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click ${r.symbol === S.sym ? "sel" : ""}" data-flowsym="${esc(r.symbol)}"><td>${star(r.mentioned)} <span class="wsym">${esc(r.symbol)}</span></td>
        <td class="num ${cls(r.change_pct)}">${fmtPct(r.change_pct)}</td><td class="num">${fmtInt(r.call_vol)}</td><td class="num">${fmtInt(r.put_vol)}</td>
        <td class="num ${r.pc_ratio > 1.2 ? "down" : r.pc_ratio < 0.6 ? "up" : ""}" title="Call premium ${fmtMoney(r.call_prem)} · put premium ${fmtMoney(r.put_prem)}">${r.pc_ratio ?? "--"}</td>
        <td class="num">${r.iv30 != null ? r.iv30.toFixed(1) : "--"}<span class="${cls(r.iv30_change)}" style="font-size:10px"> ${r.iv30_change != null ? (r.iv30_change > 0 ? "+" : "") + r.iv30_change.toFixed(1) : ""}</span></td>
        <td class="num ${r.vol_vs_avg >= 2 ? "amber" : ""}">${r.vol_vs_avg != null ? r.vol_vs_avg.toFixed(1) + "×" : `<span class="dim" title="${r.history_days || 0} days recorded">--</span>`}</td>
        <td class="num">${r.unusual_count} · ${fmtMoney(r.unusual_prem)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="fcol"><table><thead><tr><th>CONTRACT</th><th class="num">DTE</th><th>LEAN · FILL</th><th class="num">PREMIUM</th><th class="num">VOL</th><th class="num">OI</th><th class="num">VOL/OI</th><th class="num">LAST</th><th class="num">IV</th><th class="num">OTM</th></tr></thead><tbody>
      ${items.slice(0, 200).map((u) => `<tr><td>${star(u.mentioned)} <span class="chip" data-sym="${esc(u.symbol)}">${esc(u.symbol)}</span> ${esc(u.exp.slice(5))} <b class="${u.type === "C" ? "up" : "down"}">${u.strike}${u.type}</b></td>
        <td class="num">${u.dte}</td><td><span class="${u.lean === "bull" ? "up" : u.lean === "bear" ? "down" : "dim"}">${u.lean === "bull" ? "▲ BULL" : u.lean === "bear" ? "▼ BEAR" : "·"}</span> <span class="dim">${u.fill}</span></td>
        <td class="num" style="color:#fff">${fmtMoney(u.premium)}</td><td class="num">${fmtInt(u.volume)}</td><td class="num dim">${fmtInt(u.oi)}</td><td class="num ${u.vol_oi >= 5 ? "amber" : ""}">${u.vol_oi}×</td>
        <td class="num">${u.last}</td><td class="num dim" title="delta ${u.delta != null ? u.delta.toFixed(2) : "?"}">${u.iv}</td>
        <td class="num ${u.otm_pct < 0 ? "dim" : ""}" title="${u.otm_pct < 0 ? "in the money" : "out of the money"}">${u.otm_pct != null ? u.otm_pct.toFixed(1) + "%" : ""}</td>
        <td><a href="https://finance.yahoo.com/quote/${esc(u.contract)}/" target="_blank" rel="noopener" title="Open contract on Yahoo Finance">↗</a></td></tr>`).join("")}
      </tbody></table>${items.length ? "" : `<div class="empty">No contracts match these filters.</div>`}
      <div class="note" style="padding:6px 8px">Unusual = volume ≥ ${fmtInt(500)}, premium ≥ $100K and volume ≥ 1.5× open interest (new positions likely). Fill/lean are estimated from the last print vs the current bid/ask, not trade-by-trade data. Negative OTM = in the money.</div></div>
    </div>`;
  },

  async news(bar, body, live) {
    const mode = S.sub.newsSym || "";
    const q = S.sub.newsQ || "";
    bar.innerHTML = seg("newsSym", [["", "MARKET WIRE"], ["1", `${S.sym} HEADLINES`], ["arch", "ARCHIVE"]], mode)
      + (mode === "arch" ? `<input class="f" id="newsq" placeholder="search stored headlines…" value="${esc(q)}" style="width:220px"><span class="dim">every headline the terminal has seen, stored in SQLite</span>` : "");
    if (mode === "arch") { const i = $("#newsq"); i.onchange = () => { S.sub.newsQ = i.value.trim(); renderTab(); }; }
    loading();
    const d = await api(mode === "arch" ? "news/archive?q=" + encodeURIComponent(q) : mode ? "news?symbol=" + encodeURIComponent(S.sym) : "news");
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    body.innerHTML = `<table><thead><tr><th>TIME ET</th><th>SRC</th><th>HEADLINE</th><th>TICKERS</th></tr></thead><tbody>${d.map((n) => `
      <tr><td class="dim" style="white-space:nowrap">${esc(fmtET(n.ts))}</td><td class="dim">${esc(n.source)}</td>
      <td class="wrap"><a href="${esc(n.url)}" target="_blank" rel="noopener" class="${n.alert ? "down" : ""}" style="${n.alert ? "" : "color:var(--text)"}">${esc(n.title)}</a></td>
      <td>${(n.tickers || []).slice(0, 4).map(chip).join(" ")}</td></tr>`).join("")}</tbody></table>`;
  },

  async cal(bar, body, live) {
    const cc = S.sub.calCountry ?? "USD", imp = S.sub.calImp ?? "hm";
    bar.innerHTML = seg("calCountry", [["USD", "USD"], ["", "ALL"]], cc) + seg("calImp", [["hm", "HIGH+MED"], ["", "ALL"]], imp)
      + `<span class="dim">This week · times ET</span><a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">forexfactory.com ↗</a>`;
    loading();
    const d = await api("calendar");
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    const now = Date.now() / 1000;
    const rows = d.filter((e) => (!cc || e.country === cc) && (!imp || ["High", "Medium"].includes(e.impact)));
    const nextIdx = rows.findIndex((e) => e.ts > now);
    let lastDay = "";
    body.innerHTML = `<table><thead><tr><th>DAY</th><th>TIME</th><th>CCY</th><th>IMPACT</th><th>EVENT</th><th class="num">ACTUAL</th><th class="num">FCST</th><th class="num">PREV</th></tr></thead><tbody>${rows.map((e, i) => {
      const p = etParts(new Date(e.ts * 1000)), day = `${p.weekday} ${p.month} ${p.day}`;
      const show = day !== lastDay; lastDay = day;
      return `<tr class="${e.ts < now ? "past" : ""} ${i === nextIdx ? "next" : ""}"><td class="amber">${show ? day : ""}</td><td>${p.hour}:${p.minute}</td><td>${esc(e.country)}</td>
        <td class="imp-${esc(e.impact)}">${esc(e.impact)}</td><td>${esc(e.title)}</td><td class="num">${esc(e.actual || "")}</td><td class="num dim">${esc(e.forecast || "")}</td><td class="num dim">${esc(e.previous || "")}</td></tr>`;
    }).join("")}</tbody></table>` + (rows.length ? "" : `<div class="empty">No events for this filter.</div>`);
  },

  async cong(bar, body, live) {
    const q = S.sub.congQ || "", txn = S.sub.congTxn || "", src = S.sub.congSrc || "";
    bar.innerHTML = seg("congSrc", [["", "LATEST 300"], ["arch", "ARCHIVE"]], src)
      + `<input class="f" id="congq" placeholder="ticker or member" value="${esc(q)}" style="width:170px">`
      + seg("congTxn", [["", "ALL"], ["Purchase", "BUYS"], ["Sale", "SALES"]], txn)
      + `<span class="dim">${src ? "Every disclosure stored since the terminal started" : "Via Quiver Quant"} · filings lag trades by up to 45 days</span>`;
    loading();
    const d = await api(src ? "congress?archive=1" : "congress");
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    const ql = q.toLowerCase();
    const rows = d.filter((r) => (!txn || r.txn.startsWith(txn)) && (!q || (r.ticker || "").toLowerCase() === ql || r.member.toLowerCase().includes(ql)));
    body.innerHTML = `<table><thead><tr><th>TRADED</th><th>FILED</th><th>MEMBER</th><th>TICKER</th><th>TXN</th><th>AMOUNT</th><th>ASSET</th><th class="num">XS RET</th></tr></thead><tbody>${rows.map((r) => `
      <tr><td>${esc(r.traded)}</td><td class="dim">${esc(r.filed)}</td>
      <td>${r.member_url ? `<a href="${esc(r.member_url)}" target="_blank" rel="noopener" class="party-${esc(r.party)}">${esc(r.member)}</a>` : `<span class="party-${esc(r.party)}">${esc(r.member)}</span>`} <span class="dim">${esc(r.party)}-${esc(r.chamber[0] || "")}</span></td>
      <td>${chip(r.ticker)}</td><td class="${r.txn.startsWith("Purchase") ? "up" : r.txn.startsWith("Sale") ? "down" : ""}">${esc(r.txn)}</td>
      <td>${esc(r.amount)}</td><td class="dim" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.asset)}</td>
      <td class="num ${cls(r.excess_return)}" title="Return vs SPY since trade">${r.excess_return != null ? fmtPct(r.excess_return, 1) : ""}</td></tr>`).join("")}</tbody></table>`
      + (rows.length ? "" : `<div class="empty">No matching trades in the latest 300 disclosures.</div>`);
    const inp = $("#congq");
    inp.onchange = () => { S.sub.congQ = inp.value.trim(); renderTab(); };
  },

  async ins(bar, body, live) {
    const mode = S.sub.insMode || "latest";
    bar.innerHTML = seg("insMode", [["latest", "LATEST"], ["buys", "BUYS $25K+"], ["big", "BUYS $100K+"], ["cluster", "CLUSTER BUYS"], ["sym", `${S.sym} ONLY`], ["archive", "ARCHIVE"]], mode)
      + `<span class="dim">SEC Form 4 via OpenInsider</span>`;
    loading();
    const d = await api(mode === "sym" ? "insiders?ticker=" + encodeURIComponent(S.sym) : "insiders?mode=" + mode);
    const ilink = (r) => (r.insider_url ? `<a href="${esc(r.insider_url)}" target="_blank" rel="noopener" style="color:var(--text)">${esc(r.insider)}</a>` : esc(r.insider));
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    body.innerHTML = `<table><thead><tr><th>FILED</th><th>TRADED</th><th>TICKER</th><th>COMPANY</th><th>INSIDER</th><th>TITLE</th><th>TYPE</th><th class="num">PRICE</th><th class="num">QTY</th><th class="num">ΔOWN</th><th class="num">VALUE</th><th>FILING</th></tr></thead><tbody>${d.map((r) => `
      <tr><td class="dim" style="white-space:nowrap">${esc(r.filed)}</td><td>${esc(r.traded)}</td><td>${chip(r.ticker)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.company)}</td><td>${ilink(r)}</td><td class="dim">${esc(r.title)}</td>
      <td class="${r.type.startsWith("P") ? "up" : r.type.startsWith("S") ? "down" : ""}">${esc(r.type)}</td>
      <td class="num">${esc(r.price)}</td><td class="num">${esc(r.qty)}</td><td class="num">${esc(r.delta_own)}</td><td class="num ${r.value.startsWith("-") ? "down" : "up"}">${esc(r.value)}</td>
      <td>${r.filing_url ? `<a href="${esc(r.filing_url)}" target="_blank" rel="noopener">SEC ↗</a>` : ""}</td></tr>`).join("")}</tbody></table>`
      + (d.length ? "" : `<div class="empty">No insider filings found.</div>`);
  },

  async f13(bar, body, live) {
    bar.innerHTML = `<span class="dim">Latest 13F-HR filings (quarterly fund holdings) from SEC EDGAR · click to open the filing</span>`;
    loading();
    const d = await api("13f");
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    body.innerHTML = `<table><thead><tr><th>FILED ET</th><th>FORM</th><th>FILER</th><th>CIK</th></tr></thead><tbody>${d.map((r) => `
      <tr><td class="dim">${esc(fmtET(r.ts, true))}</td><td>${esc(r.form)}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.filer)}</a></td><td class="dim">${esc(r.cik)}</td></tr>`).join("")}</tbody></table>`;
  },

  async pred(bar, body, live) {
    const venue = S.sub.predVenue || "poly", tag = S.sub.predTag || "economy";
    const tags = ["economy", "fed-rates", "finance", "business", "tariffs", "crypto", "politics", "geopolitics"];
    bar.innerHTML = seg("predVenue", [["poly", "POLYMARKET"], ["kalshi", "KALSHI"]], venue)
      + (venue === "poly" ? seg("predTag", tags.map((t) => [t, t.toUpperCase()]), tag) : `<span class="dim">Fed, CPI, jobs, GDP, recession, S&P, Nasdaq, oil, BTC</span>`);
    loading();
    const d = await api(venue === "kalshi" ? "predictions?venue=kalshi" : "predictions?tag=" + tag);
    if (!live()) return;
    if (d.error) { body.innerHTML = errBox(d); return; }
    body.innerHTML = `<div class="pcards">${d.map((e) => `
      <div class="pcard"><h4><a href="${esc(e.url)}" target="_blank" rel="noopener" style="color:#fff">${esc(e.title)}</a></h4>
      <div class="meta">${e.volume24h ? "24h vol $" + Math.round(e.volume24h).toLocaleString() : esc(e.series || "")}${e.end ? " · ends " + esc(e.end) : ""}</div>
      ${e.markets.map((m) => `<div class="prow"><div class="lbl"><div class="bar" style="width:${(m.yes * 100).toFixed(1)}%"></div><span>${esc(m.label)}</span></div>
        <div class="num" style="color:#fff">${(m.yes * 100).toFixed(m.yes < 0.01 ? 1 : 0)}%</div>
        <div class="num ${cls(m.change)}">${m.change ? (m.change > 0 ? "+" : "") + (m.change * 100).toFixed(1) : ""}</div></div>`).join("")}
      </div>`).join("")}</div>` + (d.length ? "" : `<div class="empty">No open markets.</div>`);
  },

  async track(bar, body, live) {
    bar.innerHTML = `<span class="dim">How the benchmark (${esc(S.cfg.benchmark)}) moved after each person's posts. Builds up as the terminal runs; intraday data covers ~58 days.</span>`;
    loading();
    const d = await api("trackrecord");
    if (!live()) return;
    const c = (v) => `<td class="num ${cls(v)}">${v != null ? fmtPct(v, 3) : "--"}</td>`;
    const pct = (v) => `<td class="num">${v != null ? v + "%" : "--"}</td>`;
    body.innerHTML = `
      <div class="detail"><div class="amber">BY PERSON</div>
      <table><thead><tr><th>PERSON</th><th class="num">POSTS</th><th class="num">AVG 5M</th><th class="num">AVG 30M</th><th class="num">AVG 60M</th><th class="num">AVG |30M|</th><th class="num">% UP 30M</th></tr></thead><tbody>
      ${d.people.map((r) => `<tr class="click" data-person="${esc(r.person)}"><td style="color:${personColor(r.person)}">${esc(r.person)}</td><td class="num">${r.n}</td>${c(r.avg5)}${c(r.avg30)}${c(r.avg60)}<td class="num">${r.abs30 != null ? r.abs30.toFixed(3) + "%" : "--"}</td>${pct(r.up30)}</tr>`).join("")}
      </tbody></table>
      <div class="amber" style="margin-top:12px">BY PERSON × TOPIC <span class="dim">(2+ posts, sorted by avg 30m move)</span></div>
      <table><thead><tr><th>PERSON</th><th>TOPIC</th><th class="num">N</th><th class="num">AVG 5M</th><th class="num">AVG 30M</th><th class="num">AVG 60M</th><th class="num">% UP 30M</th></tr></thead><tbody>
      ${d.categories.map((r) => `<tr><td style="color:${personColor(r.person)}">${esc(r.person)}</td><td>${esc(r.category)}</td><td class="num">${r.n}</td>${c(r.avg5)}${c(r.avg30)}${c(r.avg60)}${pct(r.up30)}</tr>`).join("")}
      </tbody></table>
      <div class="amber" style="margin-top:12px">BIGGEST MOVES AFTER A POST <span class="dim">(largest move in any tagged ticker)</span></div>
      <table><thead><tr><th>WHEN</th><th>PERSON</th><th>TICKER</th><th class="num">MOVE</th><th>POST</th></tr></thead><tbody>
      ${d.movers.map((m) => `<tr class="click" data-post="${esc(m.id)}"><td class="dim" style="white-space:nowrap">${esc(fmtET(m.ts, true))}</td><td style="color:${personColor(m.person)}">${esc(m.person)}</td><td>${chip(m.ticker)}</td>${c(m.move)}<td class="wrap">${esc(m.text.slice(0, 140))}${S.byId[m.id] && S.byId[m.id].url ? `<a class="lnk" href="${esc(S.byId[m.id].url)}" target="_blank" rel="noopener">↗</a>` : ""}</td></tr>`).join("")}
      </tbody></table>
      ${d.people.length ? "" : `<div class="empty">No measurements yet. Impact is computed a few minutes after each post (or after the next open for off-hours posts).</div>`}
      <div class="note">Correlation, not causation: a single post's move is mixed with everything else happening in the market. Averages get meaningful after dozens of posts.</div></div>`;
  },

  async impact(bar, body, live) {
    bar.innerHTML = "";
    if (!S.sel) { body.innerHTML = `<div class="empty">Click a post in the feed (or a marker on the chart) to see how the market reacted.</div>`; return; }
    const cached = S.byId[S.sel];
    const draw = (p) => {
      const im = p.impact || {}, tk = im.tickers || {};
      const order = [S.cfg.benchmark, ...Object.keys(tk).filter((t) => t !== S.cfg.benchmark)];
      const c = (v) => `<td class="num ${cls(v)}">${v != null ? fmtPct(v, 2) : `<span class="dim">pending</span>`}</td>`;
      bar.innerHTML = `<span style="color:${personColor(p.person)};font-weight:700">${esc(p.person)}</span><span class="badge b-${esc(p.source)}">${SRC[p.source] || ""}</span>
        <span class="dim">${esc(fmtET(p.ts, true))} ET</span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">open original ↗</a>` : ""}`;
      body.innerHTML = `<div class="detail">
        <div class="dtext">${esc(p.text)}</div>
        <div class="ptags">${p.tickers.map((t) => `<span class="chip" data-sym="${esc(t)}">${esc(t)}</span>`).join("")}${p.categories.map((x) => `<span class="cat">${esc(x)}</span>`).join("")}
          ${p.matched.length ? `<span class="dim">matched: ${esc(p.matched.join(", "))}</span>` : ""}</div>
        <table style="margin-top:10px"><thead><tr><th>TICKER</th><th class="num">+5 MIN</th><th class="num">+30 MIN</th><th class="num">+60 MIN</th><th class="num">PEAK 60M</th></tr></thead><tbody>
        ${order.filter((t) => tk[t]).map((t) => tk[t].error ? `<tr><td>${chip(t)}</td><td colspan="4" class="dim">${esc(tk[t].error)}</td></tr>`
          : `<tr><td>${chip(t)}</td>${c(tk[t].r5)}${c(tk[t].r30)}${c(tk[t].r60)}${c(tk[t].peak)}</tr>`).join("")}
        </tbody></table>
        <div class="note">${im.session === "next-open" ? "Posted while the US market was closed: moves are measured from the prior close to 5/30/60 minutes after the next open (so they include the opening gap)."
          : im.session === "live" ? "Posted during market hours: moves are measured from the last price before the post." : "Measurement starts once the market has traded after this post."}
          ${Object.keys(tk).length ? "" : " No measurement yet (posts older than ~58 days or without market data can't be measured)."}</div></div>`;
    };
    if (cached) draw(cached);
    const fresh = await api("post/" + encodeURIComponent(S.sel));
    if (!live() || fresh.error) return;
    mergePosts([fresh]);
    draw(S.byId[S.sel]);
  },

  async status(bar, body, live) {
    bar.innerHTML = `<span class="dim">Health of every data source. Errors usually mean a free source rate-limited us; it retries automatically.</span>`;
    const [d, st] = await Promise.all([api("status"), api("db/stats")]);
    if (!live()) return;
    body.innerHTML = `<div class="note" style="padding:6px 8px">DATABASE · ${esc(st._path)} · ${st._size_mb} MB · ${Object.entries(st).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${esc(k.replace(/_/g, " "))} <b style="color:var(--text)">${fmtInt(v)}</b>`).join(" · ")}</div><table><thead><tr><th></th><th>SOURCE</th><th>TYPE</th><th>LAST CHECK</th><th class="num">NEW</th><th>NOTE</th></tr></thead><tbody>${Object.values(d).map((s) => `
      <tr><td class="${s.ok ? "up" : s.ok === false ? "down" : "dim"}">●</td><td style="color:${personColor(s.person)}">${esc(s.person)}</td><td class="dim">${esc(SRC[s.type] || s.type)}</td>
      <td class="dim">${s.last ? ago(s.last) + " ago" : "--"}</td><td class="num">${s.new ?? ""}</td><td class="${s.ok ? "dim" : "down"}">${esc(s.error || "ok")}</td></tr>`).join("")}</tbody></table>
      ${S.cfg.x_enabled ? "" : `<div class="note" style="padding:0 8px 10px">X/Twitter: no API token set, so X accounts are tracked through news coverage (NEWS badge). To get posts directly, set an X API bearer token (env X_BEARER_TOKEN or "x_bearer_token" in config.json), or add an RSS feed for an account (e.g. from rss.app) as an "rss" source.</div>`}`;
  },

  async help(bar, body) {
    bar.innerHTML = "";
    const h = [
      ["NVDA  or  NVDA GO", "Chart a ticker (any Yahoo symbol: ^VIX, CL=F, BTC-USD, EURUSD=X)"],
      ["NVDA 1Y", "Chart with range: 1D 5D 1M 3M 6M 1Y 5Y"],
      ["ADD TSLA AMD", "Add to watchlist"], ["DEL TSLA", "Remove from watchlist"],
      ["SORT SECTOR", "Sort / group the watchlist: SECTOR, INDUSTRY, TYPE, CHG, LOSERS, MOVERS, EXT, VOL, MENTIONS, FLOW, AZ, MANUAL"],
      ["NEWS  /  NEWS NVDA", "Market wire / ticker headlines"], ["CAL", "Economic calendar"],
      ["CONG  /  CONG NVDA  /  CONG PELOSI", "Congressional trades"], ["INS  /  INS NVDA  /  INS BUYS", "Insider trades"],
      ["13F", "Latest fund holdings filings"], ["PRED  /  KALSHI  /  PRED CRYPTO", "Prediction markets"],
      ["BRIEF", "Pre-market brief (auto-built weekdays; BUILD NOW in the tab)"],
      ["OPT  /  OPT NVDA  /  OPT PUTS", "Unusual options flow (also OPT MENTIONED, OPT WATCH)"],
      ["TRACK", "Post-impact track record per person"], ["IMPACT", "Impact of the selected post"],
      ["FEED TRUMP  /  FEED ALL", "Filter the market-movers feed by person"],
      ["ALERT NVIDIA", "Add your own alert keyword (saved in the database)"], ["UNALERT NVIDIA", "Remove a custom alert keyword"],
      ["ALERTS", "Alert history: every post / options / brief alert with links"], ["FIND TARIFF", "Search every stored post"],
      ["THEME PHOSPHOR", "Switch color theme (amber, phosphor, midnight, synth, crimson, ice, graphite, oled)"],
      ["SETTINGS  or  ⚙", "Theme, accent color, text size, panels, watchlist, alert keywords, database stats"],
      ["LAYOUT", "Reset panel sizes and visibility (drag panel borders to resize)"],
      ["ALERT", "List custom alert keywords"], ["MUTE  /  UNMUTE", "Alert sound off/on"], ["MAX", "Maximize / restore the bottom panel"],
      ["STATUS", "Data source health"], ["Alt+1 … Alt+0", "Switch bottom tabs"], ["/", "Focus the command bar"], ["Esc", "Clear command bar"],
    ];
    body.innerHTML = `<div class="help">${h.map(([k, v]) => `<div><code>${esc(k)}</code> <span class="dim">${esc(v)}</span></div>`).join("")}
      <div style="margin-top:10px"><span class="amber">Options alerts</span> <span class="dim">fire when a new unusual contract has $500K+ premium and 3×+ open interest on a ticker mentioned in a post in the last 24h (change alert_scope in config.json to "watchlist" or "all").</span></div>
      <div style="margin-top:10px"><span class="amber">Alerts</span> <span class="dim">fire on new posts from direct sources (Truth Social, X, official feeds) that hit an alert topic
      (tariffs, China, Fed, war, fiscal), an alert keyword, a watchlist company, or one of your custom keywords. Edit topics and keywords in config.json.</span></div></div>`;
  },
};

/* ============================================================ post search & alert history */

async function searchPosts(q) {
  q = (q || "").trim();
  if (!q) { S.search = null; renderFeed(); return; }
  const results = await api("posts?limit=500&q=" + encodeURIComponent(q));
  if (($("#fsearch").value || "").trim() !== q && !S.searchFromCmd) { /* user kept typing */ }
  mergePosts(results);
  S.search = { q, results: results.map((p) => S.byId[p.id]) };
  renderFeed();
}

TAB_RENDER.alerts = async (bar, body, live) => {
  const kind = S.sub.alertKind || "";
  bar.innerHTML = seg("alertKind", [["", "ALL"], ["post", "POSTS"], ["flow", "OPTIONS"], ["brief", "BRIEFS"]], kind)
    + `<span class="dim">Every alert the terminal has fired, stored in the database</span>`;
  loading();
  const d = await api("alerts?limit=500" + (kind ? "&kind=" + kind : ""));
  if (!live()) return;
  const icon = { post: "⚠", flow: "⚡", brief: "☀" };
  body.innerHTML = `<table><thead><tr><th>WHEN ET</th><th></th><th>ALERT</th><th>DETAIL</th><th>TICKERS</th><th>LINK</th></tr></thead><tbody>${d.map((a) => {
    const action = a.kind === "post" ? `data-post="${esc(a.ref)}"` : a.kind === "brief" ? `data-brief="${esc(a.ref)}"` : a.symbol ? `data-flowsym="${esc(a.symbol)}"` : "";
    return `<tr class="click" ${action}><td class="dim" style="white-space:nowrap">${esc(fmtET(a.ts, true))}</td><td class="amber">${icon[a.kind] || "•"}</td>
      <td style="color:${a.kind === "post" ? personColor(a.title.split(" (")[0]) : "var(--amber)"}">${esc(a.title)}</td>
      <td class="wrap">${esc((a.body || "").slice(0, 220))}</td>
      <td>${(a.symbol || "").split(",").filter(Boolean).slice(0, 4).map(chip).join(" ")}</td>
      <td>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">open ↗</a>` : a.kind === "brief" ? `<span class="dim">BRIEF tab</span>` : ""}</td></tr>`;
  }).join("")}</tbody></table>` + (d.length ? "" : `<div class="empty">No alerts yet. They are logged here as they fire (posts, options flow, briefs).</div>`);
};

/* ============================================================ brief layout */

function briefHTML(b) {
  const qrow = (q) => `<tr class="click" data-sym="${esc(q.symbol)}"><td class="wsym">${esc(LABELS[q.symbol] || GLOBAL_LABELS[q.symbol] || q.symbol)}</td>
    <td class="num">${fmtPx(q.price, q.symbol)}</td><td class="num ${cls(q.pct)}">${fmtPct(q.pct)}</td></tr>`;
  const mrow = (q) => `<tr class="click" data-sym="${esc(q.symbol)}"><td class="wsym">${esc(q.symbol)}</td><td class="num">${fmtPx(q.price)}</td>
    <td class="num ${cls(q.move)}">${fmtPct(q.move)}</td><td class="dim">${q.basis === "pre" ? "PRE" : ""}</td></tr>`;
  const card = (title, inner, cls_ = "") => `<div class="bcard ${cls_}"><h4>${title}</h4>${inner}</div>`;
  const P = b.posts, M = b.movers, O = b.options;
  const optRow = (u) => `<tr><td><span class="chip" data-sym="${esc(u.symbol)}">${esc(u.symbol)}</span> <a href="https://finance.yahoo.com/quote/${esc(u.contract)}/" target="_blank" rel="noopener" style="color:var(--text)">${esc(u.exp.slice(5))} <b class="${u.type === "C" ? "up" : "down"}">${u.strike}${u.type}</b></a></td>
    <td class="num">${fmtMoney(u.premium)}</td><td class="num">${u.vol_oi}×</td><td class="${u.lean === "bull" ? "up" : u.lean === "bear" ? "down" : "dim"}">${u.lean || ""}</td></tr>`;
  return `<div class="bhead">${esc(b.headline || b.kind)}</div><div class="bcards">
    ${card("FUTURES & MACRO", `<table>${b.futures.map(qrow).join("")}</table>`)}
    ${card(`OVERNIGHT POSTS <span class="dim">since ${esc(fmtET(b.since, true))} ET</span>`,
      `<div class="bstat"><b>${P.count}</b> direct posts · <b class="${P.alert_count ? "down" : ""}">${P.alert_count}</b> alerts · ${P.news_count} news items</div>
      <div class="bline">${P.by_person.map(([p, n]) => `<span style="color:${personColor(p)}">${esc(p)} ${n}</span>`).join(" · ") || `<span class="dim">quiet night</span>`}</div>
      ${P.topics.length ? `<div class="bline">${P.topics.map(([t, n]) => `<span class="cat">${esc(t)} ${n}</span>`).join(" ")}</div>` : ""}
      ${P.alerts.map((p) => `<div class="balert click" data-post="${esc(p.id)}"><span class="dim">${esc(fmtET(p.ts))}</span> <b style="color:${personColor(p.person)}">${esc(p.person)}</b> ${esc(p.text.slice(0, 180))}${p.url ? `<a class="lnk" href="${esc(p.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}
        <div>${p.tickers.slice(0, 6).map((t) => `<span class="chip" data-sym="${esc(t)}">${esc(t)}</span>`).join(" ")}</div></div>`).join("")}`, "wide")}
    ${card(`${esc(b.calendar_label || "TODAY'S CALENDAR")} <span class="dim">USD · high/med</span>`, b.calendar.length ? `<table>${b.calendar.map((e) => {
      const p = etParts(new Date(e.ts * 1000));
      return `<tr><td>${p.hour}:${p.minute}</td><td class="imp-${esc(e.impact)}">${esc(e.impact[0])}</td><td>${esc(e.title)}</td><td class="num dim">${esc(e.forecast || "")}</td><td class="num dim">${esc(e.previous || "")}</td></tr>`;
    }).join("")}</table><div class="note">columns: forecast · previous</div>` : `<div class="dim">No major US releases today.</div>`)}
    ${card("GLOBAL MARKETS", `<table>${b.global.map(qrow).join("")}</table>`)}
    ${card("BIGGEST MOVERS <span class=\"dim\">watchlist + scanned names</span>", `<div class="b2"><table>${M.up.map(mrow).join("")}</table><table>${M.down.map(mrow).join("")}</table></div>`)}
    ${M.mentioned.length ? card("MENTIONED OVERNIGHT", `<table>${M.mentioned.map(mrow).join("")}</table>`) : ""}
    ${card("PREDICTION MARKET SWINGS <span class=\"dim\">24h</span>", b.predictions.length ? `<table>${b.predictions.map((p) => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--text)">${esc(p.event)}</a> <span class="dim">${esc(p.label)}</span></td>
      <td class="num" style="color:#fff">${Math.round(p.yes * 100)}%</td><td class="num ${cls(p.change)}">${p.change > 0 ? "+" : ""}${(p.change * 100).toFixed(0)}pt</td></tr>`).join("")}</table>` : `<div class="dim">No big swings.</div>`, "wide")}
    ${card(`UNUSUAL OPTIONS <span class="dim">${esc(O.day || "no scan yet")} · ex-0DTE</span>`, O.top.length ? `<table>${O.top.slice(0, 10).map(optRow).join("")}</table>
      ${O.hot.length ? `<div class="bline">Volume vs avg: ${O.hot.map((r) => `<span class="chip" data-sym="${esc(r.symbol)}">${esc(r.symbol)} ${r.vol_vs_avg.toFixed(1)}×</span>`).join(" ")}</div>` : ""}
      ${O.mentioned.length ? `<div class="bline amber">On tickers mentioned overnight:</div><table>${O.mentioned.slice(0, 5).map(optRow).join("")}</table>` : ""}` : `<div class="dim">No unusual options recorded yet.</div>`)}
    ${card("CONGRESS FILINGS <span class=\"dim\">since close</span>", b.congress.length ? `<table>${b.congress.map((r) => `<tr><td>${r.member_url ? `<a href="${esc(r.member_url)}" target="_blank" rel="noopener" class="party-${esc(r.party)}">${esc(r.member)}</a>` : esc(r.member)}</td><td>${chip(r.ticker)}</td>
      <td class="${r.txn.startsWith("Purchase") ? "up" : "down"}">${esc(r.txn)}</td><td class="dim">${esc(r.amount)}</td></tr>`).join("")}</table>` : `<div class="dim">No new disclosures.</div>`)}
    ${card("INSIDER BUYS $100K+ <span class=\"dim\">since close</span>", b.insiders.length ? `<table>${b.insiders.map((r) => `<tr><td>${chip(r.ticker)}</td><td>${esc(r.insider)}</td><td class="dim">${esc(r.title)}</td><td class="num up">${esc(r.value)}</td><td>${r.filing_url ? `<a href="${esc(r.filing_url)}" target="_blank" rel="noopener">SEC ↗</a>` : ""}</td></tr>`).join("")}</table>` : `<div class="dim">None filed.</div>`)}
  </div>${b.errors.length ? `<div class="note" style="padding:0 10px 10px">Some sections failed: ${esc(b.errors.join(" | "))}</div>` : ""}`;
}

const GLOBAL_LABELS = { "^N225": "NIKKEI", "^HSI": "HANG SENG", "000001.SS": "SHANGHAI", "^GDAXI": "DAX", "^FTSE": "FTSE 100", "^STOXX50E": "STOXX 50",
  "YM=F": "DOW FUT", "RTY=F": "R2K FUT" };

/* ============================================================ commands */

const RANGES = { "1D": "1d", "5D": "5d", "1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y", "5Y": "5y" };

function saveWatch() { saveSetting("watchlist", S.watch); renderWatchBtn(); }

function runCommand(raw) {
  const text = raw.trim();
  if (!text) return;
  pushHistory(text);
  const parts = text.toUpperCase().split(/\s+/).filter((w) => w !== "GO" && w !== "<GO>");
  const [c, ...rest] = parts;
  const arg = rest.join(" ");
  const tabWith = (tab, sub) => { Object.assign(S.sub, sub || {}); showTab(tab); };
  switch (c) {
    case "HELP": case "H": case "?": return showTab("help");
    case "ADD": {
      const add = rest.filter((s) => !S.watch.includes(s));
      S.watch.push(...add); saveWatch(); refreshQuotes(); return msg(add.length ? "Added " + add.join(", ") : "Already on watchlist");
    }
    case "DEL": case "RM": case "REMOVE":
      S.watch = S.watch.filter((s) => !rest.includes(s)); saveWatch(); renderWatch(); return msg("Removed " + rest.join(", "));
    case "NEWS": case "N": case "CN":
      if (rest[0]) { loadChart(rest[0]); return tabWith("news", { newsSym: "1" }); }
      return tabWith("news", { newsSym: "" });
    case "CAL": case "ECO": case "ECON": return showTab("cal");
    case "CONG": case "CONGRESS": return tabWith("cong", { congQ: arg });
    case "INS": case "INSIDER": case "INSIDERS": {
      const modes = { BUYS: "buys", BIG: "big", CLUSTER: "cluster", LATEST: "latest" };
      if (modes[rest[0]]) return tabWith("ins", { insMode: modes[rest[0]] });
      if (rest[0]) { loadChart(rest[0]); return tabWith("ins", { insMode: "sym" }); }
      return tabWith("ins", { insMode: "latest" });
    }
    case "13F": return showTab("f13");
    case "PRED": case "POLY": case "POLYMARKET":
      return tabWith("pred", rest[0] === "KALSHI" ? { predVenue: "kalshi" } : { predVenue: "poly", ...(rest[0] ? { predTag: rest[0].toLowerCase() } : {}) });
    case "KALSHI": return tabWith("pred", { predVenue: "kalshi" });
    case "TRACK": case "TR": return showTab("track");
    case "BRIEF": case "BR": case "PRE": return tabWith("brief", { briefDay: "" });
    case "OPT": case "OPTS": case "FLOW": case "UOA": {
      const sub = { flowType: "", flowScope: "" };
      for (const w of rest) {
        if (w === "CALLS") sub.flowType = "C"; else if (w === "PUTS") sub.flowType = "P";
        else if (w === "MENTIONED") sub.flowScope = "mentioned"; else if (w === "WATCH") sub.flowScope = "watch";
        else { sub.flowScope = "sym"; loadChart(w); }
      }
      return tabWith("flow", sub);
    }
    case "IMPACT": case "IMP": return showTab("impact");
    case "STATUS": case "SOURCES": return showTab("status");
    case "ALERTS": case "ALRT": return showTab("alerts");
    case "FIND": case "SEARCH": { const q = text.split(/\s+/).slice(1).join(" "); $("#fsearch").value = q; return searchPosts(q); }
    case "THEME": {
      const k = (rest[0] || "").toLowerCase();
      const key = THEMES[k] ? k : Object.keys(THEMES).find((x) => THEMES[x].name.toLowerCase().includes(k));
      if (!key) return msg("Themes: " + Object.keys(THEMES).join(", "), !!k);
      S.ui.theme = key; S.ui.accent = ""; applyTheme(); saveUI(); return msg("Theme: " + THEMES[key].name);
    }
    case "SETTINGS": case "SET": case "PREFS": case "CONFIG": return openSettings();
    case "SORT": {
      const alias = { MANUAL: "manual", AZ: "az", "A-Z": "az", ALPHA: "az", CHG: "chg_d", UP: "chg_d", GAINERS: "chg_d", DOWN: "chg_a", LOSERS: "chg_a",
        MOVE: "abs", MOVERS: "abs", EXT: "ext", PRE: "ext", AH: "ext", VOL: "vol", VOLUME: "vol", SECTOR: "sector", INDUSTRY: "industry",
        TYPE: "type", MENTIONS: "mentions", POSTS: "mentions", FLOW: "flow", OPTIONS: "flow" };
      const m = alias[rest[0]];
      if (!m) return msg("SORT " + Object.keys(alias).join(" | "), !!rest[0]);
      setWatchSort(m); return msg("Watchlist sorted: " + WSORTS.find((x) => x[0] === m)[1]);
    }
    case "LAYOUT":
      S.ui.panels = { ...UI_DEFAULTS.panels }; S.ui.sizes = { ...UI_DEFAULTS.sizes }; S.ui.swap = false;
      applyLayout(); saveUI(); return msg("Layout reset");
    case "FEED": {
      if (!arg || arg === "ALL") { S.fperson = ""; S.fsrc = ""; setSeg("#fsrc", ""); }
      else {
        const p = S.cfg.people.find((x) => x.toUpperCase().includes(arg));
        if (!p) return msg("No person matching " + arg, true);
        S.fperson = p;
      }
      fillPeople(); return renderFeed();
    }
    case "ALERT": {
      const kw = text.slice(5).trim().toLowerCase();
      if (!kw) return msg("Custom alerts: " + (S.customAlerts.join(", ") || "none"));
      if (!S.customAlerts.includes(kw)) S.customAlerts.push(kw);
      saveSetting("custom_alerts", S.customAlerts); renderFeed(); updateMarkers(); return msg(`Alerting on "${kw}"`);
    }
    case "UNALERT": {
      const kw = text.slice(7).trim().toLowerCase();
      S.customAlerts = S.customAlerts.filter((k) => k !== kw); saveSetting("custom_alerts", S.customAlerts); renderFeed(); return msg(`Removed "${kw}"`);
    }
    case "MAX": case "MIN": return toggleMax();
    case "MUTE": S.sound = false; return syncToggles();
    case "UNMUTE": S.sound = true; return syncToggles();
  }
  if (/^[A-Z0-9^=.\-]{1,15}$/.test(c)) return loadChart(c, RANGES[rest[0]]);
  msg("Unknown command. Type HELP", true);
}

function toggleMax() {
  S.max = !S.max; store.set("max", S.max);
  $("#grid").classList.toggle("maxbottom", S.max); renderTabs(); placeGutters();
}

function setSeg(sel, v) { $$(sel + " button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); }
function syncToggles() {
  $("#sound").classList.toggle("on", S.sound); store.set("sound", S.sound);
  $("#bell").classList.toggle("on", S.notify); store.set("notify", S.notify);
}

/* ============================================================ events */

function bindEvents() {
  $("#cmdwrap").addEventListener("submit", (e) => { e.preventDefault(); runCommand($("#cmd").value); $("#cmd").value = ""; });
  document.addEventListener("keydown", (e) => {
    const inInput = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault(); const i = (+e.key + 9) % 10; if (TABS[i]) showTab(TABS[i][0]); return;
    }
    if (e.key === "Escape") { if ($("#settings")?.classList.contains("open")) closeSettings(); if (document.activeElement === $("#cmd")) { $("#cmd").value = ""; $("#cmd").blur(); } return; }
    if (!inInput && (e.key === "/" || (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey))) {
      $("#cmd").focus(); if (e.key === "/") e.preventDefault();
    }
  });

  // delegated clicks: ticker chips & watchlist rows & tape
  document.addEventListener("click", (e) => {
    const grp = e.target.closest("tr[data-grp]");
    if (grp) { const c = (S.ui.watchCollapsed ||= {}); c[grp.dataset.grp] = !c[grp.dataset.grp]; saveUI(); renderWatch(); return; }
    const wd = e.target.closest("[data-wdel]");
    if (wd) { e.stopPropagation(); toggleWatch(wd.dataset.wdel); return; }
    if (e.target.closest("#fclear")) { e.preventDefault(); $("#fsearch").value = ""; searchPosts(""); return; }
    if (e.target.closest("#cmdmsg") && S.lastAlertAction) { S.lastAlertAction(); return; }
    if (e.target.closest("#settings")) return;
    const symEl = e.target.closest("[data-sym]");
    if (symEl) { e.stopPropagation(); loadChart(symEl.dataset.sym); return; }
    const post = e.target.closest(".post");
    if (post && !e.target.closest("a")) { post.classList.toggle("open"); selectPost(post.dataset.id); return; }
    if (e.target.closest("#maxbtn")) { toggleMax(); return; }
    const tab = e.target.closest("#tabs button");
    if (tab) { showTab(tab.dataset.tab); return; }
    const sg = e.target.closest("[data-seg] button");
    if (sg) { S.sub[sg.parentElement.dataset.seg] = sg.dataset.v; renderTab(); return; }
    const br = e.target.closest("[data-brief]");
    if (br) { S.sub.briefDay = br.dataset.brief; showTab("brief"); return; }
    const fs = e.target.closest("tr[data-flowsym]");
    if (fs) { S.sub.flowScope = "sym"; if (S.tab !== "flow") showTab("flow"); loadChart(fs.dataset.flowsym).then(renderTab); return; }
    const pr = e.target.closest("[data-post]");
    if (pr) { selectPost(pr.dataset.post); return; }
    const pp = e.target.closest("tr[data-person]");
    if (pp) { S.fperson = pp.dataset.person; fillPeople(); renderFeed(); }
  });

  $("#ranges").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) loadChart(S.sym, b.dataset.v); });
  $("#mkmode").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.mkmode = b.dataset.v; setSeg("#mkmode", S.mkmode); saveSetting("mkmode", S.mkmode); updateMarkers();
  });
  $("#fsrc").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.fsrc = b.dataset.v; setSeg("#fsrc", S.fsrc); renderFeed(); });
  $("#fperson").addEventListener("change", (e) => { S.fperson = e.target.value; renderFeed(); });
  let fsTimer = null;
  $("#fsearch").addEventListener("input", (e) => { clearTimeout(fsTimer); fsTimer = setTimeout(() => searchPosts(e.target.value), 300); });
  $("#fsearch").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; searchPosts(""); } });

  $("#sound").addEventListener("click", () => { S.sound = !S.sound; syncToggles(); if (S.sound) beep(); });
  $("#bell").addEventListener("click", async () => {
    if (!("Notification" in window)) return msg("Notifications not supported in this browser", true);
    if (S.notify) { S.notify = false; return syncToggles(); }
    const perm = await Notification.requestPermission();
    S.notify = perm === "granted"; syncToggles();
    msg(S.notify ? "Desktop notifications on" : "Notifications blocked by the browser", !S.notify);
  });
}

/* ============================================================ boot */

async function boot() {
  tickClock(); setInterval(tickClock, 1000);
  S.cfg = await api("config");
  await loadSettings();                             // watchlist, alerts, theme, layout: stored in SQLite
  S.sound = store.get("sound", true);
  S.notify = store.get("notify", false) && "Notification" in window && Notification.permission === "granted";
  S.max = store.get("max", false);
  $("#grid").classList.toggle("maxbottom", S.max);
  setSeg("#mkmode", S.mkmode);
  syncToggles();
  bindEvents();
  bindWatchDrag();
  initChart();
  initUI();
  $("#wsort").innerHTML = WSORTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("#wsort").value = S.ui.watchSort || "manual";
  $("#wsort").addEventListener("change", (e) => setWatchSort(e.target.value));
  if (["sector", "industry", "type"].includes(S.ui.watchSort)) loadProfiles();
  if (S.ui.watchSort === "flow") loadFlowPrem();
  renderTabs();
  mergePosts(await api("posts?limit=600"));
  fillPeople();
  renderFeed();
  await refreshQuotes();
  loadChart(S.startSym || "SPY");
  renderTab();
  connectStream();

  setInterval(refreshQuotes, 15000);
  setInterval(reloadPosts, 90000);                 // pick up impact measurements as they complete
  setInterval(() => { if (["news", "pred", "status", "track", "flow"].includes(S.tab)) renderTab(); }, 60000);
  setInterval(() => { if (S.range === "1d") loadChart(S.sym); }, 60000);

}

boot().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<div style="color:#f55;padding:8px">Failed to start: ${esc(e.message)}. Is the server running?</div>`); });
