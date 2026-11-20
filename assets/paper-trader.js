import {
  applyPaperFills,
  emptyPaperLedger,
  normalizePaperOrderbook,
  paperExecutionLevels,
  simulatePaperLimitOrder,
} from "../src/paper.js";

const STORAGE_KEY = "kalshi-demo-paper-ledger-v1";
const API_ROOTS = [
  "https://external-api.demo.kalshi.co/trade-api/v2",
  "https://demo-api.kalshi.co/trade-api/v2",
];
const CATEGORY_LABELS = {
  "gas-prices": "Gas prices",
  elections: "Elections",
  culture: "Culture",
  crypto: "Crypto",
  golf: "Golf",
};
const $ = (id) => document.getElementById(id);
let ledger = readLedger();
let currentBook = null;
const quoteByTicker = new Map();
const attemptedPositionQuotes = new Set();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function fmtMoney(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(value));
}

function fmtContracts(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
}

function fmtPrice(value) {
  return value === null || value === undefined ? "—" : fmtMoney(value, 4);
}

function fmtTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function categoryLabel(value) {
  return CATEGORY_LABELS[value] ?? "Unlabeled";
}

function readLedger() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPaperLedger();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.positions || !Array.isArray(parsed.orders)) return emptyPaperLedger();
    const initialCash = parsed.initialCash === null ? null : Number(parsed.initialCash);
    const cash = parsed.cash === null ? null : Number(parsed.cash);
    if ((initialCash !== null && (!Number.isFinite(initialCash) || initialCash < 0)) || (cash !== null && (!Number.isFinite(cash) || cash < 0))) return emptyPaperLedger();
    return {
      ...emptyPaperLedger(),
      ...parsed,
      initialCash,
      cash,
      realizedPnl: Number.isFinite(Number(parsed.realizedPnl)) ? Number(parsed.realizedPnl) : 0,
      positions: parsed.positions,
      orders: parsed.orders.slice(0, 500),
    };
  } catch {
    return emptyPaperLedger();
  }
}

function persistLedger() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    setMessage("paper-account-message", "Browser storage is unavailable or full. The paper result was not saved.", true);
    return false;
  }
}

function cloneLedger(value = ledger) {
  return JSON.parse(JSON.stringify(value));
}

function setMessage(id, message, isError = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("message-error", isError);
}

function sourceLink(url, label) {
  return `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function renderAccount() {
  const configured = ledger.initialCash !== null && ledger.cash !== null;
  const initial = $("paper-initial-cash");
  const cash = $("paper-cash");
  const realized = $("paper-realized");
  const positionCount = $("paper-position-count");
  const state = $("paper-ledger-state");
  if (initial) initial.textContent = configured ? fmtMoney(ledger.initialCash) : "—";
  if (cash) cash.textContent = configured ? fmtMoney(ledger.cash) : "—";
  if (realized) realized.textContent = configured ? fmtMoney(ledger.realizedPnl, 4) : "—";
  if (positionCount) positionCount.textContent = configured ? String(Object.keys(ledger.positions).length) : "—";
  if (state) {
    state.textContent = configured ? "Stored in this browser" : "Not configured";
    state.className = `status-pill ${configured ? "status-live" : "status-pending"}`;
  }
  const bankroll = $("paper-bankroll");
  if (bankroll && configured && document.activeElement !== bankroll) bankroll.value = String(ledger.initialCash);
  const accountMessage = $("paper-account-message");
  if (accountMessage && configured && !accountMessage.classList.contains("message-error")) {
    accountMessage.textContent = `Paper account configured with ${fmtMoney(ledger.initialCash)} virtual cash. No Kalshi account is connected.`;
  }
  const submit = $("paper-submit-order");
  if (submit) submit.disabled = !configured;
}

function renderBookRows(bookState) {
  const body = $("paper-book-body");
  if (!body) return;
  const rows = [];
  for (const outcome of ["yes", "no"]) {
    for (const action of ["sell", "buy"]) {
      const levels = paperExecutionLevels(bookState.book, outcome, action).slice(0, 8);
      for (const level of levels) {
        rows.push({
          label: `${outcome.toUpperCase()} ${action === "buy" ? "ask" : "bid"}`,
          price: level.price,
          contracts: level.contracts,
          source: bookState.sourceUrl,
        });
      }
    }
  }
  rows.sort((a, b) => a.price - b.price || a.label.localeCompare(b.label));
  body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td class="num">${fmtPrice(row.price)}</td><td class="num">${fmtContracts(row.contracts)}</td><td>${sourceLink(row.source, "Official demo book")}</td></tr>`).join("") : `<tr><td colspan="4" class="empty-state">The returned book contains no bid levels. No paper fill can be simulated. ${sourceLink(bookState.sourceUrl, "Open official orderbook")}</td></tr>`;
  const timestamp = $("paper-book-timestamp");
  if (timestamp) {
    timestamp.textContent = `Snapshot ${fmtTime(bookState.fetchedAt)}`;
    timestamp.className = "status-pill status-live";
  }
}

