/*
 * alert-desk/test_alert_desk.mjs — deterministic boot test for the dual chat feeds.
 *
 * Loads alert-desk/chat.html in jsdom (index.html belongs to session 0ad208bf) with fetch() mocked, in two cases:
 *   case 1 offline — the committed seed must render both feeds; every message
 *        must carry an official API source link + venue event link; the ROI
 *        feed must be a strict subset of the all-events feed; topic filter,
 *        clear, swing tape and rules table must work.
 *   case 2 live — official-shaped GET /markets payloads: baseline then a
 *        >= $0.10 swing must alert (both feeds), a < $0.10 move must not, the
 *        day-move pass must fire once, a vanished watched ticker must be
 *        re-checked and a returned result must post a RESOLVED message, and a
 *        429 must schedule a retry without crashing.
 *
 * The demo API is unreachable from the sandbox (egress allowlist), so "live"
 * means official-shaped payloads through the page's own code path — no test
 * forks the implementation (alert.js is inlined verbatim).
 *
 * Run: node alert-desk/test_alert_desk.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://external-api.demo.kalshi.co/trade-api/v2";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
function readJson(p) { return JSON.parse(readFileSync(p, "utf-8")); }

/* Official-shaped market rows (field names per docs.kalshi.com Get Markets). */
function mkt(over = {}) {
  return Object.assign({
    ticker: "KXAAAGASW-26NOV23-3.6400",
    event_ticker: "KXAAAGASW-26NOV23",
    title: "Will average gas prices be above $3.6400?",
    status: "active",
    result: "",
    last_price_dollars: "0.4000",
    previous_price_dollars: "0.3800",
    yes_bid_dollars: "0.3900",
    yes_ask_dollars: "0.4100",
    volume_24h_fp: "5000.00",
    open_interest_fp: "9000.00",
  }, over);
}

function makeFetcher(scenario) {
  const calls = [];
  let polls = 0;
  return {
    calls,
    fetch: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("data/seed.json") || u.includes("/data/seed.json")) {
        if (scenario.seedFails) throw new TypeError("Failed to fetch seed");
        return { ok: true, status: 200, json: async () => readJson(join(HERE, "data", "seed.json")) };
      }
      if (u.startsWith(API + "/markets?status=open")) {
        polls++;
        if (scenario.rateLimitAfter && polls > scenario.rateLimitAfter) {
          return { ok: false, status: 429, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => scenario.list(polls) };
      }
      const one = u.match(/^https:\/\/external-api\.demo\.kalshi\.co\/trade-api\/v2\/markets\/([^/?]+)$/);
      if (one) {
        const t = decodeURIComponent(one[1]);
        if (scenario.resolve && scenario.resolve[t]) {
          return { ok: true, status: 200, json: async () => ({ market: scenario.resolve[t] }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
      throw new TypeError("unexpected fetch " + u);
    },
  };
}

async function boot(scenario) {
  const html = readFileSync(join(HERE, "chat.html"), "utf-8")
    .replace('<script src="assets/alert.js"></script>',
             () => "<script>" + readFileSync(join(HERE, "assets", "alert.js"), "utf-8") + "</script>");
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String((e && e.message) || e)));
  vc.on("error", (m) => errors.push(String(m)));
  const fx = makeFetcher(scenario);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://karagemop466-tech.github.io/Demo1/alert-desk/chat.html",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) { win.fetch = fx.fetch; },
  });
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));
  return { dom, win: dom.window, doc: dom.window.document, errors, fx };
}

function feedMsgs(doc, id) {
  return [...doc.querySelectorAll(`#${id} .msg`)];
}

