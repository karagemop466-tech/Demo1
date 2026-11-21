/*
 * Kalshi demo desk — the trader-facing layer.
 *
 * Two data paths, deliberately:
 *   1. COMPUTED FILES (strategies.json, jumps.json, charts.json) — produced by
 *      tools/strategy_sim.py and tools/jump_scan.py from a capture of the official demo
 *      API. These render instantly and offline, and every field in them carries the
 *      request URL it came from, which the page prints next to the number.
 *   2. LIVE POLLS to the public, unauthenticated demo endpoints for the market you have
 *      selected (GET /markets/{ticker} and GET /markets/{ticker}/orderbook) plus an
 *      optional board refresh (GET /markets?status=open&limit=200). Polling cadence is
 *      conservative and 429s back off, per
 *      https://docs.kalshi.com/getting_started/rate_limits.
 *
 * Nothing is inferred. If the API did not return a value, the cell renders "—" with the
 * unverified styling and stays out of aggregates. Nothing here can place an order: there
 * is no key in this repo and no signing code in this file.
 */
"use strict";

const API = "https://external-api.demo.kalshi.co/trade-api/v2";
const TOPICS = [
  { key: "gas_prices", label: "Gas prices" },
  { key: "elections", label: "Elections" },
  { key: "culture", label: "Culture" },
  { key: "crypto", label: "Crypto" },
  { key: "golf", label: "Golf" },
];
const TAB_LABEL = Object.fromEntries(TOPICS.map((t) => [t.key, t.label]));

const S = {
  strat: null, jumps: null, charts: null, live: null,
  topic: "all", q: "", sort: "dollar_notional_24h", group: "topic",
  sel: null, xunit: "minutes", span: 21600, basis: "traded",
  jumpThresh: 0.10, jumpBasis: "traded", jumpWindow: "any",
  resFilter: "all", pollSec: 10, pollTimer: null, ticks: [],
  net: "unknown", lastPoll: null, backoff: 1,
};

/* --------------------------------------------------------------- tiny helpers */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 2) => (v == null || !isFinite(+v)) ? null : (+v).toFixed(d).replace(/\.?0+$/, "") ;
const money = (v) => (v == null || !isFinite(+v)) ? '<span class="miss">—</span>' : "$" + (+v).toFixed(2);
const usd = (v) => (v == null || !isFinite(+v)) ? '<span class="miss">—</span>'
  : "$" + (+v).toLocaleString("en-US", { maximumFractionDigits: (+v) >= 1000 ? 0 : 2 });
const pct = (v) => (v == null || !isFinite(+v)) ? '<span class="miss">—</span>' : (+v).toFixed(2) + "%";
const cents = (v) => (v == null || !isFinite(+v)) ? '<span class="miss">—</span>' : "$" + (+v).toFixed(2);
const when = (iso) => (!iso ? '<span class="miss">—</span>'
  : new Date(iso).toISOString().slice(0, 16).replace("T", " ") + "Z");
const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return "—";
  if (s < 90) return Math.round(s) + "s ago";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 172800) return (s / 3600).toFixed(1) + "h ago";
  return (s / 86400).toFixed(1) + "d ago";
};
const srcLink = (url, label) => (!url ? "" :
  ` <span class="src"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || "source")}</a></span>`);
const linkToApi = (path) =>
  `<a href="${esc(API + path)}" target="_blank" rel="noopener" title="the exact demo-API request this row came from">API</a>`;
function fmtCount(v) {
  if (v == null || !isFinite(+v)) return '<span class="miss">—</span>';
  const n = +v;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return n.toFixed(n < 10 ? 2 : 0);
}
async function getJSON(url, opts = {}) {
  const r = await fetch(url, Object.assign({ headers: { Accept: "application/json" } }, opts));
  if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
  return r.json();
}
function setBadge(cls, text) {
  const b = $("badge");
  b.className = "badge " + cls;
  b.textContent = text;
}

/* --------------------------------------------------------------------- boot */
async function tryJSON(cands) {
  for (const c of cands) {
    try { return { data: await getJSON(c), from: c }; } catch (e) { /* try next */ }
  }
  return null;
}

async function boot() {
  const [st, jp, ch, lv] = await Promise.all([
    tryJSON(["data/strategies.json", "strategies.json"]),
    tryJSON(["data/jumps.json", "jumps.json"]),
    tryJSON(["data/charts.json", "charts.json"]),
    tryJSON(["data/live-snapshot.json"]),
  ]);
  if (!st) {
    setBadge("off", "no data files");
    $("board").innerHTML = '<div class="flag"><b>engine/strategies.json could not be loaded.</b>'
      + "Open this page from the site root (https://…/Demo1/engine/) — the files sit next to it.</div>";
    return;
  }
  S.strat = st.data; S.jumps = jp && jp.data; S.charts = ch && ch.data; S.live = lv && lv.data;
  S.files = { strat: st.from, jumps: jp && jp.from, charts: ch && ch.from, live: lv && lv.from };

  buildTopicChips(); buildJumpControls(); buildResChips(); wireControls();
  renderTicker();
  renderBoard();
  renderJumps();
  renderResolutions();
  renderStrategies();
  renderSources();
  pickDefaultMarket();
  probeLive();
  setStamp();
  window.addEventListener("resize", () => { if (S.sel) drawChart(); });
}

function setStamp() {
  const g = (S.strat && S.strat.generated_utc) || "?";
  const src = S.live ? "CI refresh" : "committed capture";
  $("stamp").textContent = `dataset: ${src} · generated ${g}`;
  $("boardMeta").innerHTML =
    `<span class="spin"></span>board: ${S.strat.board.length} live markets across ${TOPICS.length} topics, `
    + `grouped by topic and ranked by 24h $ traded (computed: ${esc((S.strat.assumptions && "see method") || "see method")})`;
}

/* ------------------------------------------------------------ live plumbing */
async function probeLive() {
  try {
    const st = await getJSON(API + "/exchange/status");
    S.net = "live";
    setBadge("live", `LIVE · demo API · exchange ${esc((st && st.exchange && (st.exchange.status || st.exchange)) || "?")}`);
    S.backoff = 1;
    // reach out straight away — a trader should not wait one interval for the first tick
    restartPolling();
    if (S.sel) pollSelected();
  } catch (e) {
    S.net = "offline";
    setBadge("sim", "SNAPSHOT · browser could not reach the demo API (CORS/egress)");
  }
}

async function pollSelected() {
  if (!S.sel || S.pollSec <= 0 || S.net !== "live") return;
  const t = S.sel.market_ticker;
  try {
    const [m, ob] = await Promise.all([
      getJSON(`${API}/markets/${encodeURIComponent(t)}`),
      getJSON(`${API}/markets/${encodeURIComponent(t)}/orderbook`),
    ]);
    const mk = (m && m.market) || {};
    const px = firstNum(mk.last_price, mk.last_price_dollars);
    S.ticks.push({ t: Math.floor(Date.now() / 1000), market_ticker: t, price: px,
                   bid: firstNum(mk.yes_bid, mk.yes_bid_dollars),
                   ask: firstNum(mk.yes_ask, mk.yes_ask_dollars) });
    if (S.ticks.length > 4000) S.ticks.splice(0, S.ticks.length - 4000);
    S.lastPoll = new Date().toISOString();
    // keep the row in sync with what the API now says, no smoothing
    const row = S.strat.board.find((r) => r.market_ticker === t);
    if (row) {
      row.last_price = px;
      row.yes_bid = firstNum(mk.yes_bid, mk.yes_bid_dollars);
      row.yes_ask = firstNum(mk.yes_ask, mk.yes_ask_dollars);
      row.contracts_24h = firstNum(mk.volume_24h_fp, mk.volume_24h);
      row.open_interest_contracts = firstNum(mk.open_interest_fp, mk.open_interest);
      row.status = mk.status || row.status;
      row.result = mk.result != null ? mk.result : row.result;
      row.orderbook_live = normBook(ob);
    }
    S.sel = row || S.sel;
    renderDetail(); renderBoard(true); renderTicker();
    drawChart();   // the live tick must appear on the chart, not just in the table
    setBadge("live", `LIVE · polled ${ago(S.lastPoll)}`);
  } catch (e) {
    S.backoff = Math.min(S.backoff * 2, 8);
    setBadge("off", "poll failed (backoff " + S.backoff + "×) — snapshot values kept");
    restartPolling();
  }
}

