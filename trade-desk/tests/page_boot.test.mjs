#!/usr/bin/env node
/* page_boot.test.mjs — boots every trade-desk page in jsdom with a mocked
 * network and asserts the page renders real rows without throwing.
 *
 * The mocks replay the SHAPE of official demo responses captured on 2026-11-20
 * (fields and string formats copied from the live payloads). This proves the
 * page code works; it is not a live availability test, and the pages say so.
 *
 * Usage: node trade-desk/tests/page_boot.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = path.resolve(import.meta.dirname, "../..");
const desk = path.join(root, "trade-desk");
const nowSec = Math.floor(Date.now() / 1000);
const iso = (s) => new Date((nowSec - s) * 1000).toISOString();

/* ---------------------------------------------------------------- fixtures */
const MARKETS = [
  {
    ticker: "KXPGAR2LEAD-THRC26-MGRE", event_ticker: "KXPGAR2LEAD-THRC26",
    title: "Max Greyserman leads at the end of Round 2", yes_sub_title: "Max Greyserman",
    status: "active", result: "", yes_bid_dollars: "0.0500", yes_ask_dollars: "0.0900",
    last_price_dollars: "0.0900", volume_24h_fp: "40.04", volume_fp: "45.77",
    open_interest_fp: "45.77", close_time: iso(-3600 * 6), price_level_structure: "linear_cent"
  },
  {
    ticker: "KXAAAGASW-26NOV23-3.6200", event_ticker: "KXAAAGASW-26NOV23",
    title: "US gas price above $3.62?", yes_sub_title: "Above $3.62",
    status: "active", result: "", yes_bid_dollars: "0.1400", yes_ask_dollars: "0.1600",
    last_price_dollars: "0.1500", volume_24h_fp: "1200.00", volume_fp: "3500.00",
    open_interest_fp: "900.00", close_time: iso(-3600 * 30)
  },
  {
    ticker: "KXBTCY-26DEC31-B100K", event_ticker: "KXBTCY-26DEC31",
    title: "Bitcoin above $100,000 at year end?", yes_sub_title: "Above $100k",
    status: "active", result: "", yes_bid_dollars: "0.4400", yes_ask_dollars: "0.4600",
    last_price_dollars: "0.4500", volume_24h_fp: "8000.00", volume_fp: "20000.00",
    open_interest_fp: "5000.00", close_time: iso(-3600 * 24 * 40)
  },
  {
    ticker: "KXRT-26-BESTPIC", event_ticker: "KXRT-26",
    title: "Rotten Tomatoes best picture 2026?", yes_sub_title: "Best picture",
    status: "active", result: "", yes_bid_dollars: "0.1900", yes_ask_dollars: "0.2100",
    last_price_dollars: "0.2000", volume_24h_fp: "500.00", volume_fp: "1200.00",
    open_interest_fp: "300.00", close_time: iso(-3600 * 24 * 90)
  },
  {
    ticker: "KXPRESNOMR-28-EKIR", event_ticker: "KXPRESNOMR-28",
    title: "Will Erika Kirk be the nominee for the Presidency for the Republican party?",
    yes_sub_title: "Erika Kirk", status: "active", result: "",
    yes_bid_dollars: "0.0020", yes_ask_dollars: "0.0030", last_price_dollars: "0.0030",
    volume_24h_fp: "56512.73", volume_fp: "80384199.04", open_interest_fp: "58983357.39",
    close_time: iso(-3600 * 24 * 700)
  }
];

const ORDERBOOK_ALT = { orderbook_fp: { yes_dollars: [["0.1500", "120.00"]], no_dollars: [["0.8300", "90.00"]] } };

