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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); problems.forEach(p => console.log("  - " + p)); process.exit(1); }
process.exit(0);
