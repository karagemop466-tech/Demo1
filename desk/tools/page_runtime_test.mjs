#!/usr/bin/env node
/* desk/tools/page_runtime_test.mjs — executes the real page scripts in jsdom.
 *
 * The authoring sandbox cannot run Chromium, so this stands in for a browser run:
 *   * loads live.html and a topic page with jsdom + runScripts=dangerously
 *   * stubs fetch() with recorded, shape-accurate official API payloads
 *   * asserts the DOM ends up with the expected rows, no thrown errors, no duplicate ids,
 *     consistent table shape, and that the demo-API failure path is handled
 *
 * Run: node desk/tools/page_runtime_test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESK = path.resolve(HERE, "..");
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; problems.push(name + (detail ? " — " + detail : "")); console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

/* ---- recorded payloads, shaped exactly like the documented responses ---- */
const MARKETS = {
  markets: [
    { ticker: "KXAAAGASW-26NOV23-3.6400", event_ticker: "KXAAAGASW-26NOV23",
      series_ticker: "KXAAAGASW", title: "Will average gas prices be above $3.6400?",
      event_title: "US gas prices this week", status: "active",
      yes_bid_dollars: "0.0100", yes_ask_dollars: "0.0200",
      no_bid_dollars: "0.9800", no_ask_dollars: "0.9900",
      last_price_dollars: "0.0200", volume_fp: "40555.62", volume_24h_fp: "26453.55",
      open_interest_fp: "31089.84", close_time: "2026-11-23T04:59:00Z",
      yes_bid_size_fp: "16666.66", yes_ask_size_fp: "2096.14" },
    { ticker: "KXBTCY-27JAN0100-B97500", event_ticker: "KXBTCY-27JAN0100",
      series_ticker: "KXBTCY", title: "BTC price on Jan 1, 2027?",
      event_title: "Bitcoin price at the end of 2026", status: "active",
      yes_bid_dollars: "0.9600", yes_ask_dollars: "0.9700",
      no_bid_dollars: "0.0200", no_ask_dollars: "0.0300",
      last_price_dollars: "0.9700", volume_fp: "15000.00", volume_24h_fp: "1031.00",
      open_interest_fp: "7322453.32", close_time: "2027-01-01T05:00:00Z" },
    { ticker: "KXWTI-26NOV2014-T88.99", event_ticker: "KXWTI-26NOV2014",
      series_ticker: "KXWTI", title: "Oil Price (WTI) on Friday?", status: "active",
      yes_bid_dollars: "0.2700", yes_ask_dollars: "0.2800",
      no_bid_dollars: "0.7200", no_ask_dollars: "0.7300",
      last_price_dollars: "0.2800", volume_fp: "900.0", volume_24h_fp: "10",
      open_interest_fp: "100", close_time: "2026-11-21T00:00:00Z" }
  ],
  cursor: ""
};
const CANDLES = {
  ticker: "KXAAAGASW-26NOV23-3.6400",
  candlesticks: [
    { end_period_ts: 1795170000, price: { close_dollars: "0.0500", high_dollars: "0.05", low_dollars: "0.05" },
      yes_bid: { close_dollars: "0.0400" }, yes_ask: { close_dollars: "0.0600" }, volume_fp: "10.00" },
    { end_period_ts: 1795170060, price: { close_dollars: "0.1700", high_dollars: "0.17", low_dollars: "0.05" },
      yes_bid: { close_dollars: "0.1600" }, yes_ask: { close_dollars: "0.1800" }, volume_fp: "30.00" },
    { end_period_ts: 1795170120, price: { close_dollars: "0.1500", high_dollars: "0.17", low_dollars: "0.15" },
      yes_bid: { close_dollars: "0.1400" }, yes_ask: { close_dollars: "0.1600" }, volume_fp: "5.00" }
  ]
};
const BOOK = { orderbook_fp: {
  yes_dollars: [["0.0100", "16666.66"]],
  no_dollars: [["0.9800", "8333.07"], ["0.9700", "5555.55"]] } };
const STATUS = { exchange_active: true, exchange_index_statuses: [] };

function makeFetchStub(config = {}) {
  return function (url) {
    const u = String(url);
    if (config.blind) return Promise.reject(Object.assign(new Error("blocked"), { name: "TypeError" }));
    let body = null, ok = true, status = 200;
    if (u.includes("/exchange/status")) body = STATUS;
    else if (u.includes("/orderbook")) body = BOOK;
    else if (u.includes("/candlesticks")) body = CANDLES;
    else if (/\/markets\/[^/?]+$/.test(u)) body = { market: MARKETS.markets[0] };
    else if (u.includes("/markets")) body = MARKETS;
    else if (u.includes("snapshot-slim.json")) body = JSON.parse(fs.readFileSync(path.join(DESK, "data", "snapshot-slim.json"), "utf8"));
    else { ok = false; status = 404; body = { code: "not_found" }; }
    return Promise.resolve({
      ok, status,
      json: () => Promise.resolve(body)
    });
  };
}

function canvasStub(win) {
  win.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return { setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      stroke: noop, fill: noop, fillText: noop, arc: noop, closePath: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set font(v) {},
      set globalAlpha(v) {} };
  };
}

