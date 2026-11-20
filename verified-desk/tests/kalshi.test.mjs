import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const K = require("../assets/kalshi.js");
const snap = JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url), "utf8"));

/* ---------------- fixed-point parsing ---------------- */
test("num() treats API empties as null, never zero", () => {
  assert.equal(K.num(""), null);
  assert.equal(K.num(null), null);
  assert.equal(K.num(undefined), null);
  assert.equal(K.num("0.0000"), 0);
  assert.equal(K.num("385.82"), 385.82);
  assert.equal(K.num("n/a"), null);
});

/* ---------------- fee model: must reproduce the published table ---------------- */
test("tradeFee reproduces the official General Trading Fees table (taker)", () => {
  // Rows from https://kalshi.com/docs/kalshi-fee-schedule.pdf ("Fee for 100 contracts")
  const rows = [
    [0.01, 0.07], [0.05, 0.34], [0.10, 0.63], [0.15, 0.90], [0.20, 1.12],
    [0.25, 1.32], [0.30, 1.47], [0.35, 1.60], [0.40, 1.68], [0.45, 1.74],
    [0.50, 1.75], [0.55, 1.74], [0.60, 1.68], [0.65, 1.60], [0.70, 1.47],
    [0.75, 1.32], [0.80, 1.12], [0.85, 0.90], [0.90, 0.63], [0.95, 0.34], [0.99, 0.07],
  ];
  for (const [price, published] of rows) {
    const got = K.tradeFee({ contracts: 100, price, multiplier: 1, role: "taker" });
    assert.equal(Number(got.toFixed(2)), published, `fee at price ${price} should be ${published}, got ${got}`);
  }
});

test("tradeFee single-contract column and maker coefficient", () => {
  assert.equal(K.tradeFee({ contracts: 1, price: 0.5, multiplier: 1, role: "taker" }), 0.02);
  assert.equal(K.tradeFee({ contracts: 1, price: 0.01, multiplier: 1, role: "taker" }), 0.01);
  // maker = 0.0175 coefficient
  assert.equal(K.tradeFee({ contracts: 100, price: 0.5, multiplier: 1, role: "maker" }), 0.44);
  assert.equal(K.tradeFee({ contracts: 10, price: 0.4, multiplier: 0, role: "maker" }), 0);
  assert.equal(K.tradeFee({ contracts: 5, price: 1.5, multiplier: 1, role: "taker" }), null, "price outside 0..1 rejected");
  assert.equal(K.tradeFee({ contracts: 5, price: 0.5, multiplier: 1, role: "nope" }), null);
});

test("buyCost reports position cost, fee, breakeven", () => {
  const r = K.buyCost({ contracts: 100, price: 0.29 });
  assert.equal(r.positionCost, 29);
  // 0.07 * 100 * 0.29 * 0.71 = 1.4413 -> rounds up to 1.45
  assert.equal(r.fee, 1.45);
  assert.equal(Number(r.total.toFixed(2)), 30.45);
  assert.equal(r.maxPayout, 100);
  assert.ok(Math.abs(r.breakevenPrice - 0.3045) < 1e-9);
});

/* ---------------- topic classification ---------------- */
test("classifyTopic uses verified series prefixes first", () => {
  assert.deepEqual(K.classifyTopic({ series_ticker: "KXAAAGASM", title: "Gas prices in the US in Dec 2026?" }), { topic: "gas-prices", basis: "series-prefix" });
  assert.deepEqual(K.classifyTopic({ series_ticker: "KXBTC15M", category: "Crypto" }), { topic: "crypto", basis: "series-prefix" });
  assert.deepEqual(K.classifyTopic({ series_ticker: "KXPGARYDER" }), { topic: "golf", basis: "series-prefix" });
});

test("classifyTopic falls back to tags then category", () => {
  assert.equal(K.classifyTopic({ series_ticker: "KXMYSTERY", category: "Sports", tags: ["Golf"] }).topic, "golf");
  assert.equal(K.classifyTopic({ series_ticker: "KXMYSTERY", category: "Elections" }).topic, "elections");
  assert.equal(K.classifyTopic({ series_ticker: "KXMYSTERY", category: "Culture" }).topic, "culture");
  // Economics alone must NOT be called gas prices, and Sports alone must not be golf.
  assert.equal(K.classifyTopic({ series_ticker: "KXCPI", category: "Economics", title: "CPI print" }), null);
  assert.equal(K.classifyTopic({ series_ticker: "KXNBAGAME", category: "Sports", title: "NBA game" }), null);
});

