#!/usr/bin/env node
/* engine.test.mjs — unit tests for the trade-desk analysis layer.
 *
 * These are the invariants that, if they break, make every number on the site
 * wrong: the fee formula against the official table, jump detection at the
 * $0.10 boundary, the high-ROI bar, and paper-fill / settlement arithmetic.
 *
 * Usage: node trade-desk/tests/engine.test.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

globalThis.TD = require("../assets/util.js");
const E = require("../assets/engine.js");
const TD = globalThis.TD;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail === undefined ? "" : " — " + detail)); }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

/* ---------------------------------------------------------------- fees
 * The official fee schedule PDF prints the fee for 100 contracts at 21 prices.
 * Every one of those rows must reproduce exactly, or fees on the whole site are
 * wrong. Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf
 */
console.log("fees (official fee-schedule table)");
const OFFICIAL_100 = {
  "0.01": 0.07, "0.05": 0.34, "0.10": 0.63, "0.15": 0.90, "0.20": 1.12,
  "0.25": 1.32, "0.30": 1.47, "0.35": 1.60, "0.40": 1.68, "0.45": 1.74,
  "0.50": 1.75, "0.55": 1.74, "0.60": 1.68, "0.65": 1.60, "0.70": 1.47,
  "0.75": 1.32, "0.80": 1.12, "0.85": 0.90, "0.90": 0.63, "0.95": 0.34,
  "0.99": 0.07
};
let feeBad = 0;
for (const [p, f] of Object.entries(OFFICIAL_100)) {
  const got = TD.fee(100, Number(p), 1);
  if (!near(got, f, 1e-9)) { feeBad++; console.log(`     ${p}: got ${got} want ${f}`); }
}
ok("all 21 official 100-contract fee rows reproduce", feeBad === 0);
ok("fee of zero contracts is zero", TD.fee(0, 0.5, 1) === 0);
ok("fee at a 0 or 1 price is zero (no contract can trade there)", TD.fee(10, 0, 1) === 0 && TD.fee(10, 1, 1) === 0);
ok("fee rounds up, not to nearest", TD.fee(1, 0.10, 1) === 0.01);

/* ------------------------------------------------------- jump detection */
console.log("jump detection (>= $0.10 either direction)");
const now = Date.now();
const iso = (s) => new Date(now - s * 1000).toISOString();
const tape = [
  { trade_id: "a1", ticker: "UP", count_fp: "10", yes_price_dollars: "0.40", created_time: iso(600) },
  { trade_id: "a2", ticker: "UP", count_fp: "10", yes_price_dollars: "0.45", created_time: iso(400) },
  { trade_id: "a3", ticker: "UP", count_fp: "10", yes_price_dollars: "0.52", created_time: iso(200) },
  { trade_id: "d1", ticker: "DOWN", count_fp: "25", yes_price_dollars: "0.60", created_time: iso(600) },
  { trade_id: "d2", ticker: "DOWN", count_fp: "25", yes_price_dollars: "0.47", created_time: iso(100) },
  { trade_id: "s1", ticker: "SMALL", count_fp: "5", yes_price_dollars: "0.30", created_time: iso(500) },
  { trade_id: "s2", ticker: "SMALL", count_fp: "5", yes_price_dollars: "0.39", created_time: iso(50) },
  { trade_id: "e1", ticker: "EDGE", count_fp: "5", yes_price_dollars: "0.5000", created_time: iso(500) },
  { trade_id: "e2", ticker: "EDGE", count_fp: "5", yes_price_dollars: "0.6000", created_time: iso(50) }
];
const jumps = E.scanTrades(tape, { now, windowMs: 15 * 60 * 1000 });
const byTicker = Object.fromEntries(jumps.map((j) => [j.ticker, j]));
ok("an up move of +12c fires", byTicker.UP && near(byTicker.UP.move, 0.12));
ok("a down move of -13c fires and keeps its sign", byTicker.DOWN && near(byTicker.DOWN.move, -0.13));
ok("a +9c move does not fire", !byTicker.SMALL);
ok("exactly $0.10 fires (the brief says >= $0.10)", !!byTicker.EDGE && near(byTicker.EDGE.move, 0.10));
ok("a single print cannot be a jump", E.scanTrades([tape[0]], { now }).length === 0);
ok("trades older than the window are ignored",
  E.scanTrades([{ ticker: "OLD", yes_price_dollars: "0.10", count_fp: "1", created_time: iso(3600) },
                { ticker: "OLD", yes_price_dollars: "0.50", count_fp: "1", created_time: iso(30) }],
    { now, windowMs: 10 * 60 * 1000 }).length === 0);
ok("each jump carries the trades-API source URL", byTicker.UP.source.includes("/markets/trades?ticker=UP"));

/* spike-and-retrace: net small, peak large */
const spike = E.scanTrades([
  { ticker: "SPIKE", yes_price_dollars: "0.50", count_fp: "1", created_time: iso(300) },
  { ticker: "SPIKE", yes_price_dollars: "0.65", count_fp: "1", created_time: iso(200) },
  { ticker: "SPIKE", yes_price_dollars: "0.51", count_fp: "1", created_time: iso(100) }
], { now });
ok("a spike-and-retrace is reported on its peak move", spike.length === 1 && near(spike[0].peak, 0.15) && spike[0].mode === "peak");

