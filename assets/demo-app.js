import {
  TOPICS,
  aggregateMarketField,
  classifyEvent,
  eventBookMetric,
  eventDataStatus,
  eventSourceUrl,
  marketBookMetrics,
  marketOutcome,
  marketResolutionLabel,
  openMarkets,
  parseNumber,
  pendingMarkets,
  rankEvents,
  safeDate,
  marketSourceUrl,
  orderbookSourceUrl,
} from "../src/core.js";

const API_ROOTS = [
  "https://external-api.demo.kalshi.co/trade-api/v2",
  "https://demo-api.kalshi.co/trade-api/v2",
];
const CATALOG_REFRESH_MS = 60_000;
const SELECTED_REFRESH_MS = 15_000;
const WATCHLIST_KEY = "kalshi-demo-watchlist-v1";
const SUGGESTIONS_KEY = "kalshi-demo-suggestions-v1";
const RANGE_OPTIONS = {
  "60s": { milliseconds: 60_000, candleMinutes: null, label: "60 seconds" },
  "5m": { milliseconds: 5 * 60_000, candleMinutes: 1, label: "5 minutes" },
  "1h": { milliseconds: 60 * 60_000, candleMinutes: 1, label: "1 hour" },
  "6h": { milliseconds: 6 * 60 * 60_000, candleMinutes: 60, label: "6 hours" },
  "24h": { milliseconds: 24 * 60 * 60_000, candleMinutes: 60, label: "24 hours" },
};

const state = {
  apiRoot: API_ROOTS[0],
  topicId: document.querySelector("main[data-view='markets']")?.dataset.topic ?? "all",
  catalogEvents: [],
  booksByTicker: new Map(),
  marketsByTicker: new Map(),
  watchlist: loadWatchlist(),
  watchData: new Map(),
  historicalMarketTickers: new Set(),
  watchError: "",
  selectedTicker: "",
  selectedRefreshing: false,
  chartRange: "60s",
  chartSamples: new Map(),
  historyCandles: [],
  historyError: "",
  catalogError: "",
  bookErrors: 0,
  catalogLoaded: false,
  loadingCatalog: false,
  lastCatalogAt: null,
  chartRequestId: 0,
  appRoot: document.getElementById("markets-app"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function fmtMoney(value, maximumFractionDigits = 6) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(Number(value));
}

function fmtContracts(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
}

function fmtPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `$${Number(value).toFixed(4)}`;
}

function fmtTimestamp(value, options = {}) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

function fmtClock(value) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function officialLink(url, label) {
  return `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`;
}

function topicLabel(topicId) {
  return TOPICS.find((topic) => topic.id === topicId)?.label ?? topicId;
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const value = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.event_ticker === "string");
  } catch {
    return [];
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state.watchlist));
  } catch {
    state.watchError = "Browser storage is unavailable; watch changes may not persist.";
  }
}

function setConnection(text, kind = "neutral") {
  const label = document.getElementById("connection-text");
  const dot = document.getElementById("connection-dot");
  if (!label || !dot) return;
  label.textContent = text;
  dot.className = `connection-dot${kind === "live" ? " is-live" : kind === "warn" ? " is-warn" : kind === "error" ? " is-error" : ""}`;
}

function setUpdateLabel(text) {
  const label = document.getElementById("updated-at");
  if (label) label.textContent = text;
}