function marketUrlFor(ticker) {
  const base = currentBook?.apiRoot ?? API_ROOTS[0];
  return `${base}/markets/${encodeURIComponent(ticker)}`;
}

function renderPositions() {
  const body = $("paper-positions-body");
  if (!body) return;
  const positions = Object.values(ledger.positions).filter((position) => Number(position.contracts) > 0);
  if (!positions.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty-state">No paper positions. The authenticated positions endpoint applies to real accounts: ${sourceLink("https://docs.kalshi.com/api-reference/portfolio/get-positions", "Get Positions documentation")}</td></tr>`;
    return;
  }
  body.innerHTML = positions.map((position) => {
    const key = `${position.ticker}|${String(position.outcome).toLowerCase()}`;
    const cost = Number(position.contracts) * Number(position.averagePrice);
    const quote = quoteByTicker.get(position.ticker);
    let mark = "— (refresh a book)";
    if (quote) {
      try {
        const sellPlan = simulatePaperLimitOrder({
          orderbook: quote.payload,
          outcome: position.outcome,
          action: "sell",
          contracts: position.contracts,
          limitPrice: 0.0001,
        });
        if (sellPlan.remainingContracts <= 1e-8) {
          mark = `${fmtMoney(sellPlan.notional, 4)} · P&amp;L ${fmtMoney(sellPlan.notional - cost, 4)}*`;
        } else {
          mark = "— (visible bid depth is incomplete)";
        }
      } catch {
        mark = "— (book unavailable)";
      }
    }
    return `<tr><td><span class="cell-title">${escapeHtml(categoryLabel(position.category))}</span><span class="cell-sub">${escapeHtml(position.ticker)}</span></td><td>${escapeHtml(String(position.outcome).toUpperCase())}</td><td class="num">${fmtContracts(position.contracts)}</td><td class="num">${fmtPrice(position.averagePrice)}</td><td class="num">${fmtMoney(cost, 4)}</td><td>${mark}</td><td>${sourceLink(marketUrlFor(position.ticker), "Official market")}</td></tr>`;
  }).join("");
  const missingQuotes = positions.filter((position) => !quoteByTicker.has(position.ticker) && !attemptedPositionQuotes.has(position.ticker)).slice(0, 10);
  if (missingQuotes.length) {
    missingQuotes.forEach((position) => attemptedPositionQuotes.add(position.ticker));
    refreshPositionBooks(missingQuotes);
  }
}

function renderOrders() {
  const body = $("paper-orders-body");
  if (!body) return;
  if (!ledger.orders.length) {
    body.innerHTML = `<tr><td colspan="9" class="empty-state">No paper orders yet. The official order-book request is documented at ${sourceLink("https://docs.kalshi.com/api-reference/market/get-market-orderbook", "Get Market Orderbook")}</td></tr>`;
    return;
  }
  body.innerHTML = ledger.orders.slice(0, 100).map((order) => `<tr>
    <td>${escapeHtml(fmtTime(order.timestamp))}</td>
    <td><span class="cell-title">${escapeHtml(categoryLabel(order.category))}</span><span class="cell-sub">${escapeHtml(order.ticker)}</span>${order.strategyTag ? `<span class="cell-sub">Strategy: ${escapeHtml(order.strategyTag)}</span>` : ""}</td>
    <td>${escapeHtml(String(order.action).toUpperCase())} ${escapeHtml(String(order.outcome).toUpperCase())}</td>
    <td class="num">${fmtPrice(order.limitPrice)}</td>
    <td class="num">${fmtContracts(order.requestedContracts)}</td>
    <td class="num">${fmtContracts(order.filledContracts)}</td>
    <td class="num">${fmtPrice(order.averagePrice)}</td>
    <td>${escapeHtml(order.status)}</td>
    <td>${sourceLink(order.sourceUrl, "Demo order book")}</td>
  </tr>`).join("");
}

