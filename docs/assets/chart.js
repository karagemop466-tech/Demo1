/* chart.js — dependency-free canvas time/price chart for the docs/ hub.
   X axis = timestamp (configurable window: seconds-scale to 7 days), Y axis = contract price in USD.
   Accepts a line series [{t,p}] built from official candlesticks (close) and/or live polled ticks. */

function PriceChart(canvas) {
  const ctx = canvas.getContext("2d");
  let pts = [];           // [{t: ms, p: number, hi, lo}]
  let view = null;        // {t0, t1} or null for all
  let hover = null;
  const PAD = { l: 46, r: 14, t: 14, b: 26 };

  function fmtTime(ms, span) {
    const d = new Date(ms);
    if (span <= 15 * 60000) return d.toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" });
    if (span <= 24 * 3600000) return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour12: false, hour: "2-digit" }) + "h";
  }
  function size() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(r.width * devicePixelRatio));
    canvas.height = Math.max(220, Math.floor(340 * devicePixelRatio));
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return { w: r.width, h: r.height };
  }
  function setData(series) { pts = (series || []).filter(q => Number.isFinite(q.t) && Number.isFinite(q.p)).sort((a, b) => a.t - b.t); draw(); }
  function setView(v) { view = v; draw(); }

  function draw() {
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue("--line").trim() || "#26332d";
    const muted = css.getPropertyValue("--muted").trim() || "#8fa39a";
    const brand = css.getPropertyValue("--brand").trim() || "#57d9a3";
    let data = pts;
    if (view) data = pts.filter(q => q.t >= view.t0 && q.t <= view.t1);
    if (!data.length) {
      ctx.fillStyle = muted; ctx.font = "13px system-ui"; ctx.textAlign = "center";
      ctx.fillText("No price points yet — candles arrive from the CI pipeline (official candlesticks endpoint); live ticks only if CORS permits.", w / 2, h / 2);
      return;
    }
    const span = (data[data.length - 1].t - data[0].t) || 1;
    const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
    const X = t => PAD.l + ((t - data[0].t) / span) * iw;
    const Y = p => PAD.t + (1 - p) * ih;
    // gridlines + y labels ($0.00..$1.00)
    ctx.strokeStyle = line; ctx.fillStyle = muted; ctx.font = "11px system-ui"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const p = i / 4, y = Y(p);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillText("$" + p.toFixed(2), PAD.l - 6, y + 3);
    }
    // x ticks
    ctx.textAlign = "center";
    const ticks = Math.min(6, Math.max(2, Math.floor(iw / 120)));
    for (let i = 0; i <= ticks; i++) {
      const t = data[0].t + (span * i) / ticks, x = X(t);
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, h - PAD.b); ctx.stroke();
      ctx.fillText(fmtTime(t, span), x, h - PAD.b + 14);
    }
    // hi/lo band when candles present
    const hasBand = data.some(q => Number.isFinite(q.hi) && Number.isFinite(q.lo));
    if (hasBand) {
      ctx.fillStyle = "rgba(87,217,163,0.12)";
      ctx.beginPath();
      data.forEach((q, i) => { const x = X(q.t), y = Y(q.hi != null ? q.hi : q.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      for (let i = data.length - 1; i >= 0; i--) ctx.lineTo(X(data[i].t), Y(data[i].lo != null ? data[i].lo : data[i].p));
      ctx.closePath(); ctx.fill();
    }
    // price line
    ctx.strokeStyle = brand; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((q, i) => { const x = X(q.t), y = Y(q.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // last point marker
    const last = data[data.length - 1];
    ctx.fillStyle = brand; ctx.beginPath(); ctx.arc(X(last.t), Y(last.p), 3.5, 0, 7); ctx.fill();
    // hover crosshair
    if (hover) {
      const q = data.reduce((a, b) => Math.abs(X(b.t) - hover.x) < Math.abs(X(a.t) - hover.x) ? b : a, data[0]);
      const x = X(q.t);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, h - PAD.b); ctx.stroke(); ctx.setLineDash([]);
      const label = `${new Date(q.t).toLocaleTimeString([], { hour12: false })}  $${q.p.toFixed(q.p < 0.1 ? 3 : 2)}`;
      ctx.font = "12px system-ui";
      const tw = ctx.measureText(label).width + 12;
      const bx = Math.min(Math.max(x - tw / 2, PAD.l), w - PAD.r - tw);
      ctx.fillStyle = "rgba(21,29,26,0.95)"; ctx.strokeStyle = line;
      ctx.beginPath(); ctx.roundRect(bx, PAD.t + 2, tw, 22, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css.getPropertyValue("--ink").trim() || "#e8f0ec"; ctx.textAlign = "left";
      ctx.fillText(label, bx + 6, PAD.t + 17);
    }
    // legend
    ctx.fillStyle = muted; ctx.font = "11px system-ui"; ctx.textAlign = "left";
    ctx.fillText(`YES contract price · ${data.length} points · window ${fmtTime(data[0].t, span)} → ${fmtTime(last.t, span)}`, PAD.l, PAD.t + 8);
  }

  canvas.addEventListener("mousemove", e => { const r = canvas.getBoundingClientRect(); hover = { x: e.clientX - r.left }; draw(); });
  canvas.addEventListener("mouseleave", () => { hover = null; draw(); });
  return { setData, setView, draw };
}

/* Build a price series from the CI history.json entry for one market.
   interval: "1m" | "60m"; uses candle close price (+hi/lo for the band). */
function seriesFromHistory(entry, interval) {
  const seg = entry && entry[interval];
  if (!seg || !Array.isArray(seg.candles)) return [];
  return seg.candles
    .map(c => ({ t: (c.end_ts || 0) * 1000, p: Number(c.c), hi: Number(c.h), lo: Number(c.l) }))
    .filter(q => Number.isFinite(q.t) && Number.isFinite(q.p));
}

/* Window helper: minutes → {t0,t1} relative to the latest point. */
function windowFor(series, minutes) {
  if (!series.length) return null;
  const t1 = series[series.length - 1].t;
  return minutes == null ? null : { t0: t1 - minutes * 60000, t1: t1 + 60000 };
}
