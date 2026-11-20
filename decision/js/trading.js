/* Trading page: V2 order placement with explicit preview + confirmation,
 * order management, local journal. Requires demo API key (Portfolio page). */
(function () {
  'use strict';
  var K = window.KALSHI, S = window.SITE;
  var pending = null; // validated order object awaiting confirmation

  function banner(kind, html) {
    var b = document.getElementById('connect-banner');
    b.className = 'banner ' + kind; b.innerHTML = html;
  }

  function refreshConn() {
    if (K.isConnected()) {
      banner('ok', '<b>Connected</b> (' + K.keyAlgo() + '). Orders will be signed in-browser and sent only to external-api.demo.kalshi.co.');
    } else {
      banner('warn', '<b>Not connected.</b> Connect your demo API key on the <a href="portfolio.html">Portfolio page</a> first. Trading panels stay blank until then.');
    }
  }

  /* ---- market fetch & validation ------------------------------------ */
  var market = null;

  function onGrid(price, ranges) { // price_ranges = [{start,end,step}] in dollars (verified field)
    if (!ranges || !ranges.length) return true; // nothing to validate against — do not block, but note it
    return ranges.some(function (r) {
      var p = price, s = K.fp(r.step), a = K.fp(r.start), b = K.fp(r.end);
      if (s === null || a === null || b === null) return false;
      return p >= a - 1e-9 && p <= b + 1e-9 && Math.abs((p - a) / s - Math.round((p - a) / s)) < 1e-6;
    });
  }

  document.getElementById('ord-fetch').onclick = function () {
    var t = document.getElementById('ord-ticker').value.trim();
    var box = document.getElementById('ord-market-info');
    if (!t) { box.textContent = 'Enter a market ticker.'; return; }
    K.publicGet('/markets/' + encodeURIComponent(t), {}).then(function (m) {
      market = m;
      var ranges = (m.price_ranges || []).map(function (r) { return '$' + r.start + '–$' + r.end + ' step ' + r.step; }).join('; ');
      box.innerHTML = '<b>' + K.esc(m.title || m.ticker) + '</b> · status <span class="mono">' + K.esc(m.status) + '</span>' +
        (m.result ? ' · result ' + K.esc(m.result) : '') +
        '<br>last ' + K.money(K.fp(m.last_price_dollars)) + ' · bid/ask ' + K.money(K.fp(m.yes_bid_dollars)) + ' / ' + K.money(K.fp(m.yes_ask_dollars)) +
        '<br>price grid: <span class="mono">' + K.esc(ranges) + '</span>' +
        '<br>Source: <a href="' + K.BASE + '/markets/' + encodeURIComponent(t) + '" target="_blank" rel="noreferrer">GET /markets/' + K.esc(t) + ' ↗</a>';
      document.getElementById('ord-validation').innerHTML = 'Market loaded. Price grid checks will run on preview.';
    }).catch(function (e) {
      market = null;
      box.innerHTML = '<span class="down">Market fetch failed: ' + K.esc(e.message) + '</span> — check the ticker (demo markets only).';
    });
  };

  function validate() {
    var errs = [];
    var count = document.getElementById('ord-count').value.trim();
    var price = document.getElementById('ord-price').value.trim();
    var tif = document.getElementById('ord-tif').value;
    var reduceOnly = document.getElementById('ord-reduceonly').checked;
    var exp = document.getElementById('ord-exp').value.trim();
    if (!market) errs.push('Fetch the market first (validation needs its price grid).');
    if (!/^\d+(\.\d{1,2})?$/.test(count) || K.fp(count) === null || K.fp(count) < 0.01) errs.push('Count must be ≥ 0.01 with ≤ 2 decimals (fixed-point rule).');
    if (!/^\d*\.?\d{1,4}$/.test(price)) errs.push('Price must have ≤ 4 decimal places (fixed-point dollars).');
    if (market && !onGrid(Number(price), market.price_ranges)) errs.push('Price is NOT on this market\'s official grid (see price_ranges above).');
    if (reduceOnly && tif !== 'immediate_or_cancel') errs.push('reduce_only requires time_in_force = immediate_or_cancel (official rule).');
    if (exp && tif !== 'good_till_canceled') errs.push('expiration_time requires good_till_canceled.');
    if (document.getElementById('ord-postonly').checked && tif === 'fill_or_kill') errs.push('post_only with fill_or_kill would be immediately cancelled — choose another TIF.');
    return { errs: errs, count: count, price: price };
  }

  document.getElementById('ord-preview').onclick = function () {
    var v = validate();
    var box = document.getElementById('ord-preview-box');
    var valEl = document.getElementById('ord-validation');
    if (v.errs.length) {
      valEl.innerHTML = '<span class="down">Not valid:</span><ul style="margin:6px 0 0 18px">' + v.errs.map(function (e) { return '<li>' + K.esc(e) + '</li>'; }).join('') + '</ul>';
      box.innerHTML = ''; pending = null; return;
    }
    valEl.innerHTML = '<span class="up">Validation passed against official market fields.</span>';
    var body = {
      ticker: document.getElementById('ord-ticker').value.trim(),
      side: document.getElementById('ord-side').value,
      count: K.fp(v.count).toFixed(2),
      price: v.price.indexOf('.') === -1 ? v.price + '.0000' : (v.price.split('.')[1].length < 4 ? v.price + '0'.repeat(4 - v.price.split('.')[1].length) : v.price),
      time_in_force: document.getElementById('ord-tif').value,
      self_trade_prevention_type: document.getElementById('ord-stp').value,
      post_only: document.getElementById('ord-postonly').checked,
      cancel_order_on_pause: false,
      reduce_only: document.getElementById('ord-reduceonly').checked
    };
    if (document.getElementById('ord-exp').value.trim()) body.expiration_time = Number(document.getElementById('ord-exp').value.trim());
    pending = { body: body, path: '/trade-api/v2/portfolio/events/orders', strategy: document.getElementById('ord-strategy').value };
    box.innerHTML =
      '<div class="banner warn"><b>Confirmation required.</b> This exact JSON will be signed in-browser and POSTed to <span class="mono">' + K.esc(pending.path) + '</span>. Mock funds only — but confirm you intend this trade.</div>' +
      '<pre class="code">' + K.esc(JSON.stringify(body, null, 2)) + '</pre>' +
      '<div class="toolbar"><button class="primary" id="ord-send">Sign & send</button><button id="ord-cancel" class="danger">Discard</button></div>' +
      '<div id="ord-result"></div>';
    document.getElementById('ord-cancel').onclick = function () { pending = null; box.innerHTML = '<div class="empty">Discarded — nothing was signed or sent.</div>'; };
    document.getElementById('ord-send').onclick = send;
  };

  function send() {
    if (!pending) return;
    if (!K.isConnected()) { alert('Connect a demo API key on the Portfolio page first.'); return; }
    var res = document.getElementById('ord-result');
    res.innerHTML = '<span class="badge info">Signing…</span>';
    K.signedRequest('POST', 'portfolio/events/orders', pending.body).then(function (d) {
      res.innerHTML = '<div class="banner ok"><b>Accepted.</b> Remember: 201 = accepted, not necessarily filled — check <code>remaining_count</code>. Raw:</div><pre class="code">' + K.esc(JSON.stringify(d, null, 2)) + '</pre>';
      journal(pending, d, 'accepted');
      pending = null;
      loadOrders();
    }).catch(function (e) {
      res.innerHTML = '<div class="banner err">Rejected or failed: ' + K.esc(String(e.message || e)) + '<br>Order-error reference: <a href="https://docs.kalshi.com/getting_started/order_errors" target="_blank" rel="noreferrer">official order errors ↗</a></div>';
      journal(pending, { error: String(e.message || e) }, 'failed');
    });
  }

  /* ---- journal ------------------------------------------------------- */
  function journal(p, resp, status) {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem('kx_journal') || '[]'); } catch (e) {}
    arr.unshift({ ts: new Date().toISOString(), body: p.body, strategy: p.strategy, response: resp, status: status });
    try { localStorage.setItem('kx_journal', JSON.stringify(arr.slice(0, 200))); } catch (e) {}
    renderJournal();
  }
  function renderJournal() {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem('kx_journal') || '[]'); } catch (e) {}
    var tb = document.getElementById('journal-rows');
    tb.innerHTML = arr.length ? arr.map(function (j, i) {
      var b = j.body || {};
      return '<tr><td class="mono dim">' + K.esc(j.ts.replace('T', ' ').slice(0, 19)) + '</td>' +
        '<td class="mono">' + K.esc(b.ticker || '') + '</td><td>' + K.esc(b.side || '') + '</td>' +
        '<td class="num">' + K.esc(b.count || '') + ' × $' + K.esc(b.price || '') + '</td>' +
        '<td><span class="pill">' + K.esc(j.strategy || '') + '</span></td>' +
        '<td><span class="badge ' + (j.status === 'accepted' ? 'live' : 'err') + '">' + K.esc(j.status) + '</span></td>' +
        '<td><details class="raw"><summary>raw</summary><pre class="code">' + K.esc(JSON.stringify(j, null, 1)) + '</pre></details></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">No orders placed from this site yet.</td></tr>';
  }
  document.getElementById('clear-journal').onclick = function () {
    if (confirm('Clear the local order journal?')) { try { localStorage.removeItem('kx_journal'); } catch (e) {} renderJournal(); }
  };

  /* ---- orders list & cancel ------------------------------------------ */
  function loadOrders() {
    if (!K.isConnected()) return;
    var status = document.getElementById('ord-status').value;
    return K.signedRequest('GET', 'portfolio/orders?status=' + encodeURIComponent(status) + '&limit=100').then(function (d) {
      var rows = d.orders || [];
      var tb = document.getElementById('orders-rows');
      tb.innerHTML = rows.length ? rows.map(function (o) {
        return '<tr><td class="mono" style="font-size:11px">' + K.esc(o.order_id) + '</td><td class="mono">' + K.esc(o.ticker) + '</td>' +
          '<td>' + K.esc(o.outcome_side || o.side || '') + '</td><td>' + K.esc(o.book_side || '') + '</td>' +
          '<td class="num">' + K.money(K.fp(o.yes_price_dollars)) + '</td>' +
          '<td class="num">' + K.esc(o.initial_count_fp) + ' / ' + K.esc(o.fill_count_fp) + ' / ' + K.esc(o.remaining_count_fp) + '</td>' +
          '<td>' + K.esc(o.status || '') + '</td>' +
          '<td>' + (o.status === 'resting' ? '<button class="danger" data-cancel="' + K.esc(o.order_id) + '" data-mkt="' + K.esc(o.ticker) + '">cancel</button>' : '') + '</td>' +
          '<td class="src"><a href="https://docs.kalshi.com/api-reference/orders/get-orders" target="_blank" rel="noreferrer">docs ↗</a></td></tr>';
      }).join('') : '<tr><td colspan="9" class="empty">No ' + K.esc(status) + ' orders returned.</td></tr>';
      Array.prototype.forEach.call(tb.querySelectorAll('[data-cancel]'), function (btn) {
        btn.onclick = function () {
          if (!confirm('Cancel order ' + btn.getAttribute('data-cancel') + '?')) return;
          K.signedRequest('DELETE', 'portfolio/events/orders/' + encodeURIComponent(btn.getAttribute('data-cancel')) + '?market_ticker=' + encodeURIComponent(btn.getAttribute('data-mkt')))
            .then(function (r) { alert('Cancelled: ' + JSON.stringify(r)); loadOrders(); })
            .catch(function (e) { alert('Cancel failed: ' + e.message); });
        };
      });
    }).catch(function (e) {
      document.getElementById('orders-rows').innerHTML = '<tr><td colspan="9" class="empty">Order load failed: ' + K.esc(e.message) + '</td></tr>';
    });
  }
  document.getElementById('load-orders').onclick = loadOrders;
  document.getElementById('ord-status').onchange = loadOrders;

  S.renderNav('trading.html');
  K.restore().then(function (restored) { refreshConn(); if (restored) loadOrders(); renderJournal(); });
})();
