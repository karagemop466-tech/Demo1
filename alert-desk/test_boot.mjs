/*
 * alert-desk/test_boot.mjs — deterministic boot test for the two-chat alert desk.
 *
 * Loads index.html in jsdom with fetch() mocked:
 *   - offline case: the demo API is unreachable, so the page must boot from the committed
 *     JSON files, render both chats, and mark itself SNAPSHOT.
 *   - live case: the documented endpoints are answered with official-shaped payloads and a
 *     trades tape containing a >= $0.10 move must produce a live bubble in Chat 1 (and in
 *     Chat 2 only when the model filter hits).
 *
 * Run: node alert-desk/test_boot.mjs   (needs jsdom: npm i --silent jsdom)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const API = "https://external-api.demo.kalshi.co/trade-api/v2";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
function readJson(p) { return JSON.parse(readFileSync(p, "utf-8")); }

const jumps = readJson(join(REPO, "engine/jumps.json"));
const strategies = readJson(join(REPO, "engine/strategies.json"));
const ledger = readJson(join(REPO, "sim-desk/data/ledger.json"));

function trade(id, ticker, price, secsAgo) {
  return {
    trade_id: id, ticker, count_fp: "5.00",
    yes_price_dollars: price.toFixed(4),
    no_price_dollars: (1 - price).toFixed(4),
    taker_outcome_side: "yes", created_time: new Date(Date.now() - secsAgo * 1000).toISOString(),
  };
}

function makeDom({ live, tape }) {
  const vc = new VirtualConsole(); // keep test output clean
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String((e && e.message) || e)));
  vc.on("error", (m) => errors.push(String(m)));
  // jsdom will not fetch app.js from disk, so the real file is inlined verbatim:
  // the same bytes the browser loads, no test-only copy of the logic. The replacer is a
  // function on purpose — a string replacement would run $$ / $& substitution over app.js.
  const html = readFileSync(join(HERE, "index.html"), "utf-8")
    .replace('<script src="app.js"></script>',
             () => "<script>" + readFileSync(join(HERE, "app.js"), "utf-8") + "</script>");
  const dom = new JSDOM(html, {
    url: "https://karagemop466-tech.github.io/Demo1/alert-desk/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/exchange/status")) {
          if (!live) throw new TypeError("Failed to fetch");
          return { ok: true, status: 200, json: async () => ({ exchange: { status: "active" } }) };
        }
        if (u.includes("/markets/trades")) {
          if (!live) throw new TypeError("Failed to fetch");
          return { ok: true, status: 200, json: async () => tape() };
        }
        const m = u.match(/\/markets\/([^/?]+)$/);
        if (m) {
          const t = decodeURIComponent(m[1]);
          return { ok: true, status: 200, json: async () => ({
            market: {
              ticker: t, status: "active", result: null,
              title: "Will the fixture market resolve yes? (test fixture)",
              event_ticker: "KXTESTLIVE",
            },
          }) };
        }
        if (u.endsWith("engine/jumps.json")) return { ok: true, status: 200, json: async () => jumps };
        if (u.endsWith("engine/strategies.json")) return { ok: true, status: 200, json: async () => strategies };
        if (u.endsWith("sim-desk/data/ledger.json")) return { ok: true, status: 200, json: async () => ledger };
        throw new TypeError("Failed to fetch " + u);
      };
    },
  });
  dom.__errors = errors;
  return dom;
}

async function bootIn(dom) {
  const { window } = dom;
  await window.__alertDesk.boot();
  await new Promise((r) => setTimeout(r, 40));
  // NOTE on timers: jsdom does not reliably fire timers the page scheduled from an async
  // continuation (the boot-scheduled 0 ms tape poll never runs here), while real browsers
  // do. The tests therefore drive probeLive/pollTape directly and clear the pending
  // interval so nothing fires mid-assertion. This is a jsdom artifact, not app logic.
  const A = window.__alertDesk;
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }
}

/* ------------------------------------------------------------ offline */
{
  console.log("case: offline snapshot boot");
  const dom = makeDom({ live: false });
  const { window } = dom;
  const A = window.__alertDesk;
  ok("test surface exposed", !!A && typeof A.modelHits === "function");
  await bootIn(dom);

  ok("badge = SNAPSHOT", window.document.getElementById("badge").textContent.includes("SNAPSHOT"),
    window.document.getElementById("badge").textContent);
  const allBubbles = window.document.querySelectorAll("#chatAll .bubble").length;
  const modelBubbles = window.document.querySelectorAll("#chatModel .bubble").length;
  ok("Chat 1 rendered historical bubbles", allBubbles > 0, String(allBubbles));
  ok("Chat 2 is a selective filter (fewer than Chat 1)", modelBubbles > 0 && modelBubbles < allBubbles,
    `${modelBubbles} vs ${allBubbles}`);

  // Newest-first ordering: last rendered (top) bubble is the newest jump.
  const first = window.document.querySelector("#chatAll .bubble");
  const last = Array.from(window.document.querySelectorAll("#chatAll .bubble")).pop();
  ok("newest bubble sits on top", !!first && !!last && first.querySelector(".b-time").textContent >= last.querySelector(".b-time").textContent);

  // A sim-desk ledger market must appear in Chat 2 with a P badge and a link.
  const pos = ledger.positions_open[0];
  const pBubble = Array.from(window.document.querySelectorAll("#chatModel .bubble"))
    .find((b) => b.dataset.ticker === pos.ticker);
  ok("ledger market appears in Chat 2", !!pBubble, pos.ticker);
  if (pBubble) {
    ok("P badge shown with strategy detail", /P · model holds a position/.test(pBubble.textContent)
      && new RegExp(pos.strategy).test(pBubble.textContent));
    ok("P badge links to sim-desk", pBubble.querySelector('a[href="../sim-desk/index.html"]') != null);
  }

  // Every historical bubble carries its API source link (the exact request URL).
  const withSrc = Array.from(window.document.querySelectorAll("#chatAll .bubble"))
    .filter((b) => Array.from(b.querySelectorAll("a")).some((a) => a.href.startsWith("https://external-api.demo.kalshi.co/")));
  ok("every rendered bubble has an API source link", withSrc.length === allBubbles, `${withSrc.length}/${allBubbles}`);

  // Fee math against the official formula (spot values, hand-computed).
  ok("fee(0.50) = 0.02", A.feeFor(0.5) === 0.02, String(A.feeFor(0.5)));
  ok("fee(0.14) = 0.01", A.feeFor(0.14) === 0.01, String(A.feeFor(0.14)));
  // Band edge: down-jump to 0.665 -> NO side at 0.335 -> band $0.30-$0.39 (yes-rate 16.67% ->
  // no-rate 83.33%), entry .335 + fee .02 = .355 cost, EV .8333 -> ROI ~ +1.35.
  const r = A.bandROI("no", 0.335);
  ok("bandROI(no, 0.335) positive ~1.35", r && r.roi > 1.3 && r.roi < 1.4, r ? String(r.roi) : "null");
  ok("modelHits flags B at 0.335 down", A.modelHits("NOSUCHTICKER", "down", 0.665).some((h) => h.rule === "B"));
  ok("modelHits does not flag zero-win band", !A.modelHits("NOSUCHTICKER", "up", 0.2414).some((h) => h.rule === "B"),
    JSON.stringify(A.modelHits("NOSUCHTICKER", "up", 0.2414)));

  // Ledger rule fires for a ledger market regardless of price band.
  ok("modelHits flags P for ledger market",
    A.modelHits(pos.ticker, "down", 0.665).some((h) => h.rule === "P"));

  // Topic classification follows the published rules.
  ok("topic: gas by ticker", A.classifyTopic("Will average gas prices be above $3.62?", "KXAAAGASW-26NOV23-3.6200").key === "gas_prices");
  ok("topic: crypto by title", A.classifyTopic("Bitcoin price range January?", "KXUNKNOWN-1").key === "crypto");
  ok("topic: none -> null (never guessed)", A.classifyTopic("Will it rain in Paris?", "KXPARIS-1") === null);

  // Filters: direction and basis.
  A.S.dir = "up";
  ok("direction filter hides down jumps", A.visible({ direction: "down", price_basis: "traded" }) === false);
  A.S.dir = "both";
  A.S.basis = "traded";
  ok("basis filter hides book rows", A.visible({ direction: "up", price_basis: "book-mid" }) === false);
  ok("basis filter keeps traded rows", A.visible({ direction: "up", price_basis: "traded" }) === true);
  A.S.basis = "all";
}

