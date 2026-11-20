import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPaperFills,
  emptyPaperLedger,
  normalizePaperOrderbook,
  paperExecutionLevels,
  simulatePaperLimitOrder,
} from "../src/paper.js";

const orderbook = {
  orderbook_fp: {
    yes_dollars: [["0.4000", "4"], ["0.3500", "3"]],
    no_dollars: [["0.5500", "2"], ["0.5000", "5"]],
  },
};

test("paper book derives YES and NO asks only from the opposite side's official bids", () => {
  const book = normalizePaperOrderbook(orderbook);
  assert.deepEqual(paperExecutionLevels(book, "yes", "buy").map(({ price, contracts }) => [price, contracts]), [[0.45, 2], [0.5, 5]]);
  assert.deepEqual(paperExecutionLevels(book, "no", "buy").map(({ price, contracts }) => [price, contracts]), [[0.6, 4], [0.65, 3]]);
  assert.deepEqual(paperExecutionLevels(book, "yes", "sell").map(({ price, contracts }) => [price, contracts]), [[0.4, 4], [0.35, 3]]);
});

test("paper limit execution sweeps only visible levels that meet the limit", () => {
  const result = simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "buy", contracts: 6, limitPrice: 0.49, cashAvailable: 10 });
  assert.deepEqual(result.fills.map(({ price, contracts }) => [price, contracts]), [[0.45, 2]]);
  assert.equal(result.filledContracts, 2);
  assert.equal(result.remainingContracts, 4);
  assert.equal(result.notional, 0.9);
});

test("paper buy respects available cash and records a partial fill", () => {
  const result = simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "buy", contracts: 6, limitPrice: 0.5, cashAvailable: 2.5 });
  assert.equal(result.filledContracts, 5.2);
  assert.equal(result.remainingContracts, 0.8);
  assert.equal(result.notional, 2.5);
});

test("incomplete book, invalid limit, and non-positive quantity cannot simulate an order", () => {
  assert.throws(() => simulatePaperLimitOrder({ orderbook: { orderbook_fp: { yes_dollars: [] } }, outcome: "yes", action: "buy", contracts: 1, limitPrice: 0.5, cashAvailable: 10 }), /Both YES and NO/);
  assert.throws(() => simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "buy", contracts: 1, limitPrice: 1, cashAvailable: 10 }), /Limit price/);
  assert.throws(() => simulatePaperLimitOrder({ orderbook, outcome: "no", action: "sell", contracts: 0, limitPrice: 0.4 }), /greater than zero/);
});

test("local paper ledger applies fills, tracks average cost and realized P&L, and blocks shorting", () => {
  const ledger = emptyPaperLedger();
  ledger.initialCash = 100;
  ledger.cash = 100;
  const buy = simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "buy", contracts: 2, limitPrice: 0.5, cashAvailable: ledger.cash });
  applyPaperFills(ledger, { ticker: "TEST-MKT", category: "gas-prices", outcome: "yes", action: "buy", execution: buy, sourceUrl: "https://external-api.demo.kalshi.co/trade-api/v2/markets/TEST-MKT/orderbook" });
  assert.equal(ledger.cash, 99.1);
  assert.equal(ledger.positions["TEST-MKT|yes"].contracts, 2);
  assert.equal(ledger.positions["TEST-MKT|yes"].averagePrice, 0.45);

  const sell = simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "sell", contracts: 1, limitPrice: 0.4 });
  applyPaperFills(ledger, { ticker: "TEST-MKT", category: "gas-prices", outcome: "yes", action: "sell", execution: sell, sourceUrl: "https://external-api.demo.kalshi.co/trade-api/v2/markets/TEST-MKT/orderbook" });
  assert.equal(ledger.cash, 99.5);
  assert.equal(ledger.realizedPnl, -0.05);
  assert.equal(ledger.positions["TEST-MKT|yes"].contracts, 1);

  const oversell = simulatePaperLimitOrder({ orderbook, outcome: "yes", action: "sell", contracts: 2, limitPrice: 0.4 });
  assert.throws(() => applyPaperFills(ledger, { ticker: "TEST-MKT", category: "gas-prices", outcome: "yes", action: "sell", execution: oversell, sourceUrl: "https://external-api.demo.kalshi.co/trade-api/v2/markets/TEST-MKT/orderbook" }), /shorting is disabled/);
});
