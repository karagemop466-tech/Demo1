/* Unified presentation over existing repository artifacts and shared chart/book
 * primitives. Public Kalshi demo reads only: no keys, order submission or fake
 * fills. Official references and limits are documented in summary.html.
 *
 * The saved watchlist is bounded. Polling cannot guarantee delivery of every
 * trade; response pagination is capped and gaps are disclosed. Historical
 * snapshots never become live observations or seed the live alert baseline. */
(function () {
  'use strict';
  var API = 'https://external-api.demo.kalshi.co/trade-api/v2';
  var Core = window.TapeDeskCore, Chart = window.TDChart;
  var TOPICS = [
    { id: 'gas_prices', label: 'Gas prices', cls: 'gas' },
    { id: 'elections', label: 'Elections', cls: 'elections' },
    { id: 'culture', label: 'Culture', cls: 'culture' },
    { id: 'crypto', label: 'Crypto', cls: 'crypto' },
    { id: 'golf', label: 'Golf', cls: 'golf' }
  ];
  var POLL_MS = 20000, MAX_BACKOFF_MS = 300000, MAX_TRADE_PAGES = 3;
  var WINDOWS = { '30s': 30000, '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000 };
  var state = {
    data: null, charts: null, seed: null, ranking: null, rankChecked: 0, rankError: false, rankPending: false, engine: null, selected: null,
    filter: 'all', window: '6h', showAll: false, paused: false, running: false,
    timer: null, backoff: POLL_MS, mode: 'connecting', lastPoll: null,
    liveMarkets: Object.create(null), book: null, candles: Object.create(null),
    alerts: [], modelAlerts: [], seenIds: new Set(), seenQueue: [],
    lastTradeTime: Object.create(null), tradeSince: Math.floor(Date.now() / 1000) - 60,
    truncated: false, skippedTies: 0, errors: [], cleanupChart: null
  };
  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function num(v) { if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && v.trim() === '')) return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function price(v) {
    var n = num(v); if (n === null || n < 0 || n > 1) return '—';
    var s = n.toFixed(4).replace(/0+$/, '');
    if (s.endsWith('.')) s += '00'; else if (s.indexOf('.') >= 0 && s.split('.')[1].length < 2) s += '0';
    return '$' + s;
  }
  function money(v) { var n = num(v); return n === null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function count(v) { var n = num(v); return n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function utc(v) {
    var d = new Date(v); if (!v || !Number.isFinite(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }
  function shortUtc(v) {
    var d = new Date(v); if (!v || !Number.isFinite(d.getTime())) return '—';
    return d.toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
  }
  function topic(id) { return TOPICS.find(function (t) { return t.id === id; }) || { id: id, label: id || '', cls: '' }; }
  function external(url, label) {
    if (!/^https:\/\/(external-api\.demo\.kalshi\.co|demo-api\.kalshi\.co|docs\.kalshi\.com|kalshi\.com)(\/|\?|$)/.test(String(url || ''))) return '';
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>';
  }
  function marketUrl(ticker) { return API + '/markets/' + encodeURIComponent(ticker); }
  function eventUrl(event) { return event ? API + '/events/' + encodeURIComponent(event) : ''; }
  function newsUrl(label) { return 'https://news.google.com/search?q=' + encodeURIComponent(label || ''); }
  function tradeSourceMatches(url, ticker) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' && (u.hostname === 'external-api.demo.kalshi.co' || u.hostname === 'demo-api.kalshi.co') &&
        u.pathname === '/trade-api/v2/markets/trades' && u.searchParams.get('ticker') === ticker;
    } catch (e) { return false; }
  }
  function modelScreen(quote) {
    /* This is an explicitly designed *gross winning-case* screen, not expected
     * ROI. No probability is estimated, and missing inputs fail closed. */
    if (!quote) return null;
    var bid = num(quote.bid), ask = num(quote.ask), vol = num(quote.volume);
    if (bid === null || ask === null || vol === null || bid <= 0 || ask <= 0 || ask > 0.8 || ask < bid || vol < 100) return null;
    if (Math.round((ask - bid) * 10000) > 500) return null;
    return { gross: (1 - ask) / ask, ask: ask, bid: bid, volume: vol };
  }
  function liveQuote(ticker) {
    var r = state.liveMarkets[ticker];
    if (!r || Date.now() - r.at > 90000) return null;
    return { bid: r.market.yes_bid_dollars, ask: r.market.yes_ask_dollars, volume: r.market.volume_24h_fp, url: r.url, at: r.at };
  }
  function onBubble(b) {
    /* The shared engine applies the inclusive $0.10 threshold. It also has its
     * own experimental score; this view never uses that score or its ledger. */
    var w = state.engine && state.engine.watch[b.ticker];
    if (!w || !b.source_url) return;
    var q = liveQuote(b.ticker), screen = modelScreen(q);
    var item = { kind: 'live', ticker: b.ticker, event: w.event_ticker, title: w.title,
      topic: w.topic, before: b.from, after: b.to, delta: b.delta, at: b.t * 1000,
      basis: b.basis === 'last' ? 'poll-to-poll last trade' : 'individual trades',
      src: b.source_url, quoteSrc: q && q.url, quoteAt: q && q.at, screen: screen };
    state.alerts.unshift(item); if (state.alerts.length > 250) state.alerts.pop();
    if (screen) { state.modelAlerts.unshift(item); if (state.modelAlerts.length > 250) state.modelAlerts.pop(); }
  }
  function watchItems() {
    var out = [];
    if (!state.data) return out;
    TOPICS.forEach(function (t) {
      var group = state.data.watchlist[t.id];
      ((group && group.events) || []).forEach(function (event) {
        (event.markets || []).forEach(function (m) { out.push({ topic: t.id, event: event, market: m }); });
      });
    });
    return out;
  }
  function findWatch(ticker) { return watchItems().find(function (row) { return row.market.market_ticker === ticker; }); }
  function formatDelta(delta) { var n = num(delta); return n === null ? '' : (n >= 0 ? '+' : '−') + price(Math.abs(n)); }
  function dateWithAge(v) { return utc(v); }

  async function localJson(path) {
    var r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error('Local data request failed: HTTP ' + r.status);
    return r.json();
  }
  async function request(path) {
    var url = API + path, ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return { url: url, data: await r.json(), at: Date.now() };
    } finally { clearTimeout(timer); }
  }
  function recordError(e) {
    var msg = e && e.message ? e.message : String(e);
    state.errors.unshift(msg); if (state.errors.length > 8) state.errors.pop();
  }
  function rememberTrade(id) {
    if (state.seenIds.has(id)) return false;
    state.seenIds.add(id); state.seenQueue.push(id);
    if (state.seenQueue.length > 10000) state.seenIds.delete(state.seenQueue.shift());
    return true;
  }
  async function fetchTrades() {
    var cursor = '', pages = 0, rows = [], completed = false;
    var pollStart = Math.floor(Date.now() / 1000);
    do {
      var path = '/markets/trades?limit=1000&min_ts=' + Math.max(0, state.tradeSince);
      if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
      var r = await request(path); pages++;
      if (!r.data || !Array.isArray(r.data.trades)) throw new Error('Trades response did not contain a trades array');
      r.data.trades.forEach(function (trade) { rows.push({ row: trade, url: r.url }); });
      cursor = r.data.cursor || '';
      if (!cursor) completed = true;
    } while (cursor && pages < MAX_TRADE_PAGES);
    state.truncated = !completed;
    rows.sort(function (a, b) { return Date.parse(a.row.created_time || '') - Date.parse(b.row.created_time || ''); });
    rows.forEach(function (item) {
      var tr = item.row, t = Date.parse(tr.created_time || ''), p = num(tr.yes_price_dollars);
      if (!tr.trade_id || !state.engine.watch[tr.ticker] || !Number.isFinite(t) || p === null || p < 0 || p > 1) return;
      if (!rememberTrade(String(tr.trade_id))) return;
      var prevT = state.lastTradeTime[tr.ticker];
      /* When prints have the same timestamp their order is unknown. Do not
       * manufacture an order for a second same-time print. */
      if (prevT !== undefined && t <= prevT) { if (t === prevT) state.skippedTies++; return; }
      state.lastTradeTime[tr.ticker] = t;
      state.engine.observe(tr.ticker, p, t / 1000, item.url, 'traded', { count: num(tr.count_fp), side: tr.taker_side || null });
    });
    if (completed) state.tradeSince = Math.max(state.tradeSince, pollStart - 2);
    return r;
  }
  async function fetchMarket(ticker) {
    var r = await request('/markets/' + encodeURIComponent(ticker));
    var m = r.data && r.data.market;
    if (!m || m.ticker !== ticker) throw new Error('Market response missing or ticker mismatch');
    state.liveMarkets[ticker] = { market: m, at: r.at, url: r.url };
    /* previous_price is a one-day comparison, not an observation at this
     * timestamp. Exclude it from the live baseline and the seconds chart. */
    var noDayBaseline = Object.assign({}, m);
    delete noDayBaseline.previous_price_dollars;
    state.engine.ingestMarket(noDayBaseline, r.url, r.at / 1000);
    return r;
  }
  async function fetchBook(ticker) {
    var r = await request('/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=10');
    if (!r.data || !r.data.orderbook_fp) throw new Error('Order-book response missing orderbook_fp');
    if (state.selected === ticker) state.book = { ticker: ticker, book: r.data.orderbook_fp, at: r.at, url: r.url, live: true };
    return r;
  }
  async function fetchCandles(ticker, windowId) {
    if (windowId === '30s') return null;
    var w = state.engine.watch[ticker];
    if (!w || !w.series_ticker) throw new Error('No documented series for selected contract');
    var end = Math.floor(Date.now() / 1000), start = end - Math.ceil(WINDOWS[windowId] / 1000);
    var path = '/series/' + encodeURIComponent(w.series_ticker) + '/markets/' + encodeURIComponent(ticker) +
      '/candlesticks?start_ts=' + start + '&end_ts=' + end + '&period_interval=1';
    var r = await request(path);
    if (!r.data || !Array.isArray(r.data.candlesticks)) throw new Error('Candlestick response missing candles');
    var points = r.data.candlesticks.map(function (c) {
      var p = num(c.price && c.price.close_dollars), t = num(c.end_period_ts);
      return p !== null && p >= 0 && p <= 1 && t !== null ? { ts: t * 1000, price: p, source: r.url } : null;
    }).filter(Boolean);
    state.candles[ticker + '|' + windowId] = { points: points, at: r.at, url: r.url };
    return r;
  }
  async function cycle() {
    if (state.running || state.paused || !state.engine) return;
    state.running = true; if (state.timer) clearTimeout(state.timer);
    if (Date.now() - state.rankChecked >= 120000) refreshRanking();
    // Recheck every watched contract and the historical resolution sample.
    // A finalized status without an actual result is not a confirmed outcome.
    var tickers = Object.keys(state.engine.watch).concat((state.data.resolutions || []).map(function (r) { return r.market_ticker; }));
    tickers = Array.from(new Set(tickers)).filter(function (t) {
      var m = state.liveMarkets[t] && state.liveMarkets[t].market;
      return !m || m.status !== 'finalized' || ['yes', 'no', 'scalar'].indexOf(m.result) < 0;
    });
    var slice = [];
    for (var i = 0; i < Math.min(4, tickers.length); i++) slice.push(tickers[((state.slice || 0) + i) % tickers.length]);
    state.slice = tickers.length ? ((state.slice || 0) + slice.length) % tickers.length : 0;
    var selected = state.selected, win = state.window;
    var tasks = [fetchTrades()].concat(slice.map(fetchMarket));
    if (selected) tasks.push(fetchBook(selected));
    var key = selected + '|' + win, cache = state.candles[key];
    if (selected && win !== '30s' && (!cache || Date.now() - cache.at > 60000)) tasks.push(fetchCandles(selected, win));
    var results = await Promise.allSettled(tasks);
    var allOk = results.every(function (x) { return x.status === 'fulfilled' && x.value !== null; });
    var anyOk = results.some(function (x) { return x.status === 'fulfilled' && x.value !== null; });
    var hasRateError = false;
    results.forEach(function (x) { if (x.status === 'rejected') { recordError(x.reason); if (x.reason && x.reason.status === 429) hasRateError = true; } });
    // A green badge means *all* requests actually attempted in this cycle
    // succeeded, not that every watched market has just been refreshed.
    state.mode = allOk && !state.truncated ? 'live' : anyOk ? 'partial' : 'snapshot';
    state.lastPoll = Date.now();
    state.backoff = state.mode === 'live' && !hasRateError ? POLL_MS : Math.min(MAX_BACKOFF_MS, Math.max(POLL_MS, state.backoff * 2));
    state.running = false;
    render();
    if (!state.paused) state.timer = setTimeout(cycle, state.backoff);
  }
  function scheduleNow() { if (state.timer) clearTimeout(state.timer); if (!state.running && !state.paused) cycle(); }

  function renderStatus() {
    var badge = $('connection'), notice = $('notice');
    var labels = { connecting: 'Connecting', live: 'Live polling', partial: 'Partial data', snapshot: 'Offline / stale', unavailable: 'Data unavailable' };
    badge.className = 'status-badge ' + (state.mode === 'snapshot' || state.mode === 'unavailable' ? 'offline' : state.mode);
    badge.innerHTML = '<i></i> ' + (state.paused ? 'Updates paused' : labels[state.mode]);
    $('last-updated').textContent = state.lastPoll ? 'Last poll ' + utc(state.lastPoll) : state.mode === 'unavailable' ? 'Not monitoring' : 'Checking for live updates…';
    if (state.mode === 'unavailable') {
      notice.hidden = false; notice.innerHTML = 'The watchlist or dashboard libraries could not be loaded. Values are blank; retry or visit the <a href="../site/index.html">source-linked snapshot</a>.';
    } else if (state.paused) {
      notice.hidden = false; notice.innerHTML = 'Updates are paused. Displayed values keep their individual observation times.';
    } else if (state.mode === 'snapshot') {
      notice.hidden = false; notice.innerHTML = 'The demo API could not be reached from this browser. Showing last-observed or dated snapshot values; live monitoring will retry automatically. <a href="review.html#coverage">What this means ↗</a>';
    } else if (state.mode === 'partial') {
      notice.hidden = false; notice.innerHTML = 'Some live requests failed or the trade page cap was reached. Data and alerts may be incomplete; each row shows its own source and observation time. <a href="review.html#coverage">Coverage details ↗</a>';
    } else { notice.hidden = true; }
    $('stat-watch').textContent = state.engine ? String(Object.keys(state.engine.watch).length) : '—';
    $('stat-alerts').textContent = state.engine ? String(state.alerts.length) : '—';
    $('stat-model').textContent = state.engine ? String(state.modelAlerts.length) : '—';
  }
  function renderFilters() {
    var all = [{ id: 'all', label: 'All topics', cls: '' }].concat(TOPICS);
    $('topic-filters').innerHTML = all.map(function (t) {
      return '<button type="button" class="topic-filter' + (state.filter === t.id ? ' active' : '') + '" data-topic="' + esc(t.id) + '" aria-pressed="' + (state.filter === t.id) + '">' +
        (t.cls ? '<span class="topic-dot ' + t.cls + '"></span>' : '') + esc(t.label) + '</button>';
    }).join('');
  }
  function candidateEstimate(event) {
    var markets = event && event.markets;
    if (!Array.isArray(markets) || !markets.length || event.markets_truncated || num(event.markets_count) !== markets.length) return null;
    var total = 0;
    for (var i = 0; i < markets.length; i++) {
      var m = markets[i], last = num(m.last_price_dollars), volume = num(m.volume_24h_fp);
      if (!m.ticker || m.api_url !== marketUrl(m.ticker) || last === null || last < 0 || last > 1 || volume === null || volume < 0) return null;
      total += Math.round(last * volume * 100) / 100;
    }
    total = Math.round(total * 100) / 100;
    var published = num(event.est_usd_volume_24h);
    return published !== null && Math.abs(total - published) < 0.011 ? total : null;
  }
  function renderRanking() {
    var snapshot = state.ranking, body = $('ranking-body');
    if (!snapshot || !snapshot.topics || !Number.isFinite(Date.parse(snapshot.generated_at || ''))) {
      $('ranking-asof').textContent = 'Latest collected ranking unavailable';
      body.innerHTML = '<tr><td colspan="4">No candidates available · ' + external('https://docs.kalshi.com/api-reference/events/get-event', 'Event reference') + '</td></tr>';
      return;
    }
    $('ranking-asof').textContent = 'Collected ' + utc(snapshot.generated_at) + (state.rankError ? ' · latest refresh check failed' : ' · repository snapshot');
    var rows = [];
    TOPICS.forEach(function (t) {
      if (state.filter !== 'all' && state.filter !== t.id) return;
      var key = t.id === 'gas_prices' ? 'gas' : t.id, group = snapshot.topics[key];
      var e = group && Array.isArray(group.top_events) && group.top_events[0];
      if (!e || !e.event_ticker || e.api_url !== eventUrl(e.event_ticker)) {
        rows.push('<tr><td>' + esc(t.label) + '</td><td>—</td><td>Candidate unavailable · <a href="review.html#ranking-limit">flagged</a></td><td>' + external('https://docs.kalshi.com/api-reference/events/get-event', 'Event reference') + '</td></tr>'); return;
      }
      var estimate = candidateEstimate(e);
      var pick = watchItems().find(function (r) { return r.event.event_ticker === e.event_ticker; });
      var name = esc(t.label + ' · ' + (e.title || e.event_ticker));
      rows.push('<tr><td><span class="topic-dot ' + esc(t.cls) + '"></span> ' + (pick ? '<button type="button" class="market-title inline-title" data-select="' + esc(pick.market.market_ticker) + '">' + name + '</button>' : '<strong>' + name + '</strong>') + '<span class="market-ticker">' + esc(e.event_ticker) + (pick ? ' · choose to inspect' : '') + '</span></td>' +
        '<td>' + esc(money(estimate)) + '</td><td>' + (estimate === null ? 'Inputs incomplete · <a href="review.html#ranking-limit">flagged</a>' : 'Saved inputs complete') + '</td><td>' + external(e.api_url, 'Event API') + '</td></tr>');
    });
    body.innerHTML = rows.join('') || '<tr><td colspan="4">No candidates for this topic · ' + external('https://docs.kalshi.com/api-reference/events/get-event', 'Event reference') + '</td></tr>';
  }
  async function refreshRanking() {
    if (state.rankPending) return;
    state.rankPending = true; state.rankChecked = Date.now();
    try {
      var data = await localJson('../docs/data/snapshot.json');
      if (!data || !data.topics || !Number.isFinite(Date.parse(data.generated_at || ''))) throw new Error('Ranking snapshot is invalid');
      state.ranking = data; state.rankError = false;
    } catch (e) { state.rankError = true; recordError(e); }
    finally { state.rankPending = false; renderRanking(); }
  }
  function renderSelect() {
    var sel = $('market-select');
    sel.innerHTML = watchItems().map(function (r) {
      var t = r.market.market_ticker;
      return '<option value="' + esc(t) + '"' + (t === state.selected ? ' selected' : '') + '>' + esc(topic(r.topic).label + ' · ' + t + ' — ' + r.market.title) + '</option>';
    }).join('');
    if (!state.selected) sel.innerHTML = '<option>No selected contract</option>';
  }
  function currentMarket(ticker) {
    var live = state.liveMarkets[ticker], w = findWatch(ticker);
    if (live) return { price: live.market.last_price_dollars, bid: live.market.yes_bid_dollars, ask: live.market.yes_ask_dollars,
      status: live.market.status, result: live.market.result, at: live.at, url: live.url, kind: 'observed' };
    if (!w) return null;
    var s = w.market.snapshot;
    if (!s || !s.sources || s.sources.market !== marketUrl(ticker)) return null;
    return { price: s.last_price, bid: s.yes_bid, ask: s.yes_ask, status: s.status, result: s.result,
      at: state.data.meta.snapshot_generated_utc, url: s.sources.market, kind: 'snapshot' };
  }
  function archivedCandles(ticker, win) {
    if (!state.charts || win === '30s') return null;
    var series = (state.charts.series || []).find(function (s) { return s.market_ticker === ticker; });
    if (!series) return null;
    var bucket = series.windows && series.windows[win === '24h' ? '1h/7d' : '1m/6h'];
    if (!bucket || !bucket.source || bucket.error) return null;
    var now = Date.parse(state.charts.generated_utc);
    if (!Number.isFinite(now)) return null;
    var points = (bucket.points || []).map(function (p) {
      var v = num(p.price_close), t = num(p.t);
      return v !== null && v >= 0 && v <= 1 && t !== null ? { ts: t * 1000, price: v, source: bucket.source } : null;
    }).filter(Boolean).filter(function (p) { return p.ts >= now - WINDOWS[win] && p.ts <= now; });
    return { points: points, at: now, url: bucket.source, snapshot: true, interval: bucket.period_interval_minutes };
  }
  function chartPoints() {
    var ticker = state.selected, win = state.window;
    if (!ticker || !state.engine) return null;
    if (win === '30s') {
      var st = state.engine.markets[ticker], now = Date.now();
      var raw = st ? st.points.filter(function (p) { return p[0] * 1000 >= now - WINDOWS[win]; }) : [];
      var trade = raw.filter(function (p) { return p[2] === 'traded'; });
      var chosen = trade.length ? trade : raw.filter(function (p) { return p[2] === 'last'; });
      var points = chosen.map(function (p) {
        var request = st.requests.slice().reverse().find(function (r) { return r.t === p[0] && r.basis === p[2]; });
        return request && request.url ? { ts: p[0] * 1000, price: p[1], source: request.url } : null;
      }).filter(Boolean);
      return { points: points, at: now, asOf: points.length ? points[points.length - 1].ts : null, url: points.length ? points[points.length - 1].source : '',
        snapshot: false, observed: true, basis: trade.length ? 'individual trades' : 'browser-observed last prices' };
    }
    var live = state.candles[ticker + '|' + win];
    if (live && live.points.length) return { points: live.points, at: Date.now(), asOf: live.at, url: live.url, snapshot: false, interval: 1 };
    return archivedCandles(ticker, win) || (live ? { points: [], at: Date.now(), asOf: live.at, url: live.url, snapshot: false, interval: 1 } : null);
  }
  function adjacentJumps(points, ticker, maxGap) {
    var jumps = [];
    for (var i = 1; i < points.length; i++) {
      if (Number.isFinite(maxGap) && points[i].ts - points[i - 1].ts > maxGap) continue;
      var delta = Math.round((points[i].price - points[i - 1].price) * 10000) / 10000;
      if (Math.abs(Math.round(delta * 10000)) >= 1000) jumps.push({ ts: points[i].ts, price: points[i].price, move: delta, ticker: ticker, from: points[i - 1].price, source: points[i].source });
    }
    return jumps;
  }
  function breakChartGaps(points, end, windowMs, maxGap) {
    // The shared renderer's default gap depends on window size and can bridge
    // absent candles. Keep its axes and hover behavior but limit connections to
    // adjacent candle intervals, or 30 seconds for browser observations.
    var svg = $('chart'), line = svg.querySelector('path[stroke]');
    if (!line || !points.length) return;
    function x(ts) { return 9 + (ts - (end - windowMs)) / windowMs * 89; }
    function y(value) { return 3 + (1 - value) * 88; }
    var d = '', prev = null;
    points.forEach(function (p, i) {
      if (!prev || p.ts - prev.ts > maxGap) d += 'M' + x(p.ts).toFixed(2) + ' ' + y(p.price).toFixed(2);
      else d += 'L' + x(p.ts).toFixed(2) + ' ' + y(prev.price).toFixed(2) + 'L' + x(p.ts).toFixed(2) + ' ' + y(p.price).toFixed(2);
      var beforeGap = !prev || p.ts - prev.ts > maxGap;
      var afterGap = i === points.length - 1 || points[i + 1].ts - p.ts > maxGap;
      if (beforeGap && afterGap) {
        var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', x(p.ts).toFixed(2)); dot.setAttribute('cy', y(p.price).toFixed(2));
        dot.setAttribute('r', '0.7'); dot.setAttribute('fill', '#2c9b69'); svg.appendChild(dot);
      }
      prev = p;
    });
    line.setAttribute('d', d);
  }
  function renderChart() {
    if (!Chart || !state.selected) return;
    var selected = findWatch(state.selected), cm = currentMarket(state.selected);
    $('chart-subtitle').textContent = selected ? selected.market.title.replace(/\*\*/g, '') + ' · ' + state.selected : state.selected;
    $('chart-current').innerHTML = esc(price(cm && cm.price)) + ' <small>USD</small>';
    $('current-price-source').innerHTML = cm && cm.url ? esc(cm.kind === 'snapshot' ? 'Snapshot ' : 'Observed ') + esc(utc(cm.at)) + ' · ' + external(cm.url, 'Market API') : 'Price unavailable · ' + external('https://docs.kalshi.com/api-reference/market/get-market', 'Market reference');
    var p = chartPoints(), basis = $('chart-basis');
    if (!p) { p = { points: [], at: Date.now(), url: '', snapshot: false }; basis.className = 'data-chip'; basis.textContent = 'No history available'; }
    else if (p.snapshot) { basis.className = 'data-chip snapshot'; basis.textContent = 'Archived snapshot'; }
    else if (!p.points.length) { basis.className = 'data-chip'; basis.textContent = 'No observations'; }
    else { basis.className = 'data-chip live'; basis.textContent = p.observed ? 'Observed this session' : 'API candles'; }
    var end = p.at || Date.now(), windowMs = WINDOWS[state.window];
    var points = p.points.filter(function (x) { return Number.isFinite(x.ts) && Number.isFinite(x.price) && x.ts >= end - windowMs && x.ts <= end; }).sort(function (a, b) { return a.ts - b.ts; });
    var maxGap = p.interval ? p.interval * 90000 : 30000;
    var jumps = adjacentJumps(points, state.selected, maxGap);
    if (state.cleanupChart) state.cleanupChart();
    state.cleanupChart = Chart.render($('chart'), { samples: points, now: end, windowId: state.window, jumps: jumps,
      color: '#2c9b69', title: state.selected, readoutEl: $('chart-readout'), emptyText: 'No price observations for this window' });
    $('chart').querySelectorAll('text').forEach(function (label) {
      if (num(label.getAttribute('font-size')) <= 2.4) { label.setAttribute('font-size', '3.3'); label.setAttribute('fill', '#53695d'); }
    });
    breakChartGaps(points, end, windowMs, maxGap);
    $('chart-note').textContent = 'Time (UTC) × YES price ($) · ' + (p.snapshot ? 'snapshot ' + utc(p.at) : p.observed ? p.basis + (p.asOf ? ' · through ' + utc(p.asOf) : '') : p.interval ? p.interval + '-minute candles · fetched ' + utc(p.asOf) : 'no data') + ' · gaps left blank';
    $('chart-source').innerHTML = p.url ? external(p.url, p.snapshot ? 'Snapshot source' : 'Price source') : external('https://docs.kalshi.com/api-reference/market/get-market-candlesticks', 'Chart reference');
    $('chart-readout').textContent = points.length ? 'Hover the chart for an observed price and source.' : 'No official prices available in this window.';
    var last = jumps[jumps.length - 1], jump = $('chart-jump');
    if (last) {
      jump.hidden = false;
      jump.innerHTML = '<strong>Marked move:</strong> ' + esc(formatDelta(last.move)) + ' between adjacent observations · ' + esc(utc(last.ts)) + ' · ' +
        external(last.source, 'Price source') + ' · <a href="' + esc(newsUrl(selected && selected.event.event_title || state.selected)) + '" target="_blank" rel="noopener noreferrer">News search lead ↗</a> <span>(not a verified cause)</span>';
    } else jump.hidden = true;
    document.querySelectorAll('#window-buttons button').forEach(function (b) { var on = b.getAttribute('data-window') === state.window; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function renderBook() {
    var ticker = state.selected, w = findWatch(ticker), b = state.book && state.book.ticker === ticker ? state.book : null;
    if (!b && w && w.market.snapshot.orderbook && !w.market.snapshot.orderbook.error) {
      var s = w.market.snapshot.orderbook;
      b = { ticker: ticker, book: { yes_dollars: s.yes_bids, no_dollars: s.no_bids }, at: state.data.meta.snapshot_generated_utc, url: s.source, live: false };
    }
    var body = $('book-body');
    var expectedBook = ticker && marketUrl(ticker) + '/orderbook';
    if (!b || !b.book || !b.url || !(b.url === expectedBook || b.url.indexOf(expectedBook + '?') === 0)) {
      $('book-status').textContent = 'Order book unavailable or source unverified for this contract.';
      body.innerHTML = '<tr><td colspan="3">No data available · ' + external('https://docs.kalshi.com/api-reference/market/get-market-orderbook', 'Order-book reference') + '</td></tr>';
      return;
    }
    function validLevels(levels) {
      return (Array.isArray(levels) ? levels : []).filter(function (level) {
        var p = num(Array.isArray(level) ? level[0] : level && level.price);
        var size = num(Array.isArray(level) ? level[1] : level && (level.contracts !== undefined ? level.contracts : level.size));
        return p !== null && p >= 0 && p <= 1 && size !== null && size >= 0;
      });
    }
    // The shared book primitive defaults absent size to zero. Filter such levels
    // first: an unreported quantity must never be presented as zero contracts.
    var bids = Core.yesBidLevels(validLevels(b.book.yes_dollars)), asks = Core.impliedYesAsks(validLevels(b.book.no_dollars));
    var rows = asks.slice(0, 5).map(function (l) { return { side: 'YES ask*', cls: 'ask-label', price: l[0], size: l[1] }; })
      .concat(bids.slice(0, 5).map(function (l) { return { side: 'YES bid', cls: 'bid-label', price: l[0], size: l[1] }; }));
    $('book-status').textContent = (b.live ? 'Observed ' : 'Snapshot ') + utc(b.at) + ' · top 5 levels per side';
    body.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr><td>' + esc(price(r.price)) + '</td><td>' + esc(count(r.size)) + '</td><td><span class="' + r.cls + '">' + r.side + '</span> ' + external(b.url, 'API') + '</td></tr>';
    }).join('') : '<tr><td colspan="3">No resting levels returned · ' + external(b.url, 'API') + '</td></tr>';
  }
  function snapshotAlerts() {
    if (!state.seed || !Array.isArray(state.seed.swings)) return [];
    return state.seed.swings.map(function (s) {
      var q = { bid: s.bid, ask: s.ask, volume: s.vol24h };
      return { kind: 'snapshot', ticker: s.ticker, event: s.event_ticker, title: s.title, topic: s.topic,
        before: s.before, after: s.after, delta: s.delta, at: Date.parse(s.ts), basis: '24-hour previous → last', src: s.src,
        quoteSrc: s.src, quoteAt: Date.parse(s.ts), screen: modelScreen(q) };
    }).filter(function (s) {
      var before = num(s.before), after = num(s.after), delta = num(s.delta);
      return s.src === marketUrl(s.ticker) && Number.isFinite(s.at) && before !== null && after !== null && delta !== null &&
        before >= 0 && before <= 1 && after >= 0 && after <= 1 && Math.abs((after - before) - delta) < 1e-6 && Math.abs(delta) >= 0.1 - 1e-9;
    });
  }
  function feedHtml(items, isModel, snapshot) {
    if (!items.length) return '<p class="empty">' + (isModel ? 'No qualifying model signals observed in this view.' : 'No qualifying moves observed in this view.') + '</p>';
    var prefix = snapshot ? '<div class="feed-label">SNAPSHOT · 24-hour change, not a live sudden move</div>' : '<div class="feed-label">OBSERVED THIS SESSION · demo API</div>';
    return prefix + items.map(function (a) {
      var t = topic(a.topic), sign = a.delta >= 0 ? 'up' : 'down';
      return '<article class="feed-item"><div class="feed-item-top"><span class="topic-dot ' + esc(t.cls) + '"></span><span class="feed-topic">' + esc(t.label) + '</span><span>· ' + esc(a.basis) + '</span><span class="feed-time">' + esc(shortUtc(a.at)) + '</span></div>' +
        '<div class="feed-title">' + esc((a.title || a.ticker).replace(/\*\*/g, '')) + '</div><div class="feed-price"><b>' + esc(price(a.before)) + ' → ' + esc(price(a.after)) + '</b> <span class="move ' + sign + '">' + esc(formatDelta(a.delta)) + '</span>' +
        (isModel && a.screen ? '<span>YES win gross ' + (a.screen.gross * 100).toFixed(0) + '% before fees · quote ' + esc(shortUtc(a.quoteAt)) + '</span>' : '') + '</div>' +
        '<div class="feed-links">' + (findWatch(a.ticker) ? '<button type="button" data-select="' + esc(a.ticker) + '">Inspect chart ↑</button>' : '') +
        external(a.src, 'Price API') + (isModel ? external(a.quoteSrc, 'Quote API') : '') + external(eventUrl(a.event), 'Event API') +
        '<a href="' + esc(newsUrl(a.title || a.ticker)) + '" target="_blank" rel="noopener noreferrer">News search (unverified) ↗</a></div></article>';
    }).join('');
  }
  function renderFeeds() {
    if (!state.engine) {
      $('all-count').textContent = $('model-count').textContent = '—';
      $('all-feed').innerHTML = $('model-feed').innerHTML = '<p class="empty">Alert data unavailable. Retry loading the dashboard.</p>';
      return;
    }
    var history = snapshotAlerts(), filter = function (a) { return state.filter === 'all' || a.topic === state.filter; };
    var live = state.alerts.filter(filter), picks = state.modelAlerts.filter(filter);
    var all = live.length ? live : history.filter(filter), model = picks.length ? picks : history.filter(function (a) { return filter(a) && a.screen; });
    $('all-count').textContent = String(live.length); $('model-count').textContent = String(picks.length);
    $('all-feed').innerHTML = feedHtml(all, false, !live.length);
    $('model-feed').innerHTML = feedHtml(model, true, !picks.length);
    $('feed-disclosure').textContent = 'Counters show live observations only. Snapshot examples are 24-hour changes, not sudden live moves. Coverage is limited to the selected watchlist and capped trade pages' + (state.truncated ? ' (the cap was reached on the last poll).' : '.');
  }
  function renderMarkets() {
    var body = $('market-body');
    if (!state.data) { body.innerHTML = '<tr><td colspan="6">Watchlist unavailable · ' + external('https://docs.kalshi.com/api-reference/market/get-markets', 'Markets reference') + '</td></tr>'; return; }
    var html = [], groups = 0, contracts = 0, totalEvents = 0, totalContracts = 0;
    TOPICS.forEach(function (t) {
      if (state.filter !== 'all' && state.filter !== t.id) return;
      var block = state.data.watchlist[t.id], events = block && block.events || [];
      totalEvents += events.length; totalContracts += events.reduce(function (n, e) { return n + (e.markets || []).length; }, 0);
      var shown = state.showAll ? events : events.slice(0, 1);
      shown.forEach(function (ev) {
        groups++;
        html.push('<tr class="event-row"><td colspan="6"><span class="topic-dot ' + esc(t.cls) + '"></span><span class="event-name">' + esc(t.label + ' · ' + (ev.event_title || ev.event_ticker)) + '</span> ' + external(eventUrl(ev.event_ticker), 'Event API') + '</td></tr>');
        (ev.markets || []).forEach(function (m) {
          contracts++;
          var current = currentMarket(m.market_ticker), s = m.snapshot || {}, src = s.sources || {};
          var recordedNotional = num(s.dollar_notional_24h);
          var notional = s.dollar_notional_complete && recordedNotional !== null && recordedNotional >= 0 && tradeSourceMatches(src.dollar_notional_24h, m.market_ticker) ? recordedNotional : null;
          html.push('<tr><td><button type="button" class="market-title" data-select="' + esc(m.market_ticker) + '">' + esc((m.title || '').replace(/\*\*/g, '')) + '</button><span class="market-ticker">' + esc(m.market_ticker) + '</span></td>' +
            '<td class="price-cell">' + esc(price(current && current.price)) + '</td><td>' + esc(money(notional)) + (notional === null ? ' <a href="review.html#ranking-limit">flag</a>' : '') + '</td><td>' + esc(price(current && current.bid)) + ' / ' + esc(price(current && current.ask)) + '</td>' +
            '<td class="time-cell">' + (current ? esc(current.kind === 'snapshot' ? 'Snapshot' : 'Observed') + '<br>' + esc(shortUtc(current.at)) : '— <a href="review.html#coverage">flag</a>') + '</td><td><span class="source-stack">' + external(current && current.url || marketUrl(m.market_ticker), current ? 'Market API' : 'Market reference') + (notional !== null ? external(src.dollar_notional_24h, 'Trades API') : '') + '</span></td></tr>');
        });
      });
    });
    body.innerHTML = html.join('') || '<tr><td colspan="6">No selected watchlist markets · ' + external('https://docs.kalshi.com/api-reference/market/get-markets', 'Markets reference') + '</td></tr>';
    $('market-summary').textContent = 'Showing ' + groups + ' of ' + totalEvents + ' events · ' + contracts + ' of ' + totalContracts + ' contracts';
    $('show-all').textContent = state.showAll ? 'Show fewer events' : 'Show all watchlist events'; $('show-all').setAttribute('aria-expanded', String(state.showAll));
  }
  function renderOutcomes() {
    var saved = (state.data && state.data.resolutions) || [];
    var savedTickers = new Set(saved.map(function (r) { return r.market_ticker; }));
    // Read the latest response rather than the core engine's one-time finalized
    // event: finalized with an empty result must remain eligible for rechecking.
    var latest = Object.keys(state.liveMarkets).map(function (ticker) {
      var r = state.liveMarkets[ticker], m = r.market;
      return { ticker: ticker, result: m.result, status: m.status, source: r.url, at: r.at, label: 'Observed' };
    }).filter(function (r) { return savedTickers.has(r.ticker) || ['closed', 'determined', 'disputed', 'amended', 'finalized'].indexOf(r.status) >= 0; })
      .sort(function (a, b) { return b.at - a.at; });
    saved.forEach(function (r) {
      if (!latest.some(function (x) { return x.ticker === r.market_ticker; })) latest.push({ ticker: r.market_ticker, result: r.snapshot && r.snapshot.result, status: r.snapshot && r.snapshot.status, source: r.snapshot && r.snapshot.sources && r.snapshot.sources.market, at: state.data.meta.snapshot_generated_utc, label: 'Snapshot' });
    });
    $('outcomes').innerHTML = latest.filter(function (r) { return !!external(r.source, 'Market API'); }).slice(0, 5).map(function (r) {
      var result = r.status === 'finalized' && (r.result === 'yes' || r.result === 'no') ? r.result.toUpperCase() : r.status === 'finalized' && r.result === 'scalar' ? 'SCALAR' : 'NOT FINAL';
      return '<tr><td><code>' + esc(r.ticker) + '</code><span class="market-ticker">' + esc(r.label) + ' · ' + esc(shortUtc(r.at)) + '</span></td><td><span class="outcome ' + (result === 'YES' ? 'yes' : result === 'NO' ? 'no' : '') + '">' + result + '</span><span class="market-ticker">' + esc(r.status || 'status unavailable') + '</span></td><td>' + external(r.source, 'Market API') + '</td></tr>';
    }).join('') || '<tr><td colspan="3">No outcomes available · ' + external('https://docs.kalshi.com/getting_started/market_lifecycle', 'Lifecycle reference') + '</td></tr>';
  }
  function render() { renderStatus(); renderFilters(); renderRanking(); renderSelect(); renderChart(); renderBook(); renderFeeds(); renderMarkets(); renderOutcomes(); }
  function selectMarket(ticker) {
    if (!findWatch(ticker)) return;
    state.selected = ticker; state.book = null; renderSelect(); renderChart(); renderBook();
    var section = $('price-chart'); if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scheduleNow();
  }
  function wire() {
    $('topic-filters').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-topic]'); if (!b) return;
      state.filter = b.getAttribute('data-topic');
      var first = watchItems().find(function (r) { return state.filter === 'all' || r.topic === state.filter; });
      if (first && state.filter !== 'all') { state.selected = first.market.market_ticker; state.book = null; }
      render(); scheduleNow();
    });
    $('show-all').addEventListener('click', function () { state.showAll = !state.showAll; renderMarkets(); });
    $('market-select').addEventListener('change', function (e) { selectMarket(e.target.value); });
    $('window-buttons').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-window]'); if (!b) return;
      state.window = b.getAttribute('data-window'); renderChart(); scheduleNow();
    });
    document.addEventListener('click', function (e) { var b = e.target.closest('[data-select]'); if (b) selectMarket(b.getAttribute('data-select')); });
    $('refresh').addEventListener('click', function () {
      state.backoff = POLL_MS;
      if (!state.engine) {
        if (state.timer) clearTimeout(state.timer);
        if (!Core || !Chart) window.location.reload(); else boot();
      } else scheduleNow();
    });
    $('pause').addEventListener('click', function () {
      state.paused = !state.paused; $('pause').textContent = state.paused ? 'Resume updates' : 'Pause updates';
      if (state.paused && state.timer) clearTimeout(state.timer);
      renderStatus(); if (!state.paused) scheduleNow();
    });
  }
  function validWatchlist(data) {
    if (!data || !data.meta || !Number.isFinite(Date.parse(data.meta.snapshot_generated_utc || '')) ||
        !data.watchlist || typeof data.watchlist !== 'object' || Array.isArray(data.watchlist) ||
        (data.resolutions != null && (!Array.isArray(data.resolutions) || !data.resolutions.every(function (r) { return r && typeof r.market_ticker === 'string' && r.market_ticker; })))) return false;
    return Object.keys(data.watchlist).every(function (key) {
      var group = data.watchlist[key];
      return group && Array.isArray(group.events) && group.events.every(function (event) {
        return event && typeof event.event_ticker === 'string' && event.event_ticker && Array.isArray(event.markets) && event.markets.every(function (market) {
          return market && typeof market.market_ticker === 'string' && market.market_ticker && (market.title == null || typeof market.title === 'string') && market.snapshot && typeof market.snapshot === 'object' && !Array.isArray(market.snapshot);
        });
      });
    });
  }
  function bootUnavailable() {
    state.mode = 'unavailable'; state.booting = false; state.data = null; state.engine = null;
    $('paper-asof').textContent = 'Paper data unavailable'; render();
    if (Core && Chart) state.timer = setTimeout(boot, 30000);
  }
  async function boot() {
    if (state.booting) return;
    state.booting = true;
    if (!state.wired) { wire(); state.wired = true; }
    renderFilters();
    var loaded = await Promise.allSettled([
      localJson('../tape-desk/data/watchlist.json'), localJson('../snapshot/charts.json'),
      localJson('../alert-desk/data/seed.json'), localJson('../sim-desk/data/performance.json'),
      localJson('../docs/data/snapshot.json')
    ]);
    if (loaded[0].status !== 'fulfilled' || !validWatchlist(loaded[0].value) || !Core || !Chart) {
      bootUnavailable(); return;
    }
    state.data = loaded[0].value;
    state.charts = loaded[1].status === 'fulfilled' && loaded[1].value && Array.isArray(loaded[1].value.series) ? loaded[1].value : null;
    state.seed = loaded[2].status === 'fulfilled' && loaded[2].value && Array.isArray(loaded[2].value.swings) && loaded[2].value.swings.every(function (s) { return s && typeof s === 'object'; }) ? loaded[2].value : null;
    state.ranking = loaded[4].status === 'fulfilled' ? loaded[4].value : null;
    state.rankChecked = Date.now(); state.rankError = loaded[4].status !== 'fulfilled';
    var meta = Object.assign({}, state.data.meta, { watchlist: state.data.watchlist });
    try { state.engine = Core.createEngine({ meta: meta, threshold: 0.10, hooks: { onBubble: onBubble } }); }
    catch (e) { recordError(e); bootUnavailable(); return; }
    state.selected = Object.keys(state.engine.watch)[0] || null;
    if (loaded[3].status === 'fulfilled' && loaded[3].value.simulated === true && num(loaded[3].value.equity) !== null) {
      $('paper-equity').textContent = money(loaded[3].value.equity);
      $('paper-asof').textContent = 'Paper ledger · ' + dateWithAge(loaded[3].value.updated_ts);
    } else $('paper-asof').textContent = 'Paper result unavailable';
    state.booting = false;
    render(); cycle();
  }
  window.DashboardShell = { state: state, boot: boot, cycle: cycle, modelScreen: modelScreen, adjacentJumps: adjacentJumps };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
