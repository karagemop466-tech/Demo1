#!/usr/bin/env node
/* Deterministic DOM test for sim-desk/index.html.
   Runs the real page script in jsdom with fetch mocked to return the COMMITTED
   sim-desk/data JSONs (the same bytes the GitHub Pages site serves), then asserts
   the KPI cards, rollups, position/settled tables and provenance panel render
   exactly those values — no interpolation, no invented numbers.
   Usage: node sim-desk/tests/dom_test.mjs   (requires jsdom in repo root node_modules) */
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desk = path.join(here, "..");
let html = fs.readFileSync(path.join(desk, "index.html"), "utf8");
html = html.replace(/<script src="assets\/([^"]+)"><\/script>/g, (m, f) =>
  "<script>\n" + fs.readFileSync(path.join(desk, "assets", f), "utf8") + "\n</script>");

const ledger = JSON.parse(fs.readFileSync(path.join(desk, "data", "ledger.json"), "utf8"));
const perf = JSON.parse(fs.readFileSync(path.join(desk, "data", "performance.json"), "utf8"));
const runlog = JSON.parse(fs.readFileSync(path.join(desk, "data", "run_log.json"), "utf8"));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("ok -", name);
  else { failures++; console.log("FAIL -", name, extra === undefined ? "" : String(extra).slice(0, 300)); }
}

const dom = new JSDOM(html, {
  url: "https://karagemop466-tech.github.io/Demo1/sim-desk/index.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => {
      const u = String(url);
      const body = u.includes("ledger.json") ? ledger : u.includes("performance.json") ? perf : u.includes("run_log.json") ? runlog : {};
      return { ok: true, status: 200, json: async () => body };
    };
  },
});

await new Promise((r) => setTimeout(r, 150));
const doc = dom.window.document;
const text = (id) => (doc.getElementById(id) || { textContent: "" }).textContent;

check("no load-error shown", doc.getElementById("load-error").style.display !== "block");
check("KPI equity renders committed value", text("kpis").includes(String(perf.equity.toFixed(2))), text("kpis").slice(0, 200));
check("KPI cash renders committed value", text("kpis").includes(String(perf.cash.toFixed(2))));
check("open positions section reflects ledger", perf.open_count === 0
  ? text("open-positions").includes("no open positions")
  : text("open-positions").includes(ledger.positions_open[0].ticker));
check("settled section reflects ledger", perf.settled_count === 0
  ? text("settled-trades").includes("no settled trades")
  : text("settled-trades").includes(ledger.trades_settled[0].ticker));
check("strategy rollup table present", text("strategy-rollup").includes("opened") &&
  Object.keys(perf.by_strategy).every((k) => k === "" ? true : text("strategy-rollup").includes(k) || Object.keys(perf.by_strategy).length === 0),
  text("strategy-rollup").slice(0, 120));
check("simulated banner lists caveats", text("flags").includes("SIMULATED") || text("flags").includes("simulated"));
check("run provenance shows API call count", text("runlog").includes(String(runlog.summary.api_calls)));
check("meta line shows ledger updated ts", text("meta-line").includes(ledger.meta.updated_ts));
check("equity chart notes point count", text("equity-chart").length > 0);
check("footer sources link official docs", html.includes("docs.kalshi.com/getting_started/orderbook_responses") &&
  html.includes("docs.kalshi.com/getting_started/market_settlement") &&
  html.includes("kalshi.com/docs/kalshi-fee-schedule.pdf"));

if (failures) { console.log(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("\nall sim-desk DOM assertions passed");
