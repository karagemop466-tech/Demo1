/* Canvas renderers for the Kalshi demo dashboard — no third-party chart library, so the
 * published page has no external code dependency and plots only supplied points. */
(function (global) {
  'use strict';

  function fmtTime(ms, spanMs) {
    const d = new Date(ms);
    if (spanMs <= 10 * 60 * 1000) return d.toLocaleTimeString('en-GB', { hour12: false });
    if (spanMs <= 36 * 60 * 60 * 1000) return d.toLocaleTimeString('en-GB', { hour12: false, minute: '2-digit' });
    return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-GB', { hour12: false, minute: '2-digit' });
  }

  /**
   * points: [{ts(ms), close, open?, high?, low?, volume?}] — Y is the YES contract price in dollars.
   * Only points present in the array are drawn; missing data renders as an empty plot with a note.
   */
  function priceChart(canvas, points, opts) {
    const o = Object.assign({ yMin: 0, yMax: 1, label: 'YES price (USD)', note: '' }, opts || {});
    const dpr = global.devicePixelRatio || 1;
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 280;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 56, r: 12, t: 12, b: 30 };
    const plotW = Math.max(10, w - pad.l - pad.r), plotH = Math.max(10, h - pad.t - pad.b);

    if (!points || !points.length) {
      drawFrame(ctx, pad, w, h, o, []);
      ctx.fillStyle = '#6b7280'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(o.note || 'No price points received from the API — nothing to plot.', pad.l + plotW / 2, pad.t + plotH / 2);
      return { drawn: 0 };
    }
    const xs = points.map((p) => p.ts);
    const t0 = Math.min.apply(null, xs), t1 = Math.max.apply(null, xs);
    const span = Math.max(1000, t1 - t0);
    let yMin = o.yMin, yMax = o.yMax;
    if (o.autoscale) {
      const ys = points.map((p) => p.close).filter((v) => typeof v === 'number');
      if (ys.length) {
        yMin = Math.max(0, Math.min.apply(null, ys) - 0.02);
        yMax = Math.min(1, Math.max.apply(null, ys) + 0.02);
        if (yMax - yMin < 0.02) { yMin = Math.max(0, yMin - 0.01); yMax = Math.min(1, yMax + 0.01); }
      }
    }
    const X = (ts) => pad.l + ((ts - t0) / span) * plotW;
    const Y = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    const xTicks = [];
    for (let i = 0; i <= 4; i++) xTicks.push(t0 + (span * i) / 4);
    drawFrame(ctx, pad, w, h, o, xTicks, X, Y, yMin, yMax, span);

    /* volume histogram (secondary, scaled to bottom 22% of the plot) */
    const maxVol = Math.max.apply(null, points.map((p) => p.volume || 0));
    if (maxVol > 0) {
      ctx.fillStyle = 'rgba(15,98,254,0.14)';
      const bw = Math.max(1, plotW / points.length * 0.6);
      points.forEach((p) => {
        if (!p.volume) return;
        const bh = (p.volume / maxVol) * plotH * 0.22;
        ctx.fillRect(X(p.ts) - bw / 2, pad.t + plotH - bh, bw, bh);
      });
    }

    /* high/low band, then close line (step-after so quotes read as discrete prints) */
    ctx.strokeStyle = 'rgba(16,185,129,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (p.high === null || p.high === undefined || p.low === null || p.low === undefined) return;
      if (i === 0) ctx.moveTo(X(p.ts), Y(p.high)); else ctx.lineTo(X(p.ts), Y(p.high));
    });
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (p.high === null || p.high === undefined || p.low === null || p.low === undefined) continue;
      ctx.lineTo(X(p.ts), Y(p.low));
    }
    ctx.closePath(); ctx.fillStyle = 'rgba(16,185,129,0.08)'; ctx.fill();

    ctx.strokeStyle = '#0f62fe'; ctx.lineWidth = 1.75; ctx.beginPath();
    let prevY = null;
    points.forEach((p, i) => {
      const x = X(p.ts), y = Y(p.close);
      if (prevY === null) { ctx.moveTo(x, y); } else { ctx.lineTo(x, prevY); ctx.lineTo(x, y); }
      prevY = y;
    });
    ctx.stroke();

    ctx.fillStyle = '#0f62fe';
    points.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.ts), Y(p.close), points.length > 60 ? 0 : 2.2, 0, Math.PI * 2); ctx.fill(); });

    const last = points[points.length - 1];
    canvas._kd = { points: points, X: X, t0: t0, span: span, last: last };
    return { drawn: points.length, last: last };
  }

  function drawFrame(ctx, pad, w, h, o, xTicks, X, Y, yMin, yMax, span) {
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#6b7280';
    const lo = yMin === undefined ? o.yMin : yMin, hi = yMax === undefined ? o.yMax : yMax;
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = pad.l === undefined ? 0 : pad.t + (h - pad.t - pad.b) * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText('$' + v.toFixed(2), pad.l - 6, y + 3);
    }
    ctx.strokeStyle = '#9ca3af';
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke();
    if (xTicks && X && span) {
      ctx.textAlign = 'center';
      xTicks.forEach((t) => {
        const x = X(t);
        ctx.strokeStyle = '#f3f4f6'; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
        ctx.fillStyle = '#6b7280'; ctx.fillText(fmtTime(t, span), x, h - pad.b + 14);
      });
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#374151';
    ctx.fillText(o.label + (o.subtitle ? '  ·  ' + o.subtitle : ''), pad.l, pad.t + 10);
  }

  /** Order-book ladder: contracts resting at each price as a horizontal bar. */
  function ladder(rows, container, opts) {
    const o = Object.assign({ maxContracts: 1 }, opts || {});
    if (!rows.length) {
      container.innerHTML = '<div class="empty">No resting orders returned by the order-book endpoint (empty arrays are a valid 200 response).</div>';
      return;
    }
    const max = Math.max.apply(null, rows.map((r) => r.count || 0)) || 1;
    container.innerHTML = rows.map((r) => {
      const pct = Math.round(((r.count || 0) / max) * 100);
      const cls = r.side === 'yes' ? 'bid' : 'ask';
      return '<div class="lvl ' + cls + '" title="' + (r.side || '').toUpperCase() + ' at ' + r.price + '">' +
        '<span class="p">$' + (r.price === null || r.price === undefined ? '' : Number(r.price).toFixed(4)) + '</span>' +
        '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="c">' + Number(r.count || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>' +
        '<span class="d">' + (r.dollars === null || r.dollars === undefined ? '' : '$' + Number(r.dollars).toLocaleString('en-US', { maximumFractionDigits: 2 })) + '</span>' +
        '</div>';
    }).join('');
  }

  global.KalshiUI = { priceChart: priceChart, ladder: ladder, fmtTime: fmtTime };
})(window);
