#!/usr/bin/env node
/* desk/tools/dom_test.mjs — headless DOM checks for the desk pages.
 *
 * Verifies, for every page:
 *   * it parses and every page has the shared navigation
 *   * every .html link target exists on disk
 *   * the header live badge is present
 * and, for the two interactive pages, that the scripts run without throwing and that
 * chart/jump code produces the values the page claims when fed real snapshot data.
 *
 * Run: node desk/tools/dom_test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESK = path.resolve(HERE, "..");
const PAGES = ["index.html", "live.html", "markets.html", "gas-prices.html", "elections.html",
  "culture.html", "crypto.html", "golf.html", "resolutions.html", "strategy.html",
  "portfolio.html", "requirements.html", "sources.html", "flagged.html"];

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; problems.push(name + (detail ? " — " + detail : "")); console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

console.log("1. every page parses, links resolve, navigation present");
for (const p of PAGES) {
  const file = path.join(DESK, p);
  if (!fs.existsSync(file)) { check(p + " exists", false); continue; }
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  check(p + " has <h1>", !!doc.querySelector("h1"), "no h1");
  check(p + " has main nav", doc.querySelectorAll("nav.main a").length >= 12,
    "nav links: " + doc.querySelectorAll("nav.main a").length);
  check(p + " has live status element", !!doc.querySelector("[data-live-status]"));
  check(p + " marks current page", !!doc.querySelector('nav.main a[aria-current="page"]'));
  const links = [...doc.querySelectorAll("a[href]")].map(a => a.getAttribute("href"));
  const broken = links.filter(h => {
    if (/^(https?:|mailto:|#|data:)/.test(h)) return false;
    const target = path.resolve(path.dirname(file), h.split("#")[0].split("?")[0]);
    return !fs.existsSync(target);
  });
  check(p + " internal links resolve", broken.length === 0, broken.slice(0, 3).join(", "));
  const rows = doc.querySelectorAll("tbody tr").length;
  const official = (html.match(/https:\/\/(external-api\.demo\.kalshi\.co|docs\.kalshi\.com|kalshi\.com|github\.com)/g) || []).length;
  if (rows > 0) check(p + " cites an official source", official > 0, rows + " rows, " + official + " official links");
}

console.log("2. core.js pure functions against real snapshot data");
const snapshot = JSON.parse(fs.readFileSync(path.join(DESK, "data", "snapshot-slim.json"), "utf8"));
const dom2 = new JSDOM("<!doctype html><div id='request-log'></div>", { runScripts: "outside-only", url: "https://example.test/" });
dom2.window.fetch = () => new Promise(() => {});
dom2.window.eval(fs.readFileSync(path.join(DESK, "assets", "core.js"), "utf8"));
const KD = dom2.window.KD;
check("KD object exposed", !!KD);
check("base URL is the official demo host", KD.BASE === "https://external-api.demo.kalshi.co/trade-api/v2", KD.BASE);
check("five topics defined", KD.TOPICS.length === 5, String(KD.TOPICS.length));
check("gas ticker classifies as gas", (KD.classify({ series_ticker: "KXAAAGASW", ticker: "KXAAAGASW-26NOV23-3.64", title: "Will average gas prices be above $3.64?" }) || {}).id === "gas_prices");
check("KXWTI is excluded (oil, not elections)", KD.classify({ series_ticker: "KXWTI", ticker: "KXWTI-26NOV2014-T88.99", title: "Oil Price (WTI) on Friday?" }) === null);
check("bitcoin classifies as crypto", (KD.classify({ series_ticker: "KXBTCY", ticker: "KXBTCY-27JAN0100-B97500", title: "BTC price on Jan 1, 2027?" }) || {}).id === "crypto");
check("golf series classifies as golf", (KD.classify({ series_ticker: "KXPGATOUR", ticker: "KXPGATOUR-THRC26-TMOO", title: "The RSM Classic: Taylor Moore wins" }) || {}).id === "golf");
check("rotten tomatoes classifies as culture", (KD.classify({ series_ticker: "KXRT", ticker: "KXRT-FUR-85", title: "Rotten Tomatoes score?" }) || {}).id === "culture");

console.log("3. chart + jump logic on real candle points");
let totalJumps = 0, chartDraws = 0;
snapshot.charts.forEach(c => {
  Object.keys(c.windows).forEach(w => {
    const pts = (c.windows[w].points || []).filter(p => p.c !== null && p.c !== undefined)
      .map(p => ({ t: p.t, y: Number(p.c) }));
    if (pts.length < 2) return;
    const jumps = KD.findJumps(pts, 0.10);
    totalJumps += jumps.length;
    jumps.forEach(j => {
      if (Math.abs(j.delta) < 0.10 - 1e-9) { check("jump >= $0.10", false, JSON.stringify(j)); }
    });
  });
});
check("jump scanner returns only >= $0.10 moves", true, totalJumps + " jumps found across snapshot windows");

console.log("4. chart canvas renders (jsdom stub)");
const dom3 = new JSDOM("<!doctype html><canvas id='c' width='600' height='240'></canvas>",
  { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
dom3.window.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  return { setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, fillText: noop, arc: noop, closePath: noop, createLinearGradient: () => ({ addColorStop: noop }),
    set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set font(v) {}, set globalAlpha(v) {} };
};
dom3.window.eval(fs.readFileSync(path.join(DESK, "assets", "core.js"), "utf8"));
const canvas = dom3.window.document.getElementById("c");
Object.defineProperty(canvas, "clientWidth", { value: 600 });
const series = (snapshot.charts[0].windows["1m/6h"].points || [])
  .filter(p => p.c !== null).map(p => ({ t: p.t, y: Number(p.c) }));
const drew = dom3.window.KD.drawChart(canvas, series, { jumps: dom3.window.KD.findJumps(series) });
check("drawChart renders real series", drew === true);
check("drawChart returns false on empty series", dom3.window.KD.drawChart(canvas, [], {}) === false);

console.log("5. paper-trade ledger arithmetic");
const ledger = JSON.parse(fs.readFileSync(path.join(DESK, "data", "paper-trades.json"), "utf8"));
check("ledger has trades", ledger.trades.length > 0, String(ledger.trades.length));
check("every trade has an entry source URL", ledger.trades.every(t => !!t.entry_source_url));
check("every open trade has no P&L", ledger.trades.filter(t => t.status === "OPEN").every(t => t.pnl_usd === null));
check("every settled trade has a result", ledger.trades.filter(t => t.status === "SETTLED").every(t => /^(yes|no)$/.test(t.result || "")));
const badFee = ledger.trades.filter(t => t.fee_usd === "0.00" && Number(t.entry_price) > 0.02 && Number(t.entry_price) < 0.98);
check("no zero-fee trade inside the fee-charging range", badFee.length === 0, badFee.map(t => t.id).join(","));
const losses = ledger.trades.filter(t => Number(t.entry_price) >= 0.99 || Number(t.entry_price) <= 0.01);
check("no trade entered outside [$0.02, $0.98]", losses.length === 0,
  losses.map(t => t.id + "@" + t.entry_price).join(","));

console.log("6. resolution log integrity");
const log = JSON.parse(fs.readFileSync(path.join(DESK, "data", "resolutions-log.json"), "utf8"));
const resolved = log.entries.filter(e => e.state === "resolved");
check("resolved entries all carry yes/no", resolved.every(e => /^(yes|no)$/.test(e.outcome || "")));
check("awaiting entries never carry an outcome", log.entries.filter(e => e.state === "awaiting_result").every(e => !e.outcome));
check("every entry has a source URL", log.entries.every(e => !!e.source_url));
check("totals match the entry list",
  log.totals.resolved === resolved.length && log.totals.awaiting === log.entries.length - resolved.length,
  JSON.stringify(log.totals));

console.log("7. live scan boots and covers the five topics (live.html + core.js + live.js)");

/* The scan is exercised with official-shaped payloads: the index file the page really
 * ships, two per-series responses, and a newest-page response made of multivariate
 * combos only (the shape that produced zero matches on 2026-11-21). */
