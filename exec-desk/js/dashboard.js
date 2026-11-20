/* Dashboard logic — live topic ranking, price chart (seconds/minutes/hours), liquidity depth.
   All reads are unauthenticated public endpoints (S4). Polling instead of WebSocket because
   the official WS handshake requires signed headers (S5). */
(function () {
  const K = window.KALSHI, C = window.KALSHI_CHART, CFG = K.CFG;
  const TOPICS = Object.keys(CFG.topics);

  const S = {
    topic: "gas",
    rank: "dvol",
    seriesByTopic: null,     // {topic: [series]} after classification
    eventsCache: {},         // topic -> {ts, events[]}
    selected: null,          // {ticker, seriesTicker, title, eventTitle}
    tf: "seconds",
    samples: [],             // [{t,p}] seconds-mode ring buffer
    candles: [],             // minutes/hours mode candle points
    quote: null, market: null,
    timers: { quote: null, book: null, candles: null, topic: null },
    seq: 0
  };

  const $ = id => document.getElementById(id);
  const base = () => CFG.demoRest;

  /* ---------- connection banner ---------- */
  function banner() {
    const el = $("conn-banner"); if (!el) return;
    const st = K.state;
    if (st.transport === "direct") {
      el.className = "banner ok"; el.hidden = false;
      el.innerHTML = "<b>LIVE</b> — reading the official demo API directly (<span class='mono'>" + base() + "</span>). Last success: " + K.ago(st.lastOk) + ".";
    } else if (st.transport === "relay") {
      el.className = "banner"; el.hidden = false;
      el.innerHTML = "<b>LIVE via flagged relay</b> — the browser blocked direct access, so responses are forwarded by a third party while still targeting the official API. See <a href='flagged.html'>UNVERIFIED-01 / UNVERIFIED-03</a>.";
    } else if (st.transport === "unavailable") {
      el.className = "banner err"; el.hidden = false;
      el.innerHTML = "<b>BLOCKED</b> — neither direct access nor the flagged relay reached the official API. Values stay blank (never guessed). Details: <a href='flagged.html'>UNVERIFIED-01</a>. Last error: <span class='mono'>" + K.esc(st.lastError || "") + "</span>";
    } else { el.hidden = true; }
  }
  K.onStatus(banner);

  /* ---------- topic + series + events ---------- */
  function renderTopicSeg() {
    $("topic-seg").innerHTML = TOPICS.map(t =>
      '<button data-t="' + t + '"' + (t === S.topic ? ' class="on"' : "") + ">" + CFG.topics[t].label + "</button>").join("");
  }

  async function loadSeries() {
    const all = await K.getPaged("/series", { include_volume: "true" }, "series", 3);
    const by = {}; TOPICS.forEach(t => by[t] = []);
    all.forEach(s => { const t = K.topicOf(s); if (t) by[t].push(s); });
    TOPICS.forEach(t => by[t].sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0)));
    S.seriesByTopic = by;
  }

  /* For each topic take its highest-volume series (up to 6) and pull their open events
     with nested markets. status=open filter: S8. */
  async function loadTopicEvents(topic) {
    const series = (S.seriesByTopic || {})[topic] || [];
    const top = series.slice(0, 6);
    // Parallel: one round trip per series instead of serial waits (first paint sooner).
    const results = await Promise.all(top.map(s =>
      K.get("/events", { series_ticker: s.ticker, status: "open", with_nested_markets: "true", limit: 200 })
        .catch(() => null) // keep partial results; banner already reflects transport
    ));
    const events = [];
    results.forEach(d => { if (d) (d.events || []).forEach(e => events.push(e)); });
    S.eventsCache[topic] = { ts: Date.now(), events, series };
  }

  function topicMarkets() {
    const c = S.eventsCache[S.topic]; if (!c) return [];
    const out = [];
    c.events.forEach(e => (e.markets || []).forEach(m => out.push({
      m, e, seriesTicker: e.series_ticker,
      title: (e.title || "") + " — " + (m.yes_sub_title || m.ticker)
    })));
    return out;
  }

  function metricOf(m) {
    if (S.rank === "dvol") return K.dollarVolume24h(m);
    if (S.rank === "oi") return K.openInterestDollars(m);
    return K.num(m.notional_value_dollars);
  }

  function renderRankNote() {
    const notes = {
      dvol: "Ranking metric: 24h dollar volume = volume_24h_fp × last_price_dollars (computed — the API has no dollar-volume field, UNVERIFIED-04).",
      oi: "Ranking metric: open interest in dollars = open_interest_fp × last_price_dollars (computed, UNVERIFIED-04).",
      notional: "Ranking metric: official notional_value_dollars field from the Market schema."
    };
    $("rank-note").textContent = notes[S.rank];
  }

  function renderTable() {
    const tb = $("top-table").querySelector("tbody");
    const rows = topicMarkets()
      .map(r => ({ r, v: metricOf(r.m) }))
      .filter(x => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .slice(0, CFG.topN);
    $("topic-title").textContent = CFG.topics[S.topic].label;
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="12" class="empty">No matching live markets found for this topic ' +
        '(or the API is unreachable — see banner). Keyword classifier: <a href="flagged.html">UNVERIFIED-06</a>.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map((x, i) => {
      const m = x.r.m, e = x.r.e;
      const bid = K.price(m.yes_bid_dollars), ask = K.price(m.yes_ask_dollars);
      const api = base() + "/markets/" + encodeURIComponent(m.ticker);
      return '<tr data-ticker="' + K.esc(m.ticker) + '" style="cursor:pointer"' +
        (S.selected && S.selected.ticker === m.ticker ? ' class="on-row"' : "") + ">" +
        "<td>" + (i + 1) + "</td>" +
        "<td><b>" + K.esc(e.title || "") + "</b><br><span class='meta'>" + K.esc(m.yes_sub_title || "") + "</span></td>" +
        '<td class="mono">' + K.esc(m.ticker) + "</td>" +
        "<td>" + K.statusBadge(m.status) + "</td>" +
        '<td class="num">' + (K.price(m.last_price_dollars) || "—") + "</td>" +
        '<td class="num">' + (bid || "—") + " / " + (ask || "—") + "</td>" +
        '<td class="num">' + (K.qty(m.volume_24h_fp) || "—") + "</td>" +
        '<td class="num">' + (K.usd(x.r && K.dollarVolume24h(m)) || "—") + "</td>" +
        '<td class="num">' + (K.usd(K.openInterestDollars(m)) || "—") + "</td>" +
        '<td class="num">' + (K.usd(m.notional_value_dollars) || "—") + "</td>" +
        "<td>" + K.resultMap(m.result) + "</td>" +
        '<td class="src"><a href="' + K.esc(api) + '" target="_blank" rel="noopener">API</a> · ' +
        '<a href="' + CFG.sources.markets + '" target="_blank" rel="noopener">schema</a></td></tr>';
    }).join("");
    tb.querySelectorAll("tr[data-ticker]").forEach(tr => tr.addEventListener("click", () => selectMarket(tr.dataset.ticker)));
  }

  /* ---------- selection ---------- */
  async function selectMarket(ticker) {
    const rec = topicMarkets().find(x => x.m.ticker === ticker);
    if (!rec) return;
    S.selected = { ticker, seriesTicker: rec.seriesTicker, title: rec.title, eventTitle: rec.e.title };
    S.samples = []; S.candles = []; S.quote = null; S.market = null;
    $("sel-title").textContent = ticker + " — " + rec.title;
    renderTable();
    startLoops();
    await refreshQuote(); await refreshBook(); await refreshCandles();
  }

  /* ---------- loops ---------- */
  function clearLoops() { Object.values(S.timers).forEach(t => t && clearInterval(t)); S.timers = {}; }
  function startLoops() {
    clearLoops(); if (!S.selected) return;
    S.timers.quote = setInterval(refreshQuote, S.tf === "seconds" ? CFG.pollQuote : CFG.pollBook);
    S.timers.book = setInterval(refreshBook, CFG.pollBook);
    if (S.tf === "minutes") S.timers.candles = setInterval(refreshCandles, 60000);
    if (S.tf === "hours") S.timers.candles = setInterval(refreshCandles, 600000);
    S.timers.topic = setInterval(async () => {
      try { await loadTopicEvents(S.topic); renderTable(); } catch (e) {}
    }, 45000);
  }

  async function refreshQuote() {
    if (!S.selected) return;
    try {
      const data = await K.get("/markets/" + encodeURIComponent(S.selected.ticker));
      const m = data.market; if (!m) return;
      S.market = m;
      const p = K.midPrice(m);
      if (p !== null && S.tf === "seconds") {
        S.samples.push({ t: Date.now() / 1000, p });
        const cutoff = Date.now() / 1000 - 300;
        S.samples = S.samples.filter(s => s.t >= cutoff);
      }
      $("quote-meta").textContent = "quote as of " + K.ago(K.state.lastOk) + " · mid " + (p !== null ? "$" + p.toFixed(4) : "—");
      drawPrice(); renderLiquidityKpis();
    } catch (e) { /* banner handles */ }
  }

  async function refreshBook() {
    if (!S.selected) return;
    try {
      const data = await K.get("/markets/" + encodeURIComponent(S.selected.ticker) + "/orderbook");
      const fp = data.orderbook_fp || {};
      drawDepth(fp.yes_dollars || [], fp.no_dollars || []);
      renderDepthStats(fp.yes_dollars || [], fp.no_dollars || []);
    } catch (e) { /* banner handles */ }
  }

  async function refreshCandles() {
    if (!S.selected || S.tf === "seconds") return;
    const period = S.tf === "minutes" ? 1 : 60;
    const windowSec = S.tf === "minutes" ? 3600 : 7 * 86400;
    try {
      const data = await K.get(
        "/series/" + encodeURIComponent(S.selected.seriesTicker) +
        "/markets/" + encodeURIComponent(S.selected.ticker) + "/candlesticks", {
          start_ts: Math.floor(Date.now() / 1000 - windowSec),
          end_ts: Math.floor(Date.now() / 1000),
          period_interval: period
        });
      const cs = data.candlesticks || [];
      S.candles = cs.map(c => ({
        t: c.end_period_ts,
        p: K.num(c.price && c.price.close_dollars) !== null ? K.num(c.price.close_dollars)
          : (K.num(c.yes_bid && c.yes_bid.close_dollars) !== null && K.num(c.yes_ask && c.yes_ask.close_dollars) !== null
             ? (K.num(c.yes_bid.close_dollars) + K.num(c.yes_ask.close_dollars)) / 2 : null)
      })).filter(x => x.p !== null).sort((a, b) => a.t - b.t);
      $("chart-src").innerHTML = "Candles from <span class='mono'>GET " +
        K.esc("/series/{series}/markets/{ticker}/candlesticks?period_interval=" + period) +
        "</span> — <a href='" + CFG.sources.candles + "' target='_blank' rel='noopener'>official docs</a>. Close price in USD.";
      drawPrice();
    } catch (e) {
      $("chart-src").innerHTML = "<span class='badge unv'>candles unavailable</span> see <a href='flagged.html'>Flagged</a>";
    }
  }

  /* ---------- drawing ---------- */
  function drawPrice() {
    const mode = S.tf;
    if (mode === "seconds") {
      $("tf-note").textContent = "Seconds: client-sampled mid price every " + (CFG.pollQuote / 1000) + "s from GET /markets/{ticker} (no official sub-minute series — UNVERIFIED-07). Window: last 5 minutes.";
      $("chart-src").innerHTML = "Samples from <span class='mono'>GET " + K.esc("/markets/{ticker}") +
        "</span> — <a href='" + CFG.sources.markets + "' target='_blank' rel='noopener'>official docs</a>.";
      C.line($("price-chart"), S.samples, { mode: "seconds", title: "YES mid price (sampled)" });
    } else {
      $("tf-note").textContent = mode === "minutes"
        ? "Minutes: official 1-minute candles over the last 60 minutes."
        : "Hours: official 1-hour candles over the last 7 days.";
      C.line($("price-chart"), S.candles, { mode: mode === "minutes" ? "minutes" : "hours", title: "YES close price (candles)" });
    }
  }
  function drawDepth(yesBids, noBids) { C.depth($("depth-chart"), yesBids, noBids); }

  function renderDepthStats(yesBids, noBids) {
    const bids = yesBids.map(r => ({ p: Number(r[0]), q: Number(r[1]) }));
    const asks = noBids.map(r => ({ p: 1 - Number(r[0]), q: Number(r[1]) })).filter(r => r.p > 0 && r.p < 1);
    const bestB = bids.length ? bids.reduce((a, b) => b.p > a.p ? b : a) : null;
    const bestA = asks.length ? asks.reduce((a, b) => b.p < a.p ? b : a) : null;
    $("k-bid").textContent = bestB ? "$" + bestB.p.toFixed(2) : "—";
    $("k-bid-q").textContent = bestB ? K.qty(bestB.q) + " contracts" : "";
    $("k-ask").textContent = bestA ? "$" + bestA.p.toFixed(2) : "—";
    $("k-ask-q").textContent = bestA ? K.qty(bestA.q) + " contracts (implied)" : "";
    $("k-spread").textContent = (bestB && bestA) ? "$" + (bestA.p - bestB.p).toFixed(2) : "—";
    const mid = (bestB && bestA) ? (bestA.p + bestB.p) / 2 : null;
    let d = null;
    if (mid !== null) {
      d = bids.filter(r => r.p >= mid - 0.05 && r.p <= mid + 0.05).reduce((s, r) => s + r.q, 0) +
          asks.filter(r => r.p >= mid - 0.05 && r.p <= mid + 0.05).reduce((s, r) => s + r.q, 0);
    }
    $("k-depth").textContent = d === null ? "—" : K.qty(d);
  }

  function renderLiquidityKpis() { /* KPI cards are driven by the book; quote drives the meta line */ }

  /* ---------- events ---------- */
  function wire() {
    $("topic-seg").addEventListener("click", async ev => {
      const b = ev.target.closest("button[data-t]"); if (!b) return;
      S.topic = b.dataset.t; renderTopicSeg();
      $("top-table").querySelector("tbody").innerHTML = '<tr><td colspan="12" class="empty">Loading…</td></tr>';
      try {
        if (!S.eventsCache[S.topic] || Date.now() - S.eventsCache[S.topic].ts > 45000) await loadTopicEvents(S.topic);
        renderTable(); $("asof").textContent = "events fetched " + K.ago(new Date(S.eventsCache[S.topic].ts).toISOString());
      } catch (e) { renderTable(); }
    });
    $("rank-seg").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-rank]"); if (!b) return;
      S.rank = b.dataset.rank;
      $("rank-seg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      renderRankNote(); renderTable();
    });
    $("tf-seg").addEventListener("click", async ev => {
      const b = ev.target.closest("button[data-tf]"); if (!b) return;
      S.tf = b.dataset.tf;
      $("tf-seg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      startLoops();
      drawPrice();
      if (S.tf !== "seconds") await refreshCandles();
      if (S.tf === "seconds") drawPrice();
    });
    $("btn-refresh").addEventListener("click", async () => {
      try { await loadTopicEvents(S.topic); renderTable(); $("asof").textContent = "events fetched " + K.ago(new Date().toISOString()); } catch (e) {}
      if (S.selected) { await refreshQuote(); await refreshBook(); await refreshCandles(); }
    });
    window.addEventListener("resize", () => { drawPrice(); });
  }

  async function init() {
    renderTopicSeg(); wire(); renderRankNote(); banner();
    try { await loadSeries(); } catch (e) { /* banner */ }
    try {
      await loadTopicEvents(S.topic);
      renderTable();
      $("asof").textContent = "events fetched " + K.ago(new Date(S.eventsCache[S.topic].ts).toISOString());
      // auto-select the top-ranked market so the page is live on arrival
      const first = $("top-table").querySelector("tr[data-ticker]");
      if (first) await selectMarket(first.dataset.ticker);
    } catch (e) { renderTable(); }
    setInterval(banner, 5000);
  }
  init();
})();
