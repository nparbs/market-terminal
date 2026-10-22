"use strict";
/* UI customisation: settings sync (SQLite via /api/settings), themes, resizable layout,
   command-bar autocomplete and the settings drawer. Loaded before app.js; everything here
   runs from functions called after boot, so it can use app.js globals (S, $, api, ...). */

/* ============================================================ settings persistence */

const UI_DEFAULTS = {
  theme: "amber", accent: "", updown: "classic", fs: 12, dense: false, compactFeed: false,
  panels: { watch: true, chart: true, feed: true, bottom: true, tape: true },
  sizes: { left: 300, right: 430, top: 0.54 }, swap: false, tapeSpeed: 90,
};

let saveTimer = null;
const pending = {};
function saveSetting(key, value) {
  store.set("set." + key, value);              // local cache so the page paints right before the server answers
  pending[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = { ...pending };
    for (const k of Object.keys(pending)) delete pending[k];
    try {
      await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { Object.assign(pending, body); }
  }, 400);
}

async function loadSettings() {
  let server = {};
  try { server = await api("settings"); } catch {}
  const saved = new Set(server._saved || []);
  const pick = (key, localKey, dflt) => {
    if (saved.has(key)) return server[key];
    const local = store.get("set." + key, store.get(localKey, undefined));
    if (local !== undefined) { saveSetting(key, local); return local; }   // migrate browser-only values to the DB
    return server[key] ?? dflt;
  };
  S.watch = pick("watchlist", "watch", S.cfg.watchlist);
  S.customAlerts = pick("custom_alerts", "alerts", []);
  S.history = pick("history", null, []);
  S.mkmode = pick("mkmode", "mkmode", "key");
  S.tab = pick("tab", "tab", "brief");
  S.startSym = pick("sym", "sym", "SPY");
  const ui = pick("ui", null, {});
  S.ui = { ...UI_DEFAULTS, ...ui, panels: { ...UI_DEFAULTS.panels, ...(ui.panels || {}) }, sizes: { ...UI_DEFAULTS.sizes, ...(ui.sizes || {}) } };
}

const saveUI = () => saveSetting("ui", S.ui);

/* ============================================================ themes */

const THEMES = {
  amber:    { name: "Bloomberg Amber", bg: "#000000", panel: "#07090b", bg2: "#0b0d0f", head: "#0e1114", card: "#050607", th: "#0b0e10", line: "#1d2227", line2: "#2a3138", rowline: "#0f1316", text: "#d9dde1", dim: "#7d8790", accent: "#ffa028", link: "#4aa8ff", hl: "#12171c", sel: "#15110a" },
  phosphor: { name: "Phosphor Green",  bg: "#000000", panel: "#030806", bg2: "#06100b", head: "#08140e", card: "#040a07", th: "#06100b", line: "#12261a", line2: "#1d3a28", rowline: "#0a1610", text: "#c6f6d5", dim: "#5f8f70", accent: "#39ff88", link: "#7cf7c0", hl: "#0b1a12", sel: "#0c1f14" },
  midnight: { name: "Midnight Blue",   bg: "#05080f", panel: "#080d18", bg2: "#0a1120", head: "#0d1527", card: "#070c17", th: "#0b1322", line: "#18233a", line2: "#24334f", rowline: "#0e1628", text: "#dbe6ff", dim: "#7486a8", accent: "#4aa8ff", link: "#8cc8ff", hl: "#101b30", sel: "#0f1d36" },
  synth:    { name: "Synthwave",       bg: "#07040d", panel: "#0c0716", bg2: "#110a1e", head: "#150c25", card: "#0a0613", th: "#120a20", line: "#251838", line2: "#36244f", rowline: "#150d22", text: "#efe3ff", dim: "#8e7aa8", accent: "#ff4fd8", link: "#7cc4ff", hl: "#1a0f2c", sel: "#200f2e" },
  crimson:  { name: "Crimson",         bg: "#050203", panel: "#0b0506", bg2: "#110809", head: "#160a0c", card: "#090405", th: "#12080a", line: "#2a1316", line2: "#3d1c20", rowline: "#170a0c", text: "#f3dede", dim: "#9a7478", accent: "#ff4d5e", link: "#ff9aa5", hl: "#1c0b0e", sel: "#230c10" },
  ice:      { name: "Arctic Cyan",     bg: "#03070a", panel: "#060d12", bg2: "#091319", head: "#0b1820", card: "#050b0f", th: "#09141b", line: "#132630", line2: "#1d3846", rowline: "#0b171e", text: "#dff6fb", dim: "#6f939e", accent: "#5ce1e6", link: "#9fd8ff", hl: "#0d1d25", sel: "#0c222b" },
  graphite: { name: "Graphite Mono",   bg: "#0a0a0a", panel: "#101010", bg2: "#141414", head: "#181818", card: "#0d0d0d", th: "#151515", line: "#262626", line2: "#363636", rowline: "#191919", text: "#e6e6e6", dim: "#8a8a8a", accent: "#e6e6e6", link: "#a8c7ff", hl: "#1c1c1c", sel: "#222222" },
  oled:     { name: "OLED Gold",       bg: "#000000", panel: "#000000", bg2: "#000000", head: "#060606", card: "#000000", th: "#050505", line: "#1a1a1a", line2: "#2a2a2a", rowline: "#0d0d0d", text: "#e8e2d0", dim: "#7a7468", accent: "#e8c547", link: "#6fb3ff", hl: "#0f0f0f", sel: "#141108" },
};

