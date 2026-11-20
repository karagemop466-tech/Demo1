/* Controller for pages/live.html. Renders only what the API returned. */
(function () {
  'use strict';
  const K = window.KalshiDemo, U = window.KalshiUI;
  const $ = (id) => document.getElementById(id);
  let scan = null, selected = null, timer = null, bookTimer = null;

  /* ------------------------------------------------------------ request log */
  function renderLog() {
    const rows = K.state.requests;
    $('req-log').innerHTML = rows.length ? rows.map((r) => {
      const path = r.url.replace(/^https?:\/\/[^/]+/, '');
      return '<tr><td>' + new Date().toLocaleTimeString('en-GB', { hour12: false }) + '</td>' +
        '<td><a href="' + K.esc(r.url) + '" target="_blank" rel="noreferrer">' + K.esc(path.slice(0, 110)) + '</a></td>' +
        '<td>' + r.status + '</td><td>' + r.ms + '</td><td>' + (r.records === undefined ? '' : r.records) + '</td>' +
        '<td>' + (r.ok ? 'ok' : K.esc(r.note || 'failed')) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No requests yet.</td></tr>';
  }
  window.addEventListener('kd:request', renderLog);

  /* ------------------------------------------------------------------ scan */
  async function runScan() {
    const btn = $('scan');
    btn.disabled = true; btn.textContent = 'Scanning…';
    $('conn').textContent = 'Scanning demo API…';
    $('conn').className = 'status-pill';
    const minutes = Number($('window').value);
    const topic = $('topic').value;
    const startedAt = new Date();
    try {
      scan = await K.scanLive({ minutes: minutes, topic: topic });
      localStorage.setItem('kd.lastscan', JSON.stringify({ at: startedAt.toISOString(), minutes: minutes, topic: topic, rows: scan.rows.length }));
      renderScan();
      $('conn').textContent = 'Live · scanned ' + startedAt.toLocaleTimeString('en-GB', { hour12: false });
      $('conn').className = 'status-pill live';
      $('blocked').hidden = true;
    } catch (err) {
      $('scan-meta').innerHTML = '<span class="bad">Scan failed:</span> ' + K.esc(err.message) +
        ' · <a href="https://docs.kalshi.com/getting_started/api_environments.md" target="_blank" rel="noreferrer">official demo endpoint list</a>';
      $('event-rows').innerHTML = '<tr><td colspan="12" class="empty">No verified data — nothing is fabricated. Fix connectivity (see note below) and re-run.</td></tr>';
      $('conn').textContent = 'Not connected';
      $('conn').className = 'status-pill unverified';
      if (err.transport) {
        $('blocked').hidden = false;
        $('blocked-origin').textContent = location.origin;
        $('blocked-host').textContent = K.state.host;
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Run scan';
    }
  }

  function renderScan() {
    if (!scan) return;
    const rows = scan.rows;
    $('k-events').textContent = rows.length || '0';
    $('k-top').textContent = rows.length ? K.compact(rows[0].traded) : '—';
    $('k-total').textContent = rows.length ? K.compact(rows.reduce((s, r) => s + (r.traded || 0), 0)) : '—';
    $('k-fills').textContent = scan.trades.length.toLocaleString('en-US');
    renderWatchKpi();
    $('scan-meta').innerHTML = 'Scanned ' + scan.trades.length + ' trades in the last ' + scan.windowMinutes +
      ' min → ' + Object.keys(scan.markets).length + ' markets → ' + Object.keys(scan.events).length +
      ' events → ' + rows.length + ' in topic scope. As of ' + startedStamp() +
      (scan.notes.length ? '<br><span class="warn-text">' + K.esc(scan.notes.join(' · ')) + '</span>' : '') +
      (Object.keys(scan.taxonomy).length ? '' : '<br><span class="warn-text">Series taxonomy unavailable — topics fall back to keyword matching (flagged).</span>');

    $('event-rows').innerHTML = rows.length ? rows.map((r, i) => {
      const watch = K.watchList()[r.event_ticker];
      const res = r.resolvedCount
        ? (r.yesCount && r.noCount ? r.yesCount + ' yes / ' + r.noCount + ' no' : (r.yesCount ? 'YES (' + r.yesCount + ')' : 'NO (' + r.noCount + ')'))
        : 'open';
      const topicLabels = r.topics.length ? r.topics.map((t) => K.TOPICS[t].label).join(', ') : '<span class="warn-text">unclassified</span>';
      return '<tr data-ev="' + K.esc(r.event_ticker) + '" class="' + (selected === r.event_ticker ? 'sel' : '') + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><b>' + K.esc(r.title || '(no title returned)') + '</b><br><code>' + K.esc(r.event_ticker) + '</code> · <code>' + K.esc(r.series_ticker) + '</code>' + (r.category ? ' · ' + K.esc(r.category) : '') + '</td>' +
        '<td>' + topicLabels + '</td>' +
        '<td class="num">' + K.usd(r.traded) + '</td>' +
        '<td class="num">' + K.usd(r.traded24h) + '</td>' +
        '<td class="num">' + K.usd(r.exposure) + '</td>' +
        '<td class="num">' + r.openCount + ' / ' + r.resolvedCount + '</td>' +
        '<td>' + res + '</td>' +
        '<td class="num">' + r.fills + ' · ' + K.usd(r.flowDollars) + '</td>' +
        '<td class="num">' + (r.bestPrice === null ? '' : K.usd(r.bestPrice, 4)) + '</td>' +
        '<td><button class="btn tiny ' + (watch ? 'danger' : '') + '" data-watch="' + K.esc(r.event_ticker) + '">' + (watch ? 'unwatch' : 'watch') + '</button></td>' +
        '<td class="src"><a href="' + apiLink('/events?tickers=' + encodeURIComponent(r.event_ticker)) + '" target="_blank" rel="noreferrer">API ↗</a> · <a href="' + kalshiLink(r.event_ticker) + '" target="_blank" rel="noreferrer">Kalshi ↗</a></td></tr>';
    }).join('') : '<tr><td colspan="12" class="empty">No trades matched the topic filter inside this window. Widening the window is the next check — no data is invented in the meantime.</td></tr>';

    document.querySelectorAll('#event-rows [data-watch]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = b.getAttribute('data-watch');
        if (K.watchList()[t]) K.unwatch(t);
        else {
          const row = scan.rows.find((r) => r.event_ticker === t);
          K.watch(t, { title: row.title, series_ticker: row.series_ticker, topics: row.topics, traded: row.traded });
        }
        renderScan();
      });
    });
    document.querySelectorAll('#event-rows tr[data-ev]').forEach((tr) => {
      tr.addEventListener('click', () => selectEvent(tr.getAttribute('data-ev')));
    });
  }
  function startedStamp() {
    const raw = JSON.parse(localStorage.getItem('kd.lastscan') || 'null');
    return raw ? new Date(raw.at).toLocaleString('en-GB', { hour12: false }) : '—';
  }
  function renderWatchKpi() {
    const w = Object.keys(K.watchList()).length;
    const all = K.resolutions();
    const done = Object.keys(all).filter((k) => k.indexOf('m:') === 0 && all[k].result).length;
    $('k-watch').textContent = w + ' / ' + done;
  }
  const apiLink = (p) => K.state.host + p;
  const kalshiLink = (ev) => 'https://kalshi.com/markets/' + encodeURIComponent(ev);

  /* --------------------------------------------------------------- inspect */
  function selectEvent(eventTicker) {
    selected = eventTicker;
    document.querySelectorAll('#event-rows tr[data-ev]').forEach((tr) => tr.classList.toggle('sel', tr.getAttribute('data-ev') === eventTicker));
    const row = scan.rows.find((r) => r.event_ticker === eventTicker);
    if (!row) return;
    const best = row.markets.slice().sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0))[0];
    loadPair(row, best);
  }

  async function loadPair(row, market) {
    const series = row.series_ticker;
    $('chart-title').innerHTML = 'Market <code>' + K.esc(market.ticker) + '</code> · ' + K.esc(market.yes_sub_title || market.title || '') + ' · ' + K.stamp(market.close_time && market.close_time);
    await loadChart(series, market);
    await loadBook(market.ticker);
  }

  async function loadChart(series, market) {
    const interval = $('interval').value, range = Number($('range').value);
    const canvas = $('price-chart');
    let pts = [], note = '';
    try {
      if (interval === 'ticks') {
        const t = await K.ticks(market.ticker, range);
        pts = t.map((x) => ({ ts: x.ms, close: x.close, volume: x.volume }));
        note = pts.length ? '' : 'No trades returned in this range.';
      } else {
        const c = await K.candles(series, market.ticker, interval, range);
        pts = c.map((x) => ({ ts: x.ts * 1000, close: x.close, high: x.high, low: x.low, volume: x.volume }));
        note = pts.length ? '' : 'No candlesticks returned for this range.';
      }
    } catch (err) {
      note = 'History unavailable: ' + err.message;
    }
    U.priceChart(canvas, pts, {
      autoscale: $('yscale').value === 'auto',
      label: 'YES contract price (USD)',
      subtitle: pts.length ? pts.length + ' points · ' + (interval === 'ticks' ? 'trades' : interval + ' candles') : note
    });
    if (!pts.length) $('chart-title').innerHTML += ' <span class="warn-text">— ' + K.esc(note) + '</span>';
  }

  async function loadBook(ticker) {
    $('book-title').textContent = 'Loading ' + ticker + ' …';
    try {
      const book = await K.orderbook(ticker, 30);
      const yes = book.yes.slice().reverse(), no = book.no.slice().reverse();
      $('book-title').innerHTML = '<code>' + K.esc(ticker) + '</code> · depth = top 30 levels per side';
      $('book-summary').innerHTML = [
        ['Best YES bid', book.bestYesBid ? K.usd(book.bestYesBid.price, 4) + ' × ' + K.cnt(book.bestYesBid.count) : ''],
        ['Implied YES ask', book.yesAsk === null ? '' : '$' + book.yesAsk.toFixed(4)],
        ['Spread', book.spread === null ? '' : '$' + book.spread.toFixed(4)],
        ['Best NO bid', book.bestNoBid ? K.usd(book.bestNoBid.price, 4) + ' × ' + K.cnt(book.bestNoBid.count) : ''],
        ['YES bid depth', K.cnt(book.yesContracts) + ' contracts · ' + K.usd(book.yesDollars)],
        ['NO bid depth', K.cnt(book.noContracts) + ' contracts · ' + K.usd(book.noDollars)]
      ].map((kv) => '<div class="row"><span>' + kv[0] + '</span><b>' + (kv[1] || '<i class="warn-text">not returned</i>') + '</b></div>').join('') +
        '<div class="row"><span>Source</span><b><a href="' + book.requestedUrl + '" target="_blank" rel="noreferrer">order-book response ↗</a></b></div>';
      const rows = yes.map((l) => ({ side: 'yes', price: l.price, count: l.count, dollars: l.dollars }))
        .concat(no.map((l) => ({ side: 'no', price: l.price, count: l.count, dollars: l.dollars })));
      U.ladder(rows, $('book-ladder'));
    } catch (err) {
      $('book-ladder').innerHTML = '<div class="empty">Order book unavailable: ' + K.esc(err.message) + '. No values substituted.</div>';
      $('book-summary').innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------ init */
  $('host').value = K.state.host;
  $('host').addEventListener('change', () => {
    K.state.host = $('host').value;
    localStorage.setItem('kd.host', K.state.host);
    localStorage.removeItem('kd.taxonomy');
    runScan();
  });
  $('scan').addEventListener('click', runScan);
  $('topic').addEventListener('change', runScan);
  $('window').addEventListener('change', runScan);
  $('deepscan').addEventListener('click', async () => {
    $('scan-meta').textContent = 'Refreshing watch list resolutions…';
    const upd = await K.trackResolutions();
    $('scan-meta').innerHTML = 'Watch list refreshed: ' + upd.length + ' update record(s). See <a href="resolutions.html">Resolutions</a>.';
    renderWatchKpi();
  });
  $('cadence').addEventListener('change', armCadence);
  function armCadence() {
    if (timer) clearInterval(timer);
    const ms = Number($('cadence').value);
    if (ms > 0) timer = setInterval(runScan, ms);
  }
  $('reload-chart').addEventListener('click', () => {
    if (!scan || !selected) return;
    const row = scan.rows.find((r) => r.event_ticker === selected);
    const best = row.markets.slice().sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0))[0];
    loadPair(row, best);
  });
  ['interval', 'range', 'yscale'].forEach((id) => $(id).addEventListener('change', () => $('reload-chart').click()));
  window.addEventListener('resize', () => { if (scan && selected) $('reload-chart').click(); });

  renderLog();
  renderWatchKpi();
  armCadence();
  (async () => {
    try {
      const st = await K.api('/exchange/status');
      $('conn').textContent = 'Demo API reachable · trading_active=' + st.trading_active;
      $('conn').className = 'status-pill live';
      renderLog();
    } catch (err) {
      $('conn').textContent = 'Not connected';
      $('conn').className = 'status-pill unverified';
      if (err.transport) { $('blocked').hidden = false; $('blocked-origin').textContent = location.origin; $('blocked-host').textContent = K.state.host; }
      renderLog();
      return;
    }
    runScan();
  })();
})();