test("classifyTopic keyword layer catches gas/election titles", () => {
  assert.equal(K.classifyTopic({ series_ticker: "KXWEIRD1", title: "Will average gas prices be above $3.30?" }).topic, "gas-prices");
  assert.equal(K.classifyTopic({ series_ticker: "KXWEIRD2", title: "Which California ballot measures will pass?" }).topic, "elections");
});

/* ---------------- resolution tracking (the brief's core ask) ---------------- */
test("eventResolution counts yes/no and flags mixed state", () => {
  const ballot = snap.events.find((e) => e.event_ticker === "KXCABALLOTMEASURES-26NOV03");
  const r = K.eventResolution(ballot);
  assert.equal(r.totalMarkets, 4);
  assert.equal(r.settled, 3);
  assert.equal(r.yes, 3);
  assert.equal(r.no, 0);
  assert.deepEqual(r.pending, ["KXCABALLOTMEASURES-26NOV03-PR04"]);
  assert.equal(r.complete, false);
  assert.equal(r.mixedState, true, "event still open while 3 markets resolved - drives the tracker");
  assert.equal(r.lastSettlementTs, "2026-11-06T05:07:14.419693Z");
});

test("resolved crypto 15m events are complete and outcome-bearing", () => {
  const yes = snap.events.find((e) => e.event_ticker === "KXBTC15M-26NOV200545");
  const no = snap.events.find((e) => e.event_ticker === "KXBTC15M-26NOV200600");
  assert.equal(K.eventResolution(yes).complete, true);
  assert.equal(K.marketOutcome(yes.markets[0]), "yes");
  assert.equal(K.marketOutcome(no.markets[0]), "no");
  assert.equal(no.markets[0].settlement_value_dollars, "0.0000");
});

/* ---------------- dollar volume ---------------- */
test("turnover estimate is volume_fp x last price and never invents data", () => {
  const m = snap.events[0].markets.find((x) => x.ticker === "KXAAAGASM-26DEC31-3.30");
  // 385.82 * 0.29 = 111.88780000000001 in binary floats; the engine normalises to micro-dollars.
  assert.equal(K.turnoverEstimate(m), 111.8878);
  const truncated = snap.events.find((e) => e.topic === "golf" && e.event_ticker === "KXPGATOP40-THOC26")
    .markets.find((x) => x.ticker.endsWith("-ABHAT"));
  assert.equal(K.turnoverEstimate(truncated), null, "captured-but-missing volume stays null");
});

test("eventMetrics ranks events by dollar volume with nulls last", () => {
  const orphan = {
    event_ticker: "KXNODATA-1",
    series_ticker: "KXNODATA",
    topic: "crypto",
    markets: [{ ticker: "KXNODATA-1-X", status: "active", result: "", last_price_dollars: "0.5000", volume_fp: null }],
  };
  const ranked = K.rankEvents([...snap.events, orphan], { preclassified: true });
  assert.ok(ranked.length >= 5);
  const vols = ranked.map((r) => r.metrics.dollarVolumeEstimate);
  const present = vols.filter((v) => v !== null);
  assert.deepEqual(present, [...present].sort((a, b) => b - a), "descending");
  assert.equal(vols[vols.length - 1], null, "an event with no usable volume ranks last");
  const top = ranked[0];
  assert.ok(top.metrics.contracts > 0);
  assert.equal(typeof top.metrics.resolution.complete, "boolean");
});

test("a partially captured event reports its total as a floor, not a figure", () => {
  const golf = snap.events.find((e) => e.event_ticker === "KXPGATOP40-THOC26");
  const m = K.eventMetrics(golf);
  assert.equal(m.marketsTracked, 4);
  assert.equal(m.turnoverCovered, 3, "one market's volume was truncated during capture");
  assert.equal(m.incompleteTurnover, true);
  assert.equal(m.dollarVolumeIsFloor, true, "partial sums must be labelled as a lower bound");
  assert.ok(m.dollarVolumeEstimate > 0);
  // By contrast the gas event is fully covered.
  assert.equal(K.eventMetrics(snap.events[0]).dollarVolumeIsFloor, false);
});