const UPDOWN = {
  classic:    { name: "Green / Red", up: "#2bd17e", down: "#ff4d4f" },
  colorblind: { name: "Blue / Orange", up: "#4aa8ff", down: "#ff9f1c" },
  inverse:    { name: "Red up / Green down (Asia)", up: "#ff4d4f", down: "#2bd17e" },
  mono:       { name: "White / Grey", up: "#f0f0f0", down: "#8a8a8a" },
};

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); }

function applyTheme() {
  const t = THEMES[S.ui.theme] || THEMES.amber, ud = UPDOWN[S.ui.updown] || UPDOWN.classic;
  const accent = S.ui.accent || t.accent;
  const r = document.documentElement.style;
  const set = { bg: t.bg, panel: t.panel, bg2: t.bg2, head: t.head, card: t.card, th: t.th, line: t.line, line2: t.line2,
    rowline: t.rowline, text: t.text, dim: t.dim, amber: accent, "amber-dim": mix(accent, t.bg, 0.55), blue: t.link,
    hl: t.hl, sel: S.ui.accent ? mix(accent, t.bg, 0.9) : t.sel, up: ud.up, down: ud.down, ptext: mix(t.text, "#ffffff", 0.3) };
  for (const [k, v] of Object.entries(set)) r.setProperty("--" + k, v);
  r.setProperty("--fs", S.ui.fs + "px");
  r.setProperty("--tape-speed", S.ui.tapeSpeed + "s");
  document.body.classList.toggle("dense", !!S.ui.dense);
  document.body.classList.toggle("compactfeed", !!S.ui.compactFeed);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
  if (typeof chart !== "undefined" && chart) applyChartTheme();
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim(); }

function applyChartTheme() {
  const up = cssVar("up"), down = cssVar("down");
  chart.applyOptions({
    layout: { background: { type: "solid", color: cssVar("bg") }, textColor: cssVar("dim"), fontSize: Math.max(10, S.ui.fs - 1) },
    grid: { vertLines: { color: cssVar("rowline") }, horzLines: { color: cssVar("rowline") } },
    rightPriceScale: { borderColor: cssVar("line") }, timeScale: { borderColor: cssVar("line") },
  });
  candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
  if (S.bars.length) {
    volume.setData(S.bars.map((b) => ({ time: b.time + S.gmt, value: b.volume, color: mix(b.close >= b.open ? up : down, cssVar("bg"), 0.72) })));
    updateMarkers();
  }
}

