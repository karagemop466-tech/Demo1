/* Market detail page: renders ONLY fields present in the collected snapshot. */
(function () {
  var el = document.getElementById('detailData');
  var host = document.getElementById('detail');
  if (!el || !host) return;
  var data = JSON.parse(el.textContent || '{"markets":{}}');
  var markets = data.markets || {};
  var charts = data.charts || {};
  var params = new URLSearchParams(location.search);
  var ticker = params.get('t');
  var m = markets[ticker];
  if (!m) {
    host.innerHTML = "<div class='callout warn'>No market with ticker <code>" +
      (ticker ? ticker.replace(/[<>&]/g, '') : '(none given)') +
      "</code> in this snapshot. It may have been outside the collected topic scope.</div>" +
      "<p class='fine'><a href='markets.html'>Browse all collected markets</a></p>";
    return;
  }
  function n(v, suffix) {
    if (v === null || v === undefined || v === '') return "<span class='na'>—</span>";
    return String(v) + (suffix || '');
  }
  function c(v) {
    if (v === null || v === undefined || v === '') return "<span class='na'>—</span>";
    var f = parseFloat(v);
    if (isNaN(f)) return String(v);
    return (f * 100).toFixed(1);
  }
  function a(url, label) {
    if (!url) return "<span class='na'>—</span>";
    return "<a href='" + url + "' target='_blank' rel='noreferrer'>" + (label || 'request') + " \u2197</a>";
  }
  var q = m.quotes || {}, y = q.yes || {}, no = q.no || {};
  var ob = m.orderbook || {};
  var srcs = m.sources || {};
  var rows = [
    ['Ticker', "<code>" + m.market_ticker + "</code>"],
    ['Event', n(m.event_title) + " <span class='fine'>" + n(m.event_ticker) + "</span>"],
    ['Title', n(m.title)],
    ['Topic (rule-based)', n(m.topic)],
    ['Status', n(m.status)],
    ['Result', m.result ? "<b>" + m.result.toUpperCase() + "</b>" : "<span class='na'>not resolved</span>"],
    ['Settlement value', n(m.settlement_value_dollars)],
    ['Settled (UTC)', n(m.settlement_ts)],
    ['YES bid \u00a2', c(y.bid) + (y.bid_is_live ? '' : " <span class='pill warn'>no size</span>")],
    ['YES ask \u00a2', c(y.ask) + (y.ask_is_live ? '' : " <span class='pill warn'>no size</span>")],
    ['NO bid \u00a2', c(no.bid) + (no.bid_is_live ? '' : " <span class='pill warn'>no size</span>")],
    ['NO ask \u00a2', c(no.ask) + (no.ask_is_live ? '' : " <span class='pill warn'>no size</span>")],
    ['Contracts at YES bid', n(y.bid_size_contracts)],
    ['Contracts at YES ask', n(y.ask_size_contracts)],
    ['Last price \u00a2', c(m.last_price)],
    ['24h volume (contracts)', n(m.volume_24h_contracts)],
    ['Total volume (contracts)', n(m.volume_contracts)],
    ['Open interest (contracts)', n(m.open_interest_contracts)],
    ['Notional value (USD)', n(m.notional_value_dollars)],
    ['Open time', n(m.open_time)],
    ['Close time', n(m.close_time)],
    ['Expected expiration', n(m.expected_expiration_time)],
    ['Rules (excerpt)', n(m.rules_primary)]
  ];
  var html = "<h2 style='border:0;margin-top:0;padding-top:0'>" + (m.title || m.market_ticker) + "</h2>" +
    "<div class='tablewrap'><table><tbody>" +
    rows.map(function (r) { return "<tr><th style='width:230px'>" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join('') +
    "</tbody></table></div>";

  var dn = m.dollar_notional_24h;
  if (dn) {
    html += "<h2>Computed 24 h traded notional</h2><div class='callout'>" +
      "<b>" + (dn.value === null || dn.value === undefined ? '—' : '$' + Number(dn.value).toLocaleString(undefined, { maximumFractionDigits: 2 })) + "</b> across <b>" + n(dn.trades_counted) +
      "</b> public trades. Formula: <code>" + dn.formula + "</code>. " +
      a(dn.source, 'trades request') + (dn.error ? " <span class='pill warn'>" + dn.error + "</span>" : "") +
      "</div>";
  }

  if (ob && (ob.yes_bids || ob.no_bids)) {
    var ys = {}, ns = {};
    (ob.yes_bids || []).forEach(function (b) { ys[b.price] = b.contracts; });
    (ob.no_bids || []).forEach(function (b) { ns[b.price] = b.contracts; });
    var prices = Object.keys(Object.assign({}, ys, ns)).sort(function (p, q2) { return parseFloat(q2) - parseFloat(p); });
    html += "<h2>Order book — contracts available at each price</h2>" +
      "<p class='fine'>Kalshi returns bids only; the YES ask is implied by the best NO bid (1.00 \u2212 NO bid). " +
      "Implied YES ask <b>" + n(ob.implied_yes_ask) + "</b>, implied NO ask <b>" + n(ob.implied_no_ask) + "</b>. " +
      a(ob.source, 'order book request') + "</p>" +
      "<div class='tablewrap'><table><thead><tr><th>Price (USD)</th><th>Price \u00a2</th><th>YES bid contracts</th><th>NO bid contracts</th></tr></thead><tbody>" +
      prices.map(function (p) {
        return "<tr><td>" + p + "</td><td>" + (parseFloat(p) * 100).toFixed(1) + "</td><td>" +
          (ys[p] || "<span class='na'>—</span>") + "</td><td>" + (ns[p] || "<span class='na'>—</span>") + "</td></tr>";
      }).join('') + "</tbody></table></div>";
  } else {
    html += "<h2>Order book</h2><p class='fine'>No book was requested or returned for this market in this snapshot" +
      (ob.error ? " (" + ob.error + ")" : "") + ".</p>";
  }

  if (m.settlement_sources && m.settlement_sources.length) {
    html += "<h2>Resolution sources (from the event)</h2><ul class='tight'>" +
      m.settlement_sources.map(function (s) {
        return "<li><a href='" + s.url + "' target='_blank' rel='noreferrer'>" + (s.name || s.url) + " \u2197</a></li>";
      }).join('') + "</ul>";
  }

  html += "<h2>Official request URLs for this row</h2><div class='tablewrap'><table><tbody>" +
    [['Market record', srcs.market], ['Event record', srcs.event], ['Markets list', srcs.markets], ['Order book', srcs.orderbook]]
      .map(function (r) { return "<tr><th style='width:230px'>" + r[0] + "</th><td>" + a(r[1]) + "</td></tr>"; })
      .join('') + "</tbody></table></div>";

  var ch = charts[m.market_ticker];
  if (ch) {
    html += "<h2>Price history available for this market</h2><div class='tablewrap'><table><thead><tr>" +
      "<th>Bucket</th><th>Points</th><th>Source request</th></tr></thead><tbody>" +
      Object.keys(ch.windows).map(function (k) {
        var w = ch.windows[k];
        return "<tr><td>" + k + "</td><td>" + (w.points || []).length + "</td><td>" + a(w.source) +
          (w.error ? " <span class='pill warn'>" + w.error + "</span>" : "") + "</td></tr>";
      }).join('') + "</tbody></table></div>" +
      "<p class='fine'>Plot it on the <a href='liquidity.html'>Liquidity &amp; chart page</a>.</p>";
  }
  html += "<p class='fine'><a href='markets.html'>\u2190 Back to all markets</a></p>";
  host.innerHTML = html;
})();