const liveHtml = fs.readFileSync(path.join(DESK, "live.html"), "utf8")
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const liveDom = new JSDOM(liveHtml, {
  runScripts: "outside-only", pretendToBeVisual: true,
  url: "file://" + path.join(DESK, "live.html"),
});
liveDom.window.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  return { setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, fillText: noop, arc: noop, closePath: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set font(v) {}, set globalAlpha(v) {} };
};
const seriesIndex = JSON.parse(fs.readFileSync(path.join(DESK, "data", "series-index.json"), "utf8"));
const slim = fs.readFileSync(path.join(DESK, "data", "snapshot-slim.json"), "utf8");
const marketFor = (series) => series === "KXAAAGASW"
  ? { ticker: "KXAAAGASW-26NOV23-3.9400", series_ticker: "KXAAAGASW", event_ticker: "KXAAAGASW-26NOV23",
      title: "Will average **gas prices** be above $3.9400?", status: "active", yes_bid_dollars: "0.0100",
      yes_ask_dollars: "0.0300", no_bid_dollars: "0.9700", no_ask_dollars: "0.9900",
      last_price_dollars: "0.0200", volume_24h_fp: "1200.00", open_interest_fp: "3421.27",
      close_time: "2026-11-23T04:59:00Z", result: "" }
  : { ticker: "KXPGATOUR-THRC26-TMOO", series_ticker: "KXPGATOUR", event_ticker: "KXPGATOUR-THRC26",
      title: "The RSM Classic: Taylor Moore wins", status: "active", yes_bid_dollars: "0.0400",
      yes_ask_dollars: "0.0600", no_bid_dollars: "0.9400", no_ask_dollars: "0.9600",
      last_price_dollars: "0.0500", volume_24h_fp: "840965.93", open_interest_fp: "18000.00",
      close_time: "2026-12-06T00:00:00Z", result: "" };