function firstNum(...vals) {
  for (const v of vals) { const n = parseFloat(v); if (isFinite(n)) return n; }
  return null;
}
function normBook(ob) {
  const b = (ob && (ob.orderbook_fp || ob.orderbook)) || {};
  const yes = (b.yes_dollars || b.yes || []).map((l) => ({ price: +l[0], contracts: +l[1] }));
  const no = (b.no_dollars || b.no || []).map((l) => ({ price: +l[0], contracts: +l[1] }));
  const bestNo = no.length ? no[no.length - 1].price : null;
  return {
    yes_bids: yes, no_bids: no,
    best_yes_bid: yes.length ? yes[yes.length - 1].price : null,
    // documented identity, not a returned field: 1.00 - highest NO bid
    implied_yes_ask: bestNo == null ? null : +(1 - bestNo).toFixed(4),
  };
}
function restartPolling() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  if (S.pollSec <= 0) return;
  const ms = S.pollSec * 1000 * (S.backoff || 1);
  S.pollTimer = setInterval(pollSelected, ms);
}

async function refreshBoard() {
  const btn = $("refresh");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>reading API…';
  try {
    const d = await getJSON(`${API}/markets?status=open&limit=200`);
    const map = new Map(((d && d.markets) || []).map((m) => [m.ticker, m]));
    let hit = 0;
    for (const row of S.strat.board) {
      const m = map.get(row.market_ticker);
      if (!m) continue;
      hit++;
      row.last_price = firstNum(m.last_price, m.last_price_dollars);
      row.previous_price = firstNum(m.previous_price_dollars, row.previous_price);
      row.yes_bid = firstNum(m.yes_bid, m.yes_bid_dollars);
      row.yes_ask = firstNum(m.yes_ask, m.yes_ask_dollars);
      row.contracts_24h = firstNum(m.volume_24h_fp, row.contracts_24h);
      row.status = m.status;
      row.result = m.result != null ? m.result : null;
      row._live = Math.floor(Date.now() / 1000);
    }
    setBadge("live", `LIVE · board page 1 read · ${hit}/${S.strat.board.length} rows updated`);
    renderBoard(); renderTicker();
    const meta = $("boardMeta");
    meta.innerHTML = `Live page of <code>GET /markets?status=open&amp;limit=200</code> covers the newest 200 open `
      + `markets; rows it did not contain keep their captured values and are marked <i>snapshot</i>. `
      + `Updated ${hit} row(s) just now. `
      + `<a href="${esc(API)}/markets?status=open&limit=200" target="_blank" rel="noopener">the request</a>.`;
  } catch (e) {
    setBadge("off", "board refresh failed — browser cannot reach the demo API");
    $("boardMeta").innerHTML = '<span class="miss">Board refresh failed: ' + esc(e.message)
      + ". The committed capture is still rendered below.</span>";
  } finally {
    btn.disabled = false; btn.textContent = "Refresh board from API";
  }
}

/* ---------------------------------------------------------------- controls */
function buildTopicChips() {
  const el = $("topicChips");
  const mk = (key, label) => `<button data-topic="${key}" class="${S.topic === key ? "on" : ""}">${esc(label)}</button>`;
  el.innerHTML = mk("all", "All topics (" + S.strat.board.length + ")") + TOPICS.map((t) =>
    mk(t.key, t.label + " (" + S.strat.board.filter((r) => r.topic === t.key).length + ")")).join("");
  el.onclick = (ev) => {
    const b = ev.target.closest("button[data-topic]");
    if (!b) return;
    S.topic = b.dataset.topic;
    [...el.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x === b));
    renderBoard();
  };
}
function buildJumpControls() {
  const el = $("jumpThresh");
  const opts = [0.05, 0.10, 0.15, 0.20, 0.30];
  el.innerHTML = opts.map((v) => `<button data-th="${v}" class="${Math.abs(v - S.jumpThresh) < 1e-9 ? "on" : ""}">≥ $${v.toFixed(2)}</button>`).join("");
  el.onclick = (ev) => {
    const b = ev.target.closest("button[data-th]");
    if (!b) return;
    S.jumpThresh = +b.dataset.th;
    [...el.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x === b));
    renderJumps();
  };
}
function buildResChips() {
  const el = $("resFilter");
  const n = S.strat.resolutions || [];
  const c = { all: n.length, yes: 0, no: 0, scalar: 0, pending: 0 };
  n.forEach((r) => { if (r.result === "yes") c.yes++; else if (r.result === "no") c.no++; else if (r.result === "scalar") c.scalar++; else c.pending++; });
  el.innerHTML = [["all", "all"], ["yes", "resolved YES"], ["no", "resolved NO"], ["scalar", "scalar"], ["pending", "awaiting determination"]]
    .map(([k, l]) => `<button data-rf="${k}" class="${S.resFilter === k ? "on" : ""}">${esc(l)} (${c[k]})</button>`).join("");
  el.onclick = (ev) => {
    const b = ev.target.closest("button[data-rf]");
    if (!b) return;
    S.resFilter = b.dataset.rf;
    [...el.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x === b));
    renderResolutions();
  };
}
function wireControls() {
  $("tabs").onclick = (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (!b) return;
    [...$("tabs").querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("on"));
    $("tab-" + b.dataset.tab).classList.add("on");
  };
  $("q").oninput = (e) => { S.q = e.target.value.toLowerCase(); renderBoard(); };
  $("sort").onchange = (e) => { S.sort = e.target.value; renderBoard(); };
  $("group").onchange = (e) => { S.group = e.target.value; renderBoard(); };
  $("refresh").onclick = refreshBoard;
  $("xunit").onchange = (e) => { S.xunit = e.target.value; drawChart(); };
  $("span").onchange = (e) => { S.span = +e.target.value; drawChart(); };
  $("basis").onchange = (e) => { S.basis = e.target.value; drawChart(); };
  $("poll").onchange = (e) => { S.pollSec = +e.target.value; S.backoff = 1; restartPolling(); };
  $("jumpBasis").onchange = (e) => { S.jumpBasis = e.target.value; renderJumps(); };
  $("jumpWindow").onchange = (e) => { S.jumpWindow = e.target.value; renderJumps(); };
}