function mountMarketBoard() {
  if (!state.appRoot) return;
  const topicHeading = state.topicId === "all" ? "All requested topics" : topicLabel(state.topicId);
  const intro = state.topicId === "all"
    ? "Events are ranked only when every currently open market has a valid order-book snapshot."
    : `Source-linked demo events tagged for ${topicHeading.toLowerCase()} by the site's disclosed keyword/category filter.`;

  state.appRoot.innerHTML = `
    <div class="connection-bar" role="status" aria-live="polite">
      <span class="connection-state"><span id="connection-dot" class="connection-dot" aria-hidden="true"></span><span id="connection-text">Connecting to Kalshi demo</span></span>
      <span id="updated-at">No API data displayed yet</span>
      <button type="button" id="refresh-catalog" class="action-button">Refresh data</button>
    </div>

    <section class="metric-grid" aria-label="Live dashboard summary">
      <article class="metric-card"><span class="metric-label">Matching unresolved events</span><strong class="metric-value" id="metric-events">—</strong><span class="metric-note">Open / closed with no reported result</span></article>
      <article class="metric-card"><span class="metric-label">Open markets</span><strong class="metric-value" id="metric-markets">—</strong><span class="metric-note">Across matching events</span></article>
      <article class="metric-card"><span class="metric-label">Visible bid notional</span><strong class="metric-value" id="metric-notional">—</strong><span class="metric-note" id="metric-notional-note">Sum of complete open-event books only</span></article>
      <article class="metric-card"><span class="metric-label">Events on this browser's watchlist</span><strong class="metric-value" id="metric-watchlist">${state.watchlist.length}</strong><span class="metric-note">Stored locally; not monitored while closed</span></article>
    </section>

    <section class="section" aria-labelledby="event-list-heading">
      <div class="section-heading"><div><span class="kicker">${escapeHtml(topicHeading)}</span><h2 id="event-list-heading">Live and unresolved events</h2><p>${escapeHtml(intro)}</p></div><a href="requirements.html">Ranking and filter method →</a></div>
      <div class="table-wrap"><table id="event-table">
        <thead><tr><th>Rank</th><th>Topic</th><th>Event / tickers</th><th>State</th><th>Open markets</th><th>Visible bid notional</th><th>24h volume (contracts)</th><th>Open interest (contracts)</th><th>Reported outcomes</th><th>Source</th><th>Actions</th></tr></thead>
        <tbody id="event-table-body"><tr><td colspan="11"><div class="empty-state"><strong>Loading Kalshi demo data</strong>No sample prices or account values are shown while the public API is being checked.</div></td></tr></tbody>
      </table></div>
      <p class="table-note">Dollar ranking = sum of price × contracts at returned YES and NO bid levels for currently open markets. Closed markets can remain visible for resolution tracking but do not contribute current bid depth. Incomplete books are left unranked. “Volume” and “open interest” remain contract counts.</p>
    </section>

    <section class="dashboard-grid section" aria-label="Market chart and order book">
      <article class="card card-pad chart-card">
        <div class="card-heading">
          <div><span class="kicker">Price history</span><h2 id="selected-market-title">Select an open market</h2><p id="selected-market-ticker">No selected ticker</p></div>
          <div class="chart-tools"><label for="chart-market">Market</label><select id="chart-market" aria-label="Select a market for the chart"><option value="">No markets loaded</option></select><label for="chart-range">Window</label><select id="chart-range" aria-label="Select chart time window"><option value="60s">60 seconds</option><option value="5m">5 minutes</option><option value="1h">1 hour</option><option value="6h">6 hours</option><option value="24h">24 hours</option></select></div>
        </div>
        <div class="chart-frame"><canvas id="price-chart" role="img" aria-label="Contract price over time chart">Price chart</canvas></div>
        <div class="chart-caption"><span><span class="legend-dot" aria-hidden="true"></span>Market price in USD per contract</span><span>Y: price · X: timestamp</span><span id="chart-status">Waiting for a market price</span></div>
        <div class="chart-caption"><span id="chart-sampling-note">60-second view uses page-session snapshots; no historical seconds are inferred.</span><span id="chart-source-link"></span></div>
      </article>

      <article class="card card-pad">
        <div class="card-heading"><div><span class="kicker">Current public book</span><h2>Contracts available at each bid</h2><p id="book-market-label">Select an open market to see price levels.</p></div></div>
        <div class="callout success" id="book-summary">Gross visible bid notional: —</div>
        <p class="table-note" id="book-note">The response lists YES and NO bid levels. It does not return separate ask arrays.</p>
        <div class="table-wrap"><table id="book-table"><thead><tr><th>Side</th><th>Price</th><th>Contracts</th><th>Bid notional</th><th>Source</th></tr></thead><tbody id="book-table-body"><tr><td colspan="5"><div class="empty-state"><strong>Order book not loaded</strong>Values will appear only from a valid public snapshot.</div></td></tr></tbody></table></div>
      </article>
    </section>

    <section class="section" aria-labelledby="watchlist-heading">
      <div class="section-heading"><div><span class="kicker">Resolution tracking</span><h2 id="watchlist-heading">Watched events</h2><p>Each market outcome is shown only when Kalshi's market record reports yes or no.</p></div><span class="status-pill">Browser-local watchlist</span></div>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Topic</th><th>Market</th><th>Market status / result</th><th>Settlement time</th><th>Source</th><th>Action</th></tr></thead><tbody id="watch-table-body"><tr><td colspan="7"><div class="empty-state"><strong>No watched events</strong>Use “Watch event” in the event table to follow an event until its markets report an outcome.</div></td></tr></tbody></table></div>
      <p class="table-note" id="watchlist-note">This browser rechecks watched event tickers during refreshes and when a page is revisited. It does not run a background monitor while the browser is closed.</p>
    </section>
  `;

  document.getElementById("refresh-catalog")?.addEventListener("click", () => refreshCatalog());
  document.getElementById("chart-market")?.addEventListener("change", (event) => selectMarket(event.target.value));
  document.getElementById("chart-range")?.addEventListener("change", (event) => {
    state.chartRange = RANGE_OPTIONS[event.target.value] ? event.target.value : "60s";
    state.historyCandles = [];
    state.historyError = "";
    renderSelectedMarket();
    loadHistoricalCandles();
  });
  state.appRoot.addEventListener("click", (event) => {
    const watchButton = event.target.closest("[data-watch-ticker]");
    if (watchButton) {
      toggleWatch(watchButton.dataset.watchTicker);
      return;
    }
    const removeButton = event.target.closest("[data-remove-watch]");
    if (removeButton) {
      removeWatch(removeButton.dataset.removeWatch);
      return;
    }
    const chartButton = event.target.closest("[data-chart-ticker]");
    if (chartButton && chartButton.dataset.chartTicker) {
      selectMarket(chartButton.dataset.chartTicker);
      document.getElementById("price-chart")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

async function requestJson(pathname) {
  let lastError;
  const roots = [state.apiRoot, ...API_ROOTS.filter((root) => root !== state.apiRoot)];
  for (const root of roots) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    try {
      const response = await fetch(`${root}${pathname}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.apiRoot = root;
      return data;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  const message = lastError?.name === "AbortError"
    ? "The Kalshi demo request timed out."
    : "The Kalshi demo API did not return a usable response from either documented host.";
  throw new Error(message);
}

async function fetchEventsByStatus(status) {
  const results = [];
  const seenCursors = new Set();
  let cursor = "";
  do {
    const params = new URLSearchParams({ status, with_nested_markets: "true", limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const response = await requestJson(`/events?${params.toString()}`);
    if (!Array.isArray(response?.events)) throw new Error("The event response did not contain an events array.");
    results.push(...response.events);
    const nextCursor = typeof response.cursor === "string" ? response.cursor : "";
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) throw new Error("The event API repeated a pagination cursor; refresh was stopped.");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (true);
  return results;
}

function filterCatalogEvents(events) {
  const seen = new Map();
  for (const event of events) {
    const ticker = event?.event_ticker;
    if (typeof ticker === "string" && ticker) seen.set(ticker, event);
  }
  return [...seen.values()].filter((event) => classifyEvent(event).length > 0 && pendingMarkets(event).length > 0);
}

function buildMarketIndex(events) {
  state.marketsByTicker.clear();
  for (const event of events) {
    for (const market of Array.isArray(event.markets) ? event.markets : []) {
      if (typeof market?.ticker !== "string" || !market.ticker) continue;
      state.marketsByTicker.set(market.ticker, { market, event });
    }
  }
}

async function fetchBookBatch(tickers) {
  const params = new URLSearchParams();
  for (const ticker of tickers) params.append("tickers", ticker);
  const response = await requestJson(`/markets/orderbooks?${params.toString()}`);
  if (!Array.isArray(response?.orderbooks)) throw new Error("The order-book batch response did not contain an orderbooks array.");
  const fetchedAt = Date.now();
  for (const orderbook of response.orderbooks) {
    if (typeof orderbook?.ticker === "string") state.booksByTicker.set(orderbook.ticker, { ...orderbook, fetchedAt });
  }
}

async function fetchCatalogBooks(events) {
  const tickers = [...new Set(events.flatMap((event) => openMarkets(event)
    .map((market) => market?.ticker)
    .filter((ticker) => typeof ticker === "string" && ticker)))];
  state.booksByTicker.clear();
  state.bookErrors = 0;
  const chunks = [];
  for (let index = 0; index < tickers.length; index += 100) chunks.push(tickers.slice(index, index + 100));
  for (let index = 0; index < chunks.length; index += 2) {
    const group = chunks.slice(index, index + 2);
    const results = await Promise.allSettled(group.map((chunk) => fetchBookBatch(chunk)));
    for (const result of results) if (result.status === "rejected") state.bookErrors += 1;
    setUpdateLabel(chunks.length > 1 ? `Loading visible order books (${Math.min(index + group.length, chunks.length)}/${chunks.length} batches)` : "Loading visible order books");
  }
}

function visibleEvents() {
  if (state.topicId === "all") return state.catalogEvents;
  return state.catalogEvents.filter((event) => classifyEvent(event).includes(state.topicId));
}

function currentOpenMarkets(events = visibleEvents()) {
  const results = [];
  const seen = new Set();
  for (const event of events) {
    for (const market of openMarkets(event)) {
      if (!market?.ticker || seen.has(market.ticker)) continue;
      seen.add(market.ticker);
      results.push({ market, event });
    }
  }
  return results;
}

function getEventMetricText(event) {
  const metric = eventBookMetric(event, state.booksByTicker);
  if (metric.complete) {
    return `<span class="num">${fmtMoney(metric.value)}</span><span class="cell-sub">${metric.coverage}/${metric.total} open books · complete</span>`;
  }
  if (metric.total > 0) {
    return `<span class="num">—</span><span class="cell-sub">Not ranked · ${metric.coverage}/${metric.total} open books returned</span>`;
  }
  return `<span class="num">—</span><span class="cell-sub">No open-market book</span>`;
}

function reportedOutcomes(event) {
  const resolved = (Array.isArray(event.markets) ? event.markets : [])
    .map((market) => ({ market, outcome: marketOutcome(market) }))
    .filter((item) => item.outcome);
  if (!resolved.length) return "—";
  return resolved.slice(0, 3).map(({ market, outcome }) => `${market.ticker}: ${outcome.toUpperCase()}`).join(" · ");
}

function renderMarketRows() {
  const body = document.getElementById("event-table-body");
  if (!body) return;
  if (state.catalogError && !state.catalogLoaded) {
    body.innerHTML = `<tr><td colspan="11"><div class="empty-state"><strong>Live data unavailable</strong>${escapeHtml(state.catalogError)} No sample prices or account values are displayed.</div></td></tr>`;
    return;
  }
  const events = rankEvents(visibleEvents(), state.booksByTicker);
  if (!events.length) {
    const message = state.catalogLoaded
      ? "The demo API returned no matching open or closed, unresolved events for this view. No example markets are substituted."
      : "Loading official demo event data. Values stay blank until a successful API response.";
    body.innerHTML = `<tr><td colspan="11"><div class="empty-state"><strong>No matching event rows yet</strong>${escapeHtml(message)}</div></td></tr>`;
    return;
  }
  let rank = 0;
  body.innerHTML = events.map((event) => {
    const metric = eventBookMetric(event, state.booksByTicker);
    const rankText = metric.complete ? String(++rank) : "—";
    const activeMarkets = openMarkets(event);
    const pending = pendingMarkets(event);
    const volume = aggregateMarketField(activeMarkets, "volume_24h_fp");
    const interest = aggregateMarketField(activeMarkets, "open_interest_fp");
    const topicTags = classifyEvent(event).map((topic) => `<span class="topic-pill">${escapeHtml(topicLabel(topic))}</span>`).join("");
    const tickers = pending.map((market) => market.ticker).filter(Boolean).slice(0, 4).join(", ");
    const status = eventDataStatus(event);
    const statusClass = status.includes("Live") ? "status-live" : status.includes("Resolved") ? "status-resolved" : "status-pending";
    const firstActiveTicker = activeMarkets.find((market) => market?.ticker)?.ticker ?? "";
    const isWatched = state.watchlist.some((item) => item.event_ticker === event.event_ticker);
    const source = eventSourceUrl(state.apiRoot, event.event_ticker);
    const title = event.title || event.sub_title || event.event_ticker;
    const categorySub = [event.category, event.series_ticker].filter(Boolean).join(" · ");
    return `<tr>
      <td class="num">${rankText}</td>
      <td><div class="topic-stack">${topicTags || "—"}</div></td>
      <td><span class="cell-title">${escapeHtml(title)}</span><span class="cell-sub">${escapeHtml(event.event_ticker)}${categorySub ? ` · ${escapeHtml(categorySub)}` : ""}</span><span class="cell-sub">${escapeHtml(tickers || "No unresolved market ticker returned")}</span></td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      <td class="num">${activeMarkets.length}<span class="cell-sub">${pending.length} pending markets</span></td>
      <td>${getEventMetricText(event)}</td>
      <td class="num">${fmtContracts(volume)}</td>
      <td class="num">${fmtContracts(interest)}</td>
      <td>${escapeHtml(reportedOutcomes(event))}</td>
      <td>${officialLink(source, "Event API")}</td>
      <td><div class="action-stack"><button type="button" class="action-button" data-watch-ticker="${escapeHtml(event.event_ticker)}">${isWatched ? "Watching" : "Watch event"}</button>${firstActiveTicker ? `<button type="button" class="action-button" data-chart-ticker="${escapeHtml(firstActiveTicker)}">View chart</button>` : ""}</div></td>
    </tr>`;
  }).join("");
}

function renderMetrics() {
  const events = visibleEvents();
  const eventCount = document.getElementById("metric-events");
  const marketCount = document.getElementById("metric-markets");
  const notional = document.getElementById("metric-notional");
  const note = document.getElementById("metric-notional-note");
  const watchCount = document.getElementById("metric-watchlist");
  if (!eventCount || !marketCount || !notional || !note || !watchCount) return;

  if (!state.catalogLoaded && state.catalogError) {
    eventCount.textContent = "—";
    marketCount.textContent = "—";
    notional.textContent = "—";
    note.textContent = "Unavailable; no cached or sample values";
    watchCount.textContent = String(state.watchlist.length);
    return;
  }

  const completeMetrics = events.map((event) => eventBookMetric(event, state.booksByTicker)).filter((metric) => metric.complete);
  const totalNotional = completeMetrics.reduce((total, metric) => total + metric.value, 0);
  const incompleteWithOpenMarkets = events.filter((event) => {
    const metric = eventBookMetric(event, state.booksByTicker);
    return metric.total > 0 && !metric.complete;
  }).length;
  eventCount.textContent = state.catalogLoaded ? String(events.length) : "—";
  marketCount.textContent = state.catalogLoaded ? String(currentOpenMarkets(events).length) : "—";
  notional.textContent = completeMetrics.length ? fmtMoney(totalNotional) : "—";
  note.textContent = completeMetrics.length
    ? `${completeMetrics.length} complete event books${incompleteWithOpenMarkets ? `; ${incompleteWithOpenMarkets} not ranked` : ""}`
    : "No complete open-event books available";
  watchCount.textContent = String(state.watchlist.length);
}

function allChartMarkets() {
  return currentOpenMarkets().sort((a, b) => {
    const aMetric = eventBookMetric(a.event, state.booksByTicker);
    const bMetric = eventBookMetric(b.event, state.booksByTicker);
    if (aMetric.complete !== bMetric.complete) return aMetric.complete ? -1 : 1;
    if (aMetric.complete && bMetric.complete && aMetric.value !== bMetric.value) return bMetric.value - aMetric.value;
    return String(a.market.ticker).localeCompare(String(b.market.ticker));
  });
}

function renderMarketSelect() {
  const select = document.getElementById("chart-market");
  if (!select) return;
  const options = allChartMarkets();
  if (!options.length) {
    select.innerHTML = '<option value="">No open markets returned</option>';
    select.disabled = true;
    state.selectedTicker = "";
    renderSelectedMarket();
    return;
  }
  select.disabled = false;
  if (!options.some((item) => item.market.ticker === state.selectedTicker)) {
    state.selectedTicker = options[0].market.ticker;
  }
  select.innerHTML = options.map(({ market, event }) => {
    const name = market.title || market.subtitle || market.ticker;
    const prefix = event.title ? `${event.title} — ` : "";
    return `<option value="${escapeHtml(market.ticker)}"${market.ticker === state.selectedTicker ? " selected" : ""}>${escapeHtml(`${prefix}${name}`)}</option>`;
  }).join("");
}

function selectedMarketContext() {
  return state.selectedTicker ? state.marketsByTicker.get(state.selectedTicker) ?? null : null;
}

function sampleMarketPrice(ticker, market, timestamp = Date.now()) {
  const price = parseNumber(market?.last_price_dollars);
  if (price === null) return;
  const samples = state.chartSamples.get(ticker) ?? [];
  const last = samples[samples.length - 1];
  if (last && timestamp <= last.timestamp) timestamp = last.timestamp + 1;
  samples.push({ timestamp, price });
  const oldest = Date.now() - 48 * 60 * 60 * 1000;
  state.chartSamples.set(ticker, samples.filter((sample) => sample.timestamp >= oldest).slice(-6000));
}

function candlestickSourceUrl(context) {
  const range = RANGE_OPTIONS[state.chartRange];
  if (!context || !range || range.candleMinutes === null) return null;
  const seriesTicker = context.event?.series_ticker || context.market?.series_ticker;
  if (!seriesTicker) return null;
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - range.milliseconds) / 1000);
  const params = new URLSearchParams({
    start_ts: String(start),
    end_ts: String(end),
    period_interval: String(range.candleMinutes),
  });
  return `${state.apiRoot}/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(context.market.ticker)}/candlesticks?${params.toString()}`;
}

function renderSelectedMarket() {
  const context = selectedMarketContext();
  const title = document.getElementById("selected-market-title");
  const ticker = document.getElementById("selected-market-ticker");
  const bookLabel = document.getElementById("book-market-label");
  const source = document.getElementById("chart-source-link");
  if (!title || !ticker || !bookLabel || !source) return;
  if (!context) {
    title.textContent = "Select an open market";
    ticker.textContent = "No selected ticker";
    bookLabel.textContent = "Select an open market to see price levels.";
    source.innerHTML = "";
    renderChart();
    renderOrderbook();
    return;
  }
  const { market, event } = context;
  title.textContent = market.title || market.subtitle || market.ticker;
  ticker.textContent = `${market.ticker} · ${event.title || event.event_ticker}`;
  bookLabel.textContent = `${market.ticker} · ${marketResolutionLabel(market)}`;
  const marketUrl = marketSourceUrl(state.apiRoot, market.ticker);
  const orderbookUrl = orderbookSourceUrl(state.apiRoot, market.ticker);
  const candlesUrl = candlestickSourceUrl(context);
  source.innerHTML = `${officialLink(marketUrl, "Market price")} · ${officialLink(orderbookUrl, "Order book")}${candlesUrl ? ` · ${officialLink(candlesUrl, "Candles")}` : ""}`;
  renderChart();
  renderOrderbook();
}

function chartPoints() {
  const range = RANGE_OPTIONS[state.chartRange] ?? RANGE_OPTIONS["60s"];
  const end = Date.now();
  const start = end - range.milliseconds;
  const context = selectedMarketContext();
  if (!context) return [];
  const ticker = context.market.ticker;
  const points = [];
  if (range.candleMinutes !== null) {
    for (const candle of state.historyCandles) {
      if (candle.timestamp >= start && candle.timestamp <= end && candle.price !== null) points.push(candle);
    }
  }
  for (const sample of state.chartSamples.get(ticker) ?? []) {
    if (sample.timestamp >= start && sample.timestamp <= end) points.push(sample);
  }
  const unique = new Map();
  for (const point of points) unique.set(`${point.timestamp}:${point.price}`, point);
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function drawPriceChart() {
  const canvas = document.getElementById("price-chart");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || 640);
  const height = Math.max(220, rect.height || 320);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const points = chartPoints();
  const status = document.getElementById("chart-status");
  if (!points.length) {
    context.fillStyle = "#657575";
    context.font = "14px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("No price snapshots or candles returned yet", width / 2, height / 2);
    if (status) status.textContent = state.historyError || "No confirmed price points in this window";
    return;
  }

  const margin = { left: 64, right: 14, top: 18, bottom: 42 };
  const plotWidth = Math.max(30, width - margin.left - margin.right);
  const plotHeight = Math.max(30, height - margin.top - margin.bottom);
  const range = RANGE_OPTIONS[state.chartRange] ?? RANGE_OPTIONS["60s"];
  const endTime = Date.now();
  const startTime = endTime - range.milliseconds;
  const prices = points.map((point) => point.price);
  let low = Math.min(...prices);
  let high = Math.max(...prices);
  const padding = high === low ? Math.max(Math.abs(high) * 0.04, 0.01) : (high - low) * 0.12;
  low -= padding;
  high += padding;
  if (low === high) high = low + 0.01;

  context.font = "11px system-ui, sans-serif";
  context.lineWidth = 1;
  context.strokeStyle = "#e2ebe6";
  context.fillStyle = "#657575";
  context.textAlign = "right";
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = margin.top + (plotHeight * tick) / 4;
    const value = high - ((high - low) * tick) / 4;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillText(fmtPrice(value), margin.left - 8, y + 4);
  }

  context.textAlign = "center";
  for (let tick = 0; tick <= 4; tick += 1) {
    const timestamp = startTime + (range.milliseconds * tick) / 4;
    const x = margin.left + (plotWidth * tick) / 4;
    const date = new Date(timestamp);
    const label = range.milliseconds <= 5 * 60_000
      ? date.toLocaleTimeString(undefined, { minute: "2-digit", second: "2-digit" })
      : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    context.fillText(label, x, height - 13);
  }

  const xFor = (timestamp) => margin.left + ((timestamp - startTime) / range.milliseconds) * plotWidth;
  const yFor = (price) => margin.top + ((high - price) / (high - low)) * plotHeight;
  context.strokeStyle = "#047857";
  context.lineWidth = 2.4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(point.timestamp);
    const y = yFor(point.price);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  const last = points[points.length - 1];
  context.fillStyle = "#047857";
  context.beginPath();
  context.arc(xFor(last.timestamp), yFor(last.price), 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#162326";
  context.font = "600 12px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(fmtPrice(last.price), Math.min(width - 68, xFor(last.timestamp) + 9), Math.max(14, yFor(last.price) - 9));
  if (status) status.textContent = `${points.length} reported price points · latest ${fmtClock(last.timestamp)}`;
}

function renderChart() {
  const note = document.getElementById("chart-sampling-note");
  const rangeSelect = document.getElementById("chart-range");
  if (rangeSelect && rangeSelect.value !== state.chartRange) rangeSelect.value = state.chartRange;
  if (note) {
    note.textContent = state.chartRange === "60s"
      ? "60-second view: REST snapshots every 15 seconds while this page is open; no historical seconds are inferred."
      : "Historical candles use documented REST intervals when returned; the latest REST snapshot is added separately. Candles may lag the newest quote/trade.";
  }
  drawPriceChart();
}

function renderOrderbook() {
  const body = document.getElementById("book-table-body");
  const summary = document.getElementById("book-summary");
  const context = selectedMarketContext();
  if (!body || !summary) return;
  if (!context) {
    summary.textContent = "Gross visible bid notional: —";
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><strong>No selected market</strong>Select an open market to see a source-linked price ladder.</div></td></tr>';
    return;
  }
  const { market } = context;
  const orderbook = state.booksByTicker.get(market.ticker);
  const metrics = marketBookMetrics(orderbook);
  const source = orderbookSourceUrl(state.apiRoot, market.ticker);
  if (!metrics) {
    summary.textContent = "Gross visible bid notional: — (no valid book snapshot)";
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>Order book unavailable</strong>No valid YES/NO bid snapshot was returned for this market. ${officialLink(source, "Open official orderbook source")}</div></td></tr>`;
    return;
  }
  summary.textContent = `Gross visible bid notional: ${fmtMoney(metrics.visibleBidNotional)} · ${metrics.levels.length} visible price levels · snapshot ${fmtClock(orderbook.fetchedAt ?? state.lastCatalogAt)}`;
  if (!metrics.levels.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state"><strong>Empty visible bid book</strong>The API returned both sides with no bid levels. ${officialLink(source, "Open official orderbook source")}</div></td></tr>`;
    return;
  }
  body.innerHTML = metrics.levels.map((level) => `<tr>
    <td><strong>${escapeHtml(level.side)}</strong></td>
    <td class="num">$${escapeHtml(level.priceRaw)}</td>
    <td class="num">${escapeHtml(level.contractsRaw)}</td>
    <td class="num">${fmtMoney(level.notional)}</td>
    <td>${officialLink(source, "Orderbook API")}</td>
  </tr>`).join("");
}

function updateWatchCount() {
  const count = document.getElementById("metric-watchlist");
  if (count) count.textContent = String(state.watchlist.length);
}

function renderWatchlist() {
  const body = document.getElementById("watch-table-body");
  const note = document.getElementById("watchlist-note");
  if (!body) return;
  if (note && state.watchError) note.textContent = state.watchError;
  if (!state.watchlist.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>No watched events</strong>Use “Watch event” in the event table to follow an event until its markets report an outcome.</div></td></tr>';
    updateWatchCount();
    return;
  }

  const rows = [];
  for (const item of state.watchlist) {
    const event = state.watchData.get(item.event_ticker);
    const eventSource = eventSourceUrl(state.apiRoot, item.event_ticker);
    const topics = Array.isArray(item.topics) && item.topics.length
      ? item.topics.map((id) => topicLabel(id)).join(", ")
      : event ? classifyEvent(event).map(topicLabel).join(", ") : "—";
    const markets = Array.isArray(event?.markets) ? event.markets : [];
    if (!event || !markets.length) {
      rows.push(`<tr>
        <td>${escapeHtml(event?.title || item.title || item.event_ticker)}<span class="cell-sub">${escapeHtml(item.event_ticker)}</span></td>
        <td>${escapeHtml(topics)}</td><td>—</td><td><span class="status-pill status-pending">No current market details returned</span></td><td>—</td>
        <td>${officialLink(eventSource, "Event API")}</td><td><button type="button" class="action-button" data-remove-watch="${escapeHtml(item.event_ticker)}">Remove</button></td>
      </tr>`);
      continue;
    }
    markets.forEach((market, index) => {
      const resultLabel = marketResolutionLabel(market);
      const statusClass = marketOutcome(market) ? "status-resolved" : market.status === "open" ? "status-live" : "status-pending";
      const isHistorical = state.historicalMarketTickers.has(market.ticker);
      const marketUrl = isHistorical
        ? `${state.apiRoot}/historical/markets/${encodeURIComponent(market.ticker)}`
        : marketSourceUrl(state.apiRoot, market.ticker);
      rows.push(`<tr>
        <td>${escapeHtml(event.title || item.title || item.event_ticker)}<span class="cell-sub">${escapeHtml(item.event_ticker)}</span></td>
        <td>${escapeHtml(topics)}</td>
        <td>${escapeHtml(market.title || market.subtitle || market.ticker || "—")}<span class="cell-sub">${escapeHtml(market.ticker || "")}</span></td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(resultLabel)}</span></td>
        <td>${escapeHtml(fmtTimestamp(market.settlement_ts, { year: "numeric" }))}</td>
        <td>${officialLink(marketUrl, isHistorical ? "Historical market API" : "Market API")}</td>
        <td>${index === 0 ? `<button type="button" class="action-button" data-remove-watch="${escapeHtml(item.event_ticker)}">Remove</button>` : ""}</td>
      </tr>`);
    });
  }
  body.innerHTML = rows.join("");
  updateWatchCount();
}

function toggleWatch(eventTicker) {
  const existing = state.watchlist.find((item) => item.event_ticker === eventTicker);
  if (existing) {
    state.watchlist = state.watchlist.filter((item) => item.event_ticker !== eventTicker);
  } else {
    const event = state.catalogEvents.find((candidate) => candidate.event_ticker === eventTicker);
    state.watchlist.push({
      event_ticker: eventTicker,
      title: event?.title || eventTicker,
      category: event?.category || "",
      topics: event ? classifyEvent(event) : [],
      market_tickers: Array.isArray(event?.markets) ? event.markets.map((market) => market?.ticker).filter(Boolean) : [],
    });
  }
  saveWatchlist();
  renderMarketRows();
  renderWatchlist();
  refreshWatchlist();
}

function removeWatch(eventTicker) {
  state.watchlist = state.watchlist.filter((item) => item.event_ticker !== eventTicker);
  state.watchData.delete(eventTicker);
  saveWatchlist();
  renderMarketRows();
  renderWatchlist();
}

async function refreshWatchlist() {
  if (!state.watchlist.length) {
    state.watchData.clear();
    state.historicalMarketTickers.clear();
    state.watchError = "";
    renderWatchlist();
    return;
  }
  state.watchError = "";
  const tickers = state.watchlist.map((item) => item.event_ticker);
  const next = new Map();
  const historicalTickers = new Set();
  for (let index = 0; index < tickers.length; index += 50) {
    const batch = tickers.slice(index, index + 50);
    const params = new URLSearchParams({ tickers: batch.join(","), with_nested_markets: "true", limit: "200" });
    try {
      const response = await requestJson(`/events?${params.toString()}`);
      if (Array.isArray(response?.events)) {
        for (const event of response.events) {
          if (typeof event?.event_ticker === "string") next.set(event.event_ticker, event);
        }
      }
    } catch {
      state.watchError = "Some watched events could not be refreshed. No old response is described as current.";
    }
  }

  for (const item of state.watchlist) {
    const event = next.get(item.event_ticker);
    const returnedMarkets = Array.isArray(event?.markets) ? [...event.markets] : [];
    const returnedTickers = new Set(returnedMarkets.map((market) => market?.ticker).filter(Boolean));
    const savedTickers = Array.isArray(item.market_tickers) ? item.market_tickers : [];
    const missingTickers = savedTickers.filter((ticker) => !returnedTickers.has(ticker));

    for (let index = 0; index < missingTickers.length; index += 10) {
      const batch = missingTickers.slice(index, index + 10);
      const details = await Promise.allSettled(batch.map(async (ticker) => {
        const encodedTicker = encodeURIComponent(ticker);
        try {
          const live = await requestJson(`/markets/${encodedTicker}`);
          if (live?.market) return { market: live.market, historical: false };
        } catch {
          // A market may have moved out of the live dataset; try the official historical endpoint next.
        }
        try {
          const archived = await requestJson(`/historical/markets/${encodedTicker}`);
          if (archived?.market) return { market: archived.market, historical: true };
        } catch {
          // Keep the missing outcome blank if neither official endpoint returns it.
        }
        return null;
      }));
      for (const result of details) {
        if (result.status !== "fulfilled" || !result.value?.market?.ticker) continue;
        const { market, historical } = result.value;
        returnedMarkets.push(market);
        returnedTickers.add(market.ticker);
        if (historical) historicalTickers.add(market.ticker);
      }
    }

    if (event && returnedMarkets.length) {
      event.markets = returnedMarkets;
      next.set(item.event_ticker, event);
    } else if (returnedMarkets.length) {
      next.set(item.event_ticker, {
        event_ticker: item.event_ticker,
        title: item.title || item.event_ticker,
        category: item.category || "",
        markets: returnedMarkets,
      });
    }
    if (missingTickers.some((ticker) => !returnedTickers.has(ticker)) && !state.watchError) {
      state.watchError = "One or more stored market tickers were absent from both live and historical responses; their outcomes remain blank.";
    }
  }
  state.watchData = next;
  state.historicalMarketTickers = historicalTickers;
  if (!state.watchError) state.watchError = "Watched tickers were checked against Kalshi's demo event / market endpoints; this watchlist remains local to this browser.";
  renderWatchlist();
}

async function loadHistoricalCandles() {
  const requestId = ++state.chartRequestId;
  const context = selectedMarketContext();
  const range = RANGE_OPTIONS[state.chartRange];
  if (!context || !range || range.candleMinutes === null) {
    state.historyCandles = [];
    state.historyError = "";
    renderChart();
    return;
  }
  const seriesTicker = context.event?.series_ticker || context.market?.series_ticker;
  if (!seriesTicker) {
    state.historyCandles = [];
    state.historyError = "Series ticker not returned; historical candles unavailable.";
    renderChart();
    return;
  }
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - range.milliseconds) / 1000);
  const params = new URLSearchParams({
    start_ts: String(start),
    end_ts: String(end),
    period_interval: String(range.candleMinutes),
  });
  state.historyError = "Loading documented REST candlesticks…";
  renderChart();
  try {
    const response = await requestJson(`/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(context.market.ticker)}/candlesticks?${params.toString()}`);
    if (requestId !== state.chartRequestId || context.market.ticker !== state.selectedTicker) return;
    const candles = Array.isArray(response?.candlesticks) ? response.candlesticks : [];
    state.historyCandles = candles.map((candle) => ({
      timestamp: Number(candle?.end_period_ts) * 1000,
      price: parseNumber(candle?.price?.close_dollars),
    })).filter((candle) => Number.isFinite(candle.timestamp) && candle.price !== null);
    state.historyError = state.historyCandles.length ? "" : "No historical candle values returned for this window.";
  } catch {
    if (requestId !== state.chartRequestId) return;
    state.historyCandles = [];
    state.historyError = "Historical candles unavailable; no values were substituted.";
  }
  renderChart();
}

function selectMarket(ticker) {
  if (!ticker || !state.marketsByTicker.has(ticker)) return;
  state.selectedTicker = ticker;
  state.historyCandles = [];
  state.historyError = "";
  sampleMarketPrice(ticker, state.marketsByTicker.get(ticker).market, state.lastCatalogAt ?? Date.now());
  renderMarketSelect();
  renderSelectedMarket();
  loadHistoricalCandles();
  refreshSelectedMarket();
}

async function refreshSelectedMarket() {
  const context = selectedMarketContext();
  if (!context) return;
  const ticker = context.market.ticker;
  if (marketOutcome(context.market) || context.market.status === "settled") {
    renderSelectedMarket();
    return;
  }
  const marketPath = `/markets/${encodeURIComponent(ticker)}`;
  const bookPath = `/markets/${encodeURIComponent(ticker)}/orderbook`;
  const results = await Promise.allSettled([requestJson(marketPath), requestJson(bookPath)]);
  const timestamp = Date.now();
  if (results[0].status === "fulfilled" && results[0].value?.market) {
    const updated = results[0].value.market;
    const latestContext = state.marketsByTicker.get(ticker) ?? context;
    state.marketsByTicker.set(ticker, { market: { ...latestContext.market, ...updated }, event: latestContext.event });
    sampleMarketPrice(ticker, updated, timestamp);
  }
  if (results[1].status === "fulfilled" && results[1].value?.orderbook_fp) {
    state.booksByTicker.set(ticker, { ticker, orderbook_fp: results[1].value.orderbook_fp, fetchedAt: timestamp });
  }
  if (results[0].status === "rejected" && results[1].status === "rejected") {
    state.historyError = "Latest market and book snapshots could not be refreshed; previous chart points are retained.";
  }
  renderSelectedMarket();
  renderMarketRows();
}

function renderAll() {
  renderMetrics();
  renderMarketRows();
  renderMarketSelect();
  renderSelectedMarket();
  renderWatchlist();
}

async function refreshCatalog() {
  if (state.loadingCatalog) return;
  state.loadingCatalog = true;
  state.catalogError = "";
  setConnection("Checking Kalshi demo public market data", "neutral");
  setUpdateLabel("Fetching open and closed event pages…");
  try {
    const [openEvents, closedEvents] = await Promise.all([
      fetchEventsByStatus("open"),
      fetchEventsByStatus("closed"),
    ]);
    const events = filterCatalogEvents([...openEvents, ...closedEvents]);
    state.catalogEvents = events;
    buildMarketIndex(events);
    await fetchCatalogBooks(events);
    state.catalogLoaded = true;
    state.lastCatalogAt = Date.now();
    const openCount = events.reduce((total, event) => total + openMarkets(event).length, 0);
    const failedBookBatches = state.bookErrors;
    setConnection(
      failedBookBatches ? `Demo events refreshed · ${failedBookBatches} book batch(es) unavailable` : `Demo REST data refreshed · ${state.apiRoot.includes("external-api") ? "recommended host" : "supported fallback host"}`,
      failedBookBatches ? "warn" : "live",
    );
    setUpdateLabel(`Browser fetch completed ${fmtClock(state.lastCatalogAt)} · ${events.length} matching events · ${openCount} open markets`);
    renderAll();
    if (state.selectedTicker && !state.marketsByTicker.has(state.selectedTicker)) state.selectedTicker = "";
    if (!state.selectedTicker) {
      const first = currentOpenMarkets().find(({ market }) => market?.ticker);
      if (first) {
        state.selectedTicker = first.market.ticker;
        sampleMarketPrice(first.market.ticker, first.market, state.lastCatalogAt);
        renderMarketSelect();
        renderSelectedMarket();
        loadHistoricalCandles();
      }
    }
    await refreshWatchlist();
    if (state.selectedTicker) refreshSelectedMarket();
  } catch (error) {
    state.catalogError = error instanceof Error ? error.message : "The Kalshi demo catalog could not be refreshed.";
    setConnection(state.lastCatalogAt ? "Refresh failed · showing the last successful snapshot (stale)" : "Kalshi demo data unavailable · no values displayed", "error");
    setUpdateLabel(state.lastCatalogAt ? `Last successful fetch ${fmtClock(state.lastCatalogAt)}` : "No successful API response yet");
    renderAll();
  } finally {
    state.loadingCatalog = false;
  }
}

function initSuggestions() {
  const table = document.getElementById("suggestion-table");
  if (!table) return;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY) || "{}") || {};
  } catch {
    saved = {};
  }
  const labels = { approve: "Approved for next design pass", defer: "Deferred", reject: "Rejected" };
  const render = () => {
    for (const row of table.querySelectorAll("tbody tr[data-suggestion]")) {
      const id = row.dataset.suggestion;
      const decision = saved[id];
      const stateLabel = row.querySelector(".decision-state");
      if (stateLabel) stateLabel.textContent = decision ? labels[decision] ?? "No decision" : "No decision";
      for (const button of row.querySelectorAll("[data-decision]")) {
        const selected = button.dataset.decision === decision;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
    }
  };
  table.addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]");
    const row = button?.closest("tr[data-suggestion]");
    if (!button || !row) return;
    saved[row.dataset.suggestion] = button.dataset.decision;
    try {
      localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(saved));
      const message = document.getElementById("decision-message");
      if (message) message.textContent = "Decision saved in this browser only; no code or trade setting has changed.";
    } catch {
      const message = document.getElementById("decision-message");
      if (message) message.textContent = "Browser storage is unavailable; this choice may not persist.";
    }
    render();
  });
  document.getElementById("clear-decisions")?.addEventListener("click", () => {
    saved = {};
    try { localStorage.removeItem(SUGGESTIONS_KEY); } catch { /* best-effort local cleanup */ }
    const message = document.getElementById("decision-message");
    if (message) message.textContent = "Local review choices were cleared; nothing was deployed or changed.";
    render();
  });
  render();
}

if (state.appRoot) {
  mountMarketBoard();
  refreshCatalog();
  window.setInterval(refreshCatalog, CATALOG_REFRESH_MS);
  window.setInterval(refreshSelectedMarket, SELECTED_REFRESH_MS);
  window.addEventListener("resize", renderChart);
}
initSuggestions();
