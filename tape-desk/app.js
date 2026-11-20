/*
 * tape-desk/app.js — the DOM layer. All arithmetic and rules live in core.js (unit-tested);
 * this file only fetches, feeds the engine, and paints.
 *
 * Data path: every value on screen comes from one of two places —
 *   (a) data/watchlist.json, built by tape-desk/tools/build_watchlist.py from the committed
 *       verified snapshot (each row carries the API request URL that produced it), or
 *   (b) a live response from the official demo REST API made by this page, whose request URL
 *       is printed next to the value.
 * If (b) cannot be reached, the desk says so and keeps showing (a). It never fills a gap with
 * an estimate.
 */
(function () {
  'use strict';

  var Core = globalThis.TapeDeskCore;
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var state = {
    meta: null, engine: null, base: '', mode: 'BOOT', note: '',
    requests: 0, failures: 0, errors: [], paused: false, topicFilter: 'all',
    basis: 'traded', selected: null, windowId: 'tape15',
    candles: {}, ladder: null, minTs: 0, slice: 0, timer: null, fails: 0,
    tickers: [], interval: 20000
  };

  var WINDOWS = [
    { id: 'tape5', label: '5 min · seconds (this session)', kind: 'tape', seconds: 300,
      note: 'points are the trades and quotes this page has itself observed since it was opened; the API has no sub-minute public candle' },
    { id: 'tape15', label: '15 min · seconds (this session)', kind: 'tape', seconds: 900,
      note: 'points are the trades and quotes this page has itself observed since it was opened; the API has no sub-minute public candle' },
    { id: 'tape60', label: '60 min · seconds (this session)', kind: 'tape', seconds: 3600,
      note: 'points are the trades and quotes this page has itself observed since it was opened; the API has no sub-minute public candle' },
    { id: 'c6h', label: '6 h · 1-minute candles', kind: 'candles', seconds: 6 * 3600, interval: 1,
      note: 'official candlesticks, period_interval=1 minute' },
    { id: 'c3d', label: '3 days · hourly candles', kind: 'candles', seconds: 3 * 86400, interval: 60,
      note: 'official candlesticks, period_interval=60 minutes' },
    { id: 'c30d', label: '30 days · daily candles', kind: 'candles', seconds: 30 * 86400, interval: 1440,
      note: 'official candlesticks, period_interval=1440 minutes' }
  ];
  function windowById(id) {
    for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].id === id) return WINDOWS[i];
    return WINDOWS[1];
  }

  function fmtClock(t) {
    var d = new Date(t * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }
  function fmtStamp(t, kind) {
    var d = new Date(t * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var hm = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    if (kind === 'tape') return hm + ':' + p(d.getUTCSeconds());
    if (kind === 'minutes') return p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + hm;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function money(v) { return v === null || v === undefined || isNaN(v) ? '' : '$' + Number(v).toFixed(2); }
  function signed(v) {
    if (v === null || v === undefined || isNaN(v)) return '';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(Number(v)).toFixed(2);
  }

  /* ------------------------------------------------------------------ fetching */
  function apiUrl(path, params) {
    var url = state.base + path;
    var q = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== null && params[k] !== undefined) q.push(k + '=' + encodeURIComponent(params[k]));
    });
    if (q.length) url += '?' + q.join('&');
    return url;
  }

  async function api(path, params) {
    var url = apiUrl(path, params);
    state.requests++;
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
    var data = await res.json();
    state.fails = 0;
    return { url: url, data: data };
  }

  async function probe() {
    try {
      var r = await api('/exchange/status', {});
      var ok = !!(r.data && (r.data.trading_active || r.data.exchange_active));
      state.mode = ok ? 'LIVE' : 'LIVE-QUIET';
      state.note = ok ? 'demo API reachable; trading_active ' + (r.data.trading_active ? 'true' : 'false')
                      : 'demo API answered but did not report trading active';
      state.statusUrl = r.url;
      state.fails = 0;
    } catch (e) {
      state.mode = 'SNAPSHOT';
      state.note = 'this browser cannot reach ' + state.base + ' (' + (e && e.message ? e.message : e) +
        '). Showing the committed snapshot only; no live swings until the API answers.';
      state.errors.push(String(e && e.message ? e.message : e));
      state.fails++;
    }
  }

  async function cycle() {
    if (state.paused) { render(); return; }
    if (state.mode === 'BOOT' || state.mode === 'SNAPSHOT' || state.mode === 'LIVE-QUIET') {
      if (state.fails >= 3 && state.mode === 'SNAPSHOT') { /* back off; keep the snapshot view */ }
      else await probe();
    }
    if (state.mode === 'LIVE') {
      /* one unscoped tape request plus a round-robin slice of the watchlist: the public
       * market-data endpoints need no credentials, but they do have a rate budget
       * (https://docs.kalshi.com/getting_started/rate_limits), so the desk caps itself at
       * 1 + SLICE requests per poll instead of hitting every market every time. */
      try {
        var t = await api('/markets/trades', { limit: 200, min_ts: state.minTs || null });
        var applied = state.engine.ingestTrades(t.data, t.url);
        var rows = (t.data && t.data.trades) || [];
        var newest = 0;
        rows.forEach(function (r) {
          var s = r.created_time ? Math.floor(Date.parse(r.created_time) / 1000) : 0;
          if (s > newest) newest = s;
        });
        if (newest) state.minTs = newest + 1;
        state.lastTape = { url: t.url, n: rows.length, applied: applied };
      } catch (e) {
        state.mode = 'SNAPSHOT';
        state.errors.push(String(e && e.message ? e.message : e));
        state.note = 'the tape request failed (' + (e && e.message ? e.message : e) +
          '); the desk keeps the swings it already saw and retries.';
        state.fails++;
      }
      var SLICE = 6;
      var list = state.tickers;
      for (var i = 0; i < SLICE && list.length; i++) {
        var idx = (state.slice + i) % list.length;
        var ticker = list[idx];
        try {
          var q = await api('/markets/' + encodeURIComponent(ticker), {});
          var mkt = q.data && (q.data.market || q.data);
          state.engine.ingestMarket(mkt, q.url, Math.floor(Date.now() / 1000));
          if (ticker === state.selected) await loadLadder(ticker);
        } catch (e) {
          state.errors.push(String(e && e.message ? e.message : e));
          state.fails++;
        }
      }
      state.slice = (state.slice + SLICE) % Math.max(1, list.length);
      if (state.selected) {
        var win = windowById(state.windowId);
        if (win.kind === 'candles') await loadCandles(state.selected, win);
      }
    }
    state.engine.markTrades();
    render();
  }

  async function loadLadder(ticker) {
    try {
      var r = await api('/markets/' + encodeURIComponent(ticker) + '/orderbook', {});
      state.ladder = { ticker: ticker, book: r.data && r.data.orderbook_fp, url: r.url, live: true,
                       at: Math.floor(Date.now() / 1000) };
    } catch (e) {
      state.ladder = { ticker: ticker, book: null, url: null, live: false,
                       note: 'order-book request failed: ' + (e && e.message ? e.message : e) };
      state.errors.push(String(e && e.message ? e.message : e));
      state.fails++;
    }
  }

  async function loadCandles(ticker, win) {
    var series = ticker.split('-')[0];
    var end = Math.floor(Date.now() / 1000);
    var start = end - win.seconds;
    var key = ticker + '|' + win.id;
    try {
      var r = await api('/series/' + encodeURIComponent(series) + '/markets/' + encodeURIComponent(ticker) +
        '/candlesticks', { start_ts: start, end_ts: end, period_interval: win.interval });
      state.candles[key] = { points: Core.candlePoints(r.data), url: r.url, at: end,
                             interval: win.interval, n: Core.candlePoints(r.data).length };
    } catch (e) {
      state.candles[key] = { points: [], url: null, error: String(e && e.message ? e.message : e), at: end };
      state.errors.push(String(e && e.message ? e.message : e));
      state.fails++;
    }
  }

  /* ------------------------------------------------------------------ painting */
  function topicClass(t) { return 'topic t-' + String(t || 'none').replace(/[^a-z0-9_-]/g, ''); }

  function bubbleHtml(b, isPick) {
    var sc = b.score || {};
    var cls = b.direction === 'up' ? 'up' : 'down';
    var lead = 'https://news.google.com/search?q=' + encodeURIComponent(b.title || b.ticker);
    var execBadge = sc.pass ? '<span class="pill good">model pass</span>'
      : (sc.reasons && sc.reasons.length ? '<span class="pill dim">' + esc(sc.reasons[0]) + '</span>' : '');
    var band = sc.band ? '<span class="pill">band ' + esc(sc.band.label) + ' · n=' + sc.band.n +
      (sc.band.source ? ' · ' + esc(sc.band.source) : '') + '</span>' : '';
    var roi = sc.expected_roi === null || sc.expected_roi === undefined ? '' :
      '<span class="pill ' + (sc.expected_roi > 0 ? 'good' : 'bad') + '">fee-adj ROI ' +
      (sc.expected_roi * 100).toFixed(1) + '%</span>';
    return '<article class="bub ' + cls + (isPick ? ' pick' : '') + '" data-ticker="' + esc(b.ticker) +
      '" data-id="' + esc(b.id) + '" tabindex="0">' +
      '<div class="bh"><span class="' + topicClass(b.topic) + '">' + esc(b.topic_label || b.topic || '') +
      '</span><time>' + esc(fmtClock(b.t)) + ' UTC</time><span class="basis">' + esc(b.basis) + '</span>' +
      (b.count ? '<span class="basis">' + esc(b.count) + ' contracts</span>' : '') +
      (b.side ? '<span class="basis">taker ' + esc(b.side) + '</span>' : '') + '</div>' +
      '<div class="bp"><b>' + money(b.from) + ' → ' + money(b.to) + '</b> <span class="d ' + cls + '">' +
      signed(b.delta) + '</span><span class="tk">' + esc(b.ticker) + '</span></div>' +
      '<div class="bt">' + esc(b.title || 'title not returned by the API — left blank') + '</div>' +
      (isPick ? '<div class="bf">' + band + roi + '<span class="pill">side ' + esc(sc.side || '') +
        '</span><span class="pill">fee ' + (sc.fee_cents || 0) + '¢</span>' +
        (sc.ledger ? '<span class="pill">in sim ledger</span>' : '') + '</div>' : '') +
      '<div class="bf">' +
      (b.source_url ? '<a class="src" href="' + esc(b.source_url) + '" target="_blank" rel="noopener">api response ↗</a>'
                    : '<span class="pill bad">no request URL</span>') +
      '<a class="lead" href="' + esc(lead) + '" target="_blank" rel="noopener">news lead (not proof of cause) ↗</a>' +
      execBadge + '</div></article>';
  }

  function visibleBubbles(pick) {
    var list = pick ? state.engine.picks : state.engine.bubbles;
    return list.filter(function (b) {
      return state.topicFilter === 'all' || b.topic === state.topicFilter;
    }).slice(-120).reverse();
  }

  function renderFeed(el, list, isPick) {
    if (!list.length) {
      el.innerHTML = '<p class="fine empty">' + (isPick
        ? 'No swing has passed the published rule yet. An empty pick feed is the normal state, not a bug — ' +
          'the rule refuses to fire when the settled sample or the live book does not support a trade.'
        : 'Waiting for the next ≥ ' + money(state.engine.threshold) + ' move. Committed snapshot swings (candle and book ' +
          'captures by the repository pipeline) are on <a href="../alert-desk/index.html">the alert desk</a>; this feed ' +
          'shows what this page observes live.') + '</p>';
      return;
    }
    el.innerHTML = list.map(function (b) { return bubbleHtml(b, isPick); }).join('');
    var arts = el.querySelectorAll('article');
    for (var i = 0; i < arts.length; i++) {
      arts[i].addEventListener('click', selectFromBubble);
      arts[i].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectFromBubble(ev); }
      });
    }
  }

  function selectFromBubble(ev) {
    var el = ev.currentTarget || ev.target;
    var ticker = el.getAttribute('data-ticker');
    if (ticker) focusMarket(ticker);
  }

  function focusMarket(ticker) {
    state.selected = ticker;
    var sel = $('marketPick');
    if (sel) sel.value = ticker;
    var win = windowById(state.windowId);
    if (win.kind === 'candles') loadCandles(ticker, win);
    loadLadder(ticker);
    render();
  }

  function renderChart() {
    var host = $('chart');
    var win = windowById(state.windowId);
    var ticker = state.selected;
    if (!ticker) { host.innerHTML = '<p class="fine">Pick a market.</p>'; return; }
    var pts = [];
    var srcNote = '';
    var swingMarks = state.engine.bubbles.filter(function (b) { return b.ticker === ticker; });
    if (win.kind === 'tape') {
      var since = Math.floor(Date.now() / 1000) - win.seconds;
      pts = state.engine.pointsFor(ticker, since).filter(function (p) {
        return state.basis === 'mid' ? p[2] === 'book mid' : p[2] !== 'book mid';
      }).map(function (p) { return { t: p[0], close: p[1] }; });
      srcNote = 'window: ' + win.label + ' — ' + win.note +
        (pts.length ? '' : '; nothing observed yet, so the plot is empty until a request returns');
    } else {
      var c = state.candles[ticker + '|' + win.id] || { points: [], url: null, error: null };
      pts = c.points;
      var cs = state.engine.candleSwings(pts, ticker, c.url);
      cs.forEach(function (s) { swingMarks.push(s); });
      srcNote = 'window: ' + win.label + ' — ' + win.note + ' · ' + pts.length + ' candles' +
        (c.url ? '' : ' (no live candle response in this browser session: ' +
          (c.error || 'not fetched') + ')');
      $('chartSrc').innerHTML = (c.url ? 'candlestick response: <a class="src" href="' + esc(c.url) +
        '" target="_blank" rel="noopener">' + esc(c.url) + ' ↗</a>' : 'no candle response URL — ' + esc(c.error || 'not requested')) +
        ' · <a class="src" href="' + esc(state.meta.docs.get_candlesticks) + '" target="_blank" rel="noopener">official candlesticks page</a>' +
        ' · <a class="src" href="' + esc(state.meta.docs.get_trades) + '" target="_blank" rel="noopener">official trades page</a>';
    }
    var W = 900, H = 250, L = 52, R = 14, T = 12, B = 28;
    var ys = pts.map(function (p) { return p.close; }).filter(function (v) { return v !== null && v !== undefined; });
    var yLo = 0, yHi = 1;
    if ($('yscale').value === 'auto' && ys.length) {
      yLo = Math.max(0, Math.min.apply(null, ys) - 0.03);
      yHi = Math.min(1, Math.max.apply(null, ys) + 0.03);
      if (yHi - yLo < 0.06) { yHi = Math.min(1, yLo + 0.06); }
    }
    var xs = pts.map(function (p) { return p.t; });
    var xLo = xs.length ? Math.min.apply(null, xs) : Math.floor(Date.now() / 1000) - win.seconds;
    var xHi = xs.length ? Math.max.apply(null, xs) : Math.floor(Date.now() / 1000);
    if (xHi - xLo < 30) xHi = xLo + 30;
    function X(t) { return L + (t - xLo) / (xHi - xLo) * (W - L - R); }
    function Y(v) { return T + (1 - (v - yLo) / (yHi - yLo)) * (H - T - B); }
    var ticks = [], grid = '';
    var nY = 5;
    for (var i = 0; i <= nY; i++) {
      var v = yLo + (yHi - yLo) * i / nY;
      var y = Y(v);
      grid += '<line class="grid" x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="ax" x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">$' + v.toFixed(2) + '</text>';
    }
    for (var j = 0; j <= 4; j++) {
      var tx = xLo + (xHi - xLo) * j / 4;
      var x = X(tx);
      grid += '<line class="grid" x1="' + x.toFixed(1) + '" y1="' + T + '" x2="' + x.toFixed(1) + '" y2="' + (H - B) + '"/>' +
        '<text class="ax" x="' + x.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' +
        esc(fmtStamp(tx, win.kind === 'tape' ? 'tape' : (win.interval === 1440 ? 'days' : 'minutes'))) + '</text>';
    }
    var line = '', area = '';
    var good = pts.filter(function (p) { return p.close !== null && p.close !== undefined; });
    if (good.length > 1) {
      line = '<polyline class="price" points="' + good.map(function (p) {
        return X(p.t).toFixed(1) + ',' + Y(Math.max(yLo, Math.min(yHi, p.close))).toFixed(1);
      }).join(' ') + '"/>';
      area = '<polygon class="fill" points="' + (X(good[0].t).toFixed(1) + ',' + (H - B)) + ' ' +
        good.map(function (p) { return X(p.t).toFixed(1) + ',' + Y(Math.max(yLo, Math.min(yHi, p.close))).toFixed(1); }).join(' ') +
        ' ' + (X(good[good.length - 1].t).toFixed(1) + ',' + (H - B)) + '"/>';
      good.forEach(function (p) {
        if (good.length < 140) {
          ticks += '<circle class="pt" cx="' + X(p.t).toFixed(1) + '" cy="' + Y(Math.max(yLo, Math.min(yHi, p.close))).toFixed(1) +
            '" r="2.1"><title>' + esc(fmtStamp(p.t, 'tape')) + ' · ' + money(p.close) + '</title></circle>';
        }
      });
    }
    var marks = '';
    swingMarks.forEach(function (s) {
      if (s.t < xLo || s.t > xHi) return;
      var y = Y(Math.max(yLo, Math.min(yHi, s.to)));
      marks += '<g class="mark ' + (s.direction === 'up' ? 'up' : 'down') + '">' +
        '<line x1="' + X(s.t).toFixed(1) + '" y1="' + T + '" x2="' + X(s.t).toFixed(1) + '" y2="' + (H - B) + '"/>' +
        '<circle cx="' + X(s.t).toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5"/>' +
        '<text class="mk" x="' + (X(s.t) + 7).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '">' + signed(s.delta) + '</text>' +
        '<title>' + esc(fmtClock(s.t) + ' ' + money(s.from) + ' → ' + money(s.to)) + '</title></g>';
    });
    var trades = state.engine.trades.filter(function (t) { return t.ticker === ticker; });
    trades.forEach(function (t) {
      if (t.opened_t < xLo || t.opened_t > xHi) return;
      marks += '<line class="entry" x1="' + X(t.opened_t).toFixed(1) + '" y1="' + T + '" x2="' +
        X(t.opened_t).toFixed(1) + '" y2="' + (H - B) + '"><title>' + esc(t.id + ' ' + t.side + ' @ ' + money(t.entry)) + '</title></line>';
    });
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="contract price over time for ' +
      esc(ticker) + '">' + grid + area + line + ticks + marks +
      '<line class="axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>' +
      '<line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>' +
      '<text class="axlab" x="' + L + '" y="' + (H - 0.5) + '">time (UTC)</text>' +
      '<text class="axlab" x="4" y="' + (T + 2) + '">price $</text></svg>';
    $('chartNote').textContent = srcNote + (swingMarks.length ? ' · ' + swingMarks.length + ' ≥ $0.10 move(s) marked' : ' · no ≥ $0.10 move in this window');
  }

  function renderLadder() {
    var host = $('ladder');
    var w = state.engine.watch[state.selected];
    var live = state.ladder && state.ladder.ticker === state.selected && state.ladder.book ? state.ladder : null;
    var snap = w && w.snapshot && w.snapshot.orderbook ? w.snapshot.orderbook : null;
    var yesBids = [], noBids = [], url = '', basis = '';
    if (live) {
      yesBids = ((live.book.yes_dollars) || []).map(function (l) { return { price: l[0], contracts: l[1] }; });
      noBids = ((live.book.no_dollars) || []).map(function (l) { return { price: l[0], contracts: l[1] }; });
      url = live.url; basis = 'live order book';
    } else if (snap) {
      yesBids = snap.yes_bids || []; noBids = snap.no_bids || [];
      url = snap.source || ''; basis = 'committed snapshot book (no live book in this browser session)';
    }
    if (!yesBids.length && !noBids.length) {
      host.innerHTML = '<p class="fine empty">No book to show yet' + (state.ladder && state.ladder.note
        ? ' — ' + esc(state.ladder.note) : '') + '.</p>';
      $('ladderNote').textContent = '';
      return;
    }
    var bids = Core.yesBidLevels(yesBids.map(function (l) { return [l.price, l.contracts]; }));
    var asks = Core.impliedYesAsks(noBids.map(function (l) { return [l.price, l.contracts]; }));
    var max = 0;
    bids.concat(asks).forEach(function (l) { if ((l[1] || 0) > max) max = l[1]; });
    function rows(levels, kind) {
      return levels.map(function (l) {
        var pct = max ? Math.max(1.5, (l[1] || 0) / max * 100) : 0;
        return '<tr class="' + kind + '"><td class="num">' + money(l[0]) + '</td>' +
          '<td class="num">' + (l[1] === null || l[1] === undefined ? '' : Number(l[1]).toLocaleString('en-US')) + '</td>' +
          '<td><span class="bar ' + kind + '" style="width:' + pct.toFixed(1) + '%"></span></td>' +
          '<td class="fine">' + (kind === 'bid' ? 'YES bid' : 'YES ask implied by a NO bid at ' + money(Core.num(1 - l[0]))) + '</td></tr>';
      }).join('');
    }
    var totalB = bids.reduce(function (a, l) { return a + (l[1] || 0); }, 0);
    var totalA = asks.reduce(function (a, l) { return a + (l[1] || 0); }, 0);
    host.innerHTML = '<table class="grid"><thead><tr><th>price</th><th>contracts</th><th></th><th>side</th></tr></thead>' +
      '<tbody>' + rows(asks, 'ask') + rows(bids, 'bid') + '</tbody>' +
      '<tfoot><tr><td colspan="2" class="fine">resting YES bids ' + Math.round(totalB).toLocaleString('en-US') +
      ' · implied YES asks ' + Math.round(totalA).toLocaleString('en-US') + '</td><td colspan="2" class="fine">' +
      (url ? '<a class="src" href="' + esc(url) + '" target="_blank" rel="noopener">book response ↗</a>' : 'no source URL') +
      '</td></tr></tfoot></table>';
    $('ladderNote').textContent = basis + ' · asks are implied: a NO bid at x is a YES ask at $' +
      (1).toFixed(2) + ' − x (official order-book page)';
  }

  function renderCause() {
    var host = $('cause');
    var t = state.selected;
    var st = t ? state.engine.markets[t] : null;
    var w = t ? state.engine.watch[t] : null;
    var bubbles = state.engine.bubbles.filter(function (b) { return b.ticker === t; });
    var last = bubbles.length ? bubbles[bubbles.length - 1] : null;
    var rules = (st && st.rules) || (w && w.snapshot && w.snapshot.rules_primary) || '';
    var html = '<dl class="cause">' +
      '<dt>market</dt><dd><code>' + esc(t || '') + '</code>' + (st && st.title ? ' — ' + esc(st.title) :
        (w && w.title ? ' — ' + esc(w.title) : '')) + '</dd>' +
      '<dt>official settlement rule</dt><dd>' + (rules ? esc(rules) :
        '<span class="pill bad">not in a response this session — left blank, not paraphrased</span>') + '</dd>' +
      '<dt>source the rule names</dt><dd class="fine">' + (rules ? esc(extractSource(rules)) : '') +
        (rules ? ' — quoted from the API field, this desk does not link a page it has not read' : '') + '</dd>' +
      '<dt>last ≥ $0.10 move here</dt><dd>' + (last ? esc(fmtClock(last.t) + ' UTC · ' + money(last.from) + ' → ' +
        money(last.to) + ' (' + last.basis + ')') : 'none seen this session') + '</dd>' +
      '<dt>request URLs around it</dt><dd>' + (st && st.requests && st.requests.length
        ? st.requests.slice(-4).reverse().map(function (q) {
            return '<a class="src" href="' + esc(q.url) + '" target="_blank" rel="noopener">' +
              esc(fmtClock(q.t) + ' ' + q.basis) + ' ↗</a>';
          }).join(' ') : '<span class="fine">none yet</span>') + '</dd>' +
      '<dt>news lead</dt><dd>' + (last ? '<a class="lead" href="https://news.google.com/search?q=' +
        encodeURIComponent(last.title || t) + '" target="_blank" rel="noopener">search headlines at that minute ↗</a>' +
        '<span class="fine"> a lead, not proof of cause</span>' : '<span class="fine">no jump to anchor yet</span>') + '</dd>' +
      '</dl>';
    host.innerHTML = html;
  }

  function extractSource(rules) {
    var m = /according to ([A-Z][A-Za-z .&']{2,40})/.exec(rules);
    if (m) return 'settlement reference: ' + m[1].trim();
    m = /CF Benchmarks/i.test(rules) ? [0, 'CF Benchmarks index (named in the rule)'] : null;
    if (m) return 'settlement ' + m[1];
    m = /Tomatometer/i.test(rules) ? [0, 'Rotten Tomatoes Tomatometer score (named in the rule)'] : null;
    if (m) return 'settlement ' + m[1];
    m = /wins the ([^,\.]+)/i.exec(rules);
    if (m) return 'settlement reference: ' + m[1].trim() + ' result';
    m = /elected to the ([^,\.]+)/i.exec(rules);
    if (m) return 'settlement reference: ' + m[1].trim() + ' official result';
    return 'no external body named in the rule text';
  }

  function renderBoard() {
    var host = $('board');
    var meta = state.meta;
    var out = [];
    Object.keys(meta.watchlist).forEach(function (topic) {
      if (state.topicFilter !== 'all' && state.topicFilter !== topic) return;
      var block = meta.watchlist[topic];
      var rows = [];
      (block.events || []).forEach(function (ev) {
        rows.push('<tr class="eventrow"><td colspan="8"><span class="' + topicClass(topic) + '">' +
          esc(block.label) + '</span> <b>' + esc(ev.event_title || ev.event_ticker) + '</b> ' +
          '<code class="fine">' + esc(ev.event_ticker) + '</code> · <code class="fine">' + esc(ev.series_ticker) +
          '</code> <a class="src" href="' + esc((state.meta.live_probes || {}).exchange_status ?
            (state.meta.rest_base + '/events/' + encodeURIComponent(ev.event_ticker)) : state.meta.rest_base) +
          '" target="_blank" rel="noopener">event endpoint ↗</a></td></tr>');
        (ev.markets || []).forEach(function (m) {
          var st = state.engine.markets[m.market_ticker] || {};
          var q = st.quotes || null;
          var live = q || null;
          var s = m.snapshot;
          var lastPrice = (live && live.last_price !== null && live.last_price !== undefined)
            ? live.last_price : s.last_price;
          var bid = live ? live.yes_bid : s.yes_bid;
          var ask = live ? live.yes_ask : s.yes_ask;
          var bidSz = live ? live.yes_bid_size : s.yes_bid_size;
          var askSz = live ? live.yes_ask_size : s.yes_ask_size;
          var status = live ? live.status : s.status;
          var result = live ? (live.result || '') : (s.result || '');
          var mm = m.model || {};
          var moved = state.engine.bubbles.filter(function (b) { return b.market_ticker === m.market_ticker || b.ticker === m.market_ticker; });
          var chk = m.live_check || {};
          rows.push('<tr data-ticker="' + esc(m.market_ticker) + '" class="mkrow">' +
            '<td><button class="link" data-pick="' + esc(m.market_ticker) + '"><code>' + esc(m.market_ticker) + '</code></button>' +
            '<div class="fine">' + esc(m.title || '') + '</div></td>' +
            '<td class="num strong">' + money(lastPrice) + (moved.length ? ' <span class="pill ' +
              (moved[moved.length - 1].direction) + '">' + signed(moved[moved.length - 1].delta) + ' ×' + moved.length + '</span>' : '') + '</td>' +
            '<td class="num">' + money(bid) + '<span class="fine"> × ' + (bidSz === null || bidSz === undefined ? '' : Math.round(bidSz)) + '</span></td>' +
            '<td class="num">' + money(ask) + '<span class="fine"> × ' + (askSz === null || askSz === undefined ? '' : Math.round(askSz)) + '</span></td>' +
            '<td class="num">' + (s.dollar_notional_24h === null || s.dollar_notional_24h === undefined ? '' :
              '$' + Math.round(s.dollar_notional_24h).toLocaleString('en-US')) + '</td>' +
            '<td class="fine">' + esc(status || '') + (result ? ' · ' + esc(result) : '') + '</td>' +
            '<td class="fine">' + (mm.band ? 'band ' + esc(mm.band.label) + ' n=' + mm.band.n +
              (mm.expected_roi === null ? '' : '') + (mm.roi_yes !== null && mm.roi_yes !== undefined ? ' · ROI yes ' + (mm.roi_yes * 100).toFixed(0) + '%' : '') +
              (mm.roi_no !== null && mm.roi_no !== undefined ? ' · no ' + (mm.roi_no * 100).toFixed(0) + '%' : '')
              : '<span class="pill dim">no band sample ≥ ' + (mm.min_band_n || 20) + '</span>') +
              (mm.model_interest ? ' <span class="pill good">model likes</span>' : '') +
              (chk.verdict === 'ALL-MATCH' ? ' <span class="pill ok">live ✓</span>' :
               chk.verdict === 'HAS-DELTA' ? ' <span class="pill">moved since snapshot</span>' : '') + '</td>' +
            '<td class="fine">' + (s.sources && s.sources.market ? '<a class="src" href="' + esc(s.sources.market) +
              '" target="_blank" rel="noopener">snapshot ↗</a>' : '<span class="pill bad">no source</span>') +
              (live && live.request_url ? ' <a class="src" href="' + esc(live.request_url) + '" target="_blank" rel="noopener">live ↗</a>' : '') +
              '</td></tr>');
        });
      });
      out.push('<section class="topicblock"><h3>' + esc(block.label) +
        '<span class="fine"> · ' + block.open_markets_in_snapshot + ' open markets in this topic in the snapshot · ' +
        ((state.meta.topics[topic] || {}).watchlist_events || 0) + ' events shown, biggest money first</span></h3>' +
        '<table class="grid"><thead><tr><th>market</th><th>price</th><th>YES bid</th><th>YES ask</th>' +
        '<th>24 h traded $</th><th>status</th><th>model</th><th>sources</th></tr></thead><tbody>' +
        rows.join('') + '</tbody></table></section>');
    });
    host.innerHTML = out.join('');
    var btns = host.querySelectorAll('[data-pick]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        focusMarket(ev.currentTarget.getAttribute('data-pick'));
      });
    }
  }

  function renderResolutions() {
    var host = $('resTable');
    var live = state.engine.resolutions.slice().reverse();
    var committed = (state.data.resolutions || []);
    function rrow(r, isLive) {
      return '<tr><td>' + (isLive ? 'live' : 'snapshot') + '</td>' +
        '<td><code>' + esc(r.ticker || r.market_ticker) + '</code></td>' +
        '<td class="fine">' + esc(r.title || '') + '</td>' +
        '<td>' + (isLive ? (r.result ? r.result.toUpperCase() : '—') :
          (r.resolved_yes_no ? r.resolved_yes_no : '<span class="pill dim">not terminal</span>')) + '</td>' +
        '<td class="fine">' + esc(r.status || (r.live && r.live.verdict) || '') + '</td>' +
        '<td class="num">' + (r.settlement_value === null || r.settlement_value === undefined
          ? (r.live && r.live.fields ? '' : '') : money(r.settlement_value)) + '</td>' +
        '<td class="fine">' + esc(r.settlement_ts || (r.source_url ? '' : '')) + '</td>' +
        '<td class="fine">' + (r.source_url ? '<a class="src" href="' + esc(r.source_url) +
          '" target="_blank" rel="noopener">response ↗</a>' :
          (r.live && r.live.request_url ? '<a class="src" href="' + esc(r.live.request_url) +
            '" target="_blank" rel="noopener">verified response ↗</a>' : '')) + '</td></tr>';
    }
    host.innerHTML = '<table class="grid"><thead><tr><th>seen</th><th>market</th><th>title</th><th>YES/NO</th>' +
      '<th>status</th><th>payout</th><th>settlement_ts</th><th>source</th></tr></thead><tbody>' +
      live.map(function (r) { return rrow(r, true); }).join('') +
      committed.map(function (r) { return rrow(r, false); }).join('') +
      '</tbody></table>' +
      '<p class="fine">Live rows appear when a watched market’s status becomes <code>finalized</code> while this page is open — ' +
      'gas-price weekly markets and golf tournaments settle often on the demo venue. ' +
      'Snapshot rows are the committed resolution record, re-checked by this session against the API ' +
      '(<a href="verified.html">table</a>).</p>';
  }

  function renderPaper() {
    var st = state.engine.stats();
    $('paperKpis').innerHTML =
      '<div class="kpi"><b>' + st.trades + '</b><span>simulated trades</span></div>' +
      '<div class="kpi"><b>' + st.settled + '</b><span>settled · ' + st.open + ' open</span></div>' +
      '<div class="kpi"><b>' + st.wins + ' / ' + st.losses + '</b><span>wins / losses</span></div>' +
      '<div class="kpi"><b>' + (st.net === null ? '' : (st.net >= 0 ? '+' : '−') + '$' + Math.abs(st.net).toFixed(2)) +
        '</b><span>realised net</span></div>' +
      '<div class="kpi"><b>' + (st.roi_pct === null ? '—' : st.roi_pct.toFixed(1) + '%') +
        '</b><span>net ROI on realised</span></div>' +
      '<div class="kpi"><b>' + (st.unrealised === null ? '' : (st.unrealised >= 0 ? '+' : '−') + '$' +
        Math.abs(st.unrealised).toFixed(2)) + '</b><span>unrealised (mark = last price)</span></div>';
    var rows = state.engine.trades.slice().reverse().map(function (t) {
      return '<tr><td>' + esc(t.id) + '</td><td><code>' + esc(t.ticker) + '</code></td>' +
        '<td class="fine">' + esc(t.topic || '') + '</td><td>' + esc(t.side.toUpperCase()) + '</td>' +
        '<td class="num">' + money(t.entry) + '</td><td class="num">' + (t.fee * 100).toFixed(0) + '¢</td>' +
        '<td class="num">' + money(t.cost) + '</td>' +
        '<td class="num">' + (t.status === 'settled' ? money(t.received) : money(t.mark)) + '</td>' +
        '<td class="num ' + ((t.realised === null ? 0 : t.realised) >= 0 ? 'pos' : 'neg') + '">' +
        (t.realised === null || t.realised === undefined ? (t.status === 'open' ? 'open' : '—') : signed(t.realised)) + '</td>' +
        '<td class="fine">' + esc(t.category) + ' · ' + esc(t.band || 'no band') + '</td>' +
        '<td class="fine">' + (t.trigger && t.trigger.url ? '<a class="src" href="' + esc(t.trigger.url) +
          '" target="_blank" rel="noopener">trigger ↗</a>' : '') +
          (t.settlement_url ? ' <a class="src" href="' + esc(t.settlement_url) + '" target="_blank" rel="noopener">settlement ↗</a>' : '') +
        '</td></tr>';
    }).join('');
    $('paperTable').innerHTML = '<table class="grid"><thead><tr><th>id</th><th>market</th><th>topic</th><th>side</th>' +
      '<th>entry</th><th>fee</th><th>cost</th><th>value</th><th>P&amp;L</th><th>category</th><th>sources</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="11" class="fine empty">No pick has fired, so no simulated trade exists. ' +
      'Nothing is invented to fill this table.</td></tr>') + '</tbody></table>';
    function catTable(g, label) {
      var keys = Object.keys(g || {});
      if (!keys.length) return '';
      return '<h4>' + esc(label) + '</h4><table class="grid"><thead><tr><th>' + esc(label) + '</th><th>trades</th>' +
        '<th>wins</th><th>net</th><th>net ROI</th></tr></thead><tbody>' + keys.map(function (k) {
          return '<tr><td>' + esc(k) + '</td><td class="num">' + g[k].n + '</td><td class="num">' + g[k].wins +
            '</td><td class="num">' + money(g[k].net) + '</td><td class="num">' +
            (g[k].roi_pct === null ? '—' : g[k].roi_pct.toFixed(1) + '%') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    $('paperCats').innerHTML = '<div class="cats">' + catTable(st.by_topic, 'topic') + catTable(st.by_band, 'price band') +
      catTable(st.by_category, 'strategy category') + '</div>' +
      (st.settled ? '' : '<p class="fine">Categorised results appear once a pick settles. Demo markets settle on their own ' +
        'schedule; this desk never invents a result to populate the table.</p>');
  }

  function renderStatus() {
    var badge = $('modeBadge');
    badge.textContent = state.mode === 'LIVE' ? 'LIVE — demo API' : state.mode === 'SNAPSHOT' ? 'SNAPSHOT ONLY' : state.mode;
    badge.className = 'badge ' + (state.mode === 'LIVE' ? 'live' : state.mode === 'SNAPSHOT' ? 'snap' : 'boot');
    $('stWatch').textContent = state.tickers.length;
    $('stInterval').textContent = (state.interval / 1000) + ' s';
    $('stLast').textContent = state.lastPoll ? fmtClock(state.lastPoll) + ' UTC' : '—';
    $('stReq').textContent = state.requests;
    $('stFail').textContent = state.failures;
    $('stSwings').textContent = state.engine ? state.engine.bubbles.length : 0;
    $('stPicks').textContent = state.engine ? state.engine.picks.length : 0;
    $('stOff').textContent = state.engine ? state.engine.counters.off_topic : 0;
    var banner = $('banner');
    if (state.mode === 'SNAPSHOT' || state.note) {
      banner.hidden = false;
      banner.innerHTML = '<b>' + (state.mode === 'LIVE' ? 'live' : 'notice') + ':</b> ' + esc(state.note) +
        (state.statusUrl && state.mode === 'LIVE' ? ' · <a class="src" href="' + esc(state.statusUrl) +
          '" target="_blank" rel="noopener">status response ↗</a>' : '');
      banner.className = 'banner ' + (state.mode === 'LIVE' ? 'ok' : 'warn');
    } else {
      banner.hidden = true;
    }
    $('rateNote').textContent = '≤ ' + (1 + 6) + ' requests per poll, round-robin over ' + state.tickers.length +
      ' watchlist markets — a full sweep every ' +
      Math.ceil(state.tickers.length / 6) * (state.interval / 1000) + ' s · unauthenticated market data per ' +
      '<a class="src" href="' + esc(state.meta.docs.market_data_qs) + '" target="_blank" rel="noopener">official quick start</a>';
    $('allCount').textContent = visibleBubbles(false).length + (state.engine.bubbles.length !== visibleBubbles(false).length ? ' / ' + state.engine.bubbles.length : '');
    $('pickCount').textContent = visibleBubbles(true).length;
  }

  function render() {
    state.lastPoll = Math.floor(Date.now() / 1000);
    renderStatus();
    renderFeed($('feedAll'), visibleBubbles(false), false);
    renderFeed($('feedPicks'), visibleBubbles(true), true);
    renderChart();
    renderLadder();
    renderCause();
    renderBoard();
    renderPaper();
    renderResolutions();
    if ($('follow') && $('follow').checked) {
      $('feedAll').scrollTop = 0; $('feedPicks').scrollTop = 0;
    }
  }

  function wire() {
    var chips = $('topicChips');
    var all = document.createElement('button');
    all.className = 'chip on'; all.textContent = 'all'; all.setAttribute('data-topic', 'all');
    chips.appendChild(all);
    Object.keys(state.meta.watchlist).forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip'; b.textContent = state.meta.watchlist[t].label;
      b.setAttribute('data-topic', t);
      chips.appendChild(b);
    });
    chips.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-topic]') : null;
      if (!b) return;
      state.topicFilter = b.getAttribute('data-topic');
      var kids = chips.querySelectorAll('.chip');
      for (var i = 0; i < kids.length; i++) kids[i].className = 'chip' + (kids[i] === b ? ' on' : '');
      render();
    });
    $('interval').addEventListener('change', function (ev) {
      state.interval = parseInt(ev.target.value, 10) || 20000;
      restart();
    });
    $('basis').addEventListener('change', function (ev) { state.basis = ev.target.value; render(); });
    $('pause').addEventListener('click', function (ev) {
      state.paused = !state.paused;
      ev.target.textContent = state.paused ? 'resume' : 'pause';
      renderStatus();
    });
    $('clearLive').addEventListener('click', function () {
      state.engine.bubbles.length = 0; state.engine.picks.length = 0; render();
    });
    var mp = $('marketPick');
    state.tickers.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t; o.textContent = t + ' — ' + ((state.engine.watch[t] || {}).title || '').slice(0, 46);
      mp.appendChild(o);
    });
    mp.addEventListener('change', function (ev) { focusMarket(ev.target.value); });
    var wp = $('windowPick');
    WINDOWS.forEach(function (w) {
      var o = document.createElement('option'); o.value = w.id; o.textContent = w.label; wp.appendChild(o);
    });
    wp.value = state.windowId;
    wp.addEventListener('change', function (ev) {
      state.windowId = ev.target.value;
      var w = windowById(state.windowId);
      if (w.kind === 'candles' && state.selected) loadCandles(state.selected, w);
      render();
    });
    $('yscale').addEventListener('change', function () { renderChart(); });
    var rule = state.meta.model;
    $('pickRule').innerHTML = 'a swing earns a pick only when all three published tests pass — ' +
      '<a class="src" href="' + esc(state.meta.docs.fee_schedule) + '" target="_blank" rel="noopener">official fee schedule</a>, ' +
      '<a class="src" href="' + esc(state.meta.docs.settlement) + '" target="_blank" rel="noopener">official settlement</a>';
    $('ruleList').innerHTML = [
      '<b>side</b> ' + esc(rule.rule_b),
      '<b>sample floor</b> ' + esc(rule.rule_n) + ' (bands used: ' + esc(rule.bands_source) + ')',
      '<b>executability</b> ' + esc(rule.rule_e),
      '<b>ledger tag</b> ' + esc(rule.rule_p) + ' (' + rule.ledger_tickers + ' ledger markets known)',
      '<b>honesty</b> ' + esc(rule.honesty)
    ].map(function (s) { return '<li>' + s + '</li>'; }).join('');
    $('howList').innerHTML = howText().map(function (s) { return '<li>' + s + '</li>'; }).join('');
  }

  function howText() {
    var m = state.meta, d = m.docs;
    function a(url, txt) { return '<a class="src" href="' + url + '" target="_blank" rel="noopener">' + txt + ' ↗</a>'; }
    return [
      '<b>Bases.</b> The demo REST root is <code>' + esc(m.rest_base) + '</code> (' +
        a(d.environments, 'official environments page') + '); the alternate demo host is <code>' +
        esc(m.rest_base_alt) + '</code>. Prices are mock funds (' + a(d.demo_env, 'official demo page') + ').',
      '<b>Public reads.</b> ' + a(d.market_data_qs, 'the official market-data quick start') + ' documents market data ' +
        'without authentication; ' + a(d.get_trades, 'GET /markets/trades') + ' takes <code>limit</code> 1–1000 and ' +
        '<code>min_ts</code>/<code>max_ts</code> in <b>seconds</b>; ' + a(d.get_markets, 'GET /markets') + ' and ' +
        a(d.get_market, 'GET /markets/{ticker}') + ' return the dollar fields this desk prints verbatim.',
      '<b>Order book.</b> ' + a(d.get_orderbook, 'GET /markets/{ticker}/orderbook') + ' returns YES bids and NO bids only; ' +
        'a NO bid at <em>x</em> is a YES ask at $1.00 − <em>x</em> (' + a(d.orderbook_responses, 'official order-book page') +
        '), so the ladder shows both sides and labels which one is implied.',
      '<b>Candles.</b> ' + a(d.get_candlesticks, 'the candlesticks page') + ' allows <code>period_interval</code> of 1, 60 or ' +
        '1440 minutes — nothing finer. That is why the seconds axis is built from the tape this page observes itself, and is ' +
        'labelled “this session”. No sub-minute history is invented.',
      '<b>Resolutions.</b> ' + a(d.lifecycle, 'the lifecycle page') + ': <code>result</code> appears at <code>determined</code>, ' +
        'can be challenged at <code>disputed</code>, and payout happens at <code>finalized</code>; ' + a(d.settlement, 'settlement') +
        ' pays $1 per winning contract. This desk prints YES/NO only at <code>finalized</code>.',
      '<b>Fees.</b> taker fee = round up(M × 0.07 × C × P × (1 − P)) with M = 1, C = 1 (' +
        a(d.fee_schedule, 'official fee schedule') + '), applied to every simulated entry before ROI or P&amp;L is shown.',
      '<b>WebSockets are not used, and here is why.</b> ' + a(d.quick_start_ws, 'the WebSocket quick start') +
        ' states that connections require a signed handshake (<code>KALSHI-ACCESS-KEY</code> / ' +
        '<code>-SIGNATURE</code> / <code>-TIMESTAMP</code>) even for the channels that carry public market data, and no key ' +
        'exists in this repository. A static page cannot open that session, so this desk polls REST and says so instead of ' +
        'pretending to stream.',
      '<b>Sharding.</b> ' + a(d.sharding, 'the sharding page') + ' documents <code>exchange_index</code> routing and says an ' +
        '<code>exchange_index</code> omitted request defaults to index 0. The desk therefore reads per-market data by ticker ' +
        '(which the same page says is auto-routed) and prints the <code>exchange_index</code> field the API reports.',
      '<b>Nothing is filled in.</b> A field the API did not return is blank; the row is listed on ' +
        '<a href="verified.html#blank">the verification page</a>. ' +
        'Snapshot-vs-live differences for the ten markets this session re-fetched are in ' +
        '<a href="data/live-check.json">data/live-check.json</a>.',
      '<b>Rate limits.</b> ' + a(d.rate_limits, 'the rate-limit page') + ' publishes per-tier budgets; the desk caps itself at ' +
        '7 requests per poll and backs off after three failures rather than hammering a public endpoint.'
    ];
  }

  function restart() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { cycle(); }, state.interval);
    cycle();
  }

  async function boot() {
    var data;
    try {
      var r = await fetch('data/watchlist.json', { cache: 'no-store' });
      data = await r.json();
    } catch (e) {
      $('banner').hidden = false;
      $('banner').innerHTML = '<b>cannot load data/watchlist.json</b> — ' + esc(e && e.message ? e.message : e) +
        ' . This page must be served over HTTP (it does not work from file://).';
      return;
    }
    state.data = data;
    state.meta = Object.assign({}, data.meta, { watchlist: data.watchlist, resolutions: data.resolutions });
    state.base = data.meta.rest_base;
    state.lastSeen = {};
    state.engine = Core.createEngine({
      meta: state.meta, threshold: data.meta.threshold_dollars,
      hooks: {
        onBubble: function (b) { state.lastSeen[b.ticker] = b.to; },
        onQuote: function () {}
      }
    });
    state.tickers = Object.keys(state.engine.watch);
    state.selected = state.tickers[0] || null;
    state.minTs = Math.floor(Date.now() / 1000) - 60;
    wire();
    restart();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  globalThis.TapeDesk = state;
})();
