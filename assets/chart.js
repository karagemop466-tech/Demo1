/* Native SVG price chart. No CDN, no external dependency, no fabricated points.
   Reads data collected from GET /series/{s}/markets/{t}/candlesticks. */
(function () {
  var me = document.currentScript;
  var svg = document.getElementById('chart');
  if (!me || !svg) return;
  var series = [];
  var marketSel = document.getElementById('chartMarket');
  var bucketSel = document.getElementById('chartBucket');
  var seriesSel = document.getElementById('chartSeries');
  var note = document.getElementById('chartNote');
  var tableHost = document.getElementById('chartTable');

  function boot() {
  if (!series.length) {
    note.textContent = 'No candlestick history was returned for this snapshot, so nothing is plotted.';
    return;
  }
  series.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.market_ticker;
    opt.textContent = s.market_ticker;
    marketSel.appendChild(opt);
  });

  function draw() {
    var s = series.find(function (x) { return x.market_ticker === marketSel.value; }) || series[0];
    var bucket = s.windows[bucketSel.value] || {};
    var points = (bucket.points || []).filter(function (p) {
      return p[seriesSel.value] !== null && p[seriesSel.value] !== undefined && p.t;
    });
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!points.length) {
      note.textContent = 'The API returned no points with a ' + seriesSel.options[seriesSel.selectedIndex].text +
        ' value for ' + s.market_ticker + ' in this window. Nothing is plotted.';
      tableHost.innerHTML = '';
      return;
    }
    var W = 900, H = 340, L = 58, R = 16, T = 18, B = 42;
    var xs = points.map(function (p) { return p.t * 1000; });
    var ys = points.map(function (p) { return p[seriesSel.value]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 === x0) x1 = x0 + 1000;
    var pad = (y1 - y0) * 0.12 || 0.02;
    y0 = Math.max(0, y0 - pad); y1 = Math.min(1, y1 + pad);
    if (y1 === y0) { y1 = Math.min(1, y0 + 0.02); }
    function X(t) { return L + (t - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var ns = 'http://www.w3.org/2000/svg';
    function el(name, attrs, text) {
      var n = document.createElementNS(ns, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    }
    var defs = el('defs', {});
    var grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'grad'); grad.setAttribute('x1', '0'); grad.setAttribute('x2', '0');
    grad.setAttribute('y1', '0'); grad.setAttribute('y2', '1');
    var st1 = document.createElementNS(ns, 'stop');
    st1.setAttribute('offset', '0%'); st1.setAttribute('stop-color', '#5eead4');
    var st2 = document.createElementNS(ns, 'stop');
    st2.setAttribute('offset', '100%'); st2.setAttribute('stop-color', '#5eead4'); st2.setAttribute('stop-opacity', '0');
    grad.appendChild(st1); grad.appendChild(st2); defs.appendChild(grad);

    // y grid: price in cents
    for (var i = 0; i <= 4; i++) {
      var v = y0 + (y1 - y0) * i / 4;
      var y = Y(v);
      el('line', { class: 'chart-grid', x1: L, x2: W - R, y1: y, y2: y });
      el('text', { class: 'chart-axis', x: L - 8, y: y + 4, 'text-anchor': 'end' },
        (v * 100).toFixed(1) + '\u00a2');
    }
    // x axis ticks (time)
    for (var j = 0; j <= 4; j++) {
      var t = x0 + (x1 - x0) * j / 4;
      var d = new Date(t);
      var lbl = d.toISOString().slice(5, 16).replace('T', ' ');
      el('text', { class: 'chart-axis', x: X(t), y: H - B + 20, 'text-anchor': 'middle' }, lbl);
      el('line', { class: 'chart-grid', x1: X(t), x2: X(t), y1: T, y2: H - B, opacity: .4 });
    }
    el('text', { class: 'chart-axis', x: L - 44, y: T - 4 }, 'price \u00a2');
    el('text', { class: 'chart-axis', x: W - R, y: H - 6, 'text-anchor': 'end' }, 'time (UTC)');

    var dline = points.map(function (p, k) {
      return (k ? 'L' : 'M') + X(p.t * 1000).toFixed(1) + ' ' + Y(p[seriesSel.value]).toFixed(1);
    }).join(' ');
    el('path', { class: 'chart-area', d: dline + ' L' + X(xs[xs.length - 1]) + ' ' + (H - B) + ' L' + X(xs[0]) + ' ' + (H - B) + ' Z' });
    el('path', { class: 'chart-line', d: dline });
    points.forEach(function (p) {
      var c = el('circle', { cx: X(p.t * 1000), cy: Y(p[seriesSel.value]), r: 2.4, class: 'chart-dot' });
      var title = document.createElementNS(ns, 'title');
      title.textContent = new Date(p.t * 1000).toISOString() + ' · ' + (p[seriesSel.value] * 100).toFixed(1) + '\u00a2';
      c.appendChild(title);
    });

    var firstV = points[0][seriesSel.value], lastV = points[points.length - 1][seriesSel.value];
    var chg = (lastV - firstV) * 100;
    note.innerHTML = '<b>' + s.market_ticker + '</b> · ' + points.length + ' points · ' +
      new Date(x0).toISOString().replace('T', ' ').slice(0, 16) + ' → ' +
      new Date(x1).toISOString().replace('T', ' ').slice(0, 16) + ' UTC · change ' +
      (chg >= 0 ? '+' : '') + chg.toFixed(1) + '\u00a2' +
      (bucket.error ? ' · API note: ' + bucket.error : '') +
      ' · <a href="' + bucket.source + '" target="_blank" rel="noreferrer">source request ↗</a>';

    // accessible data table (last 12 points)
    var rows = points.slice(-12).reverse().map(function (p) {
      return '<tr><td>' + new Date(p.t * 1000).toISOString().replace('T', ' ').slice(0, 16) +
        '</td><td>' + (p[seriesSel.value] * 100).toFixed(1) + '</td><td>' +
        (p.yes_bid_close === null ? '—' : (p.yes_bid_close * 100).toFixed(1)) + '</td><td>' +
        (p.yes_ask_close === null ? '—' : (p.yes_ask_close * 100).toFixed(1)) + '</td><td>' +
        (p.volume === null ? '—' : p.volume) + '</td></tr>';
    }).join('');
    tableHost.innerHTML = '<h3>Last 12 buckets (as plotted)</h3><div class="tablewrap"><table>' +
      '<thead><tr><th>Bucket end (UTC)</th><th>Plotted value ¢</th><th>YES bid ¢</th><th>YES ask ¢</th><th>Volume (contracts)</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }
  marketSel.addEventListener('change', draw);
  bucketSel.addEventListener('change', draw);
  seriesSel.addEventListener('change', draw);
  draw();
  }
  fetch(me.getAttribute('data-src'))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      series = (d.series || []).filter(function (x) {
        return Object.keys(x.windows || {}).some(function (k) {
          return (x.windows[k].points || []).length;
        });
      });
      boot();
    })
    .catch(function (e) {
      note.textContent = 'Could not load chart data (' + e + '). Nothing is plotted.';
    });
})();