test("rankEvents filters to the five requested topics only", () => {
  const ids = ["gas-prices", "elections", "culture", "crypto", "golf"];
  const ranked = K.rankEvents(snap.events, { preclassified: true, topics: ids });
  for (const r of ranked) assert.ok(ids.includes(r.topic), `${r.topic} not requested`);
});

/* ---------------- order book / liquidity ---------------- */
test("ladder merges yes/no bids and derives the implied YES ask", () => {
  // Example book straight from the official orderbook docs page.
  const book = {
    orderbook_fp: {
      yes_dollars: [["0.0100", "200.00"], ["0.1500", "100.00"], ["0.4200", "13.00"]],
      no_dollars: [["0.0100", "100.00"], ["0.3800", "300.00"], ["0.5600", "17.00"]],
    },
  };
  const lad = K.ladder(book);
  assert.equal(lad.bestYesBid, 0.42, "best bid is the LAST element (ascending order)");
  assert.equal(lad.bestNoBid, 0.56);
  assert.equal(Number(lad.bestYesAsk.toFixed(2)), 0.44, "YES ask = 1 - best NO bid");
  const at = K.atPrice(lad, 0.15);
  assert.deepEqual(at, { yesBid: 100, noBid: 0, total: 100 }, "contracts available at a given price");
});

test("walkBook eats depth, computes slippage and fees", () => {
  const book = {
    orderbook_fp: { yes_dollars: [["0.3000", "10.00"]], no_dollars: [["0.6000", "10.00"], ["0.6500", "10.00"]] },
  };
  const lad = K.ladder(book);
  const buy = K.walkBook(lad, { side: "buy", outcome: "yes", contracts: 15 });
  assert.equal(buy.filled, 15);
  assert.ok(buy.fullyFillable);
  // Best YES ask comes from the highest NO bid: 1-0.65 = 0.35 (10 contracts),
  // then 1-0.60 = 0.40 (5 contracts). Notional 3.50 + 2.00 = 5.50 / 15.
  assert.equal(buy.touchPrice, 0.35, "crossing the 0.65 NO bid prices YES at 0.35");
  assert.equal(Number(buy.averagePrice.toFixed(4)), 0.3667);
  assert.equal(Number((buy.averagePrice - buy.touchPrice).toFixed(4)), 0.0167, "slippage vs the touch");
  assert.ok(buy.slippage > 0);
  assert.ok(buy.fee > 0);
  const sell = K.walkBook(lad, { side: "sell", outcome: "yes", contracts: 8 });
  assert.equal(sell.averagePrice, 0.3, "selling into the only YES bid level");
  const buyNo = K.walkBook(lad, { side: "buy", outcome: "no", contracts: 5 });
  assert.equal(buyNo.averagePrice, 0.7, "NO ask = 1 - best YES bid");
  const tooBig = K.walkBook(lad, { side: "buy", outcome: "yes", contracts: 999 });
  assert.equal(tooBig.fullyFillable, false);
  assert.equal(tooBig.unfilled, 999 - 20);
  assert.equal(K.walkBook(lad, { side: "buy", outcome: "yes", contracts: 0 }), null);
});

test("empty order book (closed or unknown ticker) is reported, not hidden", () => {
  const lad = K.ladder(snap.orderbook);
  assert.equal(lad.empty, true);
  assert.equal(lad.bestYesBid, null);
});

/* ---------------- candles, granularity, axes ---------------- */
test("candlestick URL builder enforces the documented constraints", () => {
  const ok = K.candlestickUrl({
    base: K.BASES[0].rest, seriesTicker: "KXBTC15M", ticker: "KXBTC15M-26NOV200615-15",
    startTs: 1795165200, endTs: 1795174200, granularityId: "minutes",
  });
  assert.ok(ok.url.includes("period_interval=1"));
  assert.ok(ok.url.includes("start_ts=1795165200"));
  assert.equal(ok.error, undefined);

  const secs = K.candlestickUrl({ base: "x", seriesTicker: "S", ticker: "T", startTs: 1, endTs: 2, granularityId: "seconds" });
  assert.match(secs.error, /no sub-minute period/, "seconds must be refused with the WS explanation");

  const ms = K.candlestickUrl({ base: "x", seriesTicker: "S", ticker: "T", startTs: 1795165200000, endTs: 1795174200000, granularityId: "minutes" });
  assert.match(ms.error, /millisecond/, "ms timestamps rejected with 400 per docs");

  const huge = K.candlestickUrl({ base: "x", seriesTicker: "S", ticker: "T", startTs: 0, endTs: 60 * 6000, granularityId: "minutes" });
  assert.match(huge.error, /5000/, "5000-period cap enforced before the call");

  const backwards = K.candlestickUrl({ base: "x", seriesTicker: "S", ticker: "T", startTs: 100, endTs: 50, granularityId: "hours" });
  assert.match(backwards.error, /after/);
});

