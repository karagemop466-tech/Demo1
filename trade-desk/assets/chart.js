/* trade-desk/assets/chart.js — dependency-free interactive SVG price chart.
 *
 * x axis: time. y axis: YES contract price in dollars (0.00–1.00).
 * Windows: seconds (30s/2m), minutes (15m/1h), hours (6h/24h).
 *
 * The chart never invents a point. Its input is a list of {ts, price, source}
 * samples that the page assembled from official responses, and gaps are drawn as
 * gaps: if two samples are more than GOOD_MS apart the line is broken rather than
 * interpolated.
 *
 * Because GET /markets/{t}/candlesticks only accepts 1/60/1440-minute periods
 * (https://docs.kalshi.com/api-reference/market/get-market-candlesticks), the
 * seconds view is built from individual trades returned by
 * https://docs.kalshi.com/api-reference/market/get-trades, and the page says so.
 */
(function (root) {
  "use strict";
  var TD = root.TD;

  var WINDOWS = [
    { id: "30s", label: "30 seconds", ms: 30 * 1000, unit: "seconds" },
    { id: "2m", label: "2 minutes", ms: 2 * 60 * 1000, unit: "seconds" },
    { id: "15m", label: "15 minutes", ms: 15 * 60 * 1000, unit: "minutes" },
    { id: "1h", label: "1 hour", ms: 60 * 60 * 1000, unit: "minutes" },
    { id: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000, unit: "hours" },
    { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000, unit: "hours" }
  ];

  function windowById(id) {
    for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].id === id) return WINDOWS[i];
    return WINDOWS[2];
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, text) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtPrice(v) { return "$" + v.toFixed(2); }
  function fmtAxisTime(ts, win) {
    var d = new Date(ts);
    if (win !== undefined && win.unit === "hours") return d.toISOString().slice(11, 16);
    return d.toISOString().slice(11, 19);
  }

  /* Render into `svg` (an <svg> element). Returns a cleanup function.
   * cfg: {samples, now, windowId, jumps, markers, onZoom, color, title} */
  function render(svg, cfg) {
    if (!svg) return function () {};
    var win = windowById(cfg.windowId);
    var now = cfg.now || Date.now();
    var t0 = now - win.ms, t1 = now;
    var W = 100, H = 100;           /* viewBox units; scaled by CSS */
    var padL = 9, padR = 2, padT = 3, padB = 9;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    function x(ts) { return padL + ((ts - t0) / (t1 - t0)) * plotW; }
    function y(p) { return padT + (1 - p) * plotH; }

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", (cfg.title || "Contract price") + " over " + win.label);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var samples = (cfg.samples || []).filter(function (s) {
      return s && isFinite(s.ts) && s.ts >= t0 - 1000 && s.ts <= t1 + 1000 && isFinite(s.price);
    }).sort(function (a, b) { return a.ts - b.ts; });

    /* grid + y labels at 0, .25, .50, .75, 1.00 */
    [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
      svg.appendChild(el("line", {
        x1: padL, x2: W - padR, y1: y(p).toFixed(2), y2: y(p).toFixed(2),
        stroke: p === 0.5 ? "#cbd5e1" : "#eef2f7", "stroke-width": 0.18,
        "vector-effect": "non-scaling-stroke"
      }));
      var label = el("text", {
        x: 0.4, y: (y(p) + 0.9).toFixed(2), "font-size": 2.4, fill: "#64748b"
      }, fmtPrice(p));
      svg.appendChild(label);
    });

    /* x ticks: 5 evenly spaced */
    for (var i = 0; i <= 4; i++) {
      var ts = t0 + (i / 4) * (t1 - t0);
      svg.appendChild(el("line", {
        x1: x(ts).toFixed(2), x2: x(ts).toFixed(2), y1: padT, y2: H - padB,
        stroke: "#f1f5f9", "stroke-width": 0.18, "vector-effect": "non-scaling-stroke"
      }));
      svg.appendChild(el("text", {
        x: x(ts).toFixed(2), y: H - padB + 3.4, "font-size": 2.2, fill: "#64748b",
        "text-anchor": i === 0 ? "start" : i === 4 ? "end" : "middle"
      }, fmtAxisTime(ts, win)));
    }

    if (!samples.length) {
      svg.appendChild(el("text", {
        x: W / 2, y: H / 2, "font-size": 3, fill: "#94a3b8", "text-anchor": "middle"
      }, cfg.emptyText || "no official price prints in this window"));
      return function () {};
    }

    /* step line: prediction-market prices are quotes, so a step is more honest
     * than a diagonal (the price held until the next print). */
    var goodMs = Math.max(30000, win.ms / 6);
    var d = "", started = false, prev = null, area = "";
    samples.forEach(function (s) {
      if (!started) {
        d += "M" + x(s.ts).toFixed(2) + " " + y(s.price).toFixed(2);
        started = true;
      } else if (s.ts - prev.ts > goodMs) {
        d += "M" + x(s.ts).toFixed(2) + " " + y(s.price).toFixed(2);
      } else {
        d += "L" + x(s.ts).toFixed(2) + " " + y(prev.price).toFixed(2) +
             "L" + x(s.ts).toFixed(2) + " " + y(s.price).toFixed(2);
      }
      prev = s;
    });
    var first = samples[0], last = samples[samples.length - 1];
    area = "M" + x(first.ts).toFixed(2) + " " + y(first.price).toFixed(2) +
      "L" + x(last.ts).toFixed(2) + " " + y(last.price).toFixed(2) +
      "L" + x(last.ts).toFixed(2) + " " + (H - padB) + "L" + x(first.ts).toFixed(2) + " " + (H - padB) + "Z";

    svg.appendChild(el("path", { d: area, fill: cfg.color || "#2563eb", opacity: 0.08 }));
    svg.appendChild(el("path", {
      d: d, fill: "none", stroke: cfg.color || "#2563eb", "stroke-width": 1.2,
      "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round"
    }));

    /* last point */
    svg.appendChild(el("circle", {
      cx: x(last.ts).toFixed(2), cy: y(last.price).toFixed(2), r: 0.9,
      fill: cfg.color || "#2563eb"
    }));

    /* jump markers: triangles at the print where a >= $0.10 move landed */
    (cfg.jumps || []).forEach(function (j) {
      if (!isFinite(j.ts) || j.ts < t0) return;
      var up = (j.move || 0) >= 0;
      var px = x(j.ts), py = y(j.price === undefined ? 0 : j.price);
      var ax = px, ay = up ? py - 2.6 : py + 2.6;
      var tri = "M" + ax.toFixed(2) + " " + ay.toFixed(2) +
        "L" + (ax - 1.4).toFixed(2) + " " + (ay + (up ? 2.4 : -2.4)).toFixed(2) +
        "L" + (ax + 1.4).toFixed(2) + " " + (ay + (up ? 2.4 : -2.4)).toFixed(2) + "Z";
      var node = el("path", {
        d: tri, fill: up ? "#15803d" : "#b91c1c", opacity: 0.95,
        "data-ticker": j.ticker || "", "data-move": j.move
      });
      var tip = document.createElementNS(SVG_NS, "title");
      tip.textContent = (up ? "▲ +" : "▼ −") + Math.abs((j.move || 0) * 100).toFixed(0) + "¢ at " +
        new Date(j.ts).toISOString().slice(11, 19) + "Z" + (j.ticker ? " · " + j.ticker : "");
      node.appendChild(tip);
      svg.appendChild(node);
    });

    /* hover readout */
    var focus = el("circle", { r: 1.1, fill: "#0f172a", opacity: 0 });
    svg.appendChild(focus);
    var tipText = el("text", { "font-size": 2.4, fill: "#0f172a", "text-anchor": "end", opacity: 0 });
    svg.appendChild(tipText);
    var readout = cfg.readoutEl || null;

    function nearest(evt) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return null;
      var rel = (evt.clientX - rect.left) / rect.width * W;
      var ts = t0 + ((rel - padL) / plotW) * (t1 - t0);
      var best = null, bestD = Infinity;
      samples.forEach(function (s) {
        var dd = Math.abs(s.ts - ts);
        if (dd < bestD) { bestD = dd; best = s; }
      });
      return best;
    }
    function onMove(evt) {
      var s = nearest(evt);
      if (!s) return;
      focus.setAttribute("cx", x(s.ts).toFixed(2));
      focus.setAttribute("cy", y(s.price).toFixed(2));
      focus.setAttribute("opacity", 1);
      tipText.setAttribute("x", W - padR);
      tipText.setAttribute("y", padT + 3);
      tipText.setAttribute("opacity", 1);
      tipText.textContent = fmtPrice(s.price) + " · " + new Date(s.ts).toISOString().slice(11, 19) + "Z";
      if (readout) {
        readout.innerHTML = "<b>" + TD.esc(fmtPrice(s.price)) + "</b> · " +
          TD.esc(new Date(s.ts).toISOString().replace("T", " ").replace(".000Z", "Z")) +
          (s.source ? ' · <a href="' + TD.attr(s.source) + '" target="_blank" rel="noopener">source</a>' : "");
      }
    }
    function onLeave() {
      focus.setAttribute("opacity", 0);
      tipText.setAttribute("opacity", 0);
    }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);

    /* click to zoom: shift the window so the clicked time is centred */
    function onClick(evt) {
      if (typeof cfg.onZoom !== "function") return;
      var s = nearest(evt);
      if (s) cfg.onZoom(s.ts);
    }
    svg.addEventListener("click", onClick);

    return function cleanup() {
      svg.removeEventListener("mousemove", onMove);
      svg.removeEventListener("mouseleave", onLeave);
      svg.removeEventListener("click", onClick);
    };
  }

  /* Small sparkline used in table rows and alert cards. */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 60, h = opts.height || 16;
    var vals = (values || []).filter(function (v) { return isFinite(v); });
    if (vals.length < 2) return "";
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) {
      return (i / (vals.length - 1) * w).toFixed(1) + "," + (h - ((v - min) / span) * h).toFixed(1);
    }).join(" ");
    var colour = opts.color || (vals[vals.length - 1] >= vals[0] ? "#15803d" : "#b91c1c");
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="' + colour +
      '" stroke-width="1.2"/></svg>';
  }

  root.TDChart = { WINDOWS: WINDOWS, windowById: windowById, render: render, sparkline: sparkline };
  if (typeof module === "object" && module.exports) module.exports = { WINDOWS: WINDOWS, windowById: windowById, sparkline: sparkline };
})(typeof globalThis !== "undefined" ? globalThis : this);
