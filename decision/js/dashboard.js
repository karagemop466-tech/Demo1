/* Live dashboard logic. Public demo API only; snapshot fallback when unreachable. */
(function () {
  'use strict';
  var K = window.KALSHI, S = window.SITE, C = window.CHARTS;

  var state = {
    allowlist: K.buildAllowlist([]),
    allRows: [],           // all enriched topic events
    events: [],            // topic-filtered view
    topic: 'all',
    rankBy: 'est',
    selEvent: null,
    selMarket: null,
    windowMode: 'live',
    lastSourceUrl: null,
    seriesLoaded: false,
    timers: { events: null, book: null, ticks: null }
  };

  function srcLink(url, label) {
    return '<a href="' + K.esc(url) + '" target="_blank" rel="noreferrer">' + (label || 'API ↗') + '</a>';
  }

  /* ---------- allowlist from official series taxonomy (once per load) ----- */
  function loadAllowlist() {
    var calls = [
      K.publicGetAll('/series', { category: 'Crypto' }, 4, 200),
      K.publicGetAll('/series', { category: 'Elections' }, 6, 200),
      K.publicGetAll('/series', { category: 'Culture' }, 2, 200),
      K.publicGetAll('/series', { category: 'Entertainment' }, 3, 200),
      K.publicGetAll('/series', { tags: 'Golf' }, 4, 200),
      K.publicGetAll('/series', { category: 'Economics' }, 12, 200) // gas lives under Economics (verified)
    ];
    return Promise.all(calls).then(function (res) {
      var all = [].concat.apply([], res);
      state.allowlist = K.buildAllowlist(all);
      state.seriesLoaded = true;
    }).catch(function (e) {
      state.allowlist = K.buildAllowlist([]);
      state.seriesLoaded = false;
      console.warn('series discovery failed, using verified seed allowlist:', e.message);
    });
  }

  /* ---------- events ----------------------------------------------------- */
  function enrichEvents(allEvents) {
    return allEvents.filter(function (ev) {
      return state.allowlist[ev.series_ticker] || K.classifySeries({ category: ev.category, categories: [], tags: [], ticker: ev.series_ticker, title: ev.title });
    }).map(function (ev) {
      var markets = ev.markets || [];
      var topic = state.allowlist[ev.series_ticker] || K.classifySeries({ category: ev.category, categories: [], tags: [], ticker: ev.series_ticker, title: ev.title });
      var vol = 0, volAny = false, oi = 0, oiAny = false;
      markets.forEach(function (m) {
        var v = K.fp(m.volume_fp), o = K.fp(m.open_interest_fp);
        if (v !== null) { vol += v; volAny = true; }
        if (o !== null) { oi += o; oiAny = true; }
      });
      var est = K.estimateEventDollars(markets);
      var closes = markets.map(function (m) { return m.close_time; }).filter(Boolean).sort();
      var mktStatuses = {};
      markets.forEach(function (m) { mktStatuses[m.status] = true; });
      return {
        ev: ev, topic: topic, markets: markets,
        vol: volAny ? vol : null, oi: oiAny ? oi : null, est: est,
        closes: closes.length ? closes[0] : null,
        statuses: Object.keys(mktStatuses).join(', ') || '',
        sourceUrl: K.BASE + '/events?status=open&with_nested_markets=true&series_ticker=' + encodeURIComponent(ev.series_ticker)
      };
    });
  }

  function renderEvents() {
    var rows = state.events.slice();
    rows.sort(function (a, b) {
      if (state.rankBy === 'est') {
        var av = a.est === null ? -1 : a.est, bv = b.est === null ? -1 : b.est;
        if (bv !== av) return bv - av;
      }
      var av2 = a.vol === null ? -1 : a.vol, bv2 = b.vol === null ? -1 : b.vol;
      return bv2 - av2;
    });
    var tbody = document.getElementById('events-rows');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty">No live events matched the five topics right now. (Verified demo data — the blank is real: nothing matched, nothing was invented.)</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r, i) {
      var ev = r.ev;
      var topicLabel = r.topic ? r.topic.charAt(0).toUpperCase() + r.topic.slice(1) : '';
      var sel = state.selEvent && state.selEvent.ev.event_ticker === ev.event_ticker ? ' class="active"' : '';
      return '<tr data-ticker="' + K.esc(ev.event_ticker) + '"' + sel + ' style="cursor:pointer">' +
        '<td class="num dim">' + (i + 1) + '</td>' +
        '<td><b>' + K.esc(ev.title) + '</b><br><span class="dim mono" style="font-size:11px">' + K.esc(ev.series_ticker) + ' · ' + K.esc(ev.event_ticker) + '</span></td>' +
        '<td><span class="pill">' + K.esc(topicLabel) + '</span></td>' +
        '<td class="num">' + r.markets.length + '</td>' +
        '<td class="num">' + (r.vol === null ? '' : K.cnt(r.vol)) + '</td>' +
        '<td class="num">' + (r.est === null ? '<span class="dim">n/a</span>' : K.money(r.est)) + '</td>' +
        '<td class="num">' + (r.oi === null ? '' : K.cnt(r.oi)) + '</td>' +
        '<td class="mono dim">' + K.esc((r.closes || '').replace('T', ' ').replace('Z', '')) + '</td>' +
        '<td>' + K.esc(r.statuses) + '</td>' +
        '<td class="src">' + srcLink(r.sourceUrl, 'query ↗') + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-ticker]'), function (tr) {
      tr.onclick = function () { selectEventByTicker(tr.getAttribute('data-ticker')); };
    });
  }

  function refreshEvents(manual) {
    var url = K.BASE + '/events?status=open&with_nested_markets=true&limit=200';
    state.lastSourceUrl = url;
    return K.publicGetAll('/events', { status: 'open', with_nested_markets: true }, 8, 200)
      .then(function (all) {
        state.allRows = enrichEvents(all);
        S.setConn('live', 'Live demo API · ' + state.allRows.length + ' topic events');
        banner('ok', '<b>Live data</b> from external-api.demo.kalshi.co — public endpoints, no credentials. Retrieved ' + all.length + ' open events; ' + state.allRows.length + ' matched the five topics (' + (state.seriesLoaded ? 'live series taxonomy' : 'seed taxonomy') + ').');
        applyTopic();
        if (!state.selEvent && state.events.length) selectEvent(state.events[0]);
      })
      .catch(function (e) {
        return fallback(e);
      });
  }

  function fallback(err) {
    S.setConn('snap', 'Snapshot fallback (API unreachable)');
    banner('warn', '<b>Live demo API unreachable</b> (' + K.esc(String(err && err.message || err)) + '). Showing committed provenance-stamped snapshots collected 2026-11-20 from the same official endpoints. <a href="../flagged.html">Why this happens ↗</a>');
    return Promise.all([
      S.loadSnapshot('snapshot-events-gas.json'),
      S.loadSnapshot('meta.json')
    ]).then(function (res) {
      var snap = res[0];
      state.allRows = (snap.events || []).map(function (ev) {
        var markets = ev.markets || [];
        var est = K.estimateEventDollars(markets);
        var vol = markets.reduce(function (a, m) { var v = K.fp(m.volume_fp); return a + (v || 0); }, 0);
        return { ev: ev, topic: snap.topic || 'gas', markets: markets, vol: vol, oi: null, est: est, closes: ev.strike_date, statuses: 'snapshot', sourceUrl: snap.source_url };
      });
      applyTopic();
      if (!state.selEvent && state.events.length) selectEvent(state.events[0]);
    }).catch(function () {
      document.getElementById('events-rows').innerHTML = '<tr><td colspan="10" class="empty">Neither the live API nor committed snapshots are reachable. All values intentionally blank.</td></tr>';
    });
  }

  function banner(kind, html) {
    var b = document.getElementById('mode-banner');
    b.className = 'banner ' + kind;
    b.innerHTML = html;
  }

  /* ---------- detail: market select, stats ------------------------------- */
  function selectEventByTicker(t) {
    var r = state.events.filter(function (x) { return x.ev.event_ticker === t; })[0];
    if (r) selectEvent(r);
  }

  function selectEvent(r) {
    state.selEvent = r;
    var sel = document.getElementById('chart-market');
    var ms = (r.markets || []).slice().sort(function (a, b) { return (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0); });
    sel.innerHTML = ms.map(function (m) {
      return '<option value="' + K.esc(m.ticker) + '">' + K.esc(m.title || m.ticker) + ' — vol ' + K.cnt(K.fp(m.volume_fp)) + '</option>';
    }).join('');
    if (ms.length) selectMarket(ms[0].ticker);
    renderEvents();
  }

  function currentMarket() {
    var t = document.getElementById('chart-market').value;
    if (!state.selEvent) return null;
    return state.selEvent.markets.filter(function (m) { return m.ticker === t; })[0] || null;
  }

  function selectMarket(ticker) {
    state.selMarket = ticker;
    document.getElementById('chart-market').value = ticker;
    document.getElementById('market-src').innerHTML = 'Source: ' + srcLink(K.BASE + '/markets/' + encodeURIComponent(ticker), 'GET /markets/' + K.esc(ticker) + ' ↗') + ' · book: ' + srcLink(K.BASE + '/markets/' + encodeURIComponent(ticker) + '/orderbook', 'orderbook ↗');
    loadStats();
    loadBook();
    loadChart(true);
  }

  function loadStats() {
    var m = currentMarket();
    var box = document.getElementById('market-stats');
    if (!m) { box.innerHTML = '<div class="empty">No market selected.</div>'; return; }
    var yb = K.fp(m.yes_bid_dollars), ya = K.fp(m.yes_ask_dollars);
    var spread = (yb !== null && ya !== null && ya >= yb) ? (ya - yb) : null;
    box.innerHTML = [
      kv('Last price (YES)', K.money(K.fp(m.last_price_dollars))),
      kv('Previous', K.money(K.fp(m.previous_price_dollars))),
      kv('YES bid / ask', K.money(yb) + ' / ' + K.money(ya)),
      kv('Spread (reported)', spread === null ? '' : K.money(spread)),
      kv('24 h volume', K.cnt(K.fp(m.volume_24h_fp)) + ' cts'),
      kv('Total volume', K.cnt(K.fp(m.volume_fp)) + ' cts'),
      kv('Open interest', K.cnt(K.fp(m.open_interest_fp)) + ' cts'),
      kv('Status', K.esc(m.status) + (m.result ? ' · result ' + K.esc(m.result) : '')),
      kv('Close time', K.esc((m.close_time || '').replace('T', ' ').replace('Z', '')))
    ].join('');
  }

  function kv(k, v) { return '<div class="kv"><span>' + k + '</span><b class="mono">' + (v === '' || v === undefined ? '<span class="dim">—</span>' : v) + '</b></div>'; }

  /* ---------- chart ------------------------------------------------------ */
  function loadChart(resetTicks) {
    var m = currentMarket();
    var box = document.getElementById('chartbox');
    var srcEl = document.getElementById('chart-source');
    if (!m) { box.innerHTML = '<div class="empty">Select an event above.</div>'; return; }
    var mode = document.getElementById('chart-window').value;
    state.windowMode = mode;
    stopTicks();
    var sec = parseInt(mode, 10);

    if (mode === 'live' || sec <= 3600) { // trades-based windows (finest official candles = 1 min)
      var win = mode === 'live' ? 900 : sec;
      var url = '/markets/trades';
      srcEl.textContent = 'source: official /markets/trades' + (mode === 'live' ? ' · polled every 5 s' : '');
      return fetchTrades(m.ticker, win).then(function (pts) {
        C.lineChart(box, pts, { yMax: 1, sourceLabel: 'official trades ' + (mode === 'live' ? '(live)' : '(window ' + win + ' s)') });
        if (pts.length) chartFallbackNotice(null); else chartFallbackNotice('No trades returned for this window.');
        if (mode === 'live') startTicks(m.ticker, pts);
      }).catch(function (e) {
        chartFallbackNotice('Trade fetch failed: ' + e.message);
        box.innerHTML = '<div class="empty">Official trade data unavailable: ' + K.esc(e.message) + '</div>';
      });
    }
    // candle windows (official): 21600s->1min, 86400s->60min, else 1440min
    var interval = sec === 21600 ? 1 : (sec === 86400 ? 60 : 1440);
    var endTs = Math.floor(Date.now() / 1000), startTs = endTs - sec;
    var series = (state.selEvent && state.selEvent.ev.series_ticker) || m.event_ticker.split('-')[0];
    var candleUrl = K.BASE + '/series/' + encodeURIComponent(series) + '/markets/' + encodeURIComponent(m.ticker) + '/candlesticks?start_ts=' + startTs + '&end_ts=' + endTs + '&period_interval=' + interval;
    srcEl.textContent = 'source: official candlesticks, interval ' + interval + ' min';
    return K.publicGet('/series/' + encodeURIComponent(series) + '/markets/' + encodeURIComponent(m.ticker) + '/candlesticks', { start_ts: startTs, end_ts: endTs, period_interval: interval })
      .then(function (d) {
        var pts = (d.candlesticks || []).filter(function (c) { return c.price && c.price.close_dollars !== null && c.price.close_dollars !== undefined && K.fp(c.price.close_dollars) !== null; })
          .map(function (c) { return { t: c.end_period_ts * 1000, v: K.fp(c.price.close_dollars) }; });
        pts.sort(function (a, b) { return a.t - b.t; });
        C.lineChart(box, pts, { yMax: 1, sourceLabel: 'official candles · ' + interval + ' min' });
        chartFallbackNotice(pts.length ? null : 'Candlesticks returned no points for this window (observed in demo even for recently-traded markets — flagged). No points are invented.');
      }).catch(function (e) {
        chartFallbackNotice('Candle fetch failed: ' + e.message);
        box.innerHTML = '<div class="empty">Official candle data unavailable: ' + K.esc(e.message) + '</div>';
      });
  }

  function chartFallbackNotice(msg) {
    var el = document.getElementById('chart-source');
    if (msg) { var n = document.getElementById('chart-notice') || document.createElement('div'); n.id = 'chart-notice'; n.className = 'footnote'; n.textContent = msg; el.parentNode.appendChild(n); }
    else { var old = document.getElementById('chart-notice'); if (old) old.remove(); }
  }

  function fetchTrades(ticker, windowSec) {
    var minTs = Math.floor(Date.now() / 1000) - windowSec;
    return K.publicGet('/markets/trades', { ticker: ticker, min_ts: minTs, limit: 1000 }).then(function (d) {
      var pts = (d.trades || []).map(function (tr) {
        return { t: Date.parse(tr.created_time), v: K.fp(tr.yes_price_dollars) };
      }).filter(function (p) { return p.v !== null && !isNaN(p.t); });
      pts.sort(function (a, b) { return a.t - b.t; });
      return pts;
    });
  }

  function startTicks(ticker, base) {
    var pts = base.slice();
    state.timers.ticks = setInterval(function () {
      if (document.hidden) return;
      fetchTrades(ticker, 900).then(function (fresh) {
        var seen = {}; pts.forEach(function (p) { seen[p.t + '|' + p.v] = 1; });
        fresh.forEach(function (p) { if (!seen[p.t + '|' + p.v]) pts.push(p); });
        pts.sort(function (a, b) { return a.t - b.t; });
        if (pts.length) C.lineChart(document.getElementById('chartbox'), pts.slice(-600), { yMax: 1, sourceLabel: 'official trades (live 5 s)' });
      }).catch(function () { /* keep last chart */ });
    }, 5000);
  }
  function stopTicks() { if (state.timers.ticks) { clearInterval(state.timers.ticks); state.timers.ticks = null; } }

  /* ---------- order book ------------------------------------------------- */
  function loadBook() {
    var m = currentMarket();
    if (!m) return Promise.resolve();
    return K.publicGet('/markets/' + encodeURIComponent(m.ticker) + '/orderbook', {}).then(function (ob) {
      var yes = K.bookLevels(ob, 'yes'), no = K.bookLevels(ob, 'no');
      C.depthBars(document.getElementById('book-depth'), yes, no);
      var yb = K.bestBid(yes), nb = K.bestBid(no);
      var yAsk = K.bestAskFromOpposite(nb), nAsk = K.bestAskFromOpposite(yb);
      var ly = K.liquidity(yes), ln = K.liquidity(no);
      var spread = (yb && yAsk) ? yAsk.price - yb.price : null;
      document.getElementById('book-summary').innerHTML = [
        kv('Best YES bid', yb ? K.money(yb.price) + ' × ' + K.cnt(yb.count) : ''),
        kv('Implied YES ask (derived)', yAsk ? K.money(yAsk.price) : ''),
        kv('Best NO bid', nb ? K.money(nb.price) + ' × ' + K.cnt(nb.count) : ''),
        kv('Implied NO ask (derived)', nAsk ? K.money(nAsk.price) : ''),
        kv('Spread (derived)', spread === null ? '' : K.money(spread)),
        kv('YES displayed liquidity', K.cnt(ly.contracts) + ' cts ≈ ' + K.money(ly.dollars)),
        kv('NO displayed liquidity', K.cnt(ln.contracts) + ' cts ≈ ' + K.money(ln.dollars))
      ].join('');
      document.getElementById('book-raw').innerHTML = '<details class="raw"><summary>Show raw JSON</summary><pre class="code">' + K.esc(JSON.stringify(ob, null, 2)) + '</pre></details>';
    }).catch(function (e) {
      document.getElementById('book-depth').innerHTML = '<div class="empty">Order book unavailable: ' + K.esc(e.message) + '</div>';
    });
  }

  /* ---------- wiring ------------------------------------------------------ */
  document.getElementById('rank-by').onchange = function () { state.rankBy = this.value; renderEvents(); };
  Array.prototype.forEach.call(document.querySelectorAll('#topic-filter .chip'), function (b) {
    b.onclick = function () {
      document.querySelectorAll('#topic-filter .chip').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      state.topic = b.getAttribute('data-topic');
      applyTopic();
    };
  });
  function applyTopic() {
    state.events = state.allRows.filter(function (r) { return state.topic === 'all' || r.topic === state.topic; });
    renderEvents();
  }

  document.getElementById('chart-market').onchange = function () { if (this.value) selectMarket(this.value); };
  document.getElementById('chart-window').onchange = function () { loadChart(true); };
  document.getElementById('chart-refresh').onclick = function () { loadChart(true); };
  document.getElementById('refresh-now').onclick = function () { refreshEvents(true); };
  document.getElementById('refresh-secs').onchange = function () { restartEventTimer(); };
  function restartEventTimer() {
    if (state.timers.events) clearInterval(state.timers.events);
    var s = parseInt(document.getElementById('refresh-secs').value, 10);
    if (s > 0) state.timers.events = setInterval(function () { if (!document.hidden) refreshEvents(); }, s * 1000);
  }
  setInterval(function () { if (!document.hidden && state.selMarket) loadBook(); }, 10000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshEvents(); });

  S.renderNav('dashboard.html');
  S.setConn('off', 'connecting…');
  loadAllowlist().then(function () { return refreshEvents(); }).then(restartEventTimer);
})();