test("resample rolls 1-minute candles into hourly buckets", () => {
  const src = snap.candlesticks.candles;
  // All 16 captured candles fall inside the 11:00-12:00 UTC hour, so they
  // collapse to one hourly bucket that keeps the full traded volume.
  const hour = K.resample(src, 3600);
  assert.equal(hour.length, 1);
  const srcVol = src.reduce((a, c) => a + Number(c.volume_fp), 0);
  assert.equal(Math.round(hour[0].volume * 100), Math.round(srcVol * 100), "volume conserved by resampling");
  assert.ok(hour.every((h) => h.high >= h.low));
  assert.equal(hour[0].samples, src.length);

  // A 15-minute bucket splits the same tape into two windows, still conserving volume.
  const quarter = K.resample(src, 900);
  assert.ok(quarter.length >= 2);
  assert.equal(Math.round(quarter.reduce((a, b) => a + b.volume, 0) * 100), Math.round(srcVol * 100));

  // Synthetic candles spanning two hours must yield two buckets.
  const two = K.resample(
    [
      { end_period_ts: 1795172400, volume_fp: "10.00", open_interest_fp: "1.00", price: { open_dollars: "0.5000", high_dollars: "0.6000", low_dollars: "0.4000", close_dollars: "0.5500" } },
      { end_period_ts: 1795176000, volume_fp: "20.00", open_interest_fp: "2.00", price: { open_dollars: "0.5500", high_dollars: "0.7000", "low_dollars": "0.5000", close_dollars: "0.6500" } },
    ],
    3600
  );
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((b) => b.end_period_ts), [1795172400, 1795176000]);
  assert.equal(K.resample([], 3600).length, 0);
  assert.equal(K.resample([{ volume_fp: "1" }], 3600).length, 0, "candles without end_period_ts are skipped");
});

test("tradesToBuckets gives a sub-minute view from trade prints", () => {
  const trades = [
    { created_time: "2026-11-20T11:00:00.100Z", yes_price_dollars: "0.5700", count: 10 },
    { created_time: "2026-11-20T11:00:00.900Z", yes_price_dollars: "0.5800", count: 10 },
    { created_time: "2026-11-20T11:00:02.000Z", yes_price_dollars: "0.6000", count: 5 },
  ];
  const b = K.tradesToBuckets(trades, 1);
  assert.equal(b.length, 2, "two one-second buckets");
  assert.equal(b[0].contracts, 20);
  assert.equal(b[0].averagePrice, 0.575);
  assert.equal(b[1].ts, 1795172402);
});

test("MEC mispricing maths on the captured Ryder Cup event", () => {
  const rc = snap.events.find((e) => e.event_ticker === "KXPGARYDER-RC27");
  const mec = K.eventMetrics(rc).mec;
  assert.ok(mec, "event is mutually exclusive");
  assert.equal(mec.legs, 3);
  assert.equal(Number(mec.sumYesAsk.toFixed(2)), 3.00, "each leg quoted 1.00 ask");
  assert.equal(Number(mec.buyAllEdge.toFixed(2)), -2.00, "no basket edge at capture");
  assert.equal(K.eventMetrics(rc).mec !== null, true);
});

/* ---------------- chart geometry ---------------- */
test("chartScales maps Y into a 0..1 contract-price frame with ticks", () => {
  const pts = snap.candlesticks.candles.map((c) => ({ x: c.end_period_ts, y: Number(c.price.close_dollars ?? c.price.previous_dollars) }));
  const s = K.chartScales(pts, { yDomain: [0, 1] });
  assert.equal(s.yDomain === undefined, true);
  assert.equal(s.yMin, 0);
  assert.equal(s.yMax, 1);
  assert.equal(s.y(0), s.padT + s.plotH);
  assert.equal(s.y(1), s.padT);
  assert.equal(s.x(s.xMin), s.padL);
  assert.ok(s.yTicks.length >= 2);
  assert.ok(s.path(pts).startsWith("M"));
});