/* --------------------------------------------------------------- scoring */
console.log("screen");
const q = { ticker: "M", event_ticker: "E", title: "t", yes_bid_dollars: "0.50", yes_ask_dollars: "0.52" };
const book = { orderbook_fp: { yes_dollars: [["0.5000", "300.00"]], no_dollars: [["0.4800", "250.00"]] } };
const good = E.score(q, { jump: byTicker.UP, book, now });
ok("a tight, deep book after a jump clears the screen", E.isHighRoi(good), `score ${good.score} roi ${good.roi}`);
ok("score never exceeds its own maximum", good.score <= good.maxScore);
ok("net ROI is the fee-paid win case, below max ROI", good.roi < good.maxRoi);
ok("max ROI is (1/ask - 1)", near(good.maxRoi, 1 / 0.52 - 1, 1e-9));
const wide = E.score({ yes_bid_dollars: "0.30", yes_ask_dollars: "0.60" }, { jump: byTicker.UP, now });
ok("a 30c spread scores far below a 2c spread", wide.score < good.score);
const capped = E.score({ yes_bid_dollars: "0.97", yes_ask_dollars: "0.99" }, { jump: byTicker.UP, now });
ok("a 99c entry is rejected by the price bar", !E.isHighRoi(capped));
const noAsk = E.score({ yes_bid_dollars: "0.40", yes_ask_dollars: "0.0000" }, { jump: byTicker.UP, now });
ok("a missing ask produces no ROI and no entry", noAsk.entryAsk === null && !E.isHighRoi(noAsk));
ok("score terms always sum to the reported score",
  near(good.terms.reduce((s, t) => s + t.pts, 0), good.score, 0.051));

/* --------------------------------------------------------- paper ledger */
console.log("paper ledger");
const led = E.emptyLedger();
ok("a fresh ledger starts at the advertised $1,000", led.cash === 1000);
const open = E.openPosition(led, { ticker: "M", topic: "golf", strategy: "balanced", ask: 0.52, contracts: 10 },
  { now: new Date().toISOString() });
ok("a fill is charged the official fee", open.ok && near(open.position.entry_fee, TD.fee(10, 0.52)));
ok("cash drops by fill plus fee", near(led.cash, 1000 - (10 * 0.52 + TD.fee(10, 0.52)), 0.011));
ok("a second position in the same market is refused", !E.openPosition(led, { ticker: "M", ask: 0.52, contracts: 1 }).ok);
ok("an order larger than cash is refused", !E.openPosition(led, { ticker: "BIG", ask: 0.90, contracts: 5000 }).ok);
ok("a zero-ask market is refused rather than filled free",
  !E.openPosition(led, { ticker: "FREE", ask: 0, contracts: 1 }).ok);
const wrong = E.settlePosition(led, "M", { ticker: "M", status: "active", result: "" });
ok("settlement is refused while the market has no result", !wrong.ok && /no settlement result/.test(wrong.error));
const settle = E.settlePosition(led, "M", { ticker: "M", status: "finalized", result: "yes", settlement_ts: new Date().toISOString() });
ok("a YES settlement pays $1 per contract", settle.ok && near(settle.trade.gross, 10));
ok("settlement P&L is payout minus entry cost",
  settle.ok && near(settle.trade.pnl, 10 - (10 * 0.52 + TD.fee(10, 0.52)), 0.011));
ok("the settled position is removed", led.positions.M === undefined);
ok("a losing NO settlement pays nothing",
  (function () {
    const l = E.emptyLedger();
    E.openPosition(l, { ticker: "L", ask: 0.40, contracts: 5 });
    const s = E.settlePosition(l, "L", { ticker: "L", status: "finalized", result: "no" });
    return s.ok && s.trade.payout_per === 0 && s.trade.pnl < 0;
  })());
ok("a scalar settlement uses the API's own settlement value",
  (function () {
    const l = E.emptyLedger();
    E.openPosition(l, { ticker: "S", ask: 0.30, contracts: 10 });
    const s = E.settlePosition(l, "S", { ticker: "S", status: "finalized", result: "scalar", settlement_value_dollars: "0.4200" });
    return s.ok && near(s.trade.payout_per, 0.42);
  })());

/* ----------------------------------------------------------- performance */
console.log("performance rollups");
const perf = E.performance(led);
ok("win rate counts only settled trades", perf.settled === 1 && near(perf.winRate, 1));
ok("realized P&L equals the sum of settled P&L", near(perf.realized, settle.trade.pnl, 0.011));
ok("breakdowns cover strategy, topic, side and band",
  perf.byStrategy.length === 1 && perf.byTopic.length === 1 && perf.bySide.length === 1 && perf.byBand.length === 1);
ok("price bands are assigned deterministically",
  E.bands(0.05) === "$0.00–0.14" && E.bands(0.52) === "$0.35–0.64" && E.bands(0.99) === "$0.85–1.00");

/* ------------------------------------------------------------ strategies */
console.log("strategy rules");
const ctx = { jump: byTicker.UP, scored: good };
ok("jump-momentum buys an up-jump that clears the screen", E.strategyById("jump-momentum").select(ctx));
ok("jump-fade does not buy an up-jump", !E.strategyById("jump-fade").select(ctx));
ok("jump-fade buys a down-jump that clears the screen", E.strategyById("jump-fade").select({ jump: byTicker.DOWN, scored: good }));
ok("cheap-longshot refuses a 52c entry", !E.strategyById("cheap-longshot").select(ctx));

console.log("");
console.log(`${pass}/${pass + fail} engine checks passed`);
if (fail) process.exit(1);