/* ============================================================ layout: resizable, hideable panels */

function applyLayout() {
  const g = $("#grid"), P = S.ui.panels, Z = S.ui.sizes;
  const r = document.documentElement.style;
  r.setProperty("--left", Z.left + "px");
  r.setProperty("--right", Z.right + "px");
  r.setProperty("--top", Z.top + "fr");
  r.setProperty("--bottom", (1 - Z.top) + "fr");
  g.classList.toggle("hide-watch", !P.watch);
  g.classList.toggle("hide-feed", !P.feed);
  g.classList.toggle("hide-chart", !P.chart);
  g.classList.toggle("hide-bottom", !P.bottom || (!P.chart && !P.bottom));
  g.classList.toggle("swap", !!S.ui.swap);
  document.body.classList.toggle("hide-tape", !P.tape);
  placeGutters();
}

function placeGutters() {
  const g = $("#grid");
  if (window.innerWidth <= 1100) { $$(".gutter", g).forEach((x) => x.remove()); return; }
  if (!$(".gutter", g)) {
    g.insertAdjacentHTML("beforeend", `<div class="gutter v" data-g="a"></div><div class="gutter v" data-g="b"></div><div class="gutter h" data-g="row"></div>`);
    $$(".gutter", g).forEach((el) => el.addEventListener("mousedown", startDrag));
  }
  const W = g.clientWidth, P = S.ui.panels, Z = S.ui.sizes;
  const leftW = S.ui.swap ? (P.feed ? Z.right : 0) : (P.watch ? Z.left : 0);
  const rightW = S.ui.swap ? (P.watch ? Z.left : 0) : (P.feed ? Z.right : 0);
  const [ga, gb, gr] = ["a", "b", "row"].map((k) => $(`.gutter[data-g="${k}"]`, g));
  ga.style.left = leftW + "px"; ga.style.display = leftW ? "" : "none";
  gb.style.left = (W - rightW) + "px"; gb.style.display = rightW ? "" : "none";
  const chartEl = $("#chartp");
  const showRow = P.chart && P.bottom && !g.classList.contains("maxbottom");
  gr.style.display = showRow ? "" : "none";
  if (showRow) {
    gr.style.left = leftW + "px"; gr.style.width = (W - leftW - rightW) + "px";
    gr.style.top = chartEl.offsetTop + chartEl.offsetHeight + "px";
  }
}

let drag = null;
function startDrag(e) {
  e.preventDefault();
  const g = $("#grid").getBoundingClientRect();
  drag = { which: e.target.dataset.g, g, el: e.target };
  e.target.classList.add("drag");
  document.body.classList.add("dragging");
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", endDrag, { once: true });
}
function onDrag(e) {
  const { which, g } = drag, Z = S.ui.sizes;
  const x = e.clientX - g.left, y = e.clientY - g.top;
  const clampW = (v) => Math.max(180, Math.min(v, g.width * 0.45));
  // Gutter "a" sits on the left edge of the centre column, "b" on its right edge; which panel that is depends on swap.
  if (which === "a") { if (S.ui.swap) Z.right = clampW(x); else Z.left = clampW(x); }
  if (which === "b") { if (S.ui.swap) Z.left = clampW(g.width - x); else Z.right = clampW(g.width - x); }
  if (which === "row") Z.top = Math.max(0.15, Math.min(0.88, y / g.height));
  applyLayout();
}
function endDrag() {
  drag.el.classList.remove("drag");
  document.body.classList.remove("dragging");
  window.removeEventListener("mousemove", onDrag);
  drag = null;
  saveUI();
}

/* ============================================================ command bar autocomplete */

