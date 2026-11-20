#!/usr/bin/env node
/* Deterministic DOM test for exec-desk/dashboard.html.
   Runs the real page scripts in jsdom with fetch mocked to return official-schema
   payloads (fields per docs.kalshi.com Get Markets / Get Events / Get Series / Orderbook).
   Asserts: table renders ranked rows, banner LIVE, depth KPIs populated, no stuck spinner.
   Usage: node exec-desk/scripts/dom_test.mjs   (requires jsdom in the repo root node_modules) */
import { JSDOM } from "jsdom";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, "..", "dashboard.html");

/* jsdom's default file:// origin blocks localStorage (opaque origin), which the
   settings layer touches before every request. Serve the page under an https
   origin instead, with its scripts inlined so no network fetch is needed. */
import fs from "node:fs";
let html = fs.readFileSync(page, "utf8");
html = html.replace(/<script src="js\/([^"]+)"><\/script>/g, (m, f) =>
  "<script>\n" + fs.readFileSync(path.join(here, "..", "js", f), "utf8") + "\n</script>");

const MARKET = {
  ticker: "KXAAAGASM-26NOV30-T370", event_ticker: "EV-GAS-1", market_type: "binary",
  yes_sub_title: "Above 3.70", no_sub_title: "Below 3.70",
  created_time: "2026-11-01T00:00:00Z", updated_time: "2026-11-20T10:00:00Z",
  open_time: "2026-11-01T00:00:00Z", close_time: "2026-11-30T16:00:00Z",
  latest_expiration_time: "2026-11-30T16:00:00Z", settlement_timer_seconds: 3600,
  status: "active", notional_value_dollars: "4600.00",
  yes_bid_dollars: "0.4500", yes_ask_dollars: "0.4600",
  no_bid_dollars: "0.5300", no_ask_dollars: "0.5500",
  yes_bid_size_fp: "120.00", yes_ask_size_fp: "90.00",
  last_price_dollars: "0.4600", previous_price_dollars: "0.4500",
  volume_fp: "5000.00", volume_24h_fp: "1200.00", open_interest_fp: "900.00",
  result: "", can_close_early: false, expiration_value: "0.00",
  rules_primary: "test", rules_secondary: "", price_level_structure: [], price_ranges: []
};
const EVENT = {
  event_ticker: "EV-GAS-1", series_ticker: "KXAAAGASM",
  sub_title: "US gas", title: "Will AAA gas average be above $3.70 on Nov 30?",
  collateral_return_type: "", mutually_exclusive: true, settlement_sources: [],
  markets: [MARKET]
};
const SERIES = {
  ticker: "KXAAAGASM", frequency: "daily", title: "US gas price up/down",
  category: "Energy", categories: ["Economics"], tags: ["gas", "gasoline"],
  settlement_sources: [], contract_url: "", contract_terms_url: "",
  fee_type: "quadratic", fee_multiplier: 1, additional_prohibitions: [],
  volume_fp: "12000.00"
};

function route(url) {
  const u = String(url);
  if (u.includes("/series?")) return { series: [SERIES], cursor: "" };
  if (u.includes("/events")) return { events: [EVENT], cursor: "" };
  if (u.includes("/orderbook")) return { orderbook_fp: {
    yes_dollars: [["0.4400", "100.00"], ["0.4500", "50.00"]],
    no_dollars: [["0.5300", "80.00"], ["0.5400", "30.00"]]
  } };
  if (u.includes("/markets/")) return { market: MARKET };
  if (u.includes("/markets")) return { markets: [MARKET], cursor: "" };
  if (u.includes("/exchange/status")) return { status: { is_open: true } };
  return {};
}

const dom = new JSDOM(html, {
  url: "https://karagemop466-tech.github.io/Demo1/exec-desk/dashboard.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => ({
      ok: true, status: 200,
      json: async () => route(url),
      text: async () => JSON.stringify(route(url))
    });
    window.AbortController = AbortController;
    window.alert = () => {};
    window.confirm = () => true;
    // jsdom has no canvas backend; return a no-op 2D context so chart drawing runs.
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (t, p) => (p === "canvas" ? {} : () => {}),
      set: () => true
    });
    window.addEventListener("error", (e) => { console.error("PAGE ERROR:", e.error || e.message); process.exitCode = 1; });
  }
});

await new Promise((r) => setTimeout(r, 1500));
const d = dom.window.document;
const rows = d.querySelectorAll("#top-table tbody tr[data-ticker]");
const tbodyText = d.getElementById("top-table").querySelector("tbody").textContent;
const banner = d.getElementById("conn-banner").textContent;
const bid = d.getElementById("k-bid").textContent;
const ask = d.getElementById("k-ask").textContent;
const spread = d.getElementById("k-spread").textContent;
const depth = d.getElementById("k-depth").textContent;
const sel = d.getElementById("sel-title").textContent;

let fail = 0;
function check(name, cond, actual) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "  → actual: " + actual));
  if (!cond) fail++;
}
check("table has ranked rows", rows.length >= 1, rows.length);
check("no stuck spinner", !/Loading/.test(tbodyText), tbodyText.slice(0, 80));
check("banner shows LIVE direct", /LIVE/.test(banner) && /directly/.test(banner), banner.slice(0, 120));
check("row ticker rendered", /KXAAAGASM/.test(tbodyText), tbodyText.slice(0, 120));
check("best YES bid = $0.45", bid === "$0.45", bid);
check("implied best YES ask = 1 - highest NO bid (0.54) = $0.46", ask === "$0.46", ask);
check("spread = ask - bid = $0.01", spread === "$0.01", spread);
check("depth within ±5¢ = 260 contracts", depth === "260", depth);
check("selected market title shown", /KXAAAGASM-26NOV30/.test(sel), sel);
check("topic title rendered", /Gas prices/.test(d.getElementById("topic-title").textContent), d.getElementById("topic-title").textContent);

console.log(fail ? "\n" + fail + " assertion(s) FAILED" : "\nALL ASSERTIONS PASSED");
process.exit(fail ? 1 : 0);