function analysisLinks(orders) {
  const seen = new Set();
  const links = [];
  for (const order of orders) {
    if (!order.sourceUrl || seen.has(order.sourceUrl)) continue;
    seen.add(order.sourceUrl);
    if (links.length < 3) links.push(sourceLink(order.sourceUrl, escapeHtml(order.ticker)));
  }
  return links.length ? links.join(" · ") : sourceLink("https://docs.kalshi.com/api-reference/market/get-market-orderbook", "Orderbook docs");
}

function renderAnalysis() {
  if (!document.querySelector("[data-paper-view='analysis']")) return;
  const filledOrders = ledger.orders.filter((order) => Number(order.filledContracts) > 0);
  const totalNotional = filledOrders.reduce((sum, order) => sum + Number(order.notional || 0), 0);
  const metricOrders = $("paper-analysis-order-count");
  const metricNotional = $("paper-analysis-notional");
  const metricRealized = $("paper-analysis-realized");
  if (metricOrders) metricOrders.textContent = String(filledOrders.length);
  if (metricNotional) metricNotional.textContent = fmtMoney(totalNotional, 4);
  if (metricRealized) metricRealized.textContent = ledger.initialCash === null ? "—" : fmtMoney(ledger.realizedPnl, 4);

  const categoryBody = $("paper-analysis-categories");
  const strategyBody = $("paper-analysis-strategies");
  const groupOrders = (keyFn) => {
    const grouped = new Map();
    for (const order of filledOrders) {
      const key = keyFn(order) || "Unlabeled";
      const group = grouped.get(key) ?? { key, orders: [], contracts: 0, notional: 0, realized: 0 };
      group.orders.push(order);
      group.contracts += Number(order.filledContracts || 0);
      group.notional += Number(order.notional || 0);
      group.realized += Number(order.realizedPnl || 0);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort((a, b) => b.notional - a.notional);
  };
  const renderGroups = (body, groups) => {
    if (!body) return;
    body.innerHTML = groups.length ? groups.map((group) => `<tr><td>${escapeHtml(group.key)}</td><td class="num">${group.orders.length}</td><td class="num">${fmtContracts(group.contracts)}</td><td class="num">${fmtMoney(group.notional, 4)}</td><td class="num">${fmtMoney(group.realized, 4)}</td><td>${analysisLinks(group.orders)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-state">No simulated fills to analyze. ${sourceLink("https://docs.kalshi.com/api-reference/market/get-market-orderbook", "Orderbook source documentation")}</td></tr>`;
  };
  renderGroups(categoryBody, groupOrders((order) => categoryLabel(order.category)));
  renderGroups(strategyBody, groupOrders((order) => order.strategyTag?.trim() || "No strategy tag"));
}

function renderAll() {
  renderAccount();
  renderPositions();
  renderOrders();
  renderAnalysis();
  if (currentBook) renderBookRows(currentBook);
}

function sourceUrl(root, ticker) {
  return `${root}/markets/${encodeURIComponent(ticker)}/orderbook`;
}

async function fetchBook(ticker) {
  const failures = [];
  for (const root of API_ROOTS) {
    const url = sourceUrl(root, ticker);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const book = normalizePaperOrderbook(payload);
      return { ticker, payload, book, apiRoot: root, sourceUrl: url, fetchedAt: new Date().toISOString() };
    } catch (error) {
      failures.push(`${root.includes("external-api") ? "recommended" : "alternate"}: ${error.message || error}`);
    }
  }
  throw new Error(`Could not fetch the public demo order book. Browser CORS or API availability may block the request. ${failures.join("; ")}`);
}

async function refreshBook(ticker = $("paper-ticker")?.value.trim()) {
  if (!ticker) throw new Error("Enter a market ticker first.");
  const button = $("paper-fetch-book");
  if (button) button.disabled = true;
  setMessage("paper-order-message", `Fetching a fresh public demo order book for ${ticker}…`);
  try {
    currentBook = await fetchBook(ticker);
    quoteByTicker.set(ticker, currentBook);
    renderBookRows(currentBook);
    renderPositions();
    setMessage("paper-order-message", `Fresh visible book loaded at ${fmtTime(currentBook.fetchedAt)}. This is public market data only; no order was sent.`);
    return currentBook;
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshPositionBooks(positions) {
  const unique = [...new Set(positions.map((position) => position.ticker))].slice(0, 10);
  const results = await Promise.allSettled(unique.map((ticker) => fetchBook(ticker)));
  for (const result of results) {
    if (result.status === "fulfilled") quoteByTicker.set(result.value.ticker, result.value);
  }
  renderPositions();
}

function onBankrollSubmit(event) {
  event.preventDefault();
  const input = $("paper-bankroll");
  const amount = Number(input?.value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    setMessage("paper-account-message", "Choose a paper-only starting balance above $0 and at most $1,000,000.", true);
    return;
  }
  if (ledger.initialCash !== null && ledger.orders.length > 0 && !window.confirm("Reset the local paper account? This erases its positions and order log in this browser.")) return;
  const previous = cloneLedger();
  ledger = emptyPaperLedger();
  ledger.initialCash = round(amount);
  ledger.cash = round(amount);
  quoteByTicker.clear();
  attemptedPositionQuotes.clear();
  currentBook = null;
  if (persistLedger()) {
    const message = $("paper-account-message");
    if (message) message.classList.remove("message-error");
    setMessage("paper-account-message", `Paper account started with ${fmtMoney(amount)} virtual cash. No actual account or order was changed.`);
    renderAll();
  } else {
    ledger = previous;
    renderAll();
  }
}

async function onOrderSubmit(event) {
  event.preventDefault();
  if (ledger.initialCash === null || ledger.cash === null) {
    setMessage("paper-order-message", "Set a paper bankroll before simulating a buy or sell.", true);
    return;
  }
  const ticker = $("paper-ticker")?.value.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ticker)) {
    setMessage("paper-order-message", "Enter a ticker using letters, numbers, periods, underscores, and hyphens only.", true);
    return;
  }
  const outcome = $("paper-outcome")?.value;
  const action = $("paper-action")?.value;
  const category = $("paper-category")?.value;
  const contracts = Number($("paper-quantity")?.value);
  const limitPrice = Number($("paper-limit")?.value);
  const strategyTag = $("paper-strategy")?.value.trim() ?? "";
  const existingPosition = ledger.positions[`${ticker}|${outcome}`];
  if (action === "sell" && contracts > Number(existingPosition?.contracts ?? 0) + 1e-9) {
    setMessage("paper-order-message", "A paper sell cannot exceed the local YES/NO position. Short selling is disabled.", true);
    return;
  }
  const submit = $("paper-submit-order");
  if (submit) submit.disabled = true;
  try {
    const bookState = await refreshBook(ticker);
    const execution = simulatePaperLimitOrder({
      orderbook: bookState.payload,
      outcome,
      action,
      contracts,
      limitPrice,
      cashAvailable: action === "buy" ? ledger.cash : undefined,
    });
    const previousLedger = cloneLedger();
    const result = applyPaperFills(ledger, {
      ticker,
      category,
      strategyTag,
      outcome,
      action,
      execution,
      sourceUrl: bookState.sourceUrl,
      timestamp: new Date().toISOString(),
    });
    ledger = result.ledger;
    if (!persistLedger()) {
      ledger = previousLedger;
      renderAll();
      return;
    }
    renderAll();
    const fillMessage = execution.filledContracts > 0
      ? `${fmtContracts(execution.filledContracts)} contracts simulated at a ${fmtPrice(execution.averagePrice)} average for ${fmtMoney(execution.notional, 4)} gross. ${execution.remainingContracts > 0 ? `${fmtContracts(execution.remainingContracts)} remain unfilled.` : ""}`
      : "No visible levels met the limit; the order was logged with no fill.";
    setMessage("paper-order-message", `${result.order.status}. ${fillMessage} This was a local simulation; no Kalshi order was sent.`);
    const accountMessage = $("paper-account-message");
    if (accountMessage) accountMessage.classList.remove("message-error");
  } catch (error) {
    setMessage("paper-order-message", error.message || String(error), true);
  } finally {
    if (submit) submit.disabled = ledger.initialCash === null;
  }
}

function bindPortfolio() {
  $("paper-bankroll-form")?.addEventListener("submit", onBankrollSubmit);
  $("paper-order-form")?.addEventListener("submit", onOrderSubmit);
  $("paper-fetch-book")?.addEventListener("click", async () => {
    try { await refreshBook(); }
    catch (error) { setMessage("paper-order-message", error.message || String(error), true); }
  });
  $("paper-action")?.addEventListener("change", () => {
    const action = $("paper-action").value;
    const ticker = $("paper-ticker").value.trim();
    const outcome = $("paper-outcome").value;
    const position = ledger.positions[`${ticker}|${outcome}`];
    if (action === "sell" && position) $("paper-quantity").max = String(position.contracts);
    else $("paper-quantity").removeAttribute("max");
  });
}

function init() {
  const view = document.querySelector("[data-paper-view]")?.dataset.paperView;
  if (view === "portfolio") bindPortfolio();
  renderAll();
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      ledger = readLedger();
      renderAll();
    }
  });
}

init();