const COMMANDS = [
  ["BRIEF", "", "Pre-market brief"], ["NEWS", "[TICKER]", "Market wire or ticker headlines", "sym"], ["CAL", "", "Economic calendar"],
  ["OPT", "[TICKER|CALLS|PUTS|MENTIONED]", "Unusual options flow", "sym"], ["CONG", "[TICKER|MEMBER]", "Congressional trades", "sym"],
  ["INS", "[TICKER|BUYS|BIG|CLUSTER]", "Insider trades", "sym"], ["PRED", "[KALSHI|TAG]", "Prediction markets"],
  ["TRACK", "", "Post-impact track record"], ["IMPACT", "", "Impact of the selected post"], ["ALERTS", "", "Alert history with links"],
  ["13F", "", "Fund holdings filings"], ["STATUS", "", "Data sources and database"], ["ADD", "TICKER …", "Add to watchlist", "sym"],
  ["DEL", "TICKER …", "Remove from watchlist", "watch"], ["SORT", "SECTOR|CHG|MOVERS|EXT|VOL|MENTIONS|FLOW|AZ|MANUAL", "Sort or group the watchlist", "sort"], ["FEED", "PERSON|ALL", "Filter the feed by person", "person"],
  ["FIND", "TEXT", "Search every stored post"], ["ALERT", "KEYWORD", "Add a custom alert keyword"], ["UNALERT", "KEYWORD", "Remove a custom alert keyword", "alertkw"],
  ["THEME", "NAME", "Switch color theme", "theme"], ["SETTINGS", "", "Theme, layout and display settings"], ["LAYOUT", "RESET", "Reset panel sizes and visibility"],
  ["MAX", "", "Maximize / restore the bottom panel"], ["MUTE", "", "Alert sound off"], ["UNMUTE", "", "Alert sound on"], ["HELP", "", "All commands"],
];
const AC = { items: [], idx: -1, remote: [], q: "", timer: null };

function knownSymbols() {
  const s = new Set([...S.watch, ...S.cfg.tape, ...(S.cfg.options_universe || [])]);
  for (const p of S.posts.slice(0, 300)) p.tickers.forEach((t) => s.add(t));
  return [...s];
}

function symItem(symbol, name = "", type = "", exch = "") {
  return { kind: "sym", symbol, name: name || (S.quotes[symbol] && S.quotes[symbol].name) || "", type, exch };
}

function buildSuggestions(raw) {
  const text = raw.replace(/^\s+/, "");
  const up = text.toUpperCase();
  const parts = up.split(/\s+/);
  const first = parts[0] || "";
  const last = parts[parts.length - 1] || "";
  const cmd = COMMANDS.find((c) => c[0] === first);
  const out = [];
  if (!text) {
    S.history.slice(0, 8).forEach((h) => out.push({ kind: "hist", text: h }));
    return out;
  }
  if (parts.length > 1 && cmd && cmd[3]) {
    const ctx = cmd[3];
    if (ctx === "person") {
      S.cfg.people.filter((p) => p.toUpperCase().includes(parts.slice(1).join(" "))).slice(0, 10).forEach((p) => out.push({ kind: "person", text: p }));
    } else if (ctx === "theme") {
      Object.entries(THEMES).filter(([k, t]) => k.toUpperCase().startsWith(last) || t.name.toUpperCase().includes(last)).forEach(([k, t]) => out.push({ kind: "theme", key: k, text: t.name }));
    } else if (ctx === "sort") {
      ["SECTOR", "INDUSTRY", "TYPE", "CHG", "LOSERS", "MOVERS", "EXT", "VOL", "MENTIONS", "FLOW", "AZ", "MANUAL"]
        .filter((k) => k.startsWith(last)).forEach((k) => out.push({ kind: "fill", text: "SORT " + k, desc: "" }));
    } else if (ctx === "alertkw") {
      S.customAlerts.filter((k) => k.toUpperCase().startsWith(last)).forEach((k) => out.push({ kind: "fill", text: `UNALERT ${k}`, desc: "custom alert keyword" }));
    } else {
      const pool = ctx === "watch" ? S.watch : knownSymbols();
      pool.filter((s) => s.startsWith(last)).slice(0, 8).forEach((s) => out.push(symItem(s)));
      if (ctx !== "watch") AC.remote.filter((r) => !out.some((o) => o.symbol === r.symbol)).slice(0, 8).forEach((r) => out.push(symItem(r.symbol, r.name, r.type, r.exchange)));
    }
    return out;
  }
  if (parts.length === 1) {
    COMMANDS.filter((c) => c[0].startsWith(first)).slice(0, 6).forEach((c) => out.push({ kind: "cmd", cmd: c }));
    knownSymbols().filter((s) => s.startsWith(first)).sort((a, b) => a.length - b.length).slice(0, 6).forEach((s) => out.push(symItem(s)));
    AC.remote.filter((r) => !out.some((o) => o.symbol === r.symbol)).slice(0, 8).forEach((r) => out.push(symItem(r.symbol, r.name, r.type, r.exchange)));
    if (first.length >= 3) out.push({ kind: "find", text: text });
  }
  return out;
}