test("chartScales skips null points without breaking the line", () => {
  const s = K.chartScales([{ x: 1, y: null }, { x: 2, y: 0.5 }, { x: 3, y: 0.6 }]);
  const d = s.path([{ x: 1, y: null }, { x: 2, y: 0.5 }, { x: 3, y: 0.6 }]);
  assert.equal((d.match(/M/g) || []).length, 1);
  assert.equal(s.x(1), s.padL);
});

test("chartScales returns null for empty input instead of NaN geometry", () => {
  assert.equal(K.chartScales([]), null);
});

/* ---------------- portfolio + trade categorisation ---------------- */
test("positionPnl pays $1 per winning contract and zero on a loss", () => {
  const win = K.positionPnl({ side: "yes", entryPrice: 0.29, contracts: 100, result: "yes", fee: 1.45 });
  assert.equal(Number(win.realised.toFixed(2)), 69.55);
  const lose = K.positionPnl({ side: "yes", entryPrice: 0.29, contracts: 100, result: "no", fee: 1.45 });
  assert.equal(Number(lose.realised.toFixed(2)), -30.45);
  const open = K.positionPnl({ side: "no", entryPrice: 0.5, contracts: 10, result: "", fee: 0 });
  assert.equal(open.status, "open");
});

test("categorizeTrade derives every axis from API fields", () => {
  const cat = K.categorizeTrade(
    { price: "0.9200", outcome_side: "yes", role: "taker" },
    // entered 11:00Z for a market closing 11:15Z -> a 15-minute horizon
    { entryTime: "2026-11-20T11:00:00Z", closeTime: "2026-11-20T11:15:00Z", topic: "crypto", strategy: "crypto-15m-momentum", result: "no" }
  );
  assert.equal(cat.horizon, "<1h");
  assert.equal(cat.priceBucket, "favorite");
  assert.equal(cat.topic, "crypto");
  assert.equal(cat.intent, "crypto-15m-momentum");
  assert.equal(cat.direction, "yes");
  assert.equal(cat.outcome, "no");
  const longer = K.categorizeTrade({ price: "0.0300" }, { entryTime: "2026-11-20T11:00:00Z", closeTime: "2026-12-31T04:59:00Z", topic: "gas-prices" });
  assert.equal(longer.horizon, ">7d");
  assert.equal(longer.priceBucket, "longshot");
  assert.equal(longer.intent, "unlabelled", "an untagged order is visible as untagged, not guessed");
  const unknown = K.categorizeTrade({}, {});
  assert.equal(unknown.horizon, "unknown");
  assert.equal(unknown.priceBucket, "unknown");
});

test("portfolioView aggregates equity, hit rate and worst trade", () => {
  const v = K.portfolioView(
    [
      { topic: "crypto", size_fp: "100.00", entry_price_dollars: "0.2900", mark_price_dollars: "1.0000", realisedPnl: 69.55 },
      { topic: "crypto", size_fp: "100.00", entry_price_dollars: "0.2900", mark_price_dollars: "0.0000", realisedPnl: -30.45 },
      { topic: "golf", size_fp: "10.00", entry_price_dollars: "0.5000", mark_price_dollars: "0.5000" },
    ],
    1000000
  );
  assert.equal(v.counts.positions, 3);
  assert.equal(v.counts.wins, 1);
  assert.equal(v.counts.losses, 1);
  assert.equal(v.hitRate, 0.5);
  assert.equal(v.byTopic.crypto.positions, 2);
  assert.equal(v.best.topic, "crypto");
  assert.equal(v.worst.size, 100);
  // equity = 1_000_000 cents / 100 + unrealised (100*0.71 + 100*-0.29 + 10*0) = 10000 + 42
  assert.equal(Number(v.equity.toFixed(2)), 10042);
  assert.ok(Number.isFinite(v.equity));
});

test("equityCurve computes drawdown and total return", () => {
  const c = K.equityCurve([
    { ts: 1, equityUsd: 100 }, { ts: 2, equityUsd: 120 }, { ts: 3, equityUsd: 90 }, { ts: 4, equityUsd: 110 },
  ]);
  assert.equal(c.totalReturn, 0.1);
  assert.equal(Number(c.maxDrawdown.toFixed(4)), -0.25);
  assert.equal(c.points.length, 4);
  assert.equal(K.equityCurve([]).points.length, 0);
});

