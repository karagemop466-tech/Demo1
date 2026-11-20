/* Kalshi Demo Dashboard — dependency-free canvas charts.
   Line chart: x = time (ticks rendered as seconds / minutes / hours per mode),
   y = current contract price in dollars. Depth chart: x = price, y = contracts available. */
(function () {
  const M = { l: 56, r: 14, t: 14, b: 30 };

  function fit(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function fmtTime(sec, mode) {
    const d = new Date(sec * 1000);
    if (mode === "seconds") return d.toLocaleTimeString("en-US", { hour12: false });
    if (mode === "minutes") return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* points: [{t: unixSec, p: dollars|null}] — null p renders as a gap */
  function line(cv, points, opts) {
    opts = opts || {};
    const mode = opts.mode || "minutes";
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#161b22"; ctx.fillRect(0, 0, w, h);

    const pts = points.filter(p => p && p.p !== null && isFinite(p.p));
    if (pts.length < 2) {
      ctx.fillStyle = "#9aa7b5"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(pts.length ? "Collecting samples…" : "No data — see connection status", w / 2, h / 2);
      return;
    }
    let minT = pts[0].t, maxT = pts[pts.length - 1].t;
    let minP = Math.min.apply(null, pts.map(p => p.p));
    let maxP = Math.max.apply(null, pts.map(p => p.p));
    if (minT === maxT) maxT = minT + 1;
    const padP = Math.max((maxP - minP) * 0.15, 0.01);
    minP = Math.max(0, minP - padP); maxP = Math.min(1, maxP + padP);
    if (maxP - minP < 0.02) { const c = (maxP + minP) / 2; minP = Math.max(0, c - 0.01); maxP = Math.min(1, c + 0.01); }

    const X = t => M.l + (t - minT) / (maxT - minT) * (w - M.l - M.r);
    const Y = p => M.t + (1 - (p - minP) / (maxP - minP)) * (h - M.t - M.b);

    // gridlines + y labels (price dollars)
    ctx.strokeStyle = "#30363d"; ctx.fillStyle = "#9aa7b5"; ctx.font = "11px sans-serif";
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
      const p = minP + (maxP - minP) * i / ySteps, y = Y(p);
      ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(w - M.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText("$" + p.toFixed(2), M.l - 6, y + 3.5);
    }
    // x labels
    const xSteps = Math.max(2, Math.min(7, Math.floor((w - M.l - M.r) / 90)));
    ctx.textAlign = "center";
    for (let i = 0; i <= xSteps; i++) {
      const t = minT + (maxT - minT) * i / xSteps, x = X(t);
      ctx.fillText(fmtTime(t, mode), x, h - 8);
      ctx.strokeStyle = "#30363d";
      ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, h - M.b); ctx.stroke();
    }

    // line
    ctx.strokeStyle = opts.color || "#4dabf7"; ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    pts.forEach(p => {
      const x = X(p.t), y = Y(p.p);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;

    // last point marker + label
    const last = pts[pts.length - 1];
    ctx.fillStyle = opts.color || "#4dabf7";
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.p), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e6edf3"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "right";
    ctx.fillText("$" + last.p.toFixed(4), w - M.r - 4, Math.max(14, Y(last.p) - 8));

    // title + axis labels
    if (opts.title) {
      ctx.fillStyle = "#e6edf3"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(opts.title, M.l + 4, 12 + 8);
    }
    ctx.fillStyle = "#9aa7b5"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("price (USD)", 6, M.t + 10);
  }

  /* depth: bids = [[price,count]] ascending (official order, best last — S4);
     asks derived = 1 - no_bids (S9). Renders step bars: x = price, y = contracts. */
  function depth(cv, yesBids, noBids, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#161b22"; ctx.fillRect(0, 0, w, h);

    const bids = (yesBids || []).map(r => ({ p: Number(r[0]), q: Number(r[1]), side: "bid" }));
    const asks = (noBids || []).map(r => ({ p: 1 - Number(r[0]), q: Number(r[1]), side: "ask" }))
      .filter(r => isFinite(r.p) && r.p > 0 && r.p < 1);
    const all = bids.concat(asks);
    if (!all.length) {
      ctx.fillStyle = "#9aa7b5"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No orderbook data", w / 2, h / 2); return;
    }
    const minP = Math.min.apply(null, all.map(r => r.p));
    const maxP = Math.max.apply(null, all.map(r => r.p));
    const maxQ = Math.max.apply(null, all.map(r => r.q));
    const lo = Math.max(0, minP - 0.02), hi = Math.min(1, maxP + 0.02);
    const X = p => M.l + (p - lo) / Math.max(1e-6, hi - lo) * (w - M.l - M.r);
    const Y = q => h - M.b - (q / Math.max(1e-6, maxQ)) * (h - M.t - M.b - 16);

    ctx.strokeStyle = "#30363d"; ctx.fillStyle = "#9aa7b5"; ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const q = maxQ * i / 4, y = Y(q);
      ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(w - M.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(Math.round(q).toLocaleString(), M.l - 6, y + 3.5);
    }
    const xSteps = Math.max(2, Math.min(8, Math.floor((w - M.l - M.r) / 80)));
    ctx.textAlign = "center";
    for (let i = 0; i <= xSteps; i++) {
      const p = lo + (hi - lo) * i / xSteps;
      ctx.fillText("$" + p.toFixed(2), X(p), h - 8);
    }
    function bars(rows, color) {
      const bw = Math.max(2, Math.min(18, (w - M.l - M.r) / Math.max(12, (hi - lo) / 0.01) ));
      ctx.fillStyle = color;
      rows.forEach(r => {
        const x = X(r.p) - bw / 2, y = Y(r.q);
        ctx.fillRect(x, y, bw, h - M.b - y);
      });
    }
    bars(bids, "#2ea04388"); bars(asks, "#f8514988");
    // best bid/ask markers
    if (bids.length) {
      const bestB = bids.reduce((a, b) => b.p > a.p ? b : a);
      ctx.fillStyle = "#3fb950"; ctx.textAlign = "center"; ctx.font = "11px sans-serif";
      ctx.fillText("best bid $" + bestB.p.toFixed(2), X(bestB.p), Math.max(12, Y(bestB.q) - 4));
    }
    if (asks.length) {
      const bestA = asks.reduce((a, b) => b.p < a.p ? b : a);
      ctx.fillStyle = "#f85149"; ctx.textAlign = "center"; ctx.font = "11px sans-serif";
      ctx.fillText("best ask $" + bestA.p.toFixed(2), X(bestA.p), Math.max(12, Y(bestA.q) - 4));
    }
    ctx.fillStyle = "#9aa7b5"; ctx.textAlign = "left"; ctx.font = "11px sans-serif";
    ctx.fillText("contracts available at price (green = YES bids, red = implied YES asks)", M.l, 12);
  }

  /* bar chart for P&L by category */
  function barsH(cv, rows, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#161b22"; ctx.fillRect(0, 0, w, h);
    if (!rows.length) {
      ctx.fillStyle = "#9aa7b5"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No closed trades yet", w / 2, h / 2); return;
    }
    const maxAbs = Math.max(1e-6, Math.max.apply(null, rows.map(r => Math.abs(r.v))));
    const rowH = Math.min(34, (h - 20) / rows.length);
    const zero = M.l + (w - M.l - M.r) / 2;
    ctx.strokeStyle = "#30363d"; ctx.beginPath(); ctx.moveTo(zero, 8); ctx.lineTo(zero, h - 8); ctx.stroke();
    rows.forEach((r, i) => {
      const y = 10 + i * rowH;
      const len = (Math.abs(r.v) / maxAbs) * ((w - M.l - M.r) / 2 - 8);
      ctx.fillStyle = r.v >= 0 ? "#3fb950cc" : "#f85149cc";
      if (r.v >= 0) ctx.fillRect(zero, y + 4, len, rowH - 10);
      else ctx.fillRect(zero - len, y + 4, len, rowH - 10);
      ctx.fillStyle = "#e6edf3"; ctx.font = "12px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(r.label, 6, y + rowH / 2 + 1);
      ctx.textAlign = "right"; ctx.fillStyle = r.v >= 0 ? "#3fb950" : "#f85149";
      ctx.fillText((r.v >= 0 ? "+$" : "-$") + Math.abs(r.v).toFixed(2), w - 8, y + rowH / 2 + 1);
    });
  }

  window.KALSHI_CHART = { line, depth, barsH };
})();