function remoteQueryFor(raw) {
  const parts = raw.trim().toUpperCase().split(/\s+/);
  const cmd = COMMANDS.find((c) => c[0] === parts[0]);
  if (parts.length === 1 && !COMMANDS.some((c) => c[0] === parts[0])) return raw.trim();
  if (parts.length > 1 && cmd && cmd[3] === "sym") return parts[parts.length - 1];
  return "";
}

function acRender() {
  const box = $("#ac");
  const v = $("#cmd").value;
  AC.items = buildSuggestions(v);
  if (AC.idx >= AC.items.length) AC.idx = AC.items.length - 1;
  if (!AC.items.length || document.activeElement !== $("#cmd")) { box.classList.remove("open"); return; }
  let lastKind = "";
  const secName = { hist: "RECENT", cmd: "COMMANDS", sym: "TICKERS", person: "PEOPLE", theme: "THEMES", find: "SEARCH POSTS", fill: "SUGGESTIONS" };
  box.innerHTML = AC.items.map((it, i) => {
    const head = it.kind !== lastKind ? `<div class="ac-sec">${secName[it.kind] || ""}</div>` : "";
    lastKind = it.kind;
    const on = i === AC.idx ? "on" : "";
    if (it.kind === "cmd") return head + `<div class="ac-item ${on}" data-i="${i}"><span class="k">${esc(it.cmd[0])}</span><span class="d">${esc(it.cmd[1])} · ${esc(it.cmd[2])}</span></div>`;
    if (it.kind === "sym") {
      const w = S.watch.includes(it.symbol);
      return head + `<div class="ac-item ${on}" data-i="${i}"><span class="k">${esc(it.symbol)}</span><span class="d">${esc(it.name)}</span>
        ${it.type ? `<span class="t">${esc(it.type)}${it.exch ? " · " + esc(it.exch) : ""}</span>` : ""}
        <span class="w ${w ? "on" : ""}" data-watch="${esc(it.symbol)}" title="${w ? "Remove from" : "Add to"} watchlist">${w ? "★ WATCHING" : "+ WATCH"}</span></div>`;
    }
    if (it.kind === "find") return head + `<div class="ac-item ${on}" data-i="${i}"><span class="k">FIND</span><span class="d">Search all stored posts for “${esc(it.text)}”</span></div>`;
    return head + `<div class="ac-item ${on}" data-i="${i}"><span class="k">${esc(it.kind === "theme" ? it.key.toUpperCase() : "")}</span><span class="d">${esc(it.text)}${it.desc ? " · " + esc(it.desc) : ""}</span></div>`;
  }).join("") + `<div class="ac-foot">↑↓ select · Tab complete · Enter run · Esc close</div>`;
  box.classList.add("open");
}

