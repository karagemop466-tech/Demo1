/* desk/assets/core.js — official Kalshi demo API client + dependency-free chart.
 *
 * Everything in this file was written against the official documentation, fetched
 * 2026-11-20:
 *   base URLs ............ https://docs.kalshi.com/getting_started/api_environments
 *   demo warning ......... https://docs.kalshi.com/getting_started/demo_env
 *   markets .............. https://docs.kalshi.com/api-reference/market/get-markets
 *   orderbook ............ https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *   candlesticks ......... https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *   lifecycle ............ https://docs.kalshi.com/getting_started/market_lifecycle
 *
 * No API key is used or stored: every endpoint below is public market data.
 */
(function () {
  "use strict";

  var BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
  var DOCS = {
    markets: "https://docs.kalshi.com/api-reference/market/get-markets",
    orderbook: "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    candles: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    lifecycle: "https://docs.kalshi.com/getting_started/market_lifecycle",
    demo: "https://docs.kalshi.com/getting_started/demo_env",
    fees: "https://kalshi.com/docs/kalshi-fee-schedule.pdf"
  };

  var TOPICS = [
    { id: "gas_prices", label: "Gas prices", slug: "gas-prices",
      test: function (s) { s = (s || "").toLowerCase();
        return s.indexOf("kxaaagas") === 0 || s.indexOf("gas price") >= 0; } },
    { id: "elections", label: "Elections", slug: "elections",
      test: function (s) { s = (s || "").toLowerCase();
        return /kxpres|kxgov|kxsenate|kxhouse|kxmayor|election|nominee/.test(s); } },
    { id: "culture", label: "Culture", slug: "culture",
      test: function (s) { s = (s || "").toLowerCase();
        return /kxoscar|kxrt|kxemmy|kxgrammy|kxalbum|kxboxoffice|kxspotify|kxbillboard|kxnetflix|rotten tomatoes|best picture|box office/.test(s); } },
    { id: "crypto", label: "Crypto", slug: "crypto",
      test: function (s) { s = (s || "").toLowerCase();
        return /kxbtc|kxeth|kxsol|kxxrp|kxdoge|bitcoin|ethereum|crypto/.test(s); } },
    { id: "golf", label: "Golf", slug: "golf",
      test: function (s) { s = (s || "").toLowerCase();
        return /kxpgatour|kxlpgatour|kxgolf|pga tour|lpga|golf/.test(s); } }
  ];

  /* Series an earlier snapshot file filed under the wrong topic — drawn from the
   * repository's own data, not from inference. Shown on the Flagged page. */
  var EXCLUDED_SERIES = { KXWTI: "Crude-oil price market, not an election." };

  /* ---------- primitives ---------- */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(v, d) {
    var n = num(v);
    if (n === null) return "—";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 2 : d,
      maximumFractionDigits: d === undefined ? 2 : d });
  }
  function cents(v) {
    var n = num(v);
    return n === null ? "—" : (n * 100).toFixed(n * 100 < 10 ? 1 : 0) + "¢";
  }
  function contracts(v) {
    var n = num(v);
    if (n === null) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function pct(v, d) {
    var n = num(v);
    return n === null ? "—" : (n * 100).toFixed(d === undefined ? 1 : d) + "%";
  }
  function when(iso) {
    if (!iso) return "—";
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return esc(iso);
    return dt.toISOString().replace("T", " ").replace(":00.000Z", "Z").slice(0, 17) + "Z";
  }
  function ago(iso) {
    if (!iso) return "—";
    var dt = new Date(iso), s = Math.round((Date.now() - dt.getTime()) / 1000);
    if (isNaN(s)) return "—";
    if (s < 90) return s + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  /* ---------- public REST ---------- */
  function url(path, params) {
    var u = new URL(BASE + path);
    if (params) Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== "") {
        u.searchParams.set(k, params[k]);
      }
    });
    return u.toString();
  }

  function get(path, params, opts) {
    opts = opts || {};
    var u = url(path, params);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 12000);
    var started = Date.now();
    return fetch(u, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) {
          var e = new Error("HTTP " + r.status + " for " + u);
          e.status = r.status; e.url = u;
          throw e;
        }
        return r.json().then(function (j) {
          return { data: j, url: u, ms: Date.now() - started };
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        err.url = u;
        throw err;
      });
  }

  /* Every page that talks to the API records the calls so a reviewer can replay them. */
  var requestLog = [];
  function record(entry) {
    requestLog.unshift(entry);
    if (requestLog.length > 60) requestLog.pop();
    var el = document.getElementById("request-log");
    if (el) renderLog(el);
  }
  function renderLog(el) {
    if (!requestLog.length) { el.innerHTML = '<p class="loading">No requests yet.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>Status</th><th>ms</th><th>Request</th></tr></thead><tbody>' +
      requestLog.map(function (r) {
        var cls = r.ok ? "ok" : "bad";
        return '<tr><td><span class="badge ' + cls + '">' + (r.ok ? "200" : esc(r.error || "error")) +
          "</span></td><td class='num'>" + (r.ms === undefined ? "—" : r.ms) +
          "</td><td class='src'>" + esc(r.url) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function logged(promise, label) {
    return promise.then(function (res) {
      record({ ok: true, url: res.url, ms: res.ms, label: label });
      return res;
    }, function (err) {
      record({ ok: false, url: err.url, error: err.status ? "HTTP " + err.status :
        (err.name === "AbortError" ? "timeout" : "network/CORS"), label: label });
      throw err;
    });
  }

  /* ---------- domain helpers ---------- */
  function mid(m) {
    var b = num(m.yes_bid_dollars), a = num(m.yes_ask_dollars);
    if (b !== null && a !== null && a > 0) return (b + a) / 2;
    var l = num(m.last_price_dollars);
    if (l !== null) return l;
    if (b !== null) return b;
    if (a !== null) return a;
    return null;
  }
  function spread(m) {
    var a = num(m.yes_ask_dollars), b = num(m.no_ask_dollars);
    if (a === null || b === null || a <= 0 || b <= 0) return null;
    return a + b - 1;
  }
  /* Computed dollar volume: contracts x price. Kalshi has no "dollar amount" field,
   * so this proxy is labelled wherever it is shown. */
  function dollarVolume(m) {
    var v = num(m.volume_24h_fp);
    if (v === null) v = num(m.volume_fp);
    var p = mid(m);
    if (v === null || p === null) return null;
    return v * p;
  }
  function classify(m) {
    var probe = [m.series_ticker, m.ticker, m.event_title, m.title, m.category].join(" ");
    if (EXCLUDED_SERIES[m.series_ticker]) return null;
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i].test(probe)) return TOPICS[i];
    }
    return null;
  }
  function topicById(id) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i];
    return null;
  }
  function resultBadge(result, status) {
    var r = (result || "").toLowerCase();
    if (r === "yes") return '<span class="badge ok">resolved YES</span>';
    if (r === "no") return '<span class="badge bad">resolved NO</span>';
    if (r === "scalar") return '<span class="badge info">scalar</span>';
    if ((status || "") === "closed") return '<span class="badge warn">closed · awaiting result</span>';
    return '<span class="badge">' + esc(status || "open") + "</span>";
  }

  /* ---------- candlesticks ---------- */
  /* Documented: period_interval is 1, 60 or 1440 minutes and one request may span at
   * most 5,000 periods. Windows are therefore chosen inside those limits. */
  var WINDOWS = {
    "1m":  { period: 1,    seconds: 3600 * 2,     label: "1-minute candles · 2 h" },
    "5m":  { period: 1,    seconds: 3600 * 6,     label: "1-minute candles · 6 h" },
    "1h":  { period: 60,   seconds: 3600 * 24,    label: "1-hour candles · 24 h" },
    "6h":  { period: 60,   seconds: 3600 * 24 * 6, label: "1-hour candles · 6 d" },
    "1d":  { period: 1440, seconds: 86400 * 90,   label: "1-day candles · 90 d" }
  };
  function candles(series, ticker, windowKey) {
    var w = WINDOWS[windowKey] || WINDOWS["1m"];
    var end = Math.floor(Date.now() / 1000);
    var start = end - w.seconds;
    var path = "/series/" + encodeURIComponent(series) + "/markets/" +
      encodeURIComponent(ticker) + "/candlesticks";
    return logged(get(path, { start_ts: start, end_ts: end, period_interval: w.period }),
      "candles " + ticker).then(function (res) {
      var list = (res.data && res.data.candlesticks) || [];
      var pts = [];
      list.forEach(function (c) {
        var p = c.price || {}, b = c.yes_bid || {}, a = c.yes_ask || {};
        var close = num(p.close_dollars), bid = num(b.close_dollars), ask = num(a.close_dollars);
        var y = close !== null ? close : (bid !== null && ask !== null && ask > 0 ? (bid + ask) / 2 : bid);
        if (y === null) return;
        pts.push({ t: c.end_period_ts, y: y, hi: num(p.high_dollars), lo: num(p.low_dollars),
          bid: bid, ask: ask, vol: num(c.volume_fp) });
      });
      return { points: pts, window: w, url: res.url, raw: list.length };
    });
  }

  /* ---------- chart (canvas, no libraries) ---------- */
  function drawChart(canvas, series, opts) {
    opts = opts || {};
    if (!canvas || !series || !series.length) return false;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 720;
    var cssH = opts.height || 260;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 46, padR = 14, padT = 12, padB = 26;
    var w = cssW - padL - padR, h = cssH - padT - padB;
    var t0 = series[0].t, t1 = series[series.length - 1].t;
    if (t1 === t0) t1 = t0 + 60;
    var ys = series.map(function (p) { return p.y; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = Math.max(0.01, (hi - lo) * 0.15);
    lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    if (hi - lo < 0.02) { hi = Math.min(1, hi + 0.01); lo = Math.max(0, lo - 0.01); }

    function X(t) { return padL + (t - t0) / (t1 - t0) * w; }
    function Y(v) { return padT + (1 - (v - lo) / (hi - lo)) * h; }

    ctx.strokeStyle = "#1e2839"; ctx.lineWidth = 1;
    ctx.fillStyle = "#6b788f"; ctx.font = "11px ui-monospace, Menlo, monospace";
    for (var i = 0; i <= 4; i++) {
      var v = lo + (hi - lo) * i / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.fillText("$" + v.toFixed(2), 6, y + 4);
    }
    var steps = Math.min(6, Math.max(2, Math.floor(w / 120)));
    for (var j = 0; j <= steps; j++) {
      var t = t0 + (t1 - t0) * j / steps, x = X(t);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h); ctx.stroke();
      var dt = new Date(t * 1000);
      var lbl = opts.dayAxis
        ? dt.toISOString().slice(5, 10)
        : dt.toISOString().slice(11, 16);
      ctx.fillStyle = "#6b788f";
      ctx.fillText(lbl, Math.min(x - 14, padL + w - 30), padT + h + 17);
    }

    var grad = ctx.createLinearGradient(0, padT, 0, padT + h);
    grad.addColorStop(0, "rgba(34,211,238,.26)");
    grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.beginPath();
    series.forEach(function (p, idx) {
      if (idx === 0) ctx.moveTo(X(p.t), Y(p.y)); else ctx.lineTo(X(p.t), Y(p.y));
    });
    ctx.lineTo(X(t1), padT + h); ctx.lineTo(X(t0), padT + h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    series.forEach(function (p, idx) {
      if (idx === 0) ctx.moveTo(X(p.t), Y(p.y)); else ctx.lineTo(X(p.t), Y(p.y));
    });
    ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 1.8; ctx.stroke();

    if (opts.jumps) {
      opts.jumps.forEach(function (jp) {
        var a = X(jp.tFrom), b = X(jp.tTo);
        ctx.beginPath(); ctx.moveTo(a, Y(jp.from)); ctx.lineTo(b, Y(jp.to));
        ctx.strokeStyle = jp.delta > 0 ? "#22c55e" : "#ef4444";
        ctx.lineWidth = 3.2; ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(b, Y(jp.to), 3.6, 0, Math.PI * 2);
        ctx.fillStyle = jp.delta > 0 ? "#22c55e" : "#ef4444"; ctx.fill();
      });
    }
    var last = series[series.length - 1];
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.y), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#e8edf6"; ctx.fill();
    return true;
  }

  /* Re-scaled on container resize without re-fetching. */
  function autoRedraw(canvas, series, opts) {
    var t;
    function redraw() {
      clearTimeout(t);
      t = setTimeout(function () { drawChart(canvas, series, opts); }, 120);
    }
    window.addEventListener("resize", redraw);
    drawChart(canvas, series, opts);
  }

  /* ---------- jump detection (>= $0.10 in either direction) ---------- */
  function findJumps(points, threshold) {
    threshold = threshold === undefined ? 0.10 : threshold;
    var out = [];
    for (var i = 1; i < points.length; i++) {
      var d = points[i].y - points[i - 1].y;
      if (Math.abs(d) + 1e-9 >= threshold) {
        out.push({ tFrom: points[i - 1].t, tTo: points[i].t,
          from: points[i - 1].y, to: points[i].y, delta: d });
      }
    }
    return out;
  }

  /* ---------- live status badge ---------- */
  function probeStatus() {
    var els = document.querySelectorAll("[data-live-status]");
    if (!els.length) return;
    logged(get("/exchange/status"), "exchange/status").then(function (res) {
      var active = res.data && res.data.exchange_active;
      els.forEach(function (el) {
        el.innerHTML = '<span class="dot live"></span>Live · official demo API' +
          (active === false ? " (exchange marked inactive)" : "") +
          ' · checked ' + new Date().toISOString().slice(11, 19) + "Z";
        el.title = res.url;
      });
    }).catch(function (err) {
      els.forEach(function (el) {
        el.innerHTML = '<span class="dot err"></span>API unreachable from this browser (' +
          esc(err.status ? "HTTP " + err.status : "network / CORS") +
          ') · cached snapshot values below are still shown';
      });
    });
  }

  window.KD = {
    BASE: BASE, DOCS: DOCS, TOPICS: TOPICS, EXCLUDED_SERIES: EXCLUDED_SERIES,
    WINDOWS: WINDOWS,
    get: get, logged: logged, url: url, record: record,
    num: num, esc: esc, money: money, cents: cents, contracts: contracts, pct: pct,
    when: when, ago: ago, mid: mid, spread: spread, dollarVolume: dollarVolume,
    classify: classify, topicById: topicById, resultBadge: resultBadge,
    candles: candles, drawChart: drawChart, autoRedraw: autoRedraw, findJumps: findJumps,
    probeStatus: probeStatus
  };
})();