const SETTLED = [
  {
    ticker: "KXAAAGASW-26NOV16-3.5000", event_ticker: "KXAAAGASW-26NOV16",
    title: "US gas price above $3.50?", yes_sub_title: "Above $3.50", status: "finalized",
    result: "yes", settlement_value_dollars: "1.0000", settlement_ts: iso(3600 * 20),
    last_price_dollars: "0.8800", close_time: iso(3600 * 30), yes_bid_dollars: "0.0000",
    yes_ask_dollars: "0.0000", volume_24h_fp: "0.00", volume_fp: "900.00", open_interest_fp: "0.00"
  },
  {
    ticker: "KXPGAWIN-THRC26-SSCH", event_ticker: "KXPGAWIN-THRC26",
    title: "Scottie Scheffler wins The RSM Classic", yes_sub_title: "Scheffler", status: "finalized",
    result: "no", settlement_value_dollars: "0.0000", settlement_ts: iso(3600 * 44),
    last_price_dollars: "0.0200", close_time: iso(3600 * 50), yes_bid_dollars: "0.0000",
    yes_ask_dollars: "0.0000", volume_24h_fp: "0.00", volume_fp: "120.00", open_interest_fp: "0.00"
  }
];

const TRADES = [
  /* a clear +12c jump in golf */
  { trade_id: "t1", ticker: "KXPGAR2LEAD-THRC26-MGRE", count_fp: "10.00", yes_price_dollars: "0.0500", no_price_dollars: "0.9500", created_time: iso(300), taker_outcome_side: "yes" },
  { trade_id: "t2", ticker: "KXPGAR2LEAD-THRC26-MGRE", count_fp: "12.00", yes_price_dollars: "0.1700", no_price_dollars: "0.8300", created_time: iso(120), taker_outcome_side: "yes" },
  /* a -11c drop in crypto */
  { trade_id: "t3", ticker: "KXBTCY-26DEC31-B100K", count_fp: "200.00", yes_price_dollars: "0.5600", no_price_dollars: "0.4400", created_time: iso(240), taker_outcome_side: "yes" },
  { trade_id: "t4", ticker: "KXBTCY-26DEC31-B100K", count_fp: "150.00", yes_price_dollars: "0.4500", no_price_dollars: "0.5500", created_time: iso(60), taker_outcome_side: "yes" },
  /* a +14c culture move, so all five topics appear in the feeds */
  { trade_id: "t7", ticker: "KXRT-26-BESTPIC", count_fp: "60.00", yes_price_dollars: "0.2000", no_price_dollars: "0.8000", created_time: iso(280), taker_outcome_side: "yes" },
  { trade_id: "t8", ticker: "KXRT-26-BESTPIC", count_fp: "45.00", yes_price_dollars: "0.3400", no_price_dollars: "0.6600", created_time: iso(90), taker_outcome_side: "yes" },
  /* a small move that must NOT alert */
  { trade_id: "t5", ticker: "KXPRESNOMR-28-EKIR", count_fp: "5.00", yes_price_dollars: "0.0030", no_price_dollars: "0.9970", created_time: iso(200), taker_outcome_side: "yes" },
  { trade_id: "t6", ticker: "KXPRESNOMR-28-EKIR", count_fp: "5.00", yes_price_dollars: "0.0080", no_price_dollars: "0.9920", created_time: iso(100), taker_outcome_side: "yes" }
];

const SERIES_MAP = {
  generated_utc: iso(600), source: "https://external-api.demo.kalshi.co/trade-api/v2/series",
  total: 4,
  map: {
    KXPGAR2LEAD: ["golf", "Sports", "PGA Round 2 Leader", "Golf"],
    KXAAAGASW: ["gas", "Economics", "US gas price up", "Oil and Gas"],
    KXBTCY: ["crypto", "Crypto", "BTC price range EOY", "Crypto"],
    KXPRESNOMR: ["elections", "Elections", "Presidential nominee", "US Elections"],
    KXPGAWIN: ["golf", "Sports", "PGA Tournament Winner", "Golf"],
    KXRT: ["culture", "Entertainment", "Best Picture", "Movies"]
  }
};