const combo = { ticker: "KXMVECROSSCATEGORY-S2026EL25MYXJS4XJ25SU-SYXFWBWET",
  event_ticker: "KXMVECROSSCATEGORY-S2026EL25MYXJS4XJ25SU", series_ticker: "KXMVECROSSCATEGORY",
  title: "yes Central Connecticut St.,yes Portland St.", status: "active", volume_24h_fp: "0.00",
  open_interest_fp: "100.00", yes_bid_dollars: "0.0000", yes_ask_dollars: "1.0000",
  no_bid_dollars: "0.0000", no_ask_dollars: "1.0000", last_price_dollars: "0.4500", close_time: "2026-11-24T22:00:00Z" };
const seen = [];
liveDom.window.fetch = (input) => {
  const url = String(input);
  seen.push(url);
  const json = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
  if (url.indexOf("series-index.json") >= 0) return json(seriesIndex);
  if (url.indexOf("snapshot-slim.json") >= 0) return json(JSON.parse(slim));
  if (url.indexOf("/exchange/status") >= 0) return json({ exchange_active: true, trading_active: true });
  if (url.indexOf("candlesticks") >= 0) return json({ candlesticks: [] });
  if (url.indexOf("/orderbook") >= 0) return json({ orderbook_fp: { yes_dollars: [], no_dollars: [] } });
  if (url.indexOf("series_ticker=") >= 0) {
    const s = decodeURIComponent(url.split("series_ticker=")[1].split("&")[0]);
    return json({ markets: [marketFor(s)] });
  }
  if (url.indexOf("/markets?") >= 0 && url.indexOf("status=open") >= 0) {
    return json({ markets: [combo], cursor: null });
  }
  return json({ markets: [], candlesticks: [] });
};
liveDom.window.eval(fs.readFileSync(path.join(DESK, "assets", "core.js"), "utf8"));
liveDom.window.eval(fs.readFileSync(path.join(DESK, "assets", "live.js"), "utf8"));
/* 28 series requests are spaced 120 ms apart by design; wait for the pass to finish. */
await new Promise(r => setTimeout(r, 6000));
const liveDoc = liveDom.window.document;
const tableHtml = liveDoc.getElementById("live-table").innerHTML;
check("scan asked for the committed series index", seen.some(u => u.indexOf("series-index.json") >= 0));
check("scan used the documented mve_filter=exclude on the newest page",
  seen.some(u => u.indexOf("status=open") >= 0 && u.indexOf("mve_filter=exclude") >= 0 && u.indexOf("series_ticker=") < 0));
check("scan used series_ticker + mve_filter per series",
  seen.some(u => u.indexOf("series_ticker=KXPGATOUR") >= 0 && u.indexOf("mve_filter=exclude") >= 0),
  seen.filter(u => u.indexOf("series_ticker=") >= 0).slice(0, 2).join(" "));
check("golf market from a series request is rendered", tableHtml.indexOf("KXPGATOUR-THRC26-TMOO") >= 0);
check("gas market from a series request is rendered", tableHtml.indexOf("KXAAAGASW-26NOV23-3.9400") >= 0);
check("multivariate combo market is not rendered", tableHtml.indexOf("KXMVECROSSCATEGORY") < 0);
check("row source points at the series request that produced it",
  tableHtml.indexOf("series_ticker=KXAAAGASW") >= 0);
check("banner reports the live scan and cites mve_filter",
  (liveDoc.getElementById("api-banner").innerHTML || "").indexOf("mve_filter") >= 0,
  liveDoc.getElementById("api-banner").textContent.slice(0, 120));
check("live count reports matched markets",
  /open markets matched/.test(liveDoc.getElementById("live-count").textContent));
check("the scan stores one row per ticker (2 real markets)", (liveDom.window.__lastRows || []).length === 2,
  String((liveDom.window.__lastRows || []).length));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); problems.forEach(p => console.log("  - " + p)); process.exit(1); }
process.exit(0);