function acCompletion(it) {
  const parts = $("#cmd").value.trim().split(/\s+/);
  if (it.kind === "cmd") return it.cmd[0] + (it.cmd[1] ? " " : "");
  if (it.kind === "sym") { if (parts.length > 1) { parts[parts.length - 1] = it.symbol; return parts.join(" ").toUpperCase(); } return it.symbol; }
  if (it.kind === "person") return "FEED " + it.text;
  if (it.kind === "theme") return "THEME " + it.key.toUpperCase();
  if (it.kind === "find") return "FIND " + it.text;
  return it.text;
}

function acRun(it) {
  const value = acCompletion(it);
  if (it.kind === "cmd" && it.cmd[1] && !it.cmd[1].startsWith("[")) {   // needs an argument: complete, don't run
    $("#cmd").value = value; AC.idx = -1; acInput(); return;
  }
  $("#cmd").value = "";
  $("#ac").classList.remove("open");
  AC.idx = -1;
  runCommand(value);
}

function acInput() {
  AC.idx = -1;
  acRender();
  const q = remoteQueryFor($("#cmd").value);
  clearTimeout(AC.timer);
  if (!q || q.length < 1) { AC.remote = []; return; }
  AC.timer = setTimeout(async () => {
    const qq = q;
    try {
      const res = await api("search?q=" + encodeURIComponent(qq));
      if (remoteQueryFor($("#cmd").value) !== qq) return;
      AC.remote = Array.isArray(res) ? res : [];
      acRender();
    } catch {}
  }, 180);
}

function toggleWatch(sym) {
  sym = sym.toUpperCase();
  if (S.watch.includes(sym)) { S.watch = S.watch.filter((s) => s !== sym); msg("Removed " + sym + " from watchlist"); }
  else { S.watch.push(sym); msg("Added " + sym + " to watchlist"); }
  saveSetting("watchlist", S.watch);
  renderWatch(); renderWatchBtn(); refreshQuotes();
  if ($("#ac").classList.contains("open")) acRender();
}

function renderWatchBtn() {
  const b = $("#watchbtn");
  if (!b) return;
  const on = S.watch.includes(S.sym);
  b.classList.toggle("on", on);
  b.textContent = on ? "★ WATCHING" : "+ WATCH";
  b.title = on ? "Remove from watchlist" : "Add to watchlist";
}

function pushHistory(text) {
  S.history = [text, ...S.history.filter((h) => h !== text)].slice(0, 30);
  saveSetting("history", S.history);
}

function bindAutocomplete() {
  const inp = $("#cmd"), box = $("#ac");
  inp.addEventListener("input", acInput);
  inp.addEventListener("focus", acRender);
  inp.addEventListener("blur", () => setTimeout(() => box.classList.remove("open"), 120));
  inp.addEventListener("keydown", (e) => {
    const open = box.classList.contains("open") && AC.items.length;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); AC.idx = (AC.idx + 1) % AC.items.length; acRender(); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); AC.idx = AC.idx <= 0 ? AC.items.length - 1 : AC.idx - 1; acRender(); }
    else if (e.key === "Tab" && open) { e.preventDefault(); inp.value = acCompletion(AC.items[Math.max(0, AC.idx)]); acInput(); }
    else if (e.key === "Enter" && open && AC.idx >= 0) { e.preventDefault(); acRun(AC.items[AC.idx]); }
    else if (e.key === "Escape") { box.classList.remove("open"); }
  });
  box.addEventListener("mousedown", (e) => {
    e.preventDefault();                        // keep focus in the input
    const w = e.target.closest("[data-watch]");
    if (w) { toggleWatch(w.dataset.watch); return; }
    const it = e.target.closest(".ac-item");
    if (it) acRun(AC.items[+it.dataset.i]);
  });
}

/* ============================================================ settings drawer */