const EVENTS = {
  "KXPGAR2LEAD-THRC26": { event: { event_ticker: "KXPGAR2LEAD-THRC26", series_ticker: "KXPGAR2LEAD", title: "The RSM Classic End of Round 2 Leader", settlement_sources: [{ name: "the Governing League", url: "https://www.pgatour.com/" }] } },
  "KXAAAGASW-26NOV23": { event: { event_ticker: "KXAAAGASW-26NOV23", series_ticker: "KXAAAGASW", settlement_sources: [{ name: "AAA", url: "https://gasprices.aaa.com/" }] } },
  "KXBTCY-26DEC31": { event: { event_ticker: "KXBTCY-26DEC31", series_ticker: "KXBTCY", settlement_sources: [{ name: "CF Benchmarks", url: "https://www.cfbenchmarks.com/" }] } },
  "KXPRESNOMR-28": { event: { event_ticker: "KXPRESNOMR-28", series_ticker: "KXPRESNOMR", settlement_sources: [] } },
  "KXAAAGASW-26NOV16": { event: { event_ticker: "KXAAAGASW-26NOV16", series_ticker: "KXAAAGASW", settlement_sources: [{ name: "AAA", url: "https://gasprices.aaa.com/" }] } },
  "KXPGAWIN-THRC26": { event: { event_ticker: "KXPGAWIN-THRC26", series_ticker: "KXPGAWIN", settlement_sources: [{ name: "the Governing League", url: "https://www.pgatour.com/" }] } },
  "KXRT-26": { event: { event_ticker: "KXRT-26", series_ticker: "KXRT", settlement_sources: [{ name: "Rotten Tomatoes", url: "https://www.rottentomatoes.com/" }] } }
};

function book(ticker) {
  if (ticker === "KXPGAR2LEAD-THRC26-MGRE") {
    return { orderbook_fp: { yes_dollars: [["0.0300", "5555.55"], ["0.0400", "4166.66"], ["0.0500", "3333.33"]], no_dollars: [["0.8900", "1515.15"], ["0.9000", "1666.66"], ["0.9100", "1809.93"]] } };
  }
  return { orderbook_fp: { yes_dollars: [["0.4400", "400.00"]], no_dollars: [["0.5400", "500.00"]] } };
}

function resolveUrl(u) {
  const p = new URL(u).pathname.replace(/^\/trade-api\/v2/, "");
  if (p === "/exchange/status") {
    return { exchange_active: true, trading_active: true, exchange_index_statuses: [] };
  }
  if (p === "/markets") {
    const url = new URL(u);
    const tickers = url.searchParams.get("tickers");
    if (tickers) {
      const list = tickers.split(",");
      return { markets: MARKETS.concat(SETTLED).filter((m) => list.includes(m.ticker)), cursor: "" };
    }
    if (url.searchParams.get("status") === "settled") return { markets: SETTLED, cursor: "" };
    return { markets: MARKETS, cursor: "" };
  }
  if (p === "/markets/trades") {
    const url = new URL(u);
    const t = url.searchParams.get("ticker");
    return { trades: t ? TRADES.filter((x) => x.ticker === t) : TRADES, cursor: "" };
  }
  const bookMatch = /^\/markets\/([^/]+)\/orderbook$/.exec(p);
  if (bookMatch) return book(decodeURIComponent(bookMatch[1]));
  if (p === "/series/KXPGAR2LEAD/markets/KXPGAR2LEAD-THRC26-MGRE/candlesticks" || p.startsWith("/series/")) {
    return { ticker: "x", candlesticks: [] };
  }
  if (/^\/series\/[^/]+\/markets\/[^/]+\/candlesticks$/.test(p)) return { ticker: "x", candlesticks: [] };
  const evMatch = /^\/events\/([^/]+)$/.exec(p);
  if (evMatch) return EVENTS[decodeURIComponent(evMatch[1])] || { event: {} };
  return {};
}

