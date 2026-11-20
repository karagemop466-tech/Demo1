(() => {
  'use strict';
  const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
  const DOCS = {
    markets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    orderbook: 'https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks',
    singleBook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
    market: 'https://docs.kalshi.com/api-reference/market/get-market',
    positions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions'
  };
  const LIMIT = 100;
  const PAGE_LIMIT = 5;
  const TRACK_LIMIT = 40;
  const REFRESH_DEFAULT = 60000;
  const keywords = {
    gas: /\b(gas(?:oline)?|natural gas|natgas|petrol|diesel|fuel prices?)\b/i,
    elections: /\b(election|president|presidential|senate|senator|governor|congress|primary|ballot|vote|voting|nominee)\b/i,
    culture: /\b(pop culture|celebrity|entertainment|movie|film|television|\btv\b|music|album|award|grammy|oscar|emmy|box office)\b/i,
    crypto: /\b(crypto|bitcoin|btc|ethereum|\beth\b|solana|dogecoin|token|blockchain)\b/i,
    golf: /\b(golf|pga|lpga|masters tournament|ryder cup|open championship)\b/i
  };
  const labels = { gas: 'Gas prices', elections: 'Elections', culture: 'Culture', crypto: 'Crypto', golf: 'Golf' };
  const requestedTopic = new URLSearchParams(window.location.search).get('topic');
  const initialTopic = Object.prototype.hasOwnProperty.call(labels, requestedTopic) ? requestedTopic : 'all';
  const $ = (s) => document.querySelector(s);
  const state = {
    markets: [], events: [], selectedTicker: '', selected: null, books: new Map(), topic: initialTopic, rank: 'depth',
    watch: readJSON('kalshi-demo-watch-v1', []), history: readJSON('kalshi-demo-history-v1', []), timer: null, fetching: false, loadedPages: 0, cursor: '', hasMore: false
  };
  const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function readJSON(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : fallback; } catch { return fallback; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { setNotice('Browser storage is unavailable or full; watchlist and chart observations may not persist.', 'warning'); } }
  function n(v) { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; }
  function money(v, digits = 2) { const x = n(v); return x === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x); }
  function contracts(v) { const x = n(v); return x === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(x); }
  function safeTime(v) { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); }
  function titleText(m) { return [m.title, m.subtitle, m.yes_sub_title, m.no_sub_title, m.event_ticker, m.ticker].filter(Boolean).join(' '); }
  function category(m) { const haystack = titleText(m); return Object.keys(keywords).find(k => keywords[k].test(haystack)) || ''; }
  function categoryName(k) { return labels[k] || 'Uncategorized'; }
  function statusLabel(m) { const result = String(m.result || '').toLowerCase(); if (result === 'yes' || result === 'no') return `Resolved ${result.toUpperCase()}`; return String(m.status || 'unknown').replaceAll('_', ' '); }
  function sourceLink(url, text) { return `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>`; }
  function setNotice(message, tone = 'info') { const box = $('#data-notice'); if (!box) return; box.className = `notice notice-${tone}`; box.innerHTML = `<span class="notice-icon">${tone === 'error' ? '!' : 'i'}</span><div>${message}</div>`; }
  function setConnection(text, tone = 'neutral') { const el = $('#connection-status'); if (!el) return; el.className = `connection-chip connection-${tone}`; el.innerHTML = `<i></i> ${escapeHTML(text)}`; }
  function currentMarkets() { return state.markets.filter(m => state.topic === 'all' || category(m) === state.topic); }
  async function api(path, signal) {
    const response = await fetch(`${API}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Kalshi demo API returned HTTP ${response.status} for ${path.split('?')[0]}`);
    return response.json();
  }
  function cursorPath(cursor) { const params = new URLSearchParams({ status: 'open', limit: String(LIMIT) }); if (cursor) params.set('cursor', cursor); return `/markets?${params}`; }
  async function fetchMarketPages(reset = true) {
    if (state.fetching) return;
    state.fetching = true;
    if (reset) { state.markets = []; state.books = new Map(); state.loadedPages = 0; state.cursor = ''; state.hasMore = false; $('#market-rows').innerHTML = `<tr><td colspan="9" class="empty-state">Fetching official demo API data…</td></tr>`; }
    setConnection('Connecting to demo API', 'loading');
    try {
      let cursor = reset ? '' : state.cursor;
      let page = 0;
      do {
        const data = await api(cursorPath(cursor));
        const rows = Array.isArray(data.markets) ? data.markets : [];
        state.markets.push(...rows.map(m => ({ ...m, _topic: category(m) })).filter(m => m._topic));
        cursor = data.cursor || '';
        state.loadedPages++;
        page++;
        if (!cursor || page >= PAGE_LIMIT) break;
      } while (true);
      state.cursor = cursor;
      state.hasMore = Boolean(cursor);
      // Remove any duplicate records returned across pages without fabricating missing fields.
      const seen = new Set();
      state.markets = state.markets.filter(m => { if (!m.ticker || seen.has(m.ticker)) return false; seen.add(m.ticker); return true; });
      if (!state.markets.length) {
        setConnection('Connected · no matching open markets', 'ok');
        setNotice('The demo API responded, but no open markets matched the configured topic keywords in the markets loaded so far. Check <a href="pages/methodology.html">topic matching and query scope</a>.', 'warning');
      } else {
        setConnection('Demo API connected', 'ok');
        setNotice(`Public demo market data loaded from Kalshi. Categories are keyword-matched from returned market titles and tickers; this can omit relevant markets or include false positives. <a href="pages/methodology.html">See matching rules and source links ↗</a>`, 'success');
      }
      await loadOrderbooks();
      await reconcileWatchlist();
      recordSelectedPrice();
      render();
      $('#updated-label').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      setConnection('Data unavailable', 'error');
      setNotice(`Could not load verified live data. ${escapeHTML(err.message || 'Network request failed')}. Browser CORS, network policy, or API availability may be responsible; no placeholder data is shown. <a href="${API}/markets?status=open&limit=10" target="_blank" rel="noreferrer">Open the official demo endpoint ↗</a>`, 'error');
      if (!state.markets.length) {
        $('#market-rows').innerHTML = `<tr><td colspan="9" class="empty-state">No live records are displayed because the source request failed.</td></tr>`;
        $('#metric-open').textContent = '—'; $('#metric-events').textContent = '—'; $('#metric-depth').textContent = '—'; $('#metric-depth-label').textContent = 'Source unavailable';
        renderWatchlist(); renderChart(); renderOrderbook();
      }
    } finally { state.fetching = false; }
  }
  async function loadMore() { if (!state.hasMore || state.fetching) return; await fetchMarketPages(false); }
  function orderbookArray(book, side) {
    const fp = book?.orderbook_fp;
    const raw = fp?.[`${side}_dollars`] || book?.orderbook?.[side] || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(level => Array.isArray(level) ? { price: n(level[0]), quantity: n(level[1]) } : { price: n(level.price_dollars ?? level.price), quantity: n(level.quantity_fp ?? level.quantity) }).filter(x => x.price !== null && x.quantity !== null && x.price >= 0 && x.quantity >= 0);
  }
  function bookNotional(book) { return ['yes', 'no'].reduce((total, side) => total + orderbookArray(book, side).reduce((sum, level) => sum + level.price * level.quantity, 0), 0); }
  async function loadOrderbooks() {
    const markets = currentMarkets();
    if (!markets.length) { state.books.clear(); state.bookError = ''; return; }
    state.books = new Map();
    const allBooks = new Map();
    // Official multi-book endpoint accepts 1–100 tickers. Query the market list in documented batches.
    for (let i = 0; i < markets.length; i += 100) {
      const batch = markets.slice(i, i + 100);
      const params = new URLSearchParams(); batch.forEach(m => params.append('tickers', m.ticker));
      try {
        const result = await api(`/markets/orderbooks?${params.toString()}`);
        const rows = Array.isArray(result.orderbooks) ? result.orderbooks : [];
        rows.forEach(book => { if (book.ticker) allBooks.set(book.ticker, book); });
      } catch (err) {
        // Keep all book-derived values blank when endpoint data is unavailable.
        console.warn('Orderbook request failed:', err);
        state.bookError = err.message;
        return;
      }
    }
    state.bookError = '';
    state.books = allBooks;
  }
  function selectMarket(ticker, focus = false) {
    const market = state.markets.find(m => m.ticker === ticker) || state.watch.find(m => m.ticker === ticker);
    if (!market) return;
    state.selectedTicker = ticker; state.selected = market;
    recordSelectedPrice(); render();
    if (focus) document.querySelector('.lower-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function trackMarket(m) {
    const ix = state.watch.findIndex(x => x.ticker === m.ticker);
    if (ix >= 0) { state.watch.splice(ix, 1); }
    else {
      if (state.watch.length >= TRACK_LIMIT) { setNotice(`The browser-local watchlist is limited to ${TRACK_LIMIT} markets. Remove a tracked market before adding another.`, 'warning'); return; }
      state.watch.unshift({ ticker: m.ticker, event_ticker: m.event_ticker || '', title: m.title || m.ticker, _topic: m._topic || category(m), status: m.status || 'open', result: m.result || '', updated_time: m.updated_time || '', yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars });
    }
    saveJSON('kalshi-demo-watch-v1', state.watch); render();
  }
  async function reconcileWatchlist() {
    // Recheck saved markets after page reload to retain them through close/settlement.
    const list = state.watch.slice(0, TRACK_LIMIT);
    const chunkSize = 5;
    for (let i = 0; i < list.length; i += chunkSize) {
      await Promise.all(list.slice(i, i + chunkSize).map(async saved => {
        const listedMarket = state.markets.find(m => m.ticker === saved.ticker);
        const savedCurrent = state.watch.find(x => x.ticker === saved.ticker);
        if (listedMarket) { if (savedCurrent) Object.assign(savedCurrent, listedMarket); return; }
        try {
          const data = await api(`/markets/${encodeURIComponent(saved.ticker)}`);
          const live = data.market || data;
          const current = state.watch.find(x => x.ticker === saved.ticker);
          if (current && live) Object.assign(current, live, { _topic: category(live) || current._topic });
        } catch (err) { console.warn('Tracked market refresh failed:', saved.ticker, err); }
      }));
    }
    saveJSON('kalshi-demo-watch-v1', state.watch);
  }
  function recordSelectedPrice() {
    const m = state.markets.find(x => x.ticker === state.selectedTicker);
    if (!m) return;
    const bid = n(m.yes_bid_dollars), ask = n(m.yes_ask_dollars);
    if (bid === null || ask === null) return;
    const now = Date.now();
    const point = { ticker: m.ticker, time: now, price: (bid + ask) / 2 };
    const last = state.history.filter(x => x.ticker === m.ticker).at(-1);
    if (!last || now - last.time >= 5000) state.history.push(point);
    state.history = state.history.filter(x => now - x.time <= 86400000).slice(-2000);
    saveJSON('kalshi-demo-history-v1', state.history);
  }
  function eventsFromMarkets(markets) {
    const map = new Map();
    markets.forEach(m => {
      const key = m.event_ticker || m.ticker;
      if (!map.has(key)) map.set(key, { key, title: m.title || key, topic: m._topic, markets: [], depth: 0, depthMarkets: 0, volume: 0, volumeCount: 0, oi: 0, oiCount: 0 });
      const e = map.get(key); e.markets.push(m);
      const book = state.books.get(m.ticker);
      if (book) { e.depth += bookNotional(book); e.depthMarkets++; }
      const vol = n(m.volume_24h_fp); if (vol !== null) { e.volume += vol; e.volumeCount++; }
      const oi = n(m.open_interest_fp); if (oi !== null) { e.oi += oi; e.oiCount++; }
    });
    return [...map.values()];
  }
  function metricVal(e, rank) { return rank === 'volume' ? (e.volumeCount ? e.volume : null) : rank === 'oi' ? (e.oiCount ? e.oi : null) : e.depthMarkets ? e.depth : null; }
  function render() {
    const filtered = currentMarkets();
    state.events = eventsFromMarkets(filtered);
    const sorted = [...state.events].sort((a, b) => (metricVal(b, state.rank) ?? -1) - (metricVal(a, state.rank) ?? -1));
    $('#metric-open').textContent = contracts(filtered.length);
    $('#metric-events').textContent = contracts(state.events.length);
    $('#metric-watch').textContent = contracts(state.watch.length);
    const best = sorted.find(e => metricVal(e, 'depth') !== null);
    $('#metric-depth').textContent = best ? money(best.depth) : '—';
    $('#metric-depth-label').textContent = best ? `${best.title} · sampled bid depth` : 'No verified live order-book depth';
    $('#load-more').hidden = !state.hasMore; $('#load-more').disabled = state.fetching;
    const rankDescriptions = { depth: 'Bid depth is calculated as price × contracts across both sides of the returned order books. It is visible bid liquidity, not total event value or a guarantee of execution.', volume: '24h volume is Kalshi-reported contract quantity, summed for the returned markets in an event. It is not a dollar amount.', oi: 'Open interest is Kalshi-reported contract quantity, summed for the returned markets in an event. It is not a dollar amount.' };
    $('#rank-explainer').textContent = rankDescriptions[state.rank];
    const tbody = $('#market-rows');
    if (!sorted.length) tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No open markets matched this topic filter.</td></tr>`;
    else tbody.innerHTML = sorted.slice(0, 120).map(e => {
      const lead = e.markets[0], selected = state.selectedTicker === lead.ticker, watched = state.watch.some(x => x.ticker === lead.ticker);
      const bid = lead.yes_bid_dollars, ask = lead.yes_ask_dollars;
      const eventTitle = lead.title || e.key;
      const depthText = e.depthMarkets ? `${money(e.depth)}${e.depthMarkets < e.markets.length ? '<small>partial book coverage</small>' : ''}` : '—';
      const childRows = e.markets.map(child => { const childTracked = state.watch.some(x => x.ticker === child.ticker); return `<div class="contract-choice"><button class="contract-choice-name" data-select="${escapeHTML(child.ticker)}" type="button">${escapeHTML(child.title || child.ticker)} <small>${escapeHTML(child.ticker)}</small></button><button class="icon-button ${childTracked ? 'tracked' : ''}" data-track="${escapeHTML(child.ticker)}" aria-label="${childTracked ? 'Stop tracking' : 'Track'} ${escapeHTML(child.ticker)}" type="button">${childTracked ? '★' : '☆'}</button></div>`; }).join('');
      return `<tr class="market-row ${selected ? 'row-selected' : ''}"><td><button class="event-title" data-select="${escapeHTML(lead.ticker)}" type="button">${escapeHTML(eventTitle)}</button><div class="subline">${escapeHTML(e.key)} · ${e.markets.length} market${e.markets.length === 1 ? '' : 's'}</div><details class="contract-details"><summary>View and track individual markets</summary><div class="contract-choice-list">${childRows}</div></details></td><td><span class="topic-tag topic-${escapeHTML(e.topic)}">${escapeHTML(categoryName(e.topic))}</span></td><td>${money(bid, 4)}</td><td>${money(ask, 4)}</td><td>${e.volumeCount ? contracts(e.volume) : '—'}<small>contracts</small></td><td>${e.oiCount ? contracts(e.oi) : '—'}<small>contracts</small></td><td>${depthText}</td><td><span class="status-tag status-open">${escapeHTML(statusLabel(lead))}</span></td><td class="row-actions"><button class="icon-button ${watched ? 'tracked' : ''}" data-track="${escapeHTML(lead.ticker)}" aria-label="${watched ? 'Stop tracking' : 'Track'} lead market ${escapeHTML(lead.ticker)}" title="${watched ? 'Stop tracking lead market' : 'Track lead market'}" type="button">${watched ? '★' : '☆'}</button><a class="icon-button" href="${API}/markets/${encodeURIComponent(lead.ticker)}" target="_blank" rel="noreferrer" aria-label="Official market response for ${escapeHTML(eventTitle)}" title="Official market response">↗</a></td></tr>`;
    }).join('');
    if (state.bookError) $('#table-footnote').textContent = `Order-book depth unavailable: ${state.bookError}. Volume and open interest are reported contract counts.`;
    else $('#table-footnote').textContent = `Book depth sums returned levels for ${state.books.size} market(s). Volume / open interest are contracts. ${state.hasMore ? 'More open markets are available; current ranking is incomplete. ' : ''}Loaded ${state.loadedPages} market page(s). Click a title to inspect its lead market.`;
    renderChart(); renderOrderbook(); renderWatchlist();
    document.querySelectorAll('[data-select]').forEach(el => el.addEventListener('click', () => selectMarket(el.dataset.select)));
    document.querySelectorAll('[data-track]').forEach(el => el.addEventListener('click', () => { const market = state.markets.find(m => m.ticker === el.dataset.track); if (market) trackMarket(market); }));
    document.querySelectorAll('[data-untrack]').forEach(el => el.addEventListener('click', () => { const market = state.watch.find(m => m.ticker === el.dataset.untrack); if (market) trackMarket(market); }));
  }
  function renderWatchlist() {
    const body = $('#tracked-rows');
    if (!body) return;
    body.innerHTML = state.watch.length ? state.watch.map(m => {
      const result = String(m.result || '').toLowerCase();
      const resultText = result === 'yes' || result === 'no' ? `RESOLVED ${result.toUpperCase()}` : (m.result ? escapeHTML(m.result) : '—');
      return `<tr><td><b>${escapeHTML(m.title || m.ticker)}</b><div class="subline">${escapeHTML(m.ticker)}</div></td><td>${escapeHTML(categoryName(m._topic))}</td><td><span class="status-tag ${result === 'yes' || result === 'no' ? 'status-open' : 'status-neutral'}">${escapeHTML(statusLabel(m))}</span></td><td>${resultText}</td><td>${escapeHTML(safeTime(m.updated_time || m.last_updated_ts))}</td><td><a href="${API}/markets/${encodeURIComponent(m.ticker)}" target="_blank" rel="noreferrer">Market response ↗</a></td><td><button class="text-button" data-untrack="${escapeHTML(m.ticker)}" type="button">Remove</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-state">No tracked markets yet. Use the star on a market in the table to add it.</td></tr>';
  }
  function renderOrderbook() {
    const market = state.markets.find(m => m.ticker === state.selectedTicker) || state.watch.find(m => m.ticker === state.selectedTicker);
    $('#orderbook-title').textContent = market ? `${market.title || market.ticker} · ${market.ticker}` : 'Choose a market from the table.';
    if (!market) { $('#yes-levels').innerHTML = '<div class="depth-empty">No market selected</div>'; $('#no-levels').innerHTML = '<div class="depth-empty">No market selected</div>'; return; }
    const book = state.books.get(market.ticker);
    if (!book) { $('#yes-levels').innerHTML = '<div class="depth-empty">No reported YES bid levels</div>'; $('#no-levels').innerHTML = '<div class="depth-empty">No reported NO bid levels</div>'; return; }
    ['yes', 'no'].forEach(side => {
      const levels = orderbookArray(book, side).slice().reverse().slice(0, 10);
      const target = $(`#${side}-levels`);
      target.innerHTML = levels.length ? levels.map(level => `<div class="depth-row"><span>${money(level.price, 4)}</span><span>${contracts(level.quantity)}</span><b>${money(level.price * level.quantity, 2)}</b></div>`).join('') : '<div class="depth-empty">No bid levels returned</div>';
    });
  }
  function renderChart() {
    const canvas = $('#price-chart'); if (!canvas) return;
    const selected = state.markets.find(m => m.ticker === state.selectedTicker) || state.watch.find(m => m.ticker === state.selectedTicker);
    const windowMs = Number($('#chart-window').value) * 1000; const now = Date.now();
    const points = state.history.filter(p => p.ticker === state.selectedTicker && now - p.time <= windowMs).sort((a, b) => a.time - b.time);
    $('#chart-subtitle').textContent = selected ? `${selected.title || selected.ticker} · YES bid/ask midpoint` : 'Select an event to plot observed YES midpoint.';
    $('#chart-observations').textContent = `${points.length} observation${points.length === 1 ? '' : 's'}`;
    $('#chart-empty').hidden = points.length > 0;
    const ctx = canvas.getContext('2d'); const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height, pad = { l: 52, r: 14, t: 12, b: 28 };
    ctx.clearRect(0, 0, w, h); ctx.font = '11px Inter, system-ui, sans-serif'; ctx.strokeStyle = '#e8edf0'; ctx.fillStyle = '#82909b'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad.t + (h - pad.t - pad.b) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
    if (!points.length) return;
    const minPrice = Math.max(0, Math.min(...points.map(p => p.price)) - 0.02); const maxPrice = Math.min(1, Math.max(...points.map(p => p.price)) + 0.02); const range = maxPrice - minPrice || 0.01;
    for (let i = 0; i <= 4; i++) { const value = maxPrice - range * i / 4; const y = pad.t + (h - pad.t - pad.b) * i / 4; ctx.fillText(`$${value.toFixed(2)}`, 2, y + 4); }
    const first = points[0].time, last = points.at(-1).time, span = Math.max(1, last - first);
    const xy = p => ({ x: pad.l + (w - pad.l - pad.r) * (p.time - first) / span, y: pad.t + (h - pad.t - pad.b) * (maxPrice - p.price) / range });
    ctx.beginPath(); points.forEach((p, i) => { const q = xy(p); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }); ctx.strokeStyle = '#176b5b'; ctx.lineWidth = 2.5; ctx.stroke();
    const end = xy(points.at(-1)); ctx.fillStyle = '#176b5b'; ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#82909b'; const firstLabel = new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); const lastLabel = new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); ctx.fillText(firstLabel, pad.l, h - 7); ctx.textAlign = 'right'; ctx.fillText(lastLabel, w - pad.r, h - 7); ctx.textAlign = 'left';
  }
  function showWatchlist() {
    const panel = $('#tracked-panel');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!state.watch.length) setNotice('Your browser-local watchlist is empty. Use the star beside a market to track that contract and its reported result.', 'info');
  }
  function wire() {
    $('#refresh-button').addEventListener('click', () => fetchMarketPages(true));
    $('#load-more').addEventListener('click', loadMore);
    $('#show-watchlist').addEventListener('click', showWatchlist);
    $('#hide-watchlist').addEventListener('click', () => { $('#tracked-panel').hidden = true; });
    $('#rank-select').addEventListener('change', e => { state.rank = e.target.value; render(); });
    $('#chart-window').addEventListener('change', renderChart);
    document.querySelectorAll('[data-topic]').forEach(el => {
      el.classList.toggle('selected', el.dataset.topic === state.topic);
      el.addEventListener('click', () => {
        state.topic = el.dataset.topic; document.querySelectorAll('[data-topic]').forEach(b => b.classList.toggle('selected', b === el));
        loadOrderbooks().then(() => { recordSelectedPrice(); render(); });
      });
    });
    $('#refresh-rate').addEventListener('change', e => {
      if (state.timer) clearInterval(state.timer);
      const ms = Number(e.target.value); state.timer = ms ? setInterval(() => fetchMarketPages(true), ms) : null;
    });
    window.addEventListener('resize', renderChart);
    window.addEventListener('storage', e => { if (e.key === 'kalshi-demo-watch-v1') { state.watch = readJSON('kalshi-demo-watch-v1', []); render(); } });
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => fetchMarketPages(true), REFRESH_DEFAULT);
    $('#refresh-rate').value = String(REFRESH_DEFAULT);
  }
  wire(); fetchMarketPages(true);
})();