/* -------------------------------------------------------------- live */
{
  console.log("case: live tape");
  // Poll 1 seeds prices: two trades at the same price must not bubble.
  const tape1 = () => ({
    trades: [trade("t1", "KXTESTLIVE-A", 0.42, 3000), trade("t2", "KXTESTLIVE-A", 0.42, 2900)],
    cursor: "",
  });
  const dom = makeDom({ live: true, tape: tape1 });
  const { window } = dom;
  const A = window.__alertDesk;
  await bootIn(dom);

  ok("badge = LIVE", window.document.getElementById("badge").textContent.startsWith("LIVE"),
    window.document.getElementById("badge").textContent);
  await A.probeLive();   // re-probe: must schedule the tape poll timer
  ok("probe schedules the tape poll", A.S.timer != null);
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }
  ok("no bubbles before a swing",
    window.document.querySelectorAll("#chatAll .bubble.live").length === 0);

  // Poll 1 (driven directly — see the timer note in bootIn): seeds prices, no bubbles.
  await A.pollTape();
  ok("first tape poll seeds prices without bubbles",
    window.document.querySelectorAll("#chatAll .bubble.live").length === 0
    && A.S.tradesSeen === 2 && A.S.lastPrice.get("KXTESTLIVE-A") === 0.42,
    JSON.stringify({ seen: A.S.tradesSeen, price: A.S.lastPrice.get("KXTESTLIVE-A") }));
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }

  // Poll 2: a $0.26 up-move on KXTESTLIVE-A -> live bubble in Chat 1; also seeds the
  // ledger market's tape price (a first observation never emits — no previous price).
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/markets/trades")) {
      return { ok: true, status: 200, json: async () => ({
        trades: [trade("t8", ledger.positions_open[0].ticker, 0.07, 1),
                 trade("t9", "KXTESTLIVE-A", 0.68, 0)], cursor: "" }) };
    }
    if (/\/markets\/[^/]+$/.test(u)) return { ok: true, status: 200, json: async () => ({
      market: { ticker: decodeURIComponent(u.split("/markets/")[1].split("?")[0]), status: "active", result: null,
        title: "Will the fixture market resolve yes? (test fixture)", event_ticker: "KXTESTLIVE" } }) };
    return { ok: true, status: 200, json: async () => ({ exchange: { status: "active" } }) };
  };
  await A.pollTape();
  await new Promise((r) => setTimeout(r, 40));
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }

  const liveAll = window.document.querySelectorAll("#chatAll .bubble.live");
  ok("live bubble after >= $0.10 tape move", liveAll.length === 1, String(liveAll.length));
  if (liveAll.length) {
    const b = liveAll[0];
    ok("bubble shows fixture title fetched from /markets", b.textContent.includes("test fixture"));
    ok("bubble is an up-move 0.42 -> 0.68", b.textContent.includes("$0.42") && b.textContent.includes("$0.68"));
    ok("bubble links the tape request (min_ts)", Array.from(b.querySelectorAll("a")).some((a) => a.href.includes("min_ts=")));
    ok("bubble links a news search built from the title", Array.from(b.querySelectorAll("a")).some((a) => a.href.startsWith("https://news.google.com/")));
  }
  const liveModel = window.document.querySelectorAll("#chatModel .bubble.live");
  ok("no Chat 2 bubble for a market the model does not like", liveModel.length === 0, String(liveModel.length));

  // Now a swing on a ledger market must surface in BOTH chats via rule P.
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/markets/trades")) {
      return { ok: true, status: 200, json: async () => ({
        trades: [trade("t10", ledger.positions_open[0].ticker, 0.30, 0)], cursor: "" }) };
    }
    if (/\/markets\/[^/]+$/.test(u)) return { ok: true, status: 200, json: async () => ({
      market: { ticker: decodeURIComponent(u.split("/markets/")[1].split("?")[0]), status: "active", result: null,
        title: "Will average gas prices be above $3.6200?", event_ticker: "KXAAAGASW-26NOV23" } }) };
    return { ok: true, status: 200, json: async () => ({ exchange: { status: "active" } }) };
  };
  await A.pollTape();
  await new Promise((r) => setTimeout(r, 40));
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }

  const modelBubbles = Array.from(window.document.querySelectorAll("#chatModel .bubble.live"));
  ok("ledger-market swing reaches Chat 2 via rule P", modelBubbles.length === 1, String(modelBubbles.length));
  if (modelBubbles.length) {
    ok("Chat 2 bubble names the P rule", /P · model holds a position/.test(modelBubbles[0].textContent));
    ok("Chat 2 bubble links sim-desk evidence", modelBubbles[0].querySelector('a[href="../sim-desk/index.html"]') != null);
  }

  // Pause holds bubbles instead of rendering them.
  window.fetch = async (url) => {
    if (String(url).includes("/markets/trades")) {
      return { ok: true, status: 200, json: async () => ({
        trades: [trade("t11", "KXTESTLIVE-B", 0.10, 0), trade("t12", "KXTESTLIVE-B", 0.50, 0)], cursor: "" }) };
    }
    if (/\/markets\/[^/]+$/.test(url)) return { ok: true, status: 200, json: async () => ({
      market: { ticker: "KXTESTLIVE-B", status: "active", result: null, title: "fixture", event_ticker: "KXTESTLIVE" } }) };
    return { ok: true, status: 200, json: async () => ({ exchange: { status: "active" } }) };
  };
  const heldBefore = A.S.held;
  const liveAllBefore = window.document.querySelectorAll("#chatAll .bubble.live").length;
  A.S.paused = true;
  await A.pollTape();
  await new Promise((r) => setTimeout(r, 40));
  if (A.S.timer) { clearTimeout(A.S.timer); A.S.timer = null; }
  ok("pause holds new bubbles (counted, not rendered)", A.S.held > heldBefore
    && window.document.querySelectorAll("#chatAll .bubble.live").length === liveAllBefore,
    JSON.stringify({ held: A.S.held, before: liveAllBefore }));
  A.S.paused = false;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