/* -------------------------------------------------------------------- board */
function rows() {
  let r = S.strat.board.slice();
  if (S.topic !== "all") r = r.filter((x) => x.topic === S.topic);
  if (S.q) r = r.filter((x) => [x.title, x.event_title, x.market_ticker, x.series_ticker, x.event_ticker]
    .join(" ").toLowerCase().includes(S.q));
  const dir = S.sort === "close_time" ? 1 : -1;
  r.sort((a, b) => {
    const av = S.sort === "close_time" ? (a.close_time ? Date.parse(a.close_time) : Infinity)
      : (a[S.sort] == null ? -Infinity : a[S.sort]);
    const bv = S.sort === "close_time" ? (b.close_time ? Date.parse(b.close_time) : Infinity)
      : (b[S.sort] == null ? -Infinity : b[S.sort]);
    return av === bv ? 0 : (av > bv ? dir : -dir);
  });
  return r;
}
function statusPill(r) {
  if (r.result === "yes") return '<span class="pill yes">resolved YES</span>';
  if (r.result === "no") return '<span class="pill no">resolved NO</span>';
  if (r.result === "scalar") return '<span class="pill det">scalar</span>';
  if (r.status === "active") return '<span class="pill act">open</span>';
  if (r.status === "closed") return '<span class="pill closed">closed · awaiting</span>';
  if (r.status === "determined") return '<span class="pill det">determined</span>';
  if (r.status === "finalized") return '<span class="pill closed">finalized</span>';
  return `<span class="pill nul">${esc(r.status || "unknown")}</span>`;
}
function headRow() {
  return `<tr><th>Market</th><th>Status</th><th class="num">Price</th><th class="num">Δ prev</th>
    <th class="num">Bid / ask</th><th class="num">Spr</th><th class="num">24h&nbsp;$</th>
    <th class="num">OI</th><th class="num">Closes</th><th></th></tr>`;
}
function trFor(r) {
  const delta = (r.last_price != null && r.previous_price != null) ? r.last_price - r.previous_price : null;
  const spread = (r.implied_yes_ask != null && r.yes_bid != null) ? +(r.implied_yes_ask - r.yes_bid).toFixed(4) : null;
  const sel = S.sel && S.sel.market_ticker === r.market_ticker ? " sel" : "";
  const tleft = r.close_time ? (Date.parse(r.close_time) - Date.now()) / 3600000 : null;
  return `<tr class="${sel.trim()}" data-t="${esc(r.market_ticker)}">
    <td class="t"><a href="#m=${encodeURIComponent(r.market_ticker)}">${esc(r.title || r.market_ticker)}</a>
      ${r.has_candles ? '<span class="pill det" title="candles captured">chart</span>' : ""}
      <span class="ev">${esc(r.event_title || r.event_ticker || "")} · ${esc(r.series_ticker || "")}
      · ${esc(r.market_ticker)}${r._live ? ' · <b>live</b>' : " · snapshot"}</span>
      ${srcLink((r.sources || {}).notional, "24h $ source")}</td>
    <td>${statusPill(r)}</td>
    <td class="num">${cents(r.last_price)}</td>
    <td class="num ${delta == null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : ""}">${delta == null
      ? '<span class="miss">—</span>' : (delta > 0 ? "+" : "") + delta.toFixed(2)}</td>
    <td class="num">${cents(r.yes_bid)} / ${cents(r.implied_yes_ask != null ? r.implied_yes_ask : r.yes_ask)}</td>
    <td class="num">${spread == null ? '<span class="miss">—</span>' : spread.toFixed(2)}</td>
    <td class="num">${usd(r.dollar_notional_24h)}</td>
    <td class="num">${fmtCount(r.open_interest_contracts)}</td>
    <td class="num" title="${esc(when(r.close_time))}">${tleft == null ? '<span class="miss">—</span>'
      : tleft <= 0 ? "closed" : tleft < 48 ? tleft.toFixed(1) + "h" : Math.round(tleft / 24) + "d"}</td>
    <td>${linkToApi("/markets/" + encodeURIComponent(r.market_ticker))}</td>
  </tr>`;
}
function renderBoard(quiet) {
  const r = rows();
  const groups = [];
  if (S.group === "none") {
    groups.push({ title: r.length + " markets", count: r.length, rows: r });
  } else if (S.group === "event") {
    const byT = new Map();
    r.forEach((x) => {
      const k = x.topic || "unclassified";
      if (!byT.has(k)) byT.set(k, new Map());
      const ev = byT.get(k);
      const ek = x.event_ticker || x.market_ticker;
      if (!ev.has(ek)) ev.set(ek, []);
      ev.get(ek).push(x);
    });
    [...byT.entries()].forEach(([topic, evs]) => {
      [...evs.entries()].forEach(([ek, list]) => {
        groups.push({ title: (TAB_LABEL[topic] || topic) + " · " + (list[0].event_title || ek),
                      count: list.length, rows: list });
      });
    });
  } else {
    TOPICS.forEach((t) => {
      const list = r.filter((x) => x.topic === t.key);
      if (list.length) groups.push({ title: t.label, count: list.length, rows: list });
    });
    const extra = r.filter((x) => !TOPICS.some((t) => t.key === x.topic));
    if (extra.length) groups.push({ title: "Other", count: extra.length, rows: extra });
  }
  $("board").innerHTML = groups.map((g) => `
    <div class="grp">
      <h3><span class="dot"></span>${esc(g.title)} <span class="cnt">${g.count} shown ·
        Σ 24h $ ${usd(g.rows.reduce((a, x) => a + (x.dollar_notional_24h || 0), 0))}</span></h3>
      <div class="tw"><table><thead>${headRow()}</thead><tbody>
        ${g.rows.map(trFor).join("")}
      </tbody></table></div>
    </div>`).join("") || '<div class="flag">No rows match this filter.</div>';
  if (!quiet) {
    $("board").querySelectorAll("tr[data-t]").forEach((tr) => {
      tr.onclick = () => {
        const row = S.strat.board.find((x) => x.market_ticker === tr.dataset.t);
        if (row) { S.sel = row; S.ticks = []; renderBoard(); renderDetail(); drawChart(); }
      };
    });
  } else {
    // light touch update: prices only, keep scroll/focus
    $("board").querySelectorAll("tr[data-t]").forEach((tr) => {
      const row = S.strat.board.find((x) => x.market_ticker === tr.dataset.t);
      if (!row) return;
      const tds = tr.querySelectorAll("td");
      if (tds[2]) { tds[2].innerHTML = cents(row.last_price); tds[2].classList.add("flash"); }
      if (tds[4]) tds[4].innerHTML = `${cents(row.yes_bid)} / ${cents(row.implied_yes_ask != null ? row.implied_yes_ask : row.yes_ask)}`;
    });
  }
}