function settingsHTML() {
  const U = S.ui, P = U.panels;
  const chk = (key, label, on) => `<div class="set-row"><input type="checkbox" id="${key}" ${on ? "checked" : ""}><label for="${key}">${label}</label></div>`;
  return `<h3>⚙ SETTINGS <button class="tbtn" id="setclose">✕</button></h3>
    <div class="set-sec"><div class="lbl">THEME</div><div class="swatches">${Object.entries(THEMES).map(([k, t]) => `
      <div class="swatch ${U.theme === k ? "on" : ""}" data-theme="${k}" style="background:${t.bg};color:${t.text}">
        <span class="dots"><i style="background:${t.accent}"></i><i style="background:${t.panel};outline:1px solid ${t.line2}"></i><i style="background:${t.link}"></i></span>${esc(t.name)}</div>`).join("")}</div>
      <div class="set-row" style="margin-top:8px"><label>Custom accent color</label><input type="color" id="setaccent" value="${U.accent || (THEMES[U.theme] || THEMES.amber).accent}"><button class="tbtn" id="setaccentreset">RESET</button></div>
      <div class="set-row"><label>Up / down colors</label><select id="setupdown">${Object.entries(UPDOWN).map(([k, v]) => `<option value="${k}" ${U.updown === k ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
    </div>
    <div class="set-sec"><div class="lbl">DISPLAY</div>
      <div class="set-row"><label>Text size</label><input type="range" id="setfs" min="10" max="16" step="1" value="${U.fs}"><span id="setfsv">${U.fs}px</span></div>
      <div class="set-row"><label>Ticker tape speed</label><input type="range" id="settape" min="30" max="200" step="10" value="${200 - U.tapeSpeed + 30}"></div>
      ${chk("setdense", "Dense rows", U.dense)}
      ${chk("setcompact", "Compact feed (2-line posts)", U.compactFeed)}
    </div>
    <div class="set-sec"><div class="lbl">PANELS · drag the borders between panels to resize</div>
      ${chk("pwatch", "Watchlist", P.watch)}${chk("pchart", "Chart", P.chart)}${chk("pfeed", "Market movers feed", P.feed)}
      ${chk("pbottom", "Bottom tabs", P.bottom)}${chk("ptape", "Ticker tape", P.tape)}
      ${chk("setswap", "Swap sides (feed on the left)", U.swap)}
      <div class="set-row"><button class="tbtn" id="setreset">RESET LAYOUT</button></div>
    </div>
    <div class="set-sec"><div class="lbl">WATCHLIST · ${S.watch.length} symbols</div>
      <div class="set-row"><input class="f" id="setwatch" style="flex:1" placeholder="Add tickers, e.g. PLTR SOFI"><button class="tbtn" id="setwatchadd">ADD</button></div>
      <div class="bline">${S.watch.map((s) => `<span class="chip" title="click to remove" data-unwatch="${esc(s)}">${esc(s)} ✕</span>`).join(" ")}</div>
    </div>
    <div class="set-sec"><div class="lbl">CUSTOM ALERT KEYWORDS</div>
      <div class="set-row"><input class="f" id="setkw" style="flex:1" placeholder="e.g. nvidia, rate cut"><button class="tbtn" id="setkwadd">ADD</button></div>
      <div class="bline">${S.customAlerts.map((k) => `<span class="cat" style="cursor:pointer" data-unkw="${esc(k)}">${esc(k)} ✕</span>`).join(" ") || `<span class="dim">none</span>`}</div>
    </div>
    <div class="set-sec"><div class="lbl">DATABASE</div><div id="setdb" class="dim">loading…</div></div>`;
}

async function openSettings() {
  let el = $("#settings");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div id="settings"></div>`); el = $("#settings"); bindSettings(el); }
  el.innerHTML = settingsHTML();
  requestAnimationFrame(() => el.classList.add("open"));
  try {
    const d = await api("db/stats");
    const rows = Object.entries(d).filter(([k]) => !k.startsWith("_"));
    $("#setdb").innerHTML = `<table class="dbstats">${rows.map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td class="num">${fmtInt(v)}</td></tr>`).join("")}</table>
      <div class="note">${d._size_mb} MB · SQLite at ${esc(d._path)}</div>`;
  } catch { $("#setdb").textContent = "unavailable"; }
}
const closeSettings = () => $("#settings")?.classList.remove("open");

function bindSettings(el) {
  const rerender = () => { el.innerHTML = settingsHTML(); openSettings(); };
  el.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#setclose")) return closeSettings();
    const sw = t.closest("[data-theme]");
    if (sw) { S.ui.theme = sw.dataset.theme; S.ui.accent = ""; applyTheme(); saveUI(); return rerender(); }
    if (t.id === "setaccentreset") { S.ui.accent = ""; applyTheme(); saveUI(); return rerender(); }
    if (t.id === "setreset") { S.ui.panels = { ...UI_DEFAULTS.panels }; S.ui.sizes = { ...UI_DEFAULTS.sizes }; S.ui.swap = false; applyLayout(); saveUI(); return rerender(); }
    if (t.id === "setwatchadd") {
      const add = $("#setwatch").value.toUpperCase().split(/[\s,]+/).filter((x) => x && !S.watch.includes(x));
      S.watch.push(...add); saveSetting("watchlist", S.watch); renderWatch(); renderWatchBtn(); refreshQuotes(); return rerender();
    }
    const uw = t.closest("[data-unwatch]");
    if (uw) { toggleWatch(uw.dataset.unwatch); return rerender(); }
    if (t.id === "setkwadd") {
      const kw = $("#setkw").value.trim().toLowerCase();
      if (kw && !S.customAlerts.includes(kw)) { S.customAlerts.push(kw); saveSetting("custom_alerts", S.customAlerts); renderFeed(); updateMarkers(); }
      return rerender();
    }
    const uk = t.closest("[data-unkw]");
    if (uk) { S.customAlerts = S.customAlerts.filter((k) => k !== uk.dataset.unkw); saveSetting("custom_alerts", S.customAlerts); renderFeed(); return rerender(); }
  });
  el.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "setaccent") { S.ui.accent = t.value; applyTheme(); saveUI(); }
    if (t.id === "setfs") { S.ui.fs = +t.value; $("#setfsv").textContent = t.value + "px"; applyTheme(); placeGutters(); saveUI(); }
    if (t.id === "settape") { S.ui.tapeSpeed = 230 - +t.value; applyTheme(); saveUI(); }
  });
  el.addEventListener("change", (e) => {
    const t = e.target, P = S.ui.panels;
    const map = { pwatch: "watch", pchart: "chart", pfeed: "feed", pbottom: "bottom", ptape: "tape" };
    if (map[t.id]) { P[map[t.id]] = t.checked; applyLayout(); saveUI(); }
    if (t.id === "setswap") { S.ui.swap = t.checked; applyLayout(); saveUI(); }
    if (t.id === "setdense") { S.ui.dense = t.checked; applyTheme(); saveUI(); }
    if (t.id === "setcompact") { S.ui.compactFeed = t.checked; applyTheme(); saveUI(); }
    if (t.id === "setupdown") { S.ui.updown = t.value; applyTheme(); saveUI(); }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "setwatch") $("#setwatchadd").click();
    if (e.key === "Enter" && e.target.id === "setkw") $("#setkwadd").click();
  });
}

/* ============================================================ init */

function initUI() {
  applyTheme();
  applyLayout();
  bindAutocomplete();
  renderWatchBtn();
  $("#gear").addEventListener("click", () => ($("#settings")?.classList.contains("open") ? closeSettings() : openSettings()));
  $("#watchbtn").addEventListener("click", () => toggleWatch(S.sym));
  window.addEventListener("resize", placeGutters);
  new ResizeObserver(placeGutters).observe($("#grid"));
}