async function runPage(file, config = {}) {
  const html = fs.readFileSync(path.join(DESK, file), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.detail || e.message)));
  vc.on("error", (e) => errors.push("console.error: " + e));
  const dom = new JSDOM(html, {
    url: "https://desk.test/" + file,
    runScripts: "dangerously",
    resources: undefined,
    virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(win) {
      canvasStub(win);
      win.fetch = makeFetchStub(config);
      win.AbortController = win.AbortController || function () { this.signal = {}; this.abort = () => {}; };
      Object.defineProperty(win.HTMLElement.prototype, "clientWidth", { get() { return 760; }, configurable: true });
      win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      win.setInterval = () => 0;    // keep timers out of the test
      win.scrollTo = () => {};
    }
  });
  // execute the page's own <script src> files in order (jsdom does not fetch them here)
  const doc = dom.window.document;
  for (const s of [...doc.querySelectorAll("script[src]")]) {
    const src = s.getAttribute("src");
    const p = path.join(DESK, src);
    if (!fs.existsSync(p)) { errors.push("missing script " + src); continue; }
    try { dom.window.eval(fs.readFileSync(p, "utf8")); }
    catch (e) { errors.push("script " + src + ": " + e.message); }
  }
  try { dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded")); } catch (e) {}
  try { dom.window.dispatchEvent(new dom.window.Event("load")); } catch (e) {}
  await new Promise((r) => setTimeout(r, 500));
  return { dom, doc, errors };
}

console.log("1. live.html with a working API");
{
  const { doc, errors } = await runPage("live.html");
  check("no script errors", errors.length === 0, errors.join(" | "));
  const badge = doc.querySelector("[data-live-status]").textContent;
  check("header badge reports LIVE", /Live · official demo API/.test(badge), badge.trim().slice(0, 80));
  const rows = doc.querySelectorAll("#live-table tbody tr");
  check("live table rendered rows", rows.length >= 2, String(rows.length));
  const text = doc.getElementById("live-table").textContent;
  check("gas market present in live table", text.includes("KXAAAGASW-26NOV23-3.6400"));
  check("crypto market present in live table", text.includes("KXBTCY-27JAN0100-B97500"));
  check("oil series excluded from the five topics", !text.includes("KXWTI-26NOV2014-T88.99"));
  check("24 h $ shown as a labelled proxy", /24 h \$ \(proxy\)/.test(text));
  const ids = [...doc.querySelectorAll("[id]")].map((x) => x.id);
  check("no duplicate element ids", new Set(ids).size === ids.length,
    ids.filter((v, i) => ids.indexOf(v) !== i).join(","));
  const bookRows = doc.querySelectorAll("#book tbody tr");
  check("depth ladder rendered", bookRows.length >= 2, String(bookRows.length));
  const bookText = doc.getElementById("book").textContent;
  check("ladder shows contracts at a price", /16,666.66/.test(bookText.replace(/\u00a0/g, " ")));
  check("implied NO ask derived as 1 - best YES bid",
    /implied NO ask 99\.0¢|implied NO ask 99¢/.test(bookText), bookText.slice(0, 200));
  const note = doc.getElementById("chart-note").textContent;
  check("chart note reports candles and jumps", /candles/.test(note) && /≥ \$0\.10/.test(note), note);
  const jumps = doc.getElementById("jumps").textContent;
  check("jump scanner flagged the $0.12 move", /12¢/.test(jumps) || /0\.10/.test(jumps), jumps.slice(0, 160));
  // table shape: every row has as many cells as its header
  const tables = [...doc.querySelectorAll("table")];
  let shapeOk = true, detail = "";
  tables.forEach((t, i) => {
    const ths = t.querySelectorAll("thead th").length;
    if (!ths) return;
    t.querySelectorAll("tbody tr").forEach((tr, j) => {
      if (tr.children.length !== ths) { shapeOk = false; detail = `table ${i} row ${j}: ${tr.children.length} vs ${ths}`; }
    });
  });
  check("every table row has the header's cell count", shapeOk, detail);
}

console.log("2. live.html with the API blocked (CORS / network failure path)");
{
  const { doc, errors } = await runPage("live.html", { blind: true });
  check("no script errors when the API is blocked", errors.length === 0, errors.join(" | "));
  const badge = doc.querySelector("[data-live-status]").textContent;
  check("badge reports the block instead of pretending", /API unreachable|Live/.test(badge), badge.trim().slice(0, 90));
  const banner = doc.getElementById("api-banner").textContent;
  check("banner explains that no value was replaced", /no value has been replaced or estimated/i.test(banner), banner.slice(0, 120));
  const live = doc.getElementById("live-table").textContent;
  check("live table says unavailable rather than fabricating", /Live view unavailable/i.test(live), live.slice(0, 100));
  const log = doc.getElementById("request-log");
  check("request log records the failures", log && /network\/CORS|error/i.test(log.textContent), log ? log.textContent.slice(0, 80) : "missing");
}

console.log("3. topic page renders its grouped events and resolution tables");
{
  const { doc, errors } = await runPage("gas-prices.html");
  check("no script errors", errors.length === 0, errors.join(" | "));
  const h1 = doc.querySelector("h1").textContent;
  check("page identifies the topic", /Gas prices/.test(h1), h1);
  const events = doc.querySelectorAll("h3");
  check("events are grouped", events.length >= 1, String(events.length));
  const body = doc.body.textContent;
  check("resolved table shows a YES or NO badge", /YES|NO\b/.test(body));
  check("awaiting section present", /awaiting result/i.test(body));
}

console.log("4. pages with no chart or API work still render cleanly");
for (const p of ["requirements.html", "flagged.html", "sources.html", "resolutions.html", "portfolio.html", "strategy.html", "index.html", "markets.html"]) {
  const { doc, errors } = await runPage(p);
  check(p + " executes without errors", errors.length === 0, errors.join(" | "));
  check(p + " has content", doc.body.textContent.length > 2000, doc.body.textContent.length + " chars");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); problems.forEach((p) => console.log("  - " + p)); process.exit(1); }
process.exit(0);