/* ------------------------------------------------------------------ ticker */
function renderTicker() {
  const el = $("ticker");
  const r = (S.strat.board || []).slice()
    .filter((x) => x.dollar_notional_24h != null)
    .sort((a, b) => b.dollar_notional_24h - a.dollar_notional_24h).slice(0, 12);
  if (!r.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = r.map((x) => {
    const d = (x.last_price != null && x.previous_price != null) ? x.last_price - x.previous_price : null;
    const cl = d == null ? "" : d > 0 ? "up" : d < 0 ? "down" : "";
    return `<span class="tk">${esc((x.event_title || x.title || x.market_ticker || "").slice(0, 34))}
      <b>${cents(x.last_price)}</b> <span class="${cl}">${d == null ? "" : (d > 0 ? "▲" : "▼") + Math.abs(d).toFixed(2)}</span>
      <span style="opacity:.65">${usd(x.dollar_notional_24h)}/24h</span></span>`;
  }).join("");
}

/* ----------------------------------------------------------------- detail */
function pickDefaultMarket() {
  const want = location.hash.startsWith("#m=") ? decodeURIComponent(location.hash.slice(3)) : null;
  const withCandles = (S.strat.board || []).find((r) => r.has_candles);
  S.sel = (want && S.strat.board.find((r) => r.market_ticker === want)) || withCandles
    || (S.strat.board || [])[0];
  if (S.sel) { renderDetail(); drawChart(); renderBoard(true); restartPolling(); }
}
function candlesFor(ticker) {
  const out = {};
  const cs = (S.charts && S.charts.series) || [];
  const e = cs.find((x) => x.market_ticker === ticker);
  if (e) for (const [k, w] of Object.entries(e.windows || {})) {
    out[k] = { period_minutes: w.period_minutes, source: w.source, error: w.error,
               rows: (w.points || []).map((p) => ({ t: p[0], traded: p[1], bid: p[2], ask: p[3] })) };
  }
  const lm = ((S.live && S.live.markets) || []).find((x) => x.market_ticker === ticker);
  if (lm && lm.candles) for (const [k, w] of Object.entries(lm.candles)) {
    out[k] = { period_minutes: w.period_minutes, source: w.source, error: w.error,
               rows: (w.points || []).map((p) => ({
                 t: p.t, traded: p.price_close, bid: p.yes_bid_close, ask: p.yes_ask_close })) };
  }
  return out;
}
function renderDetail() {
  const r = S.sel;
  if (!r) return;
  if (S.net === "live" && S.pollSec > 0 && !S.polling) { S.polling = true; pollSelected().finally(() => { S.polling = false; }); }
  $("dTitle").innerHTML = esc(r.title || r.market_ticker);
  $("dSub").innerHTML = `${esc(r.event_title || r.event_ticker || "")} · ${esc(r.series_ticker || "")} ·
    ${esc(r.market_ticker)} · ${esc(TAB_LABEL[r.topic] || r.topic || "")} · ${statusPill(r)}`;
  $("dPrice").textContent = r.last_price == null ? "—" : "$" + r.last_price.toFixed(2);
  const d = (r.last_price != null && r.previous_price != null) ? r.last_price - r.previous_price : null;
  $("dChg").className = "chg " + (d == null ? "" : d > 0 ? "up" : d < 0 ? "down" : "");
  $("dChg").textContent = d == null ? "no prior print returned"
    : (d > 0 ? "+" : "") + d.toFixed(2) + " vs previous";
  const al = $("apiLink");
  al.hidden = false;
  al.href = `${API}/markets/${encodeURIComponent(r.market_ticker)}`;
  $("dFoot").innerHTML =
    `Rules (verbatim): <span class="note">${esc((r.rules_primary || "").slice(0, 300) || "not returned by the API")}</span><br>`
    + `Topic match: ${esc(r.topic_match_reason || "—")}${r.topic_matched_weakly ?
      ' · <span class="pill closed" title="matched on the series ticker, not the title">weak match</span>' : ""}<br>`
    + `24h $: ${esc(r.dollar_formula || "not computed")} ${srcLink((r.sources || {}).notional, "request")}`
    + ` · board captured ${esc(when((S.strat.inputs || {}).markets_generated_utc))}`
    + (S.lastPoll ? ` · last live poll ${esc(ago(S.lastPoll))}` : "");
  renderDepth();
}
function renderDepth() {
  const r = S.sel;
  const el = $("depthTable");
  if (!r) { el.innerHTML = ""; return; }
  // prefer the live poll; otherwise use the book the capture recorded for this market
  const ob = r.orderbook_live
    || (r.book ? { yes_bids: (r.book.yes || []).map((l) => ({ price: l[0], contracts: l[1] })),
                   no_bids: (r.book.no || []).map((l) => ({ price: l[0], contracts: l[1] })),
                   best_yes_bid: (r.book.yes || []).length ? r.book.yes[r.book.yes.length - 1][0] : null,
                   implied_yes_ask: r.implied_yes_ask } : null);
  const src = r.orderbook_live ? "live orderbook poll"
    : ((r.book && r.book.source) || (r.sources || {}).orderbook || "no orderbook request captured");
  const yes = (ob && ob.yes_bids) || [], no = (ob && ob.no_bids) || [];
  if (!yes.length && !no.length) {
    const never = !ob || !r.book;
    el.innerHTML = `<div class="note" style="padding:8px 0">` + (never
      ? "No order-book request was captured for this market, so there is nothing to show — this is a "
        + "coverage gap in the capture, not an empty book. Rows below link the request that would fill it. "
        + linkToApi("/markets/" + encodeURIComponent(r.market_ticker) + "/orderbook")
      : "This market's book came back with no resting orders. An empty book is a valid 200 response "
        + "(<a href=\"https://docs.kalshi.com/getting_started/orderbook_responses\" target=\"_blank\" rel=\"noopener\">orderbook_responses</a>), "
        + "so the ladder is legitimately blank. Nothing is inferred here.")
      + `</div>`;
    return;
  }
  const levels = new Map();
  const add = (arr, side) => arr.forEach((l) => {
    const p = +l.price, c = +l.contracts || 0;
    if (!isFinite(p)) return;
    if (!levels.has(p)) levels.set(p, { yes: 0, no: 0 });
    levels.get(p)[side] += c;
  });
  add(yes, "yes");
  // a NO bid at price q is a YES ask at 1-q (documented identity) — shown on the YES axis
  add(no.map((l) => ({ price: +(1 - +l.price).toFixed(4), contracts: l.contracts })).filter((l) => l.price > 0), "no");
  const max = Math.max(1, ...[...levels.values()].map((v) => Math.max(v.yes, v.no)));
  const sorted = [...levels.entries()].sort((a, b) => b[0] - a[0]);
  el.innerHTML = `<div class="lv h"><span>YES bid&nbsp;$</span><span>resting YES contracts</span>
    <span class="mid">price</span><span>implied YES ask (from NO bids)</span><span>$</span></div>`
    + sorted.map(([p, v]) => `<div class="lv">
        <span class="p0">${v.yes ? v.yes.toFixed(2) : ""}</span>
        <span style="display:flex;justify-content:flex-end"><span class="bar y" style="width:${(100 * v.yes / max).toFixed(1)}%"></span></span>
        <span class="mid">${p.toFixed(2)}</span>
        <span><span class="bar n" style="width:${(100 * v.no / max).toFixed(1)}%"></span></span>
        <span>${v.no ? v.no.toFixed(2) : ""}</span>
      </div>`).join("")
    + `<div class="note" style="margin-top:6px">Bars are contracts resting at that price; the widest bar is the
        largest single level. ${typeof src === "string" && src.startsWith("http")
          ? srcLink(src, "orderbook request") : esc(src)}</div>`;
}

/* ------------------------------------------------------------------- chart */
function bucketPoints(pts, unitSec) {
  if (!pts.length) return [];
  const out = [];
  let cur = null;
  for (const p of pts) {
    const k = Math.floor(p.t / unitSec) * unitSec;
    if (!cur || cur.k !== k) { cur = { k, traded: p.traded, bid: p.bid, ask: p.ask, n: 1 }; out.push(cur); }
    else {
      if (p.traded != null) cur.traded = p.traded;
      if (p.bid != null) cur.bid = p.bid;
      if (p.ask != null) cur.ask = p.ask;
      cur.n++;
    }
  }
  return out.map((o) => ({ t: o.k, traded: o.traded, mid: (o.bid != null && o.ask != null) ? (o.bid + o.ask) / 2 : null }));
}
function pickWindow(spanSec) {
  // Do not claim a 6-hour capture covers a 24-hour selection; prefer a captured
  // window broad enough for the requested interval, then fall back below.
  if (spanSec <= 6 * 3600) return ["1m/6h", "1h/7d", "1d/90d"];
  if (spanSec <= 24 * 3600) return ["1h/24h", "1h/7d", "1d/90d"];
  if (spanSec <= 7 * 86400) return ["1h/7d", "1d/90d"];
  return ["1d/90d"];
}
function hasPrice(p) {
  return [p.traded, p.bid, p.ask].some((v) => v != null && isFinite(+v));
}
function seriesFor() {
  const r = S.sel;
  if (!r) return { pts: [], label: "", src: null, note: "" };
  const cw = candlesFor(r.market_ticker);
  const keys = Object.keys(cw);
  const snapshotTimes = Object.values(cw).flatMap((w) => (w.rows || [])
    .filter(hasPrice).map((p) => +p.t).filter(Number.isFinite));
  const snapshotAsOf = snapshotTimes.length ? Math.max(...snapshotTimes) : null;
  const relevantTicks = (S.ticks || []).filter((t) => t.market_ticker === r.market_ticker
    && t.price != null && isFinite(+t.t));
  const latestLiveTick = relevantTicks.length ? Math.max(...relevantTicks.map((t) => +t.t)) : null;
  // A static snapshot is a point-in-time record. Anchor its chart at the latest
  // captured candle instead of wall-clock time, otherwise it disappears after a
  // day. Once this market has a live sample, anchor at that sample / the live clock.
  const liveAsOf = latestLiveTick == null ? null
    : (S.net === "live" ? Math.floor(Date.now() / 1000) : latestLiveTick);
  const endTime = liveAsOf == null ? (snapshotAsOf == null ? Math.floor(Date.now() / 1000) : snapshotAsOf)
    : Math.max(snapshotAsOf == null ? 0 : snapshotAsOf, liveAsOf);
  const cutoff = endTime - S.span;
  const inWindow = (w) => (w.rows || []).some((p) => p.t >= cutoff && p.t <= endTime && hasPrice(p));
  const candidates = pickWindow(S.span);
  let chosen = candidates.find((k) => cw[k] && inWindow(cw[k]));
  if (!chosen) chosen = candidates.find((k) => cw[k]) || keys.sort()[0] || null;
  const unitSec = S.xunit === "seconds" ? 1 : S.xunit === "minutes" ? 60 : S.xunit === "hours" ? 3600 : 86400;
  let pts = [];
  let note = "";
  let src = null;
  if (chosen) {
    const w = cw[chosen];
    src = w.source;
    const capturedInWindow = inWindow(w);
    pts = w.rows.filter((p) => p.t >= cutoff && p.t <= endTime && hasPrice(p)).map((p) => ({ t: p.t, traded: p.traded,
      mid: (p.bid != null && p.ask != null) ? +((p.bid + p.ask) / 2).toFixed(4) : null }));
    note = capturedInWindow ? `captured ${chosen} candles, bucketed to ${S.xunit}`
      : `no captured ${chosen} candles in this selected window`;
    if (latestLiveTick == null && snapshotAsOf != null && capturedInWindow) {
      note += ` · snapshot as of ${new Date(snapshotAsOf * 1000).toISOString().slice(0, 16)}Z`;
    }
    if (S.xunit === "seconds" && pts.length) {
      note = "1-minute candles cannot resolve seconds — seconds mode shows the client-sampled ticks below";
      pts = [];
    }
  }
  const liveTicks = relevantTicks.filter((t) => t.t >= cutoff && t.t <= endTime)
    .map((t) => ({ t: t.t, traded: t.price, mid: (t.bid != null && t.ask != null) ? (t.bid + t.ask) / 2 : null }));
  pts = pts.concat(liveTicks).sort((a, b) => a.t - b.t);
  pts = bucketPoints(pts, unitSec);
  if (liveTicks.length) note += (note ? " · " : "") + `${liveTicks.length} live tick(s) merged (client-sampled, not an official sub-minute series)`;
  return { pts, label: chosen || "no candles captured", src, note };
}
function drawChart() {
  const svg = $("chart");
  if (!S.sel) { svg.innerHTML = ""; return; }
  const { pts, src, note } = seriesFor();
  $("axisDesc").textContent = S.xunit + " · span " + fmtSpan(S.span);
  $("chartSrc").innerHTML = src ? srcLink(src, "candlestick request") : "";
  $("legend").innerHTML = pts.length
    ? `<span>${pts.length} points · ${esc(note || "captured candles")}</span>`
    : `<span class="miss">no price history captured for this market yet</span>`;
  const W = 760, H = 300, P = { l: 44, r: 10, t: 12, b: 26 };
  if (!pts.length) {
    svg.innerHTML = `<rect width="${W}" height="${H}" fill="#fff"/>`
      + `<text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" font-size="13" fill="#5d6878">No captured candles for</text>`
      + `<text x="${W / 2}" y="${H / 2 + 10}" text-anchor="middle" font-size="12" fill="#8494a6">${esc(S.sel.market_ticker)}</text>`
      + `<text x="${W / 2}" y="${H / 2 + 30}" text-anchor="middle" font-size="11.5" fill="#8494a6">turn polling on to start a seconds series</text>`;
    return;
  }
  const xs = pts.map((p) => p.t), ys = [];
  const series = [];
  if (S.basis === "traded" || S.basis === "both") {
    const s = pts.filter((p) => p.traded != null);
    if (s.length) series.push({ name: "traded close", color: "var(--yes)", pts: s, dash: "" });
  }
  if (S.basis === "mid" || S.basis === "both") {
    const s = pts.filter((p) => p.mid != null);
    if (s.length) series.push({ name: "book mid", color: "var(--no)", pts: s, dash: "4 3" });
  }
  if (!series.length) series.push({ name: "traded close", color: "var(--yes)", pts, dash: "" });
  series.forEach((s) => s.pts.forEach((p) => ys.push(p.traded != null && s.name === "traded close" ? p.traded : p.mid)));
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!isFinite(y0) || !isFinite(y1)) { y0 = 0; y1 = 1; }
  const pad = Math.max(0.02, (y1 - y0) * 0.12);
  y0 = Math.max(0, y0 - pad); y1 = Math.min(1, y1 + pad);
  if (y1 - y0 < 0.04) { y0 = Math.max(0, y0 - 0.02); y1 = Math.min(1, y1 + 0.02); }
  const chartUnitSec = S.xunit === "seconds" ? 1 : S.xunit === "minutes" ? 60 : S.xunit === "hours" ? 3600 : 86400;
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + chartUnitSec);
  const X = (t) => P.l + (W - P.l - P.r) * ((t - x0) / Math.max(1, x1 - x0));
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - y0) / Math.max(1e-9, y1 - y0));
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  // y gridlines at cent ticks
  const step = y1 - y0 > 0.4 ? 0.1 : y1 - y0 > 0.12 ? 0.05 : 0.02;
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
    const y = Y(v);
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--grid)"/>`
      + `<text x="${P.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#5d6878">$${v.toFixed(2)}</text>`;
  }
  // x ticks, unit-aware labels
  const nT = 6;
  for (let i = 0; i <= nT; i++) {
    const t = x0 + (x1 - x0) * (i / nT);
    const d = new Date(t * 1000);
    const lbl = S.xunit === "seconds" ? d.toISOString().slice(14, 19) + ":" + String(d.getUTCSeconds()).padStart(2, "0")
      : S.xunit === "minutes" ? d.toISOString().slice(11, 16)
      : S.xunit === "hours" ? d.toISOString().slice(11, 13) + "h"
      : d.toISOString().slice(5, 10);
    g += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--grid)"/>`
      + `<text x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#5d6878">${esc(lbl)}</text>`;
  }
  g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(0.5)}" y2="${Y(0.5)}" stroke="#c9d4e0" stroke-dasharray="2 3"/>`;
  series.forEach((s) => {
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.traded != null && s.name === "traded close" ? p.traded : p.mid).toFixed(1)}`).join(" ");
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-dasharray="${s.dash}"/>`;
    s.pts.forEach((p) => {
      const v = p.traded != null && s.name === "traded close" ? p.traded : p.mid;
      if (v == null) return;
      g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2" fill="${s.color}"><title>${new Date(p.t * 1000).toISOString().slice(0, 19)}Z · ${v.toFixed(4)}</title></circle>`;
    });
  });
  if (src) g += `<text x="${W - P.r}" y="${P.t + 8}" text-anchor="end" font-size="9.5" fill="#a6b0bd">official candlesticks</text>`;
  svg.innerHTML = g;
}
function fmtSpan(s) {
  return s >= 86400 * 30 ? (s / 86400).toFixed(0) + " days" : s >= 86400 ? (s / 86400).toFixed(0) + " day(s)"
    : s >= 3600 ? (s / 3600).toFixed(0) + " hour(s)" : (s / 60).toFixed(0) + " min";
}

