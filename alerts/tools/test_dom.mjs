#!/usr/bin/env node
/* Deterministic DOM test for alerts/index.html.
 *
 * Runs the real page script in jsdom with fetch mocked to return the COMMITTED
 * alerts/data/feed.json (the same bytes GitHub Pages serves), then asserts that
 * both chats render exactly the committed values — no interpolation, no
 * invented numbers — and that the model card, the coverage table and the
 * source links are present.
 *
 * Usage: node alerts/tools/test_dom.mjs   (requires jsdom in the repo root node_modules)
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const alerts = path.join(here, "..");
let html = fs.readFileSync(path.join(alerts, "index.html"), "utf8");
html = html.replace(/<script src="assets\/([^"]+)"><\/script>/g, (m, f) =>
  "<script>\n" + fs.readFileSync(path.join(alerts, "assets", f), "utf8") + "\n</script>");

const feed = JSON.parse(fs.readFileSync(path.join(alerts, "data", "feed.json"), "utf8"));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("ok -", name);
  else { failures++; console.log("FAIL -", name, extra === undefined ? "" : String(extra).slice(0, 400)); }
}

const dom = new JSDOM(html, {
  url: "https://karagemop466-tech.github.io/Demo1/alerts/index.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("feed.json")) {
        return { ok: true, status: 200, json: async () => feed };
      }
      // Any live API request in the test is a failure of the offline path:
      // it must never be needed to render the committed feed.
      throw new Error("unexpected network request in the DOM test: " + u);
    };
  },
});

await new Promise((r) => setTimeout(r, 250));
const doc = dom.window.document;
const text = (id) => (doc.getElementById(id) || { textContent: "" }).textContent;
const allStream = doc.getElementById("all-stream");
const modelStream = doc.getElementById("model-stream");

// --- left chat -----------------------------------------------------------
// The page opens on the 1-minute window, so the checks use the newest alert
// inside that window (the newest alert overall may come from a daily candle).
const firstAlert = feed.jumps.find((r) => r.window === "1m/6h");
check("left chat renders the newest committed alert",
  allStream.textContent.includes(firstAlert.title),
  firstAlert.title);
check("left chat shows the move size",
  allStream.textContent.includes(Number(firstAlert.delta).toFixed(4)),
  firstAlert.delta);
const srcLink = Array.from(allStream.querySelectorAll("a"))
  .find((a) => (a.getAttribute("href") || "").includes("/candlesticks?"));
check("left chat links to the official candlestick request",
  !!srcLink && srcLink.getAttribute("href").includes(firstAlert.market_ticker),
  srcLink ? srcLink.getAttribute("href") : "no link");
check("left chat links to the Kalshi market page",
  allStream.innerHTML.includes(firstAlert.market_page));
const oneMinuteAlerts = feed.jumps.filter((r) => r.window === "1m/6h").length;
check("left chat count matches the committed feed for the default 1-minute window",
  text("all-count").startsWith(String(oneMinuteAlerts)),
  text("all-count") + " expected " + oneMinuteAlerts);

// --- right chat ----------------------------------------------------------
check("right chat renders the shortlist",
  modelStream.textContent.trim().length > 0);
check("right chat shows the top-ranked market",
  modelStream.textContent.includes(feed.shortlist[0].title),
  feed.shortlist[0].title);
check("right chat shows the top score",
  modelStream.textContent.includes(String(feed.shortlist[0].score)),
  feed.shortlist[0].score);
check("right chat shows the count of shortlisted markets",
  text("model-count").startsWith(String(feed.shortlist.length) + " of " + String(feed.shortlist.length)),
  text("model-count"));
check("right chat explains the score components",
  modelStream.textContent.includes("QLM") && modelStream.textContent.includes("depth"));

// --- model card and coverage --------------------------------------------
const modelTable = doc.getElementById("model-table").textContent;
check("model card lists every component with its weight",
  Object.keys(feed.model.weights).every((k) => modelTable.includes(k)));
check("model card shows the weights sum",
  modelTable.includes(Object.values(feed.model.weights).reduce((a, b) => a + b, 0).toFixed(2)));
check("limits table is populated", doc.getElementById("limits-table").textContent.includes("probability"));
const coverage = doc.getElementById("coverage-table").textContent;
check("coverage table states the published alert count",
  coverage.includes(String(feed.coverage.alerts_published)));
check("coverage table states how many markets had no alert",
  coverage.includes(String(feed.coverage.markets_without_an_alert.length)));

// --- provenance ----------------------------------------------------------
const page = doc.documentElement.innerHTML;
check("page links to the official demo environment page",
  page.includes("https://docs.kalshi.com/getting_started/demo_env"));
check("page links to the verification record", page.includes("verification.html"));
check("page repeats the demo-venue warning",
  page.includes("may not be reflective of those in real markets"));
check("no unresolved placeholder in the rendered chats",
  !/undefined|NaN|\[object Object\]/.test(allStream.textContent + modelStream.textContent),
  (allStream.textContent + modelStream.textContent).slice(0, 200));

console.log(failures === 0 ? "\nPASS" : "\n" + failures + " failing");
process.exit(failures === 0 ? 0 : 1);
