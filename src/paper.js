const EPSILON = 1e-9;

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readLevels(value, side) {
  if (!Array.isArray(value)) throw new Error(`The ${side} order-book side is missing or malformed.`);
  return value.map((level) => {
    if (!Array.isArray(level) || level.length < 2) throw new Error(`The ${side} order book contains a malformed level.`);
    const price = finiteNumber(level[0]);
    const contracts = finiteNumber(level[1]);
    if (price === null || price < 0 || price > 1 || contracts === null || contracts < 0) {
      throw new Error(`The ${side} order book contains an invalid price or contract count.`);
    }
    return { price, contracts };
  }).filter((level) => level.contracts > 0);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function normalizePaperOrderbook(payload) {
  const book = payload?.orderbook_fp ?? payload?.orderbook;
  if (!book || typeof book !== "object") throw new Error("The response did not contain a market order book.");
  const yes = book.yes_dollars ?? book.yes;
  const no = book.no_dollars ?? book.no;
  if (!Array.isArray(yes) || !Array.isArray(no)) throw new Error("Both YES and NO bid sides are required for a safe paper simulation.");
  return {
    yesBids: readLevels(yes, "YES"),
    noBids: readLevels(no, "NO"),
  };
}

export function paperExecutionLevels(book, outcome, action) {
  if (!book || !Array.isArray(book.yesBids) || !Array.isArray(book.noBids)) {
    throw new Error("A normalized YES/NO order book is required.");
  }
  const side = String(outcome ?? "").toLowerCase();
  const direction = String(action ?? "").toLowerCase();
  if (!(["yes", "no"].includes(side) && ["buy", "sell"].includes(direction))) {
    throw new Error("Choose a YES or NO contract and a buy or sell action.");
  }

  if (direction === "sell") {
    return [...(side === "yes" ? book.yesBids : book.noBids)]
      .sort((a, b) => b.price - a.price)
      .map((level) => ({ ...level, bookSide: `${side.toUpperCase()} bid` }));
  }

  const oppositeBids = side === "yes" ? book.noBids : book.yesBids;
  return oppositeBids
    .map((level) => ({
      price: roundMoney(1 - level.price),
      contracts: level.contracts,
      bookSide: `${side.toUpperCase()} ask (derived from ${side === "yes" ? "NO" : "YES"} bid)`,
    }))
    .sort((a, b) => a.price - b.price);
}

export function simulatePaperLimitOrder({ orderbook, outcome, action, contracts, limitPrice, cashAvailable = Infinity }) {
  const requested = finiteNumber(contracts);
  const limit = finiteNumber(limitPrice);
  const side = String(outcome ?? "").toLowerCase();
  const direction = String(action ?? "").toLowerCase();
  if (requested === null || requested <= 0) throw new Error("Contract quantity must be greater than zero.");
  if (limit === null || limit <= 0 || limit >= 1) throw new Error("Limit price must be greater than $0 and less than $1.");
  if (!(["yes", "no"].includes(side) && ["buy", "sell"].includes(direction))) {
    throw new Error("Choose a YES or NO contract and a buy or sell action.");
  }
  const availableCash = finiteNumber(cashAvailable);
  if (direction === "buy" && (availableCash === null || availableCash < 0)) {
    throw new Error("A valid paper cash balance is required for a simulated buy.");
  }

  const book = normalizePaperOrderbook(orderbook);
  const levels = paperExecutionLevels(book, side, direction);
  let remaining = requested;
  let spentOrReceived = 0;
  const fills = [];
  for (const level of levels) {
    if (direction === "buy" ? level.price > limit + EPSILON : level.price + EPSILON < limit) break;
    if (level.price <= 0 || level.price >= 1) continue;
    let fillContracts = Math.min(level.contracts, remaining);
    if (direction === "buy") {
      const cashLeft = Math.max(0, availableCash - spentOrReceived);
      fillContracts = Math.min(fillContracts, cashLeft / level.price);
    }
    if (fillContracts <= EPSILON) break;
    const notional = roundMoney(fillContracts * level.price);
    fills.push({ price: level.price, contracts: fillContracts, notional, bookSide: level.bookSide });
    spentOrReceived = roundMoney(spentOrReceived + notional);
    remaining = Math.max(0, remaining - fillContracts);
    if (remaining <= EPSILON) {
      remaining = 0;
      break;
    }
    if (direction === "buy" && spentOrReceived >= availableCash - EPSILON) break;
  }

  const filledContracts = roundMoney(fills.reduce((sum, fill) => sum + fill.contracts, 0));
  return {
    fills,
    requestedContracts: requested,
    filledContracts,
    remainingContracts: roundMoney(Math.max(0, requested - filledContracts)),
    notional: roundMoney(spentOrReceived),
    averagePrice: filledContracts > 0 ? roundMoney(spentOrReceived / filledContracts) : null,
    outcome: side,
    action: direction,
    limitPrice: limit,
  };
}

export function emptyPaperLedger() {
  return { version: 1, initialCash: null, cash: null, realizedPnl: 0, positions: {}, orders: [] };
}

export function applyPaperFills(ledger, { ticker, category, strategyTag = "", outcome, action, execution, sourceUrl, timestamp = new Date().toISOString() }) {
  if (!ledger || ledger.version !== 1 || !ledger.positions || !Array.isArray(ledger.orders)) {
    throw new Error("The paper ledger is invalid. Reset the local paper account to continue.");
  }
  if (!ticker || !["yes", "no"].includes(String(outcome).toLowerCase()) || !["buy", "sell"].includes(String(action).toLowerCase())) {
    throw new Error("The paper order is missing a ticker, outcome, or action.");
  }
  const side = String(outcome).toLowerCase();
  const direction = String(action).toLowerCase();
  const key = `${ticker}|${side}`;
  const previous = ledger.positions[key] ?? { ticker, category, outcome: side, contracts: 0, averagePrice: 0 };
  let realizedDelta = 0;

  if (direction === "sell" && execution.filledContracts > previous.contracts + EPSILON) {
    throw new Error("A paper sell cannot exceed the locally held contracts; shorting is disabled.");
  }
  if (direction === "buy" && ledger.cash === null) throw new Error("Start a paper account before simulating a buy.");
  if (direction === "buy" && execution.notional > ledger.cash + EPSILON) throw new Error("The simulated fill exceeds the available paper cash.");

  if (execution.filledContracts > 0) {
    if (direction === "buy") {
      const nextContracts = previous.contracts + execution.filledContracts;
      const totalCost = previous.contracts * previous.averagePrice + execution.notional;
      ledger.positions[key] = {
        ...previous,
        category: category || previous.category,
        strategyTag: strategyTag || previous.strategyTag || "",
        contracts: roundMoney(nextContracts),
        averagePrice: roundMoney(totalCost / nextContracts),
      };
      ledger.cash = roundMoney(ledger.cash - execution.notional);
    } else {
      realizedDelta = roundMoney(execution.fills.reduce((sum, fill) => sum + fill.contracts * (fill.price - previous.averagePrice), 0));
      const remainingContracts = roundMoney(previous.contracts - execution.filledContracts);
      ledger.cash = roundMoney(ledger.cash + execution.notional);
      if (remainingContracts <= EPSILON) delete ledger.positions[key];
      else ledger.positions[key] = { ...previous, contracts: remainingContracts };
      ledger.realizedPnl = roundMoney((ledger.realizedPnl ?? 0) + realizedDelta);
    }
  }

  const order = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    ticker,
    category,
    strategyTag,
    outcome: side,
    action: direction,
    requestedContracts: execution.requestedContracts,
    filledContracts: execution.filledContracts,
    remainingContracts: execution.remainingContracts,
    limitPrice: execution.limitPrice,
    averagePrice: execution.averagePrice,
    notional: execution.notional,
    realizedPnl: realizedDelta,
    fills: execution.fills,
    sourceUrl,
    status: execution.filledContracts === 0 ? "No visible fill" : execution.remainingContracts === 0 ? "Filled (paper)" : "Partially filled (paper)",
  };
  ledger.orders = [order, ...ledger.orders].slice(0, 500);
  return { ledger, order };
}
