import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMarketField,
  classifyEvent,
  eventBookMetric,
  eventDataStatus,
  eventResolutionState,
  eventSourceUrl,
  marketBookMetrics,
  marketOutcome,
  marketResolutionLabel,
  rankEvents,
  visibleBidNotional,
} from "../src/core.js";

const liveMarket = (ticker, status = "open") => ({ ticker, status });

 test("topic filters use event and nested market text without adding unrelated topics", () => {
  const event = {
    title: "National gasoline prices this month",
    category: "Entertainment",
    markets: [{ title: "Will the price of gas exceed the threshold?" }],
  };
  assert.deepEqual(classifyEvent(event).sort(), ["culture", "gas-prices"]);
  assert.deepEqual(classifyEvent({ title: "Bitcoin price", category: "Crypto" }), ["crypto"]);
  assert.deepEqual(classifyEvent({ title: "PGA Tour winner" }), ["golf"]);
  assert.deepEqual(classifyEvent({ title: "A general weather outcome" }), []);
});

test("only an explicit YES or NO result is treated as an outcome", () => {
  assert.equal(marketOutcome({ result: "YES", last_price_dollars: "0.9900" }), "yes");
  assert.equal(marketOutcome({ result: "no" }), "no");
  assert.equal(marketOutcome({ last_price_dollars: "0.9900", status: "open" }), null);
  assert.equal(marketResolutionLabel({ status: "settled" }), "Settled — YES/NO result not returned");
  assert.equal(marketResolutionLabel({ status: "closed" }), "Closed — awaiting result");
});

test("event resolution state does not invent an event-level result", () => {
  assert.equal(eventResolutionState({ markets: [
    { ticker: "A", status: "settled", result: "yes" },
    { ticker: "B", status: "settled", result: "no" },
  ] }), "Resolved — market outcomes reported");
  assert.equal(eventResolutionState({ markets: [
    { ticker: "A", status: "settled" },
  ] }), "Settled — one or more YES/NO outcomes missing");
  assert.equal(eventDataStatus({ markets: [liveMarket("A"), liveMarket("B", "closed")] }), "Live + awaiting resolution");
});

test("visible bid notional sums price times contracts on both returned sides", () => {
  const orderbook = { orderbook_fp: {
    yes_dollars: [["0.4000", "10.00"], ["0.2000", "5.00"]],
    no_dollars: [["0.3000", "20.00"]],
  } };
  assert.equal(visibleBidNotional(orderbook), 11);
  const metrics = marketBookMetrics(orderbook);
  assert.equal(metrics.visibleBidNotional, 11);
  assert.equal(metrics.levels.length, 3);
  assert.equal(metrics.levels[0].side, "NO bid");
  assert.equal(metrics.levels[0].price, 0.3);
  assert.equal(visibleBidNotional({ orderbook_fp: { yes_dollars: [], no_dollars: [] } }), 0);
});

test("incomplete or malformed book data remains unavailable, not zero", () => {
  assert.equal(visibleBidNotional(null), null);
  assert.equal(visibleBidNotional({ orderbook_fp: { yes_dollars: [], no_dollars: null } }), null);
  assert.equal(visibleBidNotional({ orderbook_fp: { yes_dollars: [["bad", "5"]], no_dollars: [] } }), null);
  assert.equal(marketBookMetrics({ orderbook_fp: { yes_dollars: [], no_dollars: [] } }).visibleBidNotional, 0);
});

test("event book metric ranks only complete active open-market snapshots", () => {
  const event = { event_ticker: "EVT", markets: [
    liveMarket("OPEN-1"),
    liveMarket("CLOSED-1", "closed"),
    { ticker: "SETTLED-1", status: "settled", result: "yes" },
  ] };
  const books = new Map([["OPEN-1", { orderbook_fp: { yes_dollars: [["0.5", "2"]], no_dollars: [["0.2", "5"]] } }]]);
  assert.deepEqual(eventBookMetric(event, books), { value: 2, partialValue: 2, coverage: 1, total: 1, complete: true });
  assert.equal(eventBookMetric({ markets: [liveMarket("OPEN-2")] }, new Map()).value, null);
  assert.equal(eventBookMetric({ markets: [liveMarket("CLOSED-2", "closed")] }, new Map()).value, null);
});

test("event ranking puts fully measured events first and sorts by visible notional", () => {
  const a = { event_ticker: "A", markets: [liveMarket("A-M")] };
  const b = { event_ticker: "B", markets: [liveMarket("B-M")] };
  const missing = { event_ticker: "C", markets: [liveMarket("C-M")] };
  const books = new Map([
    ["A-M", { orderbook_fp: { yes_dollars: [["0.5", "2"]], no_dollars: [] } }],
    ["B-M", { orderbook_fp: { yes_dollars: [["0.8", "2"]], no_dollars: [] } }],
  ]);
  assert.deepEqual(rankEvents([a, missing, b], books).map((event) => event.event_ticker), ["B", "A", "C"]);
});

test("market field aggregates stay blank when a member value is unavailable", () => {
  assert.equal(aggregateMarketField([{ volume_24h_fp: "2" }, { volume_24h_fp: "3" }], "volume_24h_fp"), 5);
  assert.equal(aggregateMarketField([{ volume_24h_fp: "2" }, {}], "volume_24h_fp"), null);
  assert.equal(aggregateMarketField([], "volume_24h_fp"), null);
});

test("event source URL contains an encoded ticker and nested-market request", () => {
  const source = new URL(eventSourceUrl("https://external-api.demo.kalshi.co/trade-api/v2", "EVT / 1"));
  assert.equal(source.origin, "https://external-api.demo.kalshi.co");
  assert.equal(source.pathname, "/trade-api/v2/events");
  assert.equal(source.searchParams.get("tickers"), "EVT / 1");
  assert.equal(source.searchParams.get("with_nested_markets"), "true");
});
