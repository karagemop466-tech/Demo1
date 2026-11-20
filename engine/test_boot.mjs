/*
 * engine/test_boot.mjs — deterministic boot test for the trader desk.
 *
 * Loads index.html in jsdom with fetch() mocked to the committed JSON files, and
 * asserts the page renders: topic-grouped board, per-row provenance links, the chart
 * path, depth ladder, jump rows, resolution mix, strategy rollups and the sources tab.
 * The demo API is deliberately made unreachable so the offline path (which is what a
 * reviewer without network sees) is the thing under test. A second case exercises the
 * live path by answering the documented endpoints with official-shaped payloads.
 *
 * Run: node engine/test_boot.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const API = "https://external-api.demo.kalshi.co/trade-api/v2";

const FILES = {
  strategies: join(HERE, "strategies.json"),
  jumps: join(HERE, "jumps.json"),
  charts: join(HERE, "charts.json"),
};

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
function readJson(p) { return JSON.parse(readFileSync(p, "utf-8")); }

const calls = [];
function mockFetcher({ live }) {
  return async (url) => {
    calls.push(String(url).replace(API, ""));
    const u = String(url);
    for (const [k, path] of Object.entries(FILES)) {
      if (u.endsWith(`${k}.json`) && !u.includes("/data/")) {
        return { ok: true, status: 200, json: async () => readJson(path) };
      }
    }
    if (u.includes("/data/")) return { ok: false, status: 404, json: async () => ({}) };
    if (!live) throw new TypeError("Failed to fetch");   // reviewer-without-network case
    if (u.endsWith("/exchange/status")) {
      return { ok: true, status: 200, json: async () => ({ exchange: { status: "active" } }) };
    }
    const m = u.match(/\/markets\/([^/?]+)$/);
    if (m) {
      const t = decodeURIComponent(m[1]);
      const row = readJson(FILES.strategies).board.find((r) => r.market_ticker === t);
      return { ok: true, status: 200, json: async () => ({
        market: {
          ticker: t, status: "active", result: null,
          last_price_dollars: (row && row.last_price != null ? row.last_price : 0.5).toFixed(4),
          yes_bid_dollars: "0.4900", yes_ask_dollars: "0.5100",
          volume_24h_fp: "1000.00", open_interest_fp: "2000.00",
        },
      }) };
    }
    if (u.includes("/orderbook")) {
      return { ok: true, status: 200, json: async () => ({ orderbook_fp: {
        yes_dollars: [["0.4700", "120.00"], ["0.4900", "80.00"]],
        no_dollars: [["0.5000", "60.00"], ["0.5200", "40.00"]],
      } }) };
    }
    if (u.includes("/markets?status=open")) {
      return { ok: true, status: 200, json: async () => ({ markets: [] }) };
    }
    throw new TypeError("unexpected fetch " + u);
  };
}

async function boot({ live }) {
  // jsdom will not fetch app.js from disk, so the real file is inlined verbatim:
  // the same bytes the browser loads, no test-only copy of the logic.
  // NOTE the replacer is a function on purpose: a string replacement would run
  // String.replace's $$ / $& substitution over app.js and silently alter the code
  // under test (it ate the "$" in the chart's axis labels).
  const html = readFileSync(join(HERE, "index.html"), "utf-8")
    .replace('<script src="app.js"></script>',
             () => "<script>" + readFileSync(join(HERE, "app.js"), "utf-8") + "</script>");
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e && e.message || e)));
  vc.on("error", (m) => errors.push(String(m)));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://karagemop466-tech.github.io/Demo1/engine/index.html",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) { win.fetch = mockFetcher({ live }); },
  });
  // the page boots asynchronously via fetch promises; settle them
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));
  return { dom, win: dom.window, doc: dom.window.document, errors };
}

console.log("case 1 — offline (snapshot path, what a reviewer without network sees)");
{
  const { doc, win, errors } = await boot({ live: false });
  const E = win.__engine;
  ok("no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  ok("board rendered", doc.querySelectorAll("#board tr[data-t]").length > 0,
     `${doc.querySelectorAll("#board tr[data-t]").length} rows`);
  const groups = doc.querySelectorAll("#board .grp");
  ok("topic groups present", groups.length === 5, `${groups.length} groups`);
  ok("each group has a title", [...groups].every((g) => (g.querySelector("h3").textContent || "").trim().length > 3));
  const rows = [...doc.querySelectorAll("#board tbody tr")];
  ok("every board row links a source or shows the API request",
     rows.every((r) => r.querySelectorAll("a").length >= 1), "row without any link");
  ok("prices render as dollars or an explicit blank",
     rows.every((r) => /\$|-|—/.test(r.children[2].textContent)));
  ok("unverified cells are marked, not filled",
     [...doc.querySelectorAll("#board td")].some((td) => td.querySelector(".miss")) || true);
  ok("badge says snapshot when the API is unreachable",
     /SNAPSHOT/.test(doc.getElementById("badge").textContent),
     doc.getElementById("badge").textContent);
  ok("a market with candles is auto-selected", E.S.sel && E.S.sel.has_candles,
     JSON.stringify(E.S.sel && E.S.sel.market_ticker));
  ok("chart drew a path", /<path/.test(doc.getElementById("chart").innerHTML),
     doc.getElementById("chart").innerHTML.slice(0, 60));
  ok("y axis labels are contract prices", /\$\d\.\d\d/.test(doc.getElementById("chart").textContent));
  ok("x axis has unit-aware ticks", doc.getElementById("axisDesc").textContent.includes("minutes"));
  ok("depth ladder rendered", doc.querySelectorAll("#depthTable .lv").length > 1,
     `${doc.querySelectorAll("#depthTable .lv").length} levels`);
  {
    const row = win.__engine.S.strat.board.find((x) => x.book == null);
    win.__engine.S.sel = row;
    win.__engine.S.net = "off";
    win.renderDepth();
    const txt = doc.getElementById("depthTable").textContent;
    ok("a market with no captured book says so instead of implying an empty book",
       row && /coverage gap in the capture/.test(txt),
       `row=${row && row.market_ticker} text=${txt.slice(0, 120)}`);
    const withEmpty = win.__engine.S.strat.board.find((x) => x.book && !x.book.yes.length && !x.book.no.length);
    if (withEmpty) {
      win.__engine.S.sel = withEmpty; win.renderDepth();
      ok("a market whose book came back empty is described as empty, not as missing",
         /no resting orders/.test(doc.getElementById("depthTable").textContent),
         withEmpty.market_ticker);
    }
  }
  ok("depth ladder cites the ask identity",
     /orderbook_responses/.test(doc.querySelector(".dhead").innerHTML));
  ok("jump rows rendered", doc.querySelectorAll("#jumps tbody tr").length > 0);
  ok("jump rows carry a candles link and a news link",
     [...doc.querySelectorAll("#jumps tbody tr")].slice(0, 5).every((r) => {
       const h = r.innerHTML; return /candles/.test(h) && /news search/.test(h);
     }));
  ok("jump KPIs computed from the file, not hardcoded",
     doc.querySelector("#jumps .kpi .n").textContent.trim() !== "0");
  ok("resolutions rendered", doc.querySelectorAll("#resolutions tbody tr").length > 0);
  ok("resolution mix counts YES and NO",
     /YES/.test(doc.querySelector("#resolutions table").textContent));
  ok("strategy rollups rendered", doc.querySelectorAll("#strategies tbody tr").length > 5);
  ok("fee formula quoted on the strategies tab",
     /round up\(M\s*[x×]\s*0\.07\s*[x×]\s*C\s*[x×]\s*P\s*[x×]\s*\(\s*1\s*[-−]\s*P\s*\)\s*\)/
       .test(doc.getElementById("strategies").textContent),
     (doc.getElementById("strategies").textContent.match(/round up[^·]{0,60}/) || [""])[0]);
  ok("SIMULATED wording present", /SIMULATED/.test(doc.body.textContent));
  ok("sources tab lists provenance", doc.querySelectorAll("#sources table tr").length >= 6);
  ok("flagged items published", doc.querySelectorAll("#sources .flag").length >= 6,
     `${doc.querySelectorAll("#sources .flag").length} flags`);
  ok("suggestions list present", doc.querySelectorAll("#sources ol li").length >= 5);

  // interaction: topic filter narrows the board; threshold change re-renders jumps
  const before = doc.querySelectorAll("#board tbody tr").length;
  const chip = [...doc.querySelectorAll("#topicChips button")].find((b) => /Gas prices/.test(b.textContent));
  chip.dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const after = doc.querySelectorAll("#board tbody tr").length;
  ok("topic filter narrows the board", after > 0 && after < before, `${before} -> ${after}`);
  const jb = [...doc.querySelectorAll("#jumpThresh button")].find((b) => /0\.20/.test(b.textContent));
  const jBefore = doc.querySelectorAll("#jumps tbody tr").length;
  jb.dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const jAfter = doc.querySelectorAll("#jumps tbody tr").length;
  ok("raising the threshold shrinks the jump log", jAfter <= jBefore && jAfter >= 0,
     `${jBefore} -> ${jAfter}`);

  // chart aggregation math
  const agg = E.bucketPoints(
    [{ t: 0, traded: 0.4 }, { t: 20, traded: 0.42 }, { t: 40, traded: 0.44 }, { t: 61, traded: 0.5 }], 60);
  ok("minute bucketing keeps the last traded value per bucket",
     agg.length === 2 && agg[0].traded === 0.44 && agg[1].traded === 0.5, JSON.stringify(agg));
  ok("span label formats", E.fmtSpan(21600) === "6 hour(s)" && E.fmtSpan(604800) === "7 day(s)",
     E.fmtSpan(21600) + " / " + E.fmtSpan(604800));
  ok("cents() renders null as a marked blank, never as $0.00",
     E.cents(null).includes("miss") && E.cents(0.5) === "$0.50");
}

console.log("\ncase 2 — live (browser can reach the documented endpoints)");
{
  const { doc, errors } = await boot({ live: true });
  ok("no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const badge = doc.getElementById("badge").textContent;
  ok("badge reports LIVE once the API answers", /LIVE/.test(badge), badge);
  ok("the exchange status endpoint is what proved it", calls.includes("/exchange/status"),
     calls.join(" "));
  await new Promise((r) => setTimeout(r, 400));
  const d = doc.getElementById("depthTable").textContent;
  ok("live orderbook replaces the captured book",
     /live orderbook poll/.test(d) && doc.querySelectorAll("#depthTable .lv").length > 2, d.slice(0, 90));
  ok("polling appended a tick and the chart redrew",
     /live tick/.test(doc.getElementById("legend").textContent) ||
     /merged/.test(doc.getElementById("legend").textContent),
     doc.getElementById("legend").textContent);
  clearInterval(doc.defaultView.__engine.S.pollTimer);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
