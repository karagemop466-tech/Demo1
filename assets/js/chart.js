/* Dependency-free canvas price chart.
 *
 * X axis = time (unix seconds), Y axis = contract price in dollars.
 * Granularity and window length are chosen by the caller; the chart only
 * renders the points it is given, so it can never imply data that was not
 * received from the API.
 */

const PAD = { top: 18, right: 16, bottom: 30, left: 52 };

export function drawChart(canvas, options = {}) {
  const {
    series = [],
    yLabel = 'Price (USD)',
    xGranularity = 'minute',
    emptyMessage = 'No data',
    showTooltip = true,
  } = options;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(180, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const usable = series.filter((s) => Array.isArray(s.points) && s.points.length > 0);
  if (!usable.length) {
    ctx.fillStyle = '#77857e';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emptyMessage, width / 2, height / 2);
    return { empty: true };
  }

  const all = usable.flatMap((s) => s.points);
  let xMin = Math.min(...all.map((p) => p.t));
  let xMax = Math.max(...all.map((p) => p.t));
  let yMin = Math.min(...all.map((p) => p.v));
  let yMax = Math.max(...all.map((p) => p.v));
  if (xMin === xMax) { xMin -= 30; xMax += 30; }
  if (yMin === yMax) { yMin -= 0.02; yMax += 0.02; }
  const yPad = (yMax - yMin) * 0.12;
  yMin = Math.max(0, yMin - yPad);
  yMax = Math.min(1, yMax + yPad);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const sx = (t) => PAD.left + ((t - xMin) / (xMax - xMin)) * plotW;
  const sy = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // grid + axes
  ctx.strokeStyle = '#e2e9e5';
  ctx.fillStyle = '#77857e';
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace';

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = Math.round(sy(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + plotW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(v.toFixed(2), PAD.left - 8, y);
  }

  const xTicks = Math.max(2, Math.min(7, Math.floor(plotW / 110)));
  for (let i = 0; i <= xTicks; i++) {
    const t = xMin + ((xMax - xMin) * i) / xTicks;
    const x = Math.round(sx(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + plotH);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(formatAxisTime(t, xGranularity), x, PAD.top + plotH + 8);
  }

  // y axis label
  ctx.save();
  ctx.translate(12, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#47564f';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // series
  for (const s of usable) {
    const pts = s.points.slice().sort((a, b) => a.t - b.t);
    ctx.strokeStyle = s.color || '#14674a';
    ctx.lineWidth = s.width || 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const x = sx(p.t);
      const y = sy(p.v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    if (s.fill) {
      ctx.lineTo(sx(pts[pts.length - 1].t), PAD.top + plotH);
      ctx.lineTo(sx(pts[0].t), PAD.top + plotH);
      ctx.closePath();
      ctx.fillStyle = s.fill;
      ctx.fill();
    }

    if (s.dots) {
      ctx.fillStyle = s.color || '#14674a';
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(sx(p.t), sy(p.v), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // frame
  ctx.strokeStyle = '#cfdad4';
  ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW, plotH);

  const result = { empty: false, xMin, xMax, yMin, yMax, sx, sy, plotW, plotH };

  if (showTooltip) attachTooltip(canvas, result, usable, sx, sy, xGranularity, width, height);
  return result;
}

function attachTooltip(canvas, ctxInfo, series, sx, sy, granularity, width, height) {
  if (canvas._tooltipCleanup) canvas._tooltipCleanup();
  const tip = document.createElement('div');
  tip.style.cssText =
    'position:absolute;pointer-events:none;background:#14201c;color:#fff;font:11px ui-monospace,monospace;padding:7px 9px;border-radius:6px;display:none;white-space:nowrap;z-index:5;transform:translate(-50%,-120%);';
  const box = canvas.parentElement;
  if (box) {
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.appendChild(tip);
  }
  const onMove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    if (px < ctxInfo.xMin * 0 + PAD.left - 4 || px > rect.width - PAD.right + 4 || py < PAD.top || py > height - PAD.bottom) {
      tip.style.display = 'none';
      return;
    }
    const t = ctxInfo.xMin + ((px - PAD.left) / ctxInfo.plotW) * (ctxInfo.xMax - ctxInfo.xMin);
    const lines = [];
    for (const s of series) {
      const pts = s.points;
      let best = null;
      let bestD = Infinity;
      for (const p of pts) {
        const d = Math.abs(p.t - t);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) lines.push(`<span style="color:${s.color || '#fff'}">■</span> ${s.label}: ${best.v.toFixed(4)}`);
    }
    const stamp = new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
    tip.innerHTML = `${stamp}<br>${lines.join('<br>')}`;
    tip.style.display = 'block';
    tip.style.left = `${px}px`;
    tip.style.top = `${py}px`;
  };
  const onLeave = () => { tip.style.display = 'none'; };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas._tooltipCleanup = () => {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    if (tip.parentElement) tip.parentElement.removeChild(tip);
  };
}

/** Axis label formatting driven by the selected granularity. */
export function formatAxisTime(unixSeconds, granularity) {
  const d = new Date(unixSeconds * 1000);
  const iso = d.toISOString();
  switch (granularity) {
    case 'second':
      return iso.slice(11, 19) + 'Z';
    case 'minute':
      return iso.slice(11, 16) + 'Z';
    case 'hour':
      return iso.slice(11, 16) + 'Z';
    case 'day':
      return iso.slice(0, 10);
    default:
      return iso.slice(0, 16).replace('T', ' ') + 'Z';
  }
}

/** Human label for the x axis. */
export function granularityLabel(g) {
  return { second: 'seconds', minute: 'minutes', hour: 'hours', day: 'days' }[g] || g;
}

/** Cumulative depth series for the liquidity page. */
export function cumulativeDepth(levels) {
  let sum = 0;
  return levels.map((l) => {
    sum += l.count;
    return { price: l.price, count: l.count, cumulative: Math.round(sum * 100) / 100, notional: Math.round(l.notional * 100) / 100 };
  });
}
