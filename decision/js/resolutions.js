/* Resolution tracking: live events for the 5 topics watched until settled.
 * Persistence is browser-local (localStorage key kx_track). No invented data. */
(function () {
  'use strict';
  var K = window.KALSHI, S = window.SITE;
  var STORE = 'kx_track';

  function loadTrack() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
  }
  function saveTrack(t) {
    try { localStorage.setItem(STORE, JSON.stringify(t)); } catch (e) { /* ignore */ }
  }

  function allowlist() { return K.buildAllowlist([]); }

  function classifyFallback(ev, map) {
    return map[ev.series_ticker] || null;
  }

  /* Fetch open events for the topics; enrich with tracking history. */
  function check() {
    var map = allowlist();
    var openUrl = K.BASE + '/events?status=open&with_nested_markets=true&limit=200';
    return K.publicGetAll('/events', { status: 'open', with_nested_markets: true }, 8, 200)
      .then(function (events) {
        var topicEvents = events.filter(function (ev) { return map[ev.series_ticker]; });
        var track = loadTrack();
        var now = new Date().toISOString();
        topicEvents.forEach(function (ev) {
          if (!track[ev.event_ticker]) {
            track[ev.event_ticker] = { series: ev.series_ticker, title: ev.title, first_seen: now, history: [{ ts: now, status: 'open' }] };
          } else {
            var last = track[ev.event_ticker].history[track[ev.event_ticker].history.length - 1];
            if (last && last.status !== 'open') track[ev.event_ticker].history.push({ ts: now, status: 'open-again' });
          }
          var m = (ev.markets || []).slice().sort(function (a, b) { return (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0); })[0];
          track[ev.event_ticker].top_market = m ? m.ticker : null;
        });
        // Any tracked event no longer open → query settled state directly.
        var gone = Object.keys(track).filter(function (t) {
          return !topicEvents.some(function (ev) { return ev.event_ticker === t; }) && !track[t].resolved;
        }).slice(0, 12);
        saveTrack(track);
        render(map, topicEvents, track);
        return Promise.all(gone.map(function (t) { return resolveOne(t, track); })).then(function () {
          saveTrack(track); render(map, topicEvents, track);
        });
      })
      .then(function () {
        S.setConn('live', 'Tracking live · demo API');
        banner('ok', '<b>Live check completed</b> — watchlist refreshed from official demo API endpoints.');
      })
      .catch(function (e) {
        S.setConn('snap', 'API unreachable — showing seed history');
        banner('warn', '<b>Live demo API unreachable</b> (' + K.esc(String(e && e.message || e)) + '). The resolved-history sample below is from committed, source-linked snapshots. Watchlist refresh will retry.');
        renderSeedOnly();
      });
  }

  function resolveOne(ticker, track) {
    var rec = track[ticker];
    var mktUrl = K.BASE + '/markets?event_ticker=' + encodeURIComponent(ticker);
    return K.publicGet('/markets', { event_ticker: ticker }).then(function (d) {
      var ms = d.markets || [];
      if (!ms.length) return;
      var finalized = ms.every(function (m) { return m.status === 'finalized' || m.result; });
      var yes = ms.filter(function (m) { return m.result === 'yes'; }).map(function (m) { return m.ticker; });
      rec.resolved = { when: new Date().toISOString(), finalized_all: finalized, yes_markets: yes.slice(0, 12),
        markets: ms.slice(0, 12).map(function (m) { return { ticker: m.ticker, result: m.result || '', status: m.status, settlement_ts: m.settlement_ts || '', settlement_value_dollars: m.settlement_value_dollars || '' }; }),
        source_url: mktUrl };
      rec.history.push({ ts: new Date().toISOString(), status: finalized ? 'settled' : 'closed', result: yes.length ? 'yes (' + yes.length + ' mkt)' : 'no' });
    }).catch(function () { /* keep unresolved */ });
  }

  function banner(kind, html) {
    var b = document.getElementById('mode-banner');
    b.className = 'banner ' + kind; b.innerHTML = html;
  }

  function outcomeCell(rec) {
    if (rec && rec.resolved) {
      var yes = rec.resolved.yes_markets && rec.resolved.yes_markets.length;
      return yes ? '<span class="badge live">YES</span>' : '<span class="badge err">NO</span>';
    }
    return '<span class="badge info">live</span>';
  }

  function render(map, topicEvents, track) {
    var rows = [];
    Object.keys(track).forEach(function (t) {
      var rec = track[t];
      var h = rec.history || [];
      var lastStatus = h.length ? h[h.length - 1].status : '';
      var topSrc = rec.resolved ? rec.resolved.source_url : (K.BASE + '/events?status=open&with_nested_markets=true&series_ticker=' + encodeURIComponent(rec.series || ''));
      var detail = '';
      if (rec.resolved) {
        detail = '<details class="raw"><summary>' + rec.resolved.markets.length + ' market results</summary><pre class="code">' +
          K.esc(JSON.stringify(rec.resolved.markets, null, 1)) + '</pre></details>';
      } else if (rec.top_market) {
        detail = '<span class="dim mono" style="font-size:11px">top market: ' + K.esc(rec.top_market) + '</span>';
      }
      rows.push('<tr><td><b>' + K.esc(rec.title || t) + '</b><br><span class="dim mono" style="font-size:11px">' + K.esc(t) + '</span>' + detail + '</td>' +
        '<td><span class="pill">' + K.esc((map[rec.series] || '').toUpperCase() || '—') + '</span></td>' +
        '<td class="mono dim">' + K.esc((rec.first_seen || '').replace('T', ' ').slice(0, 19)) + '</td>' +
        '<td>' + K.esc(lastStatus) + '</td>' +
        '<td>' + outcomeCell(rec) + '</td>' +
        '<td class="mono dim">' + (rec.resolved ? K.esc((rec.resolved.markets[0] && rec.resolved.markets[0].settlement_ts) || rec.resolved.when).replace('T', ' ').slice(0, 19) : '') + '</td>' +
        '<td class="src"><a href="' + K.esc(topSrc) + '" target="_blank" rel="noreferrer">query ↗</a></td></tr>');
    });
    if (topicEvents && topicEvents.length) {
      var known = Object.keys(track);
      topicEvents.forEach(function (ev) {
        if (known.indexOf(ev.event_ticker) !== -1) return;
        rows.push('<tr><td><b>' + K.esc(ev.title) + '</b><br><span class="dim mono" style="font-size:11px">' + K.esc(ev.event_ticker) + '</span></td>' +
          '<td><span class="pill">' + K.esc((map[ev.series_ticker] || '').toUpperCase()) + '</span></td>' +
          '<td class="dim">this check</td><td>open</td><td><span class="badge info">live</span></td><td></td>' +
          '<td class="src"><a href="' + K.esc(K.BASE + '/events?status=open&with_nested_markets=true&series_ticker=' + encodeURIComponent(ev.series_ticker)) + '" target="_blank" rel="noreferrer">query ↗</a></td></tr>');
      });
    }
    document.getElementById('track-rows').innerHTML = rows.join('') || '<tr><td colspan="7" class="empty">No tracked events yet — press “Check now”.</td></tr>';
  }

  function renderSeedOnly() {
    return S.loadSnapshot('snapshot-resolutions-gas.json').then(function (snap) {
      var tb = document.querySelector('#resolved-table tbody');
      tb.innerHTML = snap.resolved_markets.map(function (m) {
        return '<tr><td class="mono">' + K.esc(m.ticker) + '</td><td>' + K.esc(m.yes_sub_title) + '</td>' +
          '<td><span class="badge ' + (m.result === 'yes' ? 'live' : 'err') + '">' + K.esc(m.result.toUpperCase()) + '</span></td>' +
          '<td>' + K.esc(m.status) + '</td><td class="mono dim">' + K.esc(m.settlement_ts) + '</td>' +
          '<td class="num">' + K.money(K.fp(m.settlement_value_dollars), 4) + '</td>' +
          '<td class="src"><a href="' + K.esc(snap.source_url.split(' and ')[0]) + '" target="_blank" rel="noreferrer">query ↗</a></td></tr>';
      }).join('');
    }).catch(function () {
      document.querySelector('#resolved-table tbody').innerHTML = '<tr><td colspan="7" class="empty">Snapshot unavailable.</td></tr>';
    });
  }

  function restart() {
    if (window._trackTimer) clearInterval(window._trackTimer);
    var s = parseInt(document.getElementById('track-secs').value, 10);
    if (s > 0) window._trackTimer = setInterval(function () { if (!document.hidden) check(); }, s * 1000);
  }

  document.getElementById('check-now').onclick = check;
  document.getElementById('track-secs').onchange = restart;
  document.getElementById('clear-track').onclick = function () {
    if (confirm('Clear local tracking history (first-seen times and recorded outcomes)?')) {
      try { localStorage.removeItem('kx_track'); } catch (e) {}
      check();
    }
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });

  S.renderNav('resolutions.html');
  S.setConn('off', 'connecting…');
  check().then(function () { return renderSeedOnly(); });
  restart();
})();
