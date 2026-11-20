/**
 * Browser-boot test: every page is loaded in a DOM (jsdom) with the real
 * snapshot fetched from disk, and must render without a single script error.
 *
 * Why this exists: the sandbox has no browser and no network route to Kalshi,
 * so a page could parse, pass every pure-function test, and still throw on
 * load (a temporal-dead-zone bug and a dead ternary were both caught this way
 * in review). This test is the closest reproducible stand-in for "open the file
 * in Chrome and watch the console".
 *
 * jsdom is an optional dev dependency: `npm i --no-save jsdom`. Without it the
 * test skips rather than fails, so the pure suite stays runnable anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch {
  /* not installed -> every test below skips */
}

const SCRIPT_SRC = /<script[^>]*src=[^>]*><\/script>\s*/g;

function loadPage(file, query = "") {
  const html = readFileSync(path.join(ROOT, file), "utf8").replace(SCRIPT_SRC, "");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e && e.message)));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    url: "http://localhost/" + file + query,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // Serve repo files for the relative fetch() the app uses for its data,
      // and fail like a network outage for anything else (never hang).
      window.fetch = async (input) => {
        const rel = String(input).replace(/^\.\//, "").split("?")[0];
        const abs = path.join(ROOT, rel);
        if (/^https?:/.test(rel) || rel.startsWith("//")) {
          return new Response("", { status: 502, statusText: "offline in tests" });
        }
        if (existsSync(abs)) {
          return new Response(readFileSync(abs), {
            status: 200,
            headers: { "content-type": rel.endsWith(".json") ? "application/json" : "text/plain" },
          });
        }
        return new Response("not found", { status: 404 });
      };
      window.addEventListener("error", (e) => errors.push("window.onerror: " + (e.error ? e.error.stack : e.message)));
      window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason && e.reason.message)));
    },
  });
  // Execute the two real scripts exactly as the page tags would, in order.
  for (const src of ["assets/kalshi.js", "assets/app.js"]) {
    dom.window.eval(readFileSync(path.join(ROOT, src), "utf8"));
  }
  return { dom, errors };
}

const settle = (window) =>
  new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      if ((window.__kalshiDemo && window.__kalshiDemo.state && window.__kalshiDemo.state.snapshot) || tries++ > 60) resolve();
      else setTimeout(tick, 25);
    };
    tick();
  });

const pages = JSDOM ? readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort() : [];

test("jsdom is available or every test below skips", (t) => {
  if (!JSDOM) t.skip("jsdom not installed: npm i --no-save jsdom");
  assert.ok(JSDOM || true);
});

for (const file of pages) {
  test(`${file} boots without script errors and builds the shell`, async (t) => {
    if (!JSDOM) return t.skip("jsdom not installed");
    const { dom, errors } = loadPage(file);
    const { window } = dom;
    await settle(window);
    assert.deepEqual(errors, [], `${file}: script errors during load\n` + errors.join("\n"));

    const doc = window.document;
    assert.ok(doc.getElementById("site-header").children.length > 0, "header did not render");
    const nav = doc.getElementById("site-nav");
    assert.ok(nav.querySelectorAll("a").length >= 10, `nav rendered ${nav.querySelectorAll("a").length} links, expected the full IA`);
    assert.ok(doc.getElementById("site-footer").textContent.includes("demo"), "footer missing");

    const mountCount = doc.querySelectorAll("[data-mount]").length;
    if (mountCount) {
      const filled = [...doc.querySelectorAll("[data-mount]")].filter((n) => n.children.length > 0);
      assert.equal(filled.length, mountCount, `${file}: ${mountCount - filled.length} of ${mountCount} mounts rendered nothing`);
      const notice = doc.querySelector("[data-mount] .notice.stop");
      assert.ok(!notice, `${file}: a mount fell back to an error notice: ${notice && notice.textContent}`);
    }
    // the tables are the deliverable: any rendered table must have body rows
    for (const table of doc.querySelectorAll("table.data")) {
      assert.ok(table.tBodies[0] && table.tBodies[0].rows.length > 0, `${file}: table ${table.id || "(unlabelled)"} has no rows`);
    }
    dom.window.close();
  });
}

test("markets.html honours a ?market= deep link and draws the chart", async (t) => {
  if (!JSDOM) return t.skip("jsdom not installed");
  const snap = JSON.parse(readFileSync(path.join(ROOT, "data/snapshot.json"), "utf8"));
  const ticker = snap.candlesticks && snap.candlesticks.ticker;
  if (!ticker) return t.skip("snapshot has no candlestick block");
  const { dom, errors } = loadPage("markets.html", "?market=" + encodeURIComponent(ticker));
  await settle(dom.window);
  const doc = dom.window.document;
  assert.deepEqual(errors, [], "errors on the deep link:\n" + errors.join("\n"));
  assert.ok(doc.querySelector("#mount-explorer svg"), "no inline SVG chart rendered for " + ticker);
  const ladder = [...doc.querySelectorAll("#mount-explorer .ladder, #mount-explorer table.data")];
  assert.ok(ladder.length > 0, "neither the depth ladder nor its fallback rendered");
  dom.window.close();
});

test("nav covers every page on disk, and every nav target exists", (t) => {
  if (!JSDOM) return t.skip("jsdom not installed");
  const { dom, errors } = loadPage("index.html");
  return settle(dom.window).then(() => {
    assert.deepEqual(errors, [], "index.html script errors");
    const hrefs = [...dom.window.document.querySelectorAll("#site-nav a")].map((a) => a.getAttribute("href"));
    assert.ok(hrefs.length >= 10, "nav too short");
    for (const h of hrefs) assert.ok(existsSync(path.join(ROOT, h.split("#")[0])), `nav link ${h} is dead`);
    dom.window.close();
  });
});