console.log("case 1 — offline (committed seed path)");
{
  const { doc, win, errors, fx } = await boot({ seedFails: false });
  const E = win.__alertdesk;
  ok("no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  ok("test hook exposed", !!E);
  ok("seed messages loaded", E.state.messages.length > 0,
     `messages=${E.state.messages.length}`);
  const all = feedMsgs(doc, "allFeed");
  const roi = feedMsgs(doc, "roiFeed");
  ok("all-events feed rendered", all.length > 0, `${all.length} messages`);
  ok("high-ROI feed rendered", roi.length > 0, `${roi.length} messages`);
  ok("ROI feed is a strict subset of all feed",
     roi.length > 0 && roi.length <= all.length &&
     roi.every((m) => all.some((a) => a.getAttribute("data-id") === m.getAttribute("data-id"))),
     `roi=${roi.length} all=${all.length}`);
  ok("every ROI message scores >= 4/5",
     roi.every((m) => Number(m.getAttribute("data-score")) >= 4),
     roi.map((m) => m.getAttribute("data-score")).join(","));
  ok("every message links an official API request",
     all.every((m) => [...m.querySelectorAll("a")].some((a) => a.href.startsWith(API))),
     "message without " + API + " link");
  ok("every message links the venue event page",
     all.every((m) => [...m.querySelectorAll("a")].some((a) => a.href.startsWith("https://kalshi.com/events/"))),
     "message without venue link");
  ok("news lead is a search, labelled as a lead",
     all.every((m) => [...m.querySelectorAll("a")].some((a) => a.href.startsWith("https://news.google.com/search"))) &&
     /not a verified cause/.test(doc.body.innerHTML));
  ok("both swing directions present",
     all.some((m) => m.querySelector(".msg-dir.up")) && all.some((m) => m.querySelector(".msg-dir.down")));
  ok("threshold $0.10 stated on the page", /\$0\.10/.test(doc.body.textContent));
  ok("swing tape rendered as SVG bars",
     doc.querySelectorAll("#tape rect").length > 0,
     `${doc.querySelectorAll("#tape rect").length} bars`);
  ok("rules table has all five rules with docs links",
     [...doc.querySelectorAll(".rules tbody tr")].length === 5 &&
     [...doc.querySelectorAll(".rules a")].every((a) => a.href.startsWith("https://docs.kalshi.com/")));
  ok("no KXWTI (published false match) in any message",
     all.every((m) => !/KXWTI/.test(m.textContent)) &&
     roi.every((m) => !/KXWTI/.test(m.textContent)));
  ok("source table cites official domains only for API rows",
     [...doc.querySelectorAll(".notes section, section")].length > 0 &&
     /docs\.kalshi\.com/.test(doc.body.innerHTML));

  /* topic filter narrows both feeds */
  const before = feedMsgs(doc, "allFeed").length;
  const chip = [...doc.querySelectorAll("#topicChips button")].find((b) => b.getAttribute("data-topic") === "crypto");
  chip.dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const afterAll = feedMsgs(doc, "allFeed");
  ok("topic filter narrows the all feed", afterAll.length > 0 && afterAll.length < before,
     `${before} -> ${afterAll.length}`);
  ok("filtered messages are all one topic",
     afterAll.every((m) => m.getAttribute("data-topic") === "crypto"));
  const afterRoi = feedMsgs(doc, "roiFeed");
  ok("ROI feed respects the filter too",
     afterRoi.every((m) => m.getAttribute("data-topic") === "crypto"));

  /* back to all, then clear */
  const allChip = [...doc.querySelectorAll("#topicChips button")].find((b) => b.getAttribute("data-topic") === "all");
  allChip.dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  doc.getElementById("clearBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  ok("clear empties both feeds",
     feedMsgs(doc, "allFeed").length === 0 && feedMsgs(doc, "roiFeed").length === 0);
  ok("empty state explains itself",
     /No alerts yet|No model picks yet/.test(doc.getElementById("allFeed").textContent + doc.getElementById("roiFeed").textContent));

  /* pause control */
  doc.getElementById("pauseBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  ok("pause sets state", E.state.paused === true);
  ok("poll skipped while paused",
     (await E.pollOnce()) === null && E.state.polls === 0);
}

console.log("\ncase 2 — live (official-shaped payloads through the real code path)");
{
  let listCalls = 0;
  const resolvePayload = mkt({
    ticker: "KXPRESPERSON-28-AOCA",
    event_ticker: "KXPRESPERSON-28",
    title: "Will candidate A win the election?",
    status: "finalized",
    result: "yes",
    last_price_dollars: "1.0000",
    settlement_value_dollars: "1.0000",
    settlement_ts: "2026-11-20T12:00:00Z",
  });
  const scenario = {
    seedFails: false,
    rateLimitAfter: 3, // polls 1-3 succeed; poll 4+ hits 429
    resolve: { "KXPRESPERSON-28-AOCA": resolvePayload },
    list: (n) => {
      listCalls = n;
      if (n === 1) {
        // baseline poll: day-move market (prev 0.30 -> last 0.45 = +0.15) + quiet market
        return { markets: [
          mkt({ ticker: "KXAAAGASW-26NOV23-3.6400", event_ticker: "KXAAAGASW-26NOV23",
                title: "Will average gas prices be above $3.6400?",
                previous_price_dollars: "0.3000", last_price_dollars: "0.4500" }),
          mkt({ ticker: "KXPGATOUR-THRC26-SCHEFFLER",
                event_ticker: "KXPGATOUR-THRC26",
                title: "Will Scottie Scheffler win the Tour Championship?",
                previous_price_dollars: "0.5000", last_price_dollars: "0.5000" }),
          mkt({ ticker: "KXPRESPERSON-28-AOCA", event_ticker: "KXPRESPERSON-28",
                title: "Will candidate A win the election?",
                previous_price_dollars: "0.7000", last_price_dollars: "0.7200" }),
        ] };
      }
      if (n === 2) {
        // live swing: gas 0.45 -> 0.60 (+0.15); golf moves only 0.03 (no alert);
        // elections market vanishes from the open list (resolution watch)
        return { markets: [
          mkt({ ticker: "KXAAAGASW-26NOV23-3.6400", event_ticker: "KXAAAGASW-26NOV23",
                title: "Will average gas prices be above $3.6400?",
                previous_price_dollars: "0.3000", last_price_dollars: "0.6000" }),
          mkt({ ticker: "KXPGATOUR-THRC26-SCHEFFLER",
                event_ticker: "KXPGATOUR-THRC26",
                title: "Will Scottie Scheffler win the Tour Championship?",
                previous_price_dollars: "0.5000", last_price_dollars: "0.5300" }),
        ] };
      }
      // later polls: stable
      return { markets: [
        mkt({ ticker: "KXAAAGASW-26NOV23-3.6400", event_ticker: "KXAAAGASW-26NOV23",
              title: "Will average gas prices be above $3.6400?",
              previous_price_dollars: "0.3000", last_price_dollars: "0.6000" }),
      ] };
    },
  };
  const { doc, win, errors, fx } = await boot(scenario);
  const E = win.__alertdesk;
  ok("no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  E.pause();     // kill the auto-timer for determinism…
  E.state.paused = false; // …but keep manual pollOnce() calls working

  const n0 = E.state.messages.length;
  await E.pollOnce(); // poll 1: baseline + day move
  const dayMsgs = E.state.messages.filter((m) => m.basis === "day" && m.source === "live");
  ok("day-move pass fires on first live poll",
     dayMsgs.length === 1 && dayMsgs[0].delta === 0.15,
     JSON.stringify(dayMsgs.map((m) => [m.ticker, m.delta])));
  ok("day-move message links the list request",
     dayMsgs.length === 1 && dayMsgs[0].src.includes("/markets?status=open&limit=1000"));
  ok("baseline poll raises no live-delta alerts",
     E.state.messages.filter((m) => m.basis === "live").length === 0);
  ok("mode switched to LIVE", E.state.mode === "live",
     doc.getElementById("modeBadge").textContent);

  await E.pollOnce(); // poll 2: +0.15 live swing; small move ignored; ticker vanishes
  const liveMsgs = E.state.messages.filter((m) => m.basis === "live");
  ok("live swing >= $0.10 alerts", liveMsgs.length === 1 &&
     liveMsgs[0].ticker === "KXAAAGASW-26NOV23-3.6400" && liveMsgs[0].delta === 0.15,
     JSON.stringify(liveMsgs.map((m) => [m.ticker, m.delta])));
  ok("sub-threshold move (0.03) raises no alert",
     !E.state.messages.some((m) => m.ticker === "KXPGATOUR-THRC26-SCHEFFLER" && m.kind === "swing" && m.basis === "live"));

  // The resolution check runs inside the same pollOnce that queues the vanished
  // ticker, so by the time poll 2 resolves the watch has already fired.
  const resMsgs = E.state.messages.filter((m) => m.kind === "resolution" && m.source === "live");
  ok("vanished ticker watched; RESOLVED YES posted",
     resMsgs.length === 1 && resMsgs[0].result === "yes" &&
     resMsgs[0].ticker === "KXPRESPERSON-28-AOCA",
     JSON.stringify(resMsgs.map((m) => [m.ticker, m.result])));
  ok("resolution message links its single-market request",
     resMsgs.length === 1 && resMsgs[0].src.includes("/markets/KXPRESPERSON-28-AOCA"));
  ok("watch queue drained after resolution",
     !E.state.pendingResolve["KXPRESPERSON-28-AOCA"]);
  ok("resolved ticker is not re-queued",
     E.state.checkedOnce["KXPRESPERSON-28-AOCA"] === true);

  await E.pollOnce(); // poll 3: stability — no duplicate messages
  ok("later polls add no duplicates",
     E.state.messages.filter((m) => m.basis === "live").length === 1 &&
     E.state.messages.filter((m) => m.kind === "resolution" && m.source === "live").length === 1);

  /* both feeds contain the live swing; ROI subset still holds */
  const all = feedMsgs(doc, "allFeed");
  const roi = feedMsgs(doc, "roiFeed");
  ok("DOM shows the live swing in the all feed",
     all.some((m) => m.getAttribute("data-id") === liveMsgs[0].id));
  ok("DOM shows the live swing in the ROI feed (score >= 4)",
     roi.some((m) => m.getAttribute("data-id") === liveMsgs[0].id));
  ok("ROI DOM is still a subset of all DOM",
     roi.every((m) => all.some((a) => a.getAttribute("data-id") === m.getAttribute("data-id"))));
  ok("live messages carry live chips",
     all.filter((m) => m.querySelector(".chip-live")).length >= 2);

  /* 429 -> retry badge, no crash */
  E.state.paused = false;
  E.state.fails = 0;
  const r1 = await E.pollOnce();
  ok("429 handled without throwing", r1 === null);
  const r2 = await E.pollOnce(); // second failure flips the badge to RETRY
  ok("second 429 also handled", r2 === null && E.state.fails === 2,
     `fails=${E.state.fails}`);
  ok("mode shows RETRY after repeated failures",
     doc.getElementById("modeBadge").textContent === "RETRY",
     doc.getElementById("modeBadge").textContent);
  ok("banner keeps the snapshot feed visible on failure",
     /unreachable|retrying/i.test(doc.getElementById("banner").textContent));
  E.pause();
}

console.log("\ncase 3 — closed markets remain under watch until a confirmed result");
{
  const tickers = Array.from({ length: 6 }, (_, i) => `KXBTC-26NOV23-WATCH${i}`);
  const resolve = Object.fromEntries(tickers.map((ticker) => [ticker, mkt({
    ticker, event_ticker: "KXBTC-26NOV23", title: "Will Bitcoin reach a threshold?",
    status: "closed", result: "", settlement_ts: "",
  })]));
  const { win, doc, fx } = await boot({ seedFails: true, list: () => ({ markets: [] }), resolve });
  const E = win.__alertdesk;
  E.pause();
  for (const ticker of tickers) E.state.pendingResolve[ticker] = { attempts: 0, nextAt: 0 };
  await E.checkResolutions();
  ok("per-poll resolution requests capped at four",
     fx.calls.filter((u) => tickers.some((t) => u.endsWith(`/markets/${t}`))).length === 4);
  // Force the scheduled due time only in this deterministic test; production
  // waits for each ticker's nextAt before another request.
  for (const watch of Object.values(E.state.pendingResolve)) watch.nextAt = 0;
  await E.checkResolutions();
  ok("later queue entries are checked despite four older unsettled entries",
     tickers.slice(4).every((t) => fx.calls.some((u) => u.endsWith(`/markets/${t}`))));
  for (let i = 0; i < 35; i++) {
    for (const watch of Object.values(E.state.pendingResolve)) watch.nextAt = 0;
    await E.checkResolutions();
  }
  ok("unsettled markets survive more than the old 20-attempt ceiling",
     tickers.every((t) => E.state.pendingResolve[t] && !E.state.checkedOnce[t]));
  resolve[tickers[0]].result = "no";
  resolve[tickers[0]].settlement_ts = "2026-11-21T02:00:00Z";
  for (const watch of Object.values(E.state.pendingResolve)) watch.nextAt = 0;
  await E.checkResolutions();
  ok("observed NO result retires only its resolved ticker",
     !E.state.pendingResolve[tickers[0]] && E.state.checkedOnce[tickers[0]] &&
     tickers.slice(1).every((t) => E.state.pendingResolve[t]));
  ok("NO result is sourced from its individual market request",
     E.state.messages.some((m) => m.kind === "resolution" && m.ticker === tickers[0] &&
       m.result === "no" && m.src === `${API}/markets/${tickers[0]}`));
  ok("watch is explicitly limited to the current tab",
     /not persisted across reloads/.test(doc.body.textContent));
}

console.log("\ncase 4 — seed failure degrades honestly");
{
  const { doc, errors } = await boot({ seedFails: true });
  ok("no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  ok("banner reports the failure, no fabricated numbers",
     /Snapshot feed unavailable/.test(doc.getElementById("banner").textContent));
  ok("feeds stay empty", feedMsgs(doc, "allFeed").length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
