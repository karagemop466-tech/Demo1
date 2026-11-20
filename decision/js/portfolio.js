/* Portfolio page: connect (signed), balance, positions, fills, session P&L. */
(function () {
  'use strict';
  var K = window.KALSHI, S = window.SITE, C = window.CHARTS;
  var sessionBalances = [];

  function banner(kind, html) {
    var b = document.getElementById('mode-banner');
    b.className = 'banner ' + kind; b.innerHTML = html;
  }

  function refreshUI() {
    var connected = K.isConnected();
    var badge = document.getElementById('perf-badge');
    badge.textContent = connected ? 'CONNECTED · ' + K.keyAlgo() : 'NOT CONNECTED';
    badge.className = 'badge ' + (connected ? 'live' : 'warn');
    var c = document.getElementById('conn');
    if (connected) { c.className = 'conn live'; document.getElementById('conn-text').textContent = 'Demo key connected (' + K.keyAlgo() + ')'; }
    else { c.className = 'conn off'; document.getElementById('conn-text').textContent = 'No demo key'; }
  }

  /* ---------- balance ------------------------------------------------------ */
  function loadBalance() {
    return K.signedRequest('GET', 'portfolio/balance').then(function (d) {
      // Official schema: balance & portfolio_value in cents; balance_dollars fp string.
      var bal = K.fp(d.balance_dollars); if (bal === null && d.balance !== undefined) bal = d.balance / 100;
      var val = (d.portfolio_value !== undefined && d.portfolio_value !== null) ? d.portfolio_value / 100 : null;
      document.getElementById('pf-balance').textContent = bal === null ? '' : K.money(bal);
      document.getElementById('pf-value').textContent = val === null ? '' : K.money(val);
      document.getElementById('balance-src').innerHTML = 'Source: signed GET <span class="mono">/portfolio/balance</span> — response raw: <code>' +
        K.esc(JSON.stringify(d).slice(0, 300)) + '</code> · <a href="https://docs.kalshi.com/api-reference/portfolio/get-balance" target="_blank" rel="noreferrer">docs ↗</a>';
      sessionBalances.push({ t: Date.now(), v: val });
      drawSession();
      return d;
    });
  }

  function drawSession() {
    if (sessionBalances.length < 2) return;
    C.lineChart(document.getElementById('session-chart'), sessionBalances.slice(-200), { sourceLabel: 'session samples (60 s), in-browser only' });
  }
  setInterval(function () { if (!document.hidden && K.isConnected()) loadBalance().catch(function () {}); }, 60000);

  /* ---------- positions ---------------------------------------------------- */
  function topicOf(ticker) {
    // Best-effort: match seeded/known series by ticker prefix (market tickers start with series ticker)
    var topics = K.TOPICS, seeds = K.seedSeries, hit = '';
    for (var i = 0; i < topics.length; i++) {
      var t = topics[i];
      for (var j = 0; j < (seeds[t] || []).length; j++) {
        if (ticker.indexOf(seeds[t][j]) === 0) return t;
      }
    }
    if (/^KXAAAGAS|^KXDIESEL/.test(ticker)) return 'gas';
    if (/^KXPGATOUR|^KXPGA|^GOLF|^KXDPWT/.test(ticker)) return 'golf';
    if (/BTC|ETH|DOGE|SOL|XRP|CRYPTO|AVAX|SUI|HYPE/i.test(ticker)) return 'crypto';
    return '';
  }

  function loadPositions() {
    return K.signedRequest('GET', 'portfolio/positions?count_filter=position&limit=500').then(function (d) {
      var rows = (d.market_positions || []);
      var tbody = document.getElementById('positions-rows');
      if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty">No open positions returned.</td></tr>'; }
      else {
        tbody.innerHTML = rows.map(function (p) {
          var pos = K.fp(p.position_fp);
          var dir = pos === null ? '' : (pos > 0 ? 'YES ×' : (pos < 0 ? 'NO ×' : ''));
          return '<tr><td class="mono">' + K.esc(p.ticker) + '</td><td><span class="pill">' + K.esc(topicOf(p.ticker)) + '</span></td>' +
            '<td class="num">' + (pos === null ? '' : K.cnt(pos) + ' (' + dir + ')') + '</td>' +
            '<td class="num">' + K.money(K.fp(p.market_exposure_dollars)) + '</td>' +
            '<td class="num ' + ((K.fp(p.realized_pnl_dollars) || 0) < 0 ? 'down' : 'up') + '">' + K.money(K.fp(p.realized_pnl_dollars)) + '</td>' +
            '<td class="num">' + K.money(K.fp(p.fees_paid_dollars)) + '</td>' +
            '<td class="num">' + K.money(K.fp(p.total_traded_dollars)) + '</td>' +
            '<td class="mono dim">' + K.esc(String(p.last_updated_ts || '').replace('T', ' ')) + '</td>' +
            '<td class="src"><a href="https://docs.kalshi.com/api-reference/portfolio/get-positions" target="_blank" rel="noreferrer">docs ↗</a></td></tr>';
        }).join('');
        var pnl = rows.reduce(function (a, p) { var v = K.fp(p.realized_pnl_dollars); return a + (v || 0); }, 0);
        var fees = rows.reduce(function (a, p) { var v = K.fp(p.fees_paid_dollars); return a + (v || 0); }, 0);
        document.getElementById('pf-pnl').textContent = K.money(pnl);
        document.getElementById('pf-fees').textContent = K.money(fees);
      }
      document.getElementById('positions-raw').textContent = JSON.stringify(d, null, 2);
    });
  }

  /* ---------- fills -------------------------------------------------------- */
  function direction(outcomeSide, bookSide) { // official mapping, verified
    if (!outcomeSide || !bookSide) return '';
    var isBuy = (outcomeSide === 'yes' && bookSide === 'bid') || (outcomeSide === 'no' && bookSide === 'ask');
    return isBuy ? 'buy' : 'sell';
  }

  function loadFills() {
    return K.signedRequest('GET', 'portfolio/fills?limit=200').then(function (d) {
      var fills = d.fills || [];
      var tbody = document.getElementById('fills-rows');
      if (!fills.length) tbody.innerHTML = '<tr><td colspan="11" class="empty">No fills returned.</td></tr>';
      else {
        tbody.innerHTML = fills.map(function (f) {
          var price = K.fp(f.yes_price_dollars), c = K.fp(f.count_fp);
          return '<tr><td class="mono dim">' + K.esc(String(f.created_time || '').replace('T', ' ').slice(0, 19)) + '</td>' +
            '<td class="mono">' + K.esc(f.ticker || f.market_ticker || '') + '</td>' +
            '<td><span class="pill">' + K.esc(topicOf(f.ticker || f.market_ticker || '')) + '</span></td>' +
            '<td>' + K.esc(f.outcome_side || f.side || '') + '</td><td>' + K.esc(f.book_side || '') + '</td>' +
            '<td>' + direction(f.outcome_side || f.side, f.book_side) + '</td>' +
            '<td class="num">' + K.cnt(c) + '</td><td class="num">' + K.money(price) + '</td>' +
            '<td>' + (f.is_taker ? 'taker' : 'maker') + '</td>' +
            '<td class="num">' + K.esc(f.fee_cost === undefined || f.fee_cost === null ? '' : String(f.fee_cost)) + '</td>' +
            '<td class="src"><a href="https://docs.kalshi.com/api-reference/portfolio/get-fills" target="_blank" rel="noreferrer">docs ↗</a></td></tr>';
        }).join('');
      }
      renderStrategy(fills);
    });
  }

  function renderStrategy(fills) {
    var agg = {};
    fills.forEach(function (f) {
      var topic = topicOf(f.ticker || f.market_ticker || '') || 'other';
      var exec = f.is_taker ? 'taker' : 'maker';
      var key = topic + ' · ' + exec;
      var c = K.fp(f.count_fp) || 0, p = K.fp(f.yes_price_dollars) || 0;
      if (!agg[key]) agg[key] = { n: 0, count: 0, notional: 0 };
      agg[key].n++; agg[key].count += c; agg[key].notional += Math.abs(c * p);
    });
    var keys = Object.keys(agg);
    document.getElementById('strategy-rows').innerHTML = keys.length
      ? keys.map(function (k) { var a = agg[k]; return '<tr><td>' + K.esc(k.split(' · ')[0]) + '</td><td>' + K.esc(k.split(' · ')[1]) + '</td><td class="num">' + a.n + '</td><td class="num">' + K.cnt(a.count) + '</td><td class="num">' + K.money(a.notional) + '</td></tr>'; }).join('')
      : '<tr><td colspan="5" class="empty">No fills returned.</td></tr>';
  }

  /* ---------- wiring ------------------------------------------------------- */
  document.getElementById('connect').onclick = function () {
    var id = document.getElementById('key-id').value.trim();
    var pem = document.getElementById('key-pem').value;
    var remember = document.getElementById('remember').checked;
    var out = document.getElementById('connect-result');
    out.innerHTML = '<span class="badge info">Importing & signing test request…</span>';
    K.connect(id, pem, remember).then(function (bal) {
      out.innerHTML = '<div class="banner ok">Connected. Key algorithm detected: <b>' + K.esc(K.keyAlgo()) + '</b>. Balance response received (signed request works).</div>';
      refreshUI();
      loadBalance().then(loadPositions).then(loadFills).catch(function (e) {
        out.innerHTML += '<div class="banner err">Signed GET succeeded but a follow-up load failed: ' + K.esc(e.message) + '</div>';
      });
    }).catch(function (e) {
      out.innerHTML = '<div class="banner err">Connection failed: ' + K.esc(String(e.message || e)) + '<br>Common causes: wrong key pair for this key ID, RSA key pasted without header lines, Ed25519 unsupported in this browser (use current Chrome/Safari), or the key lacks portfolio scope. <a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noreferrer">API keys docs ↗</a></div>';
    });
  };
  document.getElementById('disconnect').onclick = function () {
    K.disconnect();
    document.getElementById('key-pem').value = '';
    document.getElementById('connect-result').innerHTML = '<div class="banner warn">Disconnected and erased local key material.</div>';
    refreshUI();
  };
  document.getElementById('load-positions').onclick = function () { loadPositions().catch(function (e) { alert(e.message); }); };
  document.getElementById('raw-positions').onclick = function () { document.getElementById('positions-raw').hidden = !document.getElementById('positions-raw').hidden; };
  document.getElementById('load-fills').onclick = function () { loadFills().catch(function (e) { alert(e.message); }); };

  S.renderNav('portfolio.html');
  K.restore().then(function (restored) {
    refreshUI();
    if (restored) {
      banner('ok', '<b>Connected</b> from remembered key (this device). Algorithm: ' + K.keyAlgo());
      loadBalance().then(loadPositions).then(loadFills).catch(function (e) {
        banner('err', 'Restored key failed a signed request: ' + K.esc(String(e.message || e)) + ' — reconnect manually.');
      });
    } else {
      banner('warn', '<b>Not connected.</b> Portfolio panels stay blank until you connect a demo API key above — the site never fabricates account values.');
    }
  });
})();