/* ------------------------------------------------------------------- jumps */
function renderJumps() {
  const el = $("jumps");
  if (!S.jumps) { el.innerHTML = '<div class="flag">engine/jumps.json not found — run <code>python3 tools/jump_scan.py --emit-charts engine/charts.json</code>.</div>'; return; }
  const all = S.jumps.jumps || [];
  const f = all.filter((j) => Math.abs(j.delta) + 1e-9 >= S.jumpThresh
    && (S.jumpBasis === "any" || j.price_basis === S.jumpBasis)
    && (S.jumpWindow === "any" || j.window === S.jumpWindow)
    && (S.topic === "all" || j.topic === S.topic));
  const shown = f.slice(0, 250);
  $("jumpMeta").innerHTML = `${f.length} move(s) match · ${all.length} total in this capture over
    ${S.jumps.coverage.candles_scanned.toLocaleString()} candles from ${S.jumps.coverage.markets_with_candles} market(s)`;
  const up = f.filter((j) => j.delta > 0).length;
  el.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="n">${f.length}</div><div class="l">moves ≥ $${S.jumpThresh.toFixed(2)}</div>
        <div class="s">${esc(S.jumps.method)}</div></div>
      <div class="kpi"><div class="n">${up} / ${f.length - up}</div><div class="l">up / down</div>
        <div class="s">direction is arithmetic on the two closes</div></div>
      <div class="kpi"><div class="n">${f.length ? "$" + Math.max(...f.map((j) => Math.abs(j.delta))).toFixed(2) : "—"}</div>
        <div class="l">largest single move</div><div class="s">in this capture</div></div>
      <div class="kpi"><div class="n">${f.length ? (100 * f.filter((j) => (j.volume || 0) === 0).length / f.length).toFixed(0) + "%" : "—"}</div>
        <div class="l">occurred on a candle with zero volume</div>
        <div class="s">on thin demo books these are quote artefacts, not news</div></div>
    </div>
    <div class="panel"><h3>Jump log — newest first, with the request that produced it</h3><div class="tw"><table>
    <thead><tr><th>When</th><th>Market</th><th>Basis / window</th><th class="num">From</th><th class="num">To</th>
      <th class="num">Δ</th><th class="num">Gap</th><th class="num">Candle vol</th><th>Links</th></tr></thead><tbody>
    ${shown.map((j) => `<tr data-t="${esc(j.market_ticker)}">
      <td>${esc(j.time_utc)}<div class="src">${esc(ago(j.time_utc + "Z"))}</div></td>
      <td class="t"><a href="#m=${encodeURIComponent(j.market_ticker)}">${esc((j.title || j.market_ticker || "").slice(0, 70))}</a>
        <span class="ev">${esc(TAB_LABEL[j.topic] || j.topic || "")} · ${esc(j.market_ticker || "")}</span></td>
      <td class="mini">${esc(j.price_basis)} · ${esc(j.window)}</td>
      <td class="num">${cents(j.from)}</td><td class="num">${cents(j.to)}</td>
      <td class="num ${j.direction === "up" ? "up" : "down"}">${j.delta > 0 ? "+" : ""}${j.delta.toFixed(2)}</td>
      <td class="num">${j.gap_seconds}s</td>
      <td class="num">${j.volume == null ? '<span class="miss">—</span>' : fmtCount(j.volume)}</td>
      <td class="mini">
        ${j.source_url ? `<a href="${esc(j.source_url)}" target="_blank" rel="noopener">candles</a>` : '<span class="miss">no URL</span>'}
        · <a href="${esc(j.news_search_url)}" target="_blank" rel="noopener" title="a search, not a source — no cause is asserted here">news search</a>
        · ${linkToApi("/markets/" + encodeURIComponent(j.market_ticker))}</td>
    </tr>`).join("") || '<tr><td colspan="9">No moves at this threshold in the captured window — that is a real result, not a gap.</td></tr>'}
    </tbody></table></div>
    ${f.length > shown.length ? `<div class="note inner">showing the ${shown.length} largest of ${f.length}</div>` : ""}
    </div>`;
  el.querySelectorAll("tr[data-t]").forEach((tr) => {
    tr.onclick = () => {
      const row = S.strat.board.find((x) => x.market_ticker === tr.dataset.t);
      if (row) {
        S.sel = row; renderBoard(); renderDetail(); drawChart();
        [...$("tabs").querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x.dataset.tab === "board"));
        document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("on"));
        $("tab-board").classList.add("on");
      }
    };
  });
}

/* ------------------------------------------------------------- resolutions */
function renderResolutions() {
  const el = $("resolutions");
  const all = (S.strat.resolutions || []);
  const f = all.filter((r) => S.resFilter === "all" ? true
    : S.resFilter === "pending" ? (r.result == null) : r.result === S.resFilter);
  const byTopic = TOPICS.map((t) => {
    const list = f.filter((r) => r.topic === t.key);
    const yes = list.filter((r) => r.result === "yes").length;
    const no = list.filter((r) => r.result === "no").length;
    return { t: t.label, n: list.length, yes, no, other: list.length - yes - no,
             payout: list.reduce((a, r) => a + (r.settlement_value_dollars || 0), 0) };
  });
  el.innerHTML = `<div class="panel"><h3>Outcome mix in this capture (topic × resolution)</h3>
    <div class="tw"><table class="plain"><thead><tr><th>Topic</th><th class="num">Markets</th>
    <th class="num">Resolved YES</th><th class="num">Resolved NO</th><th class="num">Other / pending</th>
    <th class="num">Σ settlement $ per contract</th></tr></thead><tbody>
    ${byTopic.map((b) => `<tr><td>${esc(b.t)}</td><td class="num">${b.n}</td>
      <td class="num up">${b.yes}</td><td class="num down">${b.no}</td><td class="num">${b.other}</td>
      <td class="num">${money(b.payout)}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="panel"><h3>Market-level resolution log — ${f.length} row(s)</h3><div class="tw"><table>
    <thead><tr><th>Market</th><th>Status</th><th>Outcome</th><th class="num">Last price</th>
      <th class="num">Settlement $</th><th>Settled at</th><th class="num">Contracts traded</th><th>Source</th></tr></thead>
    <tbody>${f.slice(0, 80).map((r) => `<tr>
      <td class="t">${esc((r.title || r.market_ticker || "").slice(0, 90))}
        <span class="ev">${esc(TAB_LABEL[r.topic] || r.topic || "")} · ${esc(r.market_ticker || "")} ·
        closed ${esc(when(r.close_time))}</span></td>
      <td><span class="pill ${r.status === "finalized" ? "closed" : "det"}">${esc(r.status || "—")}</span></td>
      <td>${r.result === "yes" ? '<span class="pill yes">YES</span>' : r.result === "no"
        ? '<span class="pill no">NO</span>' : r.result ? '<span class="pill det">' + esc(r.result) + "</span>"
        : '<span class="pill nul">awaiting</span>'}</td>
      <td class="num">${cents(r.last_price)}</td>
      <td class="num">${cents(r.settlement_value_dollars)}</td>
      <td class="mini">${when(r.settlement_ts)}</td>
      <td class="num">${fmtCount(r.contracts)}</td>
      <td class="mini">${r.source ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">request</a>`
        : '<span class="miss">no URL recorded</span>'}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="note inner">Rows with a blank outcome are past their close time but not yet determined. The API
      returns <code>result: null</code> there, so the cell is blank — the page never predicts an outcome.</div></div>`;
}

/* ------------------------------------------------------------- strategies */
function summaryTable(obj, firstCol) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return '<div class="note inner">Nothing matched — no simulated fills at these settings.</div>';
  return `<div class="tw"><table class="plain"><thead><tr><th>${esc(firstCol)}</th>
    <th class="num">Trades</th><th class="num">Winners</th><th class="num">Win %</th>
    <th class="num">Cost</th><th class="num">Gross</th><th class="num">Fees</th><th class="num">Net</th>
    <th class="num">Net ROI</th><th class="num">Avg hold</th><th class="num">Markets</th><th>Sources</th></tr></thead>
    <tbody>${keys.map((k) => { const v = obj[k]; if (!v) return "";
      return `<tr><td>${esc(k)}</td><td class="num">${v.trades}</td><td class="num">${v.winners}</td>
      <td class="num">${v.win_rate_pct}%</td><td class="num">${usd(v.cost_usd)}</td>
      <td class="num">${usd(v.gross_usd)}</td><td class="num">${usd(v.fees_usd)}</td>
      <td class="num ${v.net_usd >= 0 ? "up" : "down"}">${usd(v.net_usd)}</td>
      <td class="num">${pct(v.net_roi_pct)}</td><td class="num">${v.avg_hold_minutes} min</td>
      <td class="num">${v.markets}</td>
      <td class="mini">${(v.source_urls || []).slice(0, 2).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i ? "·" : "candles"}</a>`).join(" ")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}
function renderStrategies() {
  const el = $("strategies");
  const st = S.strat.strategies || {}, ss = S.strat.assumptions || {}, study = S.strat.settlement_study || {};
  const o = (st.summary || {}).overall || {};
  const trades = (st.trades || []).slice().reverse().slice(0, 60);
  const feeNote = (ss.fees || {});
  el.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="n">${o.trades || 0}</div><div class="l">simulated round trips</div>
      <div class="s">${esc(Object.keys((st.summary || {}).by_strategy || {}).length)} rules · 1 position/market</div></div>
    <div class="kpi"><div class="n" style="color:${(o.net_usd || 0) >= 0 ? "var(--up)" : "var(--down)"}">${usd(o.net_usd)}</div>
      <div class="l">net after fees</div><div class="s">on ${usd(o.cost_usd)} of cost (${pct(o.net_roi_pct)})</div></div>
    <div class="kpi"><div class="n">${usd(o.fees_usd)}</div><div class="l">fees paid</div>
      <div class="s">taker both legs · ${esc(feeNote.taker_formula || "")}</div></div>
    <div class="kpi"><div class="n">${o.win_rate_pct == null ? "—" : o.win_rate_pct + "%"}</div><div class="l">winners</div>
      <div class="s">${o.winners || 0} of ${o.trades || 0}</div></div>
  </div>
  <div class="panel"><h3>The three rules being tested</h3><div class="inner note">
    ${Object.entries((st.rules || {})).map(([k, v]) => `<b>${esc(k)}</b> — ${esc(v)}`).join("<br>")}
    <br><br>Assumptions: ${esc(String(ss.contracts_per_trade))} contracts a leg · entry ${esc(ss.entry_fill)} ·
    exit ${esc(ss.exit_fill)} · ${esc(String(ss.position_rule))}. Every one of these is a modelling choice, stated
    here so a result can be argued with.</div></div>
  <div class="panel"><h3>By strategy</h3>${summaryTable((st.summary || {}).by_strategy, "Strategy")}</div>
  <div class="two">
    <div class="panel"><h3>By topic</h3>${summaryTable((st.summary || {}).by_topic, "Topic")}</div>
    <div class="panel"><h3>By trade type (categorised, per the brief)</h3>${summaryTable((st.summary || {}).by_trade_type, "Action / side / hold")}</div>
  </div>
  <div class="panel"><h3>Holding a settled market to its payout, bucketed by the price it last traded at</h3>
    <div class="inner note" style="padding-bottom:8px">${esc(study.definition || "")}</div>
    ${studyTable(study.buckets)}
    <div class="two" style="padding:0 12px 12px">
      <div><h3 style="font-size:12.5px;margin:12px 0 6px">Same study, only markets that traded ≥ ${esc(String((study.liquid_only || {}).min_volume_contracts))} contracts</h3>
      ${studyTable((study.liquid_only || {}).buckets)}
      <div class="note">A $0.00 or $1.00 "last price" is the API reporting no trade, not a price anyone could
      transact at: ${esc(String((study.rows_skipped || {}).price_not_fillable))} of ${esc(String(study.markets_examined))}
      settled markets in this capture were excluded for that reason alone.</div></div>
    </div>
  </div>
  <div class="panel"><h3>Trade log — the fills behind those numbers (${trades.length} shown, newest first)</h3>
    <div class="tw"><table class="plain"><thead><tr><th>Entry (UTC)</th><th>Rule</th><th>Market</th><th>Side</th>
    <th>Trigger</th><th class="num">In</th><th class="num">Out</th><th class="num">Contr</th><th class="num">Cost</th>
    <th class="num">Fees</th><th class="num">Net</th><th class="num">ROI</th><th>Source</th></tr></thead><tbody>
    ${trades.map((t) => `<tr><td class="mini">${esc(t.entry_utc)}</td>
      <td>${esc(t.strategy_name)}</td>
      <td class="t mini">${esc((t.book && t.book.title || "").slice(0, 42))}<span class="ev">${esc(t.book && t.book.market_ticker)} · ${esc(t.book && t.book.window)}</span></td>
      <td>${esc(t.side)}</td>
      <td class="mini">${esc(t.action)}<span class="ev">Δ ${t.jump_delta > 0 ? "+" : ""}${t.jump_delta.toFixed(2)} on ${esc(t.jump_direction)} jump</span></td>
      <td class="num">${cents(t.entry_price)}</td><td class="num">${cents(t.exit_price)}</td>
      <td class="num">${fmtCount(t.contracts)}</td><td class="num">${usd(t.cost_usd)}</td>
      <td class="num">${money(t.fees_usd)}</td>
      <td class="num ${t.net_usd >= 0 ? "up" : "down"}">${money(t.net_usd)}</td>
      <td class="num">${pct(t.roi_pct)}</td>
      <td class="mini">${t.book && t.book.source_url ? `<a href="${esc(t.book.source_url)}" target="_blank" rel="noopener">candles</a>` : '<span class="miss">—</span>'}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="panel"><h3>Where the tradable liquidity actually is</h3>
    <div class="inner note" style="padding-bottom:8px">${esc((S.strat.liquidity || {}).coverage_note || "")}</div>
    <div class="tw"><table class="plain"><thead><tr><th>Topic</th><th class="num">Open markets</th>
      <th class="num">Books captured</th><th class="num">Median spread</th><th class="num">Spread ≤ 1¢</th>
      <th class="num">YES depth avg (contracts)</th><th class="num">NO depth avg (contracts)</th></tr></thead><tbody>
      ${((S.strat.liquidity || {}).by_topic || []).map((r) => `<tr><td>${esc(r.topic)}</td>
        <td class="num">${r.open_markets}</td><td class="num">${r.books_captured_for}</td>
        <td class="num">${cents(r.median_spread)}</td><td class="num">${pct(r.spread_le_1c_pct)}</td>
        <td class="num">${fmtCount(r.contracts_resting_yes_side_avg)}</td>
        <td class="num">${fmtCount(r.contracts_resting_no_side_avg)}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="flag"><b>Read this before believing any of it.</b> ${
      (S.strat.caveats || []).map(esc).join(" ")}</div>`;
}
function studyTable(rows) {
  if (!rows || !rows.length) return '<div class="note inner">No settled markets matched.</div>';
  return `<div class="tw"><table class="plain"><thead><tr><th>Entry bucket</th><th class="num">Markets</th>
    <th class="num">YES</th><th class="num">NO</th><th class="num">YES rate</th><th class="num">Avg entry</th>
    <th class="num">Cost</th><th class="num">Payout</th><th class="num">Fees</th><th class="num">Net</th>
    <th class="num">Net ROI</th></tr></thead><tbody>${rows.map((b) => `<tr>
    <td>${esc(b.bucket)}</td><td class="num">${b.markets}</td><td class="num">${b.resolved_yes}</td>
    <td class="num">${b.resolved_no}</td><td class="num">${pct(b.yes_rate_pct)}</td>
    <td class="num">${cents(b.avg_entry_price)}</td><td class="num">${usd(b.cost_usd)}</td>
    <td class="num">${usd(b.payout_usd)}</td><td class="num">${usd(b.fees_usd)}</td>
    <td class="num ${b.net_usd >= 0 ? "up" : "down"}">${usd(b.net_usd)}</td>
    <td class="num">${pct(b.net_roi_pct)}</td></tr>`).join("")}</tbody></table>
    <div class="note inner">${srcLink((rows[0].source_urls || [])[0], "the request that listed these markets")}</div></div>`;
}

/* --------------------------------------------------------------- sources */
function renderSources() {
  const el = $("sources");
  const i = S.strat.inputs || {}, cov = (S.jumps || {}).coverage || {};
  const rows = [
    ["Dataset generated", when(S.strat.generated_utc) + " from " + esc(i.charts || "") + " / " + esc(i.markets || "") + " / " + esc(i.resolved || "")],
    ["API base captured", `<code>${esc(i.api_base || API)}</code> — recommended demo host per <a href="https://docs.kalshi.com/getting_started/api_environments" target="_blank" rel="noopener">api_environments</a>; the brief's alternate <code>https://demo-api.kalshi.co/trade-api/v2</code> is listed on the same page`],
    ["WebSocket", "not connected: the handshake requires a signed session, so this page polls REST instead — <a href=\"https://docs.kalshi.com/getting_started/quick_start_websockets\" target=\"_blank\" rel=\"noopener\">quick_start_websockets</a>"],
    ["Endpoints used", (S.strat.endpoints_used || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace("https://docs.kalshi.com/api-reference/", ""))}</a>`).join(" · ")],
    ["Fee schedule", `<a href="${esc(((S.strat.assumptions || {}).fees || {}).source || "")}" target="_blank" rel="noopener">${esc(((S.strat.assumptions || {}).fees || {}).effective || "official PDF")}</a> — ${esc(((S.strat.assumptions || {}).fees || {}).taker_formula || "")}`],
    ["Candle coverage", `${cov.markets_with_candles || 0} market(s), ${cov.candles_scanned || 0} candles, ${cov.windows || 0} window(s), ${cov.jumps_found || 0} moves at the default threshold`],
    ["Settled markets examined", `${(S.strat.settlement_study || {}).markets_examined || 0} · skipped ${JSON.stringify(((S.strat.settlement_study || {}).rows_skipped) || {})}`],
    ["Data file", (S.files ? Object.entries(S.files).filter(([, v]) => v).map(([k, v]) => `<a href="${esc(v)}">${esc(k)}</a>`).join(" · ") : "")],
    ["Live-poll evidence", `browser→demo-API CORS was verified for this origin in <a href="../data/cors.json">data/cors.json</a>; this page re-detects at load and shows the result in the badge`],
  ];
  el.innerHTML = `<div class="panel"><h3>Provenance</h3><div class="tw"><table class="plain">
    <tbody>${rows.map(([k, v]) => `<tr><th style="width:210px">${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody>
    </table></div></div>
    <div class="panel"><h3>Flagged for review on this desk (nothing here is a blocker)</h3><div class="inner">
      ${["Demo venue only: mock funds, and Kalshi warns demo prices/behaviour may not reflect real markets — every number here is test-venue data.",
         "No demo API key exists in this repository, so there is no real account, no real fills and no real portfolio. The trade log is simulated and labelled SIMULATED everywhere it appears.",
         "Candle capture covers a small set of markets chosen by the collector; a missing chart is a coverage gap, not a market that did not move.",
         "The 'last traded price' used as an entry in the settlement study is the API's own field, but on illiquid books it can be hours from the close, so bucket ROI overstates realism.",
         "Dollar ranking is computed (volume × notional) because the API exposes no USD-volume field on GET /markets; the formula is printed on each row's source link.",
         "Topic assignment is a published keyword rule over titles and series tickers; rows matched on ticker only are marked 'weak match'.",
         "Seconds resolution on the chart is client-sampled from polls — the official candlestick endpoint's finest interval is 1 minute, so this is labelled and never presented as exchange data.",
         "The public kalshi.com market-page URL pattern was not verifiable from the sandbox, so rows link to the API request (always correct) and a news search instead of a guessed web URL."
        ].map((t, n) => `<div class="flag"><b>ENG-${String(n + 1).padStart(2, "0")}.</b> ${esc(t)}</div>`).join("")}
    </div></div>
    <div class="panel"><h3>Suggestions to make this desk more live (in rough order of value)</h3><div class="inner">
      <ol class="tight">
        <li><b>Move to the WebSocket book channel.</b> REST polling cannot beat a minute. The documented
          <a href="https://docs.kalshi.com/websockets/orderbook-updates" target="_blank" rel="noopener">orderbook_updates</a>
          channel needs a signed session, which needs a key — the one change that would make seconds-resolution
          charts real rather than sampled.</li>
        <li><b>Persist the resolution watch across CI runs.</b> Track a queue of markets that are about to close and
          re-read them until <code>result</code> is set, appending a dated row per observation, so the resolution log
          becomes a history instead of a snapshot.</li>
        <li><b>Attach the settlement source to each jump.</b> The API returns <code>settlement_sources[].url</code> —
          the outlet the market itself settles against — which is a real, citable "what moved this" link instead of a
          news search.</li>
        <li><b>Alert on jump + depth in the same breath.</b> A ≥ $0.10 move on 5 contracts is noise; on 5,000 it is
          information. Flag only moves whose candle volume clears a floor, and show both numbers.</li>
        <li><b>Put a paper ledger next to the board.</b> The engine already prices a fill honestly (spread + taker
          fee); letting a strategy rest a simulated order and mark it to the next book makes the backtest live.</li>
        <li><b>One calendar strip.</b> Four of the five topics are driven by fixed event times (AAA weekly print,
          Fed dates, tournament rounds); a shared "what closes in the next hour" rail is the highest-use widget left.</li>
      </ol>
      <div class="note">Nothing above is implemented on this desk without a claim on the coordination board —
      the list is a queue, not a claim.</div>
    </div></div>`;
}

/* expose for the jsdom boot test */
if (typeof window !== "undefined") {
  window.__engine = { S, seriesFor, bucketPoints, rows, cents, fmtSpan, boot };
  boot();
}