/* ---------------- request layer ---------------- */
test("buildUrl drops empty params and encodes lists", () => {
  const u = K.buildUrl("https://x/trade-api/v2", "/events", { limit: 200, cursor: "", status: "open", series_ticker: "KX AAA" });
  assert.equal(u, "https://x/trade-api/v2/events?limit=200&status=open&series_ticker=KX+AAA");
});

test("BASES match the endpoints in the brief and the official docs", () => {
  assert.equal(K.BASES[0].rest, "https://external-api.demo.kalshi.co/trade-api/v2");
  assert.equal(K.BASES[0].ws, "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2");
  assert.equal(K.BASES[1].rest, "https://demo-api.kalshi.co/trade-api/v2");
  assert.equal(K.BASES[1].ws, "wss://demo-api.kalshi.co/trade-api/ws/v2");
  assert.equal(K.BASES[0].verified, true);
});

test("snapshot provenance is complete: every row carries a source URL", () => {
  for (const e of snap.events) {
    assert.ok(/^https:\/\/external-api\.demo\.kalshi\.co\/trade-api\/v2\//.test(e.source), `missing source on ${e.event_ticker}`);
    assert.ok(e.markets.length > 0);
  }
  for (const s of snap.series_volume) assert.ok(s.source, `missing source on ${s.series_ticker}`);
  assert.ok(snap.candlesticks.source.includes("period_interval=1"));
});

test("enrichSnapshot sorts rows and never drops a flagged row", () => {
  const e = K.enrichSnapshot(snap);
  assert.equal(e.rows.length, snap.events.length);
  assert.ok(e.topics.crypto.length >= 3);
  assert.ok(e.topics.golf.length >= 1);
  assert.ok(e.topics["gas-prices"].includes("KXAAAGASM-26DEC31"));
});

/* ---------------- data integrity: the snapshot must not contain invented values ---------------- */
test("snapshot market rows only use documented field names", () => {
  const allowed = new Set([
    "ticker", "title", "yes_sub_title", "no_sub_title", "subtitle", "status", "result", "floor_strike",
    "strike_type", "expiration_value", "last_price_dollars", "previous_price_dollars",
    "yes_bid_dollars", "yes_bid_size_fp", "yes_ask_dollars", "yes_ask_size_fp",
    "no_bid_dollars", "no_ask_dollars", "open_interest_fp", "volume_fp", "volume_24h_fp",
    "open_time", "close_time", "expected_expiration_time", "occurrence_datetime",
    "settlement_timer_seconds", "settlement_ts", "settlement_value_dollars", "rules_primary",
    "_note", "latest_expiration_time", "custom_strike",
  ]);
  for (const e of snap.events) {
    for (const m of e.markets) {
      for (const k of Object.keys(m)) assert.ok(allowed.has(k), `unexpected field ${k} on ${m.ticker}`);
    }
  }
});

test("demo API base is reachable only from the user's browser - sandbox has no egress (documented)", () => {
  // Guards against a future edit quietly pointing the UI at a host that was never verified.
  assert.equal(K.BASES[0].id, "demo-external");
  assert.equal(K.SOURCES.demoEnv, "https://docs.kalshi.com/getting_started/demo_env");
});

test("replaySim books round trips from recorded candles and charges both fees", () => {
  const res = K.replaySim(snap.candlesticks.candles, {
    entry: (k) => (Number(k.price && k.price.close_dollars) >= 0.5 ? 0.5 : null),
    exit: (k) => (Number(k.price && k.price.close_dollars) <= 0.05 ? 0.05 : null),
  }, { contracts: 100 });
  assert.ok(res.trades.length >= 1);
  const t = res.trades[0];
  assert.equal(t.contracts, 100);
  // Bought 0.50, exited at 0.05 (or the final candle): a loss, and fees are charged twice.
  assert.ok(t.fees > 0, "taker fee charged on entry and exit");
  assert.ok(t.netPnl < t.grossPnl, "fees reduce P&L");
  assert.equal(res.basis, "simulated from recorded candlesticks - no order was sent to Kalshi");
  assert.equal(K.replaySim([], {}, {}).trades.length, 0);
  assert.equal(K.replaySim(snap.candlesticks.candles, {}, { contracts: 10 }).trades.length, 0, "no entry rule means no trades");
});