/* ---------------------------------------------------------------- harness */
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e && e.message || e) });
    console.log(`  FAIL ${name}: ${e && e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
/* Wait until a page condition holds. Polling a rendered DOM is the honest way to
 * test an async controller: a fixed sleep either flakes or hides a real bug. */
async function waitFor(fn, label, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (fn()) return true; } catch (e) { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for " + label);
}

async function boot(file) {
  const html = fs.readFileSync(path.join(desk, file), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e && e.message)));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

  const dom = new JSDOM(html, {
    url: "https://karagemop466-tech.github.io/Demo1/trade-desk/" + file,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: undefined,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (input) => {
        const u = typeof input === "string" ? input : input.url;
        if (u.includes("data/series-map.json")) {
          return { ok: true, status: 200, json: async () => SERIES_MAP, text: async () => JSON.stringify(SERIES_MAP) };
        }
        const body = resolveUrl(u);
        return {
          ok: true, status: 200,
          headers: { get: () => "application/json" },
          json: async () => body,
          text: async () => JSON.stringify(body)
        };
      };
      window.alert = () => {};
      window.scrollTo = () => {};
    }
  });
  /* load the local scripts by hand: jsdom does not fetch file:// subresources */
  const win = dom.window;
  /* Load exactly the scripts the page declares, in order: that is what the
   * browser does, and it is how a page whose script was never wired up is
   * caught instead of silently skipped. */
  const declared = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
  if (!declared.length) throw new Error("page declares no scripts: " + file);
  declared.forEach((rel) => {
    const full = path.join(desk, rel);
    if (!fs.existsSync(full)) throw new Error(file + " references missing script " + rel);
    win.eval(fs.readFileSync(full, "utf8"));
  });
  /* fire DOMContentLoaded for pages that wait on it */
  win.document.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  return { dom, win, errors };
}

/* ------------------------------------------------------------------ tests */
console.log("trade-desk page boot tests (mocked official payload shapes)");
process.on("unhandledRejection", (e) => { console.log("UNHANDLED REJECTION in harness:", e && e.stack || e); });

const dashboard = await boot("index.html");
const { win } = dashboard;
const api = win.__tradeDesk;
await waitFor(() => api.state.alertsA.length >= 2 && api.state.markets.length >= 4, "the first poll to finish");
check("dashboard exposes its controller", () => assert(api && api.state, "no window.__tradeDesk"));
check("every fixture market classified into its official topic", () => {
  const seen = {};
  api.state.markets.forEach((m) => { seen[m.ticker] = m.topic; });
  const want = {
    "KXPGAR2LEAD-THRC26-MGRE": "golf", "KXAAAGASW-26NOV23-3.6200": "gas",
    "KXBTCY-26DEC31-B100K": "crypto", "KXPRESNOMR-28-EKIR": "elections",
    "KXRT-26-BESTPIC": "culture"
  };
  Object.keys(want).forEach((t) => assert(seen[t] === want[t], t + " got " + seen[t] + " want " + want[t]));
});
check("feed A received exactly the three >= $0.10 jumps, across three topics", () => {
  const alerts = api.state.alertsA;
  assert(alerts.length === 3, "expected 3 alerts, got " + alerts.length + " (" + alerts.map((a) => a.ticker).join(",") + ")");
  const topics = alerts.map((a) => a.topic).sort().join(",");
  assert(topics === "crypto,culture,golf", "topics in feed A: " + topics);
});
check("the +$0.05 election print did not alert", () => {
  assert(!api.state.alertsA.some((a) => a.ticker === "KXPRESNOMR-28-EKIR"), "small move produced an alert");
});
check("jump rows render into the DOM with evidence links", () => {
  const rows = win.document.querySelectorAll("#feed-a .msg");
  assert(rows.length >= 3, "only " + rows.length + " feed rows");
  const links = win.document.querySelectorAll("#feed-a .msg .links a");
  assert(links.length >= 4, "expected API+venue+news links per row, found " + links.length);
});
check("settlement source from the official event payload is linked", () => {
  const hrefs = Array.from(win.document.querySelectorAll("#feed-a .msg .links a")).map((a) => a.href);
  assert(hrefs.some((h) => h.includes("pgatour.com")), "no pgatour settlement link");
});
check("watch table rendered rows with API source links", () => {
  const rows = win.document.querySelectorAll("#watch-table tbody tr");
  assert(rows.length === 5, "expected 5 rows, got " + rows.length);
  assert(win.document.querySelector("#watch-table tbody a[href*='external-api.demo.kalshi.co']"), "no API link in watch table");
});
check("top table is ranked by estimated dollars", () => {
  const rows = Array.from(win.document.querySelectorAll("#top-table tbody tr"));
  assert(rows.length === 5, "expected 5 ranked rows, got " + rows.length);
  /* BTC fixture: 8,000 contracts x $0.45 = $3,600 is the largest estimated
   * dollar figure among the fixtures, so it must rank first. */
  assert(rows[0].textContent.includes("KXBTCY"), "highest-dollar market not first: " + rows[0].textContent.slice(0, 80));
});
check("chart rendered a line path for the selected market", () => {
  const paths = win.document.querySelectorAll("#live-chart path");
  assert(paths.length > 0, "chart has no paths");
  const note = win.document.querySelector("#chart-note").textContent;
  assert(/empty array|trades tape|candles/i.test(note), "chart note does not disclose the candle result");
});
/* click the golf row explicitly, then wait for that book to arrive (the page may
 * have auto-selected a bigger market first) */
Array.from(win.document.querySelectorAll("#watch-table a.pick"))
  .find((a) => a.getAttribute("data-ticker") === "KXPGAR2LEAD-THRC26-MGRE")
  .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
await waitFor(() => /3,333/.test(win.document.querySelector("#ladder").textContent), "the golf order book");
check("order book ladder followed the clicked market, not just the default", () => {
  const text = win.document.querySelector("#ladder").textContent;
  assert(/3,333/.test(text) || /3333/.test(text), "golf book sizes missing from ladder: " + text.slice(0, 160));
  assert(/spread/.test(text), "spread not shown");
  assert(/Max Greyserman/.test(win.document.querySelector("#book-title").textContent), "book panel does not name the selected market");
});
check("clicking a row in the watch table loads that market into the book", () => {
  const link = Array.from(win.document.querySelectorAll("#watch-table a.pick")).find((a) => a.getAttribute("data-ticker") === "KXBTCY-26DEC31-B100K");
  assert(link, "no pick link for the crypto fixture");
  link.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert(/Bitcoin above/.test(win.document.querySelector("#book-title").textContent), "book title did not change on click: " + win.document.querySelector("#book-title").textContent);
});
check("no jsdom errors while rendering", () => {
  assert(dashboard.errors.length === 0, dashboard.errors.join(" | "));
});

/* second page: resolutions */
const reso = await boot("resolutions.html");
await waitFor(() => reso.win.__resolutions && reso.win.__resolutions.state.settled.length >= 2, "the settled list");
check("resolutions page renders settled markets with YES/NO results", () => {
  const rows = reso.win.document.querySelectorAll("#resolution-table tbody tr");
  assert(rows.length === 2, "expected 2 settled rows, got " + rows.length);
  const text = reso.win.document.querySelector("#resolution-table tbody").textContent;
  assert(/YES/.test(text) && /NO/.test(text), "YES/NO results not rendered: " + text.slice(0, 200));
  assert(/gasprices\.aaa\.com|pgatour\.com/.test(reso.win.document.querySelector("#resolution-table tbody").innerHTML), "official settlement source not linked");
});
check("resolutions page boots with no jsdom errors", () => {
  assert(reso.errors.length === 0, reso.errors.join(" | "));
});

/* ---------------------------------------------------------- strategies page */
const strat = await boot("strategies.html");
const sw = strat.win;

/* seed an open paper position from a real fixture, then settle it through the page */
sw.eval(`
  (function(){
    var l = window.Engine.loadLedger();
    l.cash = 1000;
    window.Engine.openPosition(l, {ticker:"KXAAAGASW-26NOV16-3.5000", event_ticker:"KXAAAGASW-26NOV16",
      title:"US gas price above $3.50?", topic:"gas", strategy:"balanced", ask:0.20, contracts:10,
      max_roi:4, score:70, evidence:"https://external-api.demo.kalshi.co/trade-api/v2/markets/trades?ticker=KXAAAGASW-26NOV16-3.5000"},
      {now:new Date().toISOString()});
    window.Engine.saveLedger(l);
    window.__strategies.state.ledger = l;
    window.__strategies.render();
  })();
`);
await waitFor(() => /KXAAAGASW-26NOV16-3\.5000/.test(sw.document.querySelector("#open-table tbody").textContent), "the seeded open position");
check("strategies page lists an open paper position with its cost and fee", () => {
  const text = sw.document.querySelector("#open-table tbody").textContent;
  assert(/KXAAAGASW/.test(text), "open position missing");
  /* 10 contracts x $0.20 = $2.00 fill; official fee ceil(0.07*10*0.20*0.80) = $0.12; cost $2.12 */
  assert(/\$0\.12/.test(text), "expected the $0.12 official fee in the row: " + text.slice(0, 200));
  assert(/\$2\.12/.test(text), "expected total cost $2.12 in the row: " + text.slice(0, 200));
});
sw.document.querySelector("#settle-now").dispatchEvent(new sw.MouseEvent("click", { bubbles: true }));
await waitFor(() => sw.__strategies.state.ledger.trades.some((t) => t.kind === "settle"), "the settlement to land");
check("settlement used the API's own YES result and paid $1 per contract", () => {
  const t = sw.__strategies.state.ledger.trades.find((x) => x.kind === "settle");
  assert(t.result === "yes", "result not yes: " + t.result);
  assert(t.payout_per === 1, "payout per contract not $1: " + t.payout_per);
  /* 10 contracts at $0.20 = $2.00 + fee ceil(0.07*10*0.2*0.8)=ceil(0.112)=0.12 → cost 2.12; payout 10 → +7.88 */
  assert(Math.abs(t.pnl - 7.88) < 0.011, "P&L wrong: " + t.pnl);
});
check("settled table and analytics updated from the settled trade", () => {
  const text = sw.document.querySelector("#settled-table tbody").textContent;
  assert(/YES/.test(text), "settled table has no YES result");
  const kpi = sw.document.querySelector("#kpi-pnl").textContent;
  assert(/7\.88/.test(kpi), "realized P&L KPI wrong: " + kpi);
  const byTopic = sw.document.querySelector("#by-topic tbody").textContent;
  assert(/gas/i.test(byTopic), "topic breakdown missing the gas trade: " + byTopic);
});
check("strategies page boots with no jsdom errors", () => {
  assert(strat.errors.length === 0, strat.errors.join(" | "));
});

/* --------------------------------------------------------------- chart page */
const chartPage = await boot("chart.html");
await waitFor(() => chartPage.win.__chartPage && chartPage.win.__chartPage.state.current, "the chart page to load a market");
check("chart page renders a window selector with seconds, minutes and hours", () => {
  const btns = Array.from(chartPage.win.document.querySelectorAll("#windows button")).map((b) => b.getAttribute("data-window"));
  ["30s", "2m", "15m", "1h", "6h", "24h"].forEach((w) => assert(btns.includes(w), "missing window " + w));
});
check("chart page draws the price line and prices 10 contracts off the ladder", () => {
  assert(chartPage.win.document.querySelector("#chart path"), "no chart path");
  const walk = chartPage.win.document.querySelector("#walk-table tbody").textContent;
  assert(/Total to pay/.test(walk), "no total in the walk table: " + walk.slice(0, 160));
});
check("chart page states the official candle limitation", () => {
  const t = chartPage.win.document.querySelector("#resolution-note").textContent;
  assert(/1-minute/.test(t) && /trades/.test(t), "candle limitation not disclosed");
});
check("chart page boots with no jsdom errors", () => {
  assert(chartPage.errors.length === 0, chartPage.errors.join(" | "));
});

/* --------------------------------------------------------------- model page */
const modelPage = await boot("model.html");
await waitFor(() => /All 21 rows|differ/.test(modelPage.win.document.querySelector("#fee-table").textContent), "the fee table");
check("model page reproduces all 21 rows of the official fee table", () => {
  const t = modelPage.win.document.querySelector("#fee-table").textContent;
  assert(/All 21 rows of the official table reproduce exactly/.test(t), "fee table mismatch: " + t.slice(-200));
});
check("model page publishes the screen bar", () => {
  assert(/55/.test(modelPage.win.document.querySelector("#bar-score").textContent), "score bar not published");
  assert(/25%/.test(modelPage.win.document.querySelector("#bar-roi").textContent), "ROI bar not published");
});

dashboard.dom.window.close();
reso.dom.window.close();
strat.dom.window.close();
chartPage.dom.window.close();
modelPage.dom.window.close();

console.log("");
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + ": " + f.error));
  process.exit(1);
}
