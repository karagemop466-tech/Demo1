/* Dependency-free SVG chart helpers. No data is invented here: every point
 * comes from an official API response (candlesticks or trade timestamps). */
(function (global) {
  'use strict';

  function fmtClock(ms, withSec) {
    var d = new Date(ms);
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return withSec ? hm + ':' + ('0' + d.getSeconds()).slice(-2) : hm;
  }

  function niceTicks(min, max, n) {
    var span = (max - min) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var ticks = [], t = Math.ceil(min / step) * step;
    for (; t <= max + 1e-9; t += step) ticks.push(t);
    return ticks;
  }

  /* points: [{t: epochMs, v: number}] */
  function lineChart(el, points, opts) {
    opts = opts || {};
    var W = 860, H = 320, padL = 46, padR = 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    el.innerHTML = '';
    if (!points || points.length < 1) {
      el.innerHTML = '<div class="empty">No data points returned by the API for this window. Nothing is plotted without an official datapoint.</div>';
      return;
    }
    var ts = points.map(function (p) { return p.t; });
    var vs = points.map(function (p) { return p.v; });
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts);
    if (t1 === t0) { t1 = t0 + 1000; }
    var v0 = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, vs);
    var v1 = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, vs);
    var padV = (v1 - v0) * 0.08 || 0.02;
    v0 = Math.max(0, v0 - padV); v1 = Math.min(1.02, v1 + padV);
    if (v1 - v0 < 1e-9) { v1 = v0 + 0.02; }

    function X(t) { return padL + (t - t0) / (t1 - t0) * iw; }
    function Y(v) { return padT + (1 - (v - v0) / (v1 - v0)) * ih; }

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Contract price over time">'];
    svg.push('<rect x="' + padL + '" y="' + padT + '" width="' + iw + '" height="' + ih + '" fill="#0d1319" stroke="#232c38" rx="6"/>');
    // Y grid
    niceTicks(v0, v1, 5).forEach(function (tv) {
      var y = Y(tv);
      svg.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#1c2530" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 7) + '" y="' + (y + 4) + '" fill="#5c6875" font-size="11" text-anchor="end">' + '$' + tv.toFixed(tv < 0.1 ? 3 : 2) + '</text>');
    });
    // X ticks
    var nT = Math.min(7, Math.max(2, Math.round(iw / 130)));
    for (var i = 0; i <= nT; i++) {
      var tt = t0 + (t1 - t0) * i / nT;
      var x = X(tt);
      svg.push('<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + ih) + '" stroke="#1c2530" stroke-width="1"/>');
      svg.push('<text x="' + x + '" y="' + (H - 10) + '" fill="#5c6875" font-size="11" text-anchor="middle">' + fmtClock(tt, (t1 - t0) < 3600000) + '</text>');
    }
    // path + area
    var d = points.map(function (p, idx) { return (idx ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ');
    svg.push('<path d="' + d + ' L' + X(t1).toFixed(1) + ',' + (padT + ih) + ' L' + X(t0).toFixed(1) + ',' + (padT + ih) + ' Z" fill="rgba(46,204,143,.10)" stroke="none"/>');
    svg.push('<path d="' + d + '" fill="none" stroke="#2ecc8f" stroke-width="2"/>');
    var last = points[points.length - 1];
    svg.push('<circle cx="' + X(last.t) + '" cy="' + Y(last.v) + '" r="3.5" fill="#2ecc8f"/>');
    svg.push('<text x="' + (X(last.t) - 8) + '" y="' + (Y(last.v) - 9) + '" fill="#e8edf2" font-size="11" text-anchor="end" font-family="ui-monospace,monospace">$' + last.v.toFixed(4) + '</text>');
    // labels
    svg.push('<text x="' + (padL + 6) + '" y="' + (padT + 16) + '" fill="#8b98a8" font-size="11">YES contract price (USD)</text>');
    svg.push('<text x="' + (W - padR - 6) + '" y="' + (padT + 16) + '" fill="#5c6875" font-size="11" text-anchor="end">' + (opts.sourceLabel || '') + '</text>');
    svg.push('</svg>');
    el.innerHTML = svg.join('');
  }

  /* levels: [{price, count}] ascending; side 'yes'|'no' */
  function depthBars(el, yesLevels, noLevels) {
    function rows(levels, cls, label) {
      if (!levels.length) return '<div class="dim" style="padding:4px 0">No ' + label + ' bids returned.</div>';
      return levels.slice(-12).reverse().map(function (l) {
        var maxC = Math.max.apply(null, levels.map(function (x) { return x.count; })) || 1;
        var w = Math.max(2, Math.round(l.count / maxC * 100));
        return '<div class="lvl ' + cls + '"><span>$' + l.price.toFixed(2) + '</span>' +
          '<span class="bar"><i style="width:' + w + '%"></i></span>' +
          '<span style="text-align:right">' + l.count.toLocaleString() + '</span></div>';
      }).join('');
    }
    el.innerHTML =
      '<div style="font-size:11px;letter-spacing:.08em;color:#8b98a8;text-transform:uppercase;margin-bottom:6px">YES bids — contracts available at price</div>' +
      rows(yesLevels, 'yes', 'YES') +
      '<div style="font-size:11px;letter-spacing:.08em;color:#8b98a8;text-transform:uppercase;margin:14px 0 6px">NO bids — contracts available at price</div>' +
      rows(noLevels, 'no', 'NO');
  }

  global.CHARTS = { lineChart: lineChart, depthBars: depthBars };
})(window);
