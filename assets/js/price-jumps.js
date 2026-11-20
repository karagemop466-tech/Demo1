/* Kalshi DEMO sharp-move detector — session arena/b10c4954-demo1 (2026-11-20).
 * Detects contract-price jumps of at least a threshold (default $0.10) in either
 * direction between consecutive OFFICIAL candlestick closes, across the five
 * tracked topics (gas, elections, culture, crypto, golf).
 *
 * Data sources (official, verified 2026-11-20 against docs.kalshi.com):
 *  - LIVE mode:  GET {base}/series/{series_ticker}/markets/{ticker}/candlesticks
 *                ?start_ts&end_ts&period_interval   (period_interval: 1 | 60 | 1440 minutes)
 *                Response: candlesticks[].price.close_dollars, yes_bid, yes_ask, volume_fp,
 *                open_interest_fp — schema per
 *                https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *  - SNAPSHOT mode: fallback to ../snapshot/charts.json (official demo responses captured
 *                2026-11-20, every record carries its request URL).
 *
 * Links per jump:
 *  - Official candlestick API URL (the exact request that produced the row).
 *  - Official venue event page: https://kalshi.com/events/{event_ticker}
 *    (link pattern verified 2026-11-20 for all five topics: gas KXAAAGASM-26NOV30,
 *     elections KXPRESNOMD-28, culture KXOSCARPIC-27, crypto KXBTCY-27JAN0100,
 *     golf KXPGATOUR-THRC26).
 * Causation: the Kalshi API has NO field that identifies what caused a price move.
 * "Possible cause" website links are therefore left BLANK and flagged (F-17); only the
 * official venue event page is linked (the venue may display related-news digests).
 * No value is ever invented; fetch failures are shown and cells left blank.
 */
(function () {
  "use strict";
  var BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var num = function (v) { return v === "" || v == null || isNaN(Number(v)) ? null : Number(v); };
  var fmt$ = function (v) { var n = num(v); return n == null ? "" : "$" + n.toFixed(4); };
  var fmtT = function (ts) {
    var n = num(ts);
    if (n == null) return "";
    var d = new Date(n * 1000);
    return d.toISOString().replace("T", " ").replace(".000Z", "Z");
  };

  /* Watchlist = the 10 markets captured in the verified snapshot (snapshot/charts.json),
   * each carrying its series ticker, its official request URL, and its topic.
   * Topics mirror the verified series→topic mapping used by the repo pipeline. */
  var WATCHLIST = [
    { ticker: "KXAAAGASW-26NOV23-3.6400", series: "KXAAAGASW", topic: "gas" },
    { ticker: "KXAAAGASW-26NOV23-3.6200", series: "KXAAAGASW", topic: "gas" },
    { ticker: "KXPRESNOMD-28-AYAN", series: "KXPRESNOMD", topic: "elections" },
    { ticker: "KXPRESNOMR-28-LHOG", series: "KXPRESNOMR", topic: "elections" },
    { ticker: "KXOSCARPIC-27-INV", series: "KXOSCARPIC", topic: "culture" },
    { ticker: "KXBTCY-27JAN0100-T149999.99", series: "KXBTCY", topic: "crypto" },
    { ticker: "KXBTCY-27JAN0100-B127500", series: "KXBTCY", topic: "crypto" },
    { ticker: "KXPGATOUR-THRC26-TMOO", series: "KXPGATOUR", topic: "golf" },
    { ticker: "KXPGATOUR-THRC26-SSTR", series: "KXPGATOUR", topic: "golf" },
    { ticker: "KXRT-FUR-85", series: "KXRT", topic: "culture" }
  ];
  var CATS = ["gas", "elections", "culture", "crypto", "golf"];
  var CATS_LABEL = { gas: "Gas prices", elections: "Elections", culture: "Culture", crypto: "Crypto", golf: "Golf" };
  /* Official period_interval (minutes) → request window and snapshot window key. */
  var WINDOWS = {
    1: { label: "1-minute candles (last 6 h)", minutes: 360, snap: "1m/6h" },
    60: { label: "1-hour candles (last 7 days)", minutes: 10080, snap: "1h/7d" },
    1440: { label: "1-day candles (last 90 days)", minutes: 1296000, snap: "1d/90d" }
  };

  var state = { mode: "", interval: 1, threshold: 0.10, activeCat: "all",
                data: {}, jumps: [], selMarket: "", pollTimer: null, busy: false };

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 12000) : null;
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).catch(function (e) { if (t) clearTimeout(t); throw e; });
  }

  function setBanner(kind, html) {
    var b = $("mode-banner");
    b.className = "banner " + (kind || "");
    b.innerHTML = html;
  }

  /* Event ticker: market tickers carry the event ticker plus one final strike
   * segment; the venue link pattern https://kalshi.com/events/{event_ticker} was
   * verified for all five topics on 2026-11-20. */
  function eventOf(ticker) { return String(ticker).replace(/-[^-]+$/, ""); }

  /* Normalize candle payloads from both sources to {t, price, bid, ask, vol, oi, url}.
   * Values are copied verbatim from the official response; nulls stay null (never filled). */
  function normLive(cs, url) {
    var p = cs.price || {};
    return {
      t: cs.end_period_ts,
      price: num(p.close_dollars),
      bid: num((cs.yes_bid || {}).close_dollars),
      ask: num((cs.yes_ask || {}).close_dollars),
      vol: num(cs.volume_fp),
      oi: num(cs.open_interest_fp),
      url: url
    };
  }
  function normSnap(pt, url) {
    return {
      t: pt.t,
      price: num(pt.price_close),
      bid: num(pt.yes_bid_close),
      ask: num(pt.yes_ask_close),
      vol: num(pt.volume),
      oi: num(pt.open_interest),
      url: url
    };
  }

  /* Detect |Δclose| >= threshold between consecutive non-null closes. */
  function detectJumps(points, threshold) {
    var jumps = [];
    var prev = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.price == null) { continue; }
      if (prev != null) {
        var d = p.price - prev.price;
        if (Math.abs(d) >= threshold) {
          jumps.push({
            t: p.t, market: p.market, event: p.event, series: p.series, topic: p.topic,
            before: prev.price, after: p.price, delta: d,
            dir: d >= 0 ? "up" : "down", url: p.url
          });
        }
      }
      prev = p;
    }
    return jumps;
  }

  /* ---------- data loading ---------- */
  function loadSnapshot() {
    return fetchJSON("../snapshot/charts.json", 9000).then(function (j) {
      var byTicker = {};
      (j.series || []).forEach(function (s) {
        byTicker[s.market_ticker] = s;
      });
      state.data = {};
      WATCHLIST.forEach(function (w) {
        var s = byTicker[w.ticker];
        if (!s) return;
        var wkey = WINDOWS[state.interval].snap;
        var win = (s.windows || {})[wkey];
        if (!win) return;
        state.data[w.ticker] = (win.points || []).map(function (pt) {
          var n = normSnap(pt, win.source || "");
          n.market = w.ticker; n.event = eventOf(w.ticker); n.series = w.series; n.topic = w.topic;
          return n;
        });
      });
    });
  }

  function loadLive() {
    var now = Math.floor(Date.now() / 1000);
    var w = WINDOWS[state.interval];
    var start = now - w.minutes * 60;
    var jobs = WATCHLIST.map(function (m) {
      var url = BASE + "/series/" + encodeURIComponent(m.series) + "/markets/" + encodeURIComponent(m.ticker) +
        "/candlesticks?start_ts=" + start + "&end_ts=" + now + "&period_interval=" + state.interval;
      return fetchJSON(url, 15000).then(function (j) {
        state.data[m.ticker] = (j.candlesticks || []).map(function (cs) {
          var n = normLive(cs, url);
          n.market = m.ticker; n.event = eventOf(m.ticker); n.series = m.series; n.topic = m.topic;
          return n;
        });
      }).catch(function (e) { state.data[m.ticker] = null; state.fetchErrors = (state.fetchErrors || []).concat([{ ticker: m.ticker, url: url, err: e.message }]); });
    });
    return Promise.all(jobs);
  }

  /* ---------- rendering ---------- */
  function topicTag(t) { return '<span class="tag t-' + esc(t) + '">' + esc(CATS_LABEL[t] || t) + "</span>"; }

  function renderKPIs() {
    var jumps = state.jumps.filter(function (j) { return state.activeCat === "all" || j.topic === state.activeCat; });
    var up = jumps.filter(function (j) { return j.dir === "up"; }).length;
    $("kpi-mode").textContent = state.mode === "LIVE" ? "LIVE · official demo API" : "SNAPSHOT · verified 2026-11-20";
    $("kpi-markets").textContent = Object.keys(state.data).filter(function (k) { return state.data[k]; }).length + " / " + WATCHLIST.length;
    $("kpi-jumps").textContent = jumps.length;
    $("kpi-updown").textContent = up + " up · " + (jumps.length - up) + " down";
  }

  function renderTable() {
    var jumps = state.jumps.filter(function (j) { return state.activeCat === "all" || j.topic === state.activeCat; })
      .sort(function (a, b) { return b.t - a.t; });
    var body = $("jump-rows");
    if (!jumps.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty">No jumps ≥ threshold found in the loaded window. ' +
        "Values are shown only when present in an official response; empty data stays empty.</td></tr>";
      renderChart();
      return;
    }
    body.innerHTML = jumps.map(function (j) {
      var venue = "https://kalshi.com/events/" + encodeURIComponent(j.event);
      return "<tr>" +
        "<td>" + esc(fmtT(j.t)) + "</td>" +
        "<td>" + topicTag(j.topic) + "</td>" +
        '<td class="mono">' + esc(j.market) + "</td>" +
        '<td class="mono">' + esc(j.event) + "</td>" +
        "<td>" + esc(fmt$(j.before)) + "</td>" +
        "<td>" + esc(fmt$(j.after)) + "</td>" +
        '<td class="numc ' + (j.dir === "up" ? "up" : "down") + '">' + esc((j.delta >= 0 ? "+" : "") + j.delta.toFixed(4)) + "</td>" +
        '<td><span class="tag ' + (j.dir === "up" ? "t-up" : "t-down") + '">' + (j.dir === "up" ? "UP" : "DOWN") + "</span></td>" +
        '<td class="src"><a href="' + esc(j.url) + '" target="_blank" rel="noreferrer">candlestick API ↗</a> · ' +
        '<a href="' + venue + '" target="_blank" rel="noreferrer">venue event ↗</a>' +
        '<span class="blank-note"> cause: blank</span></td>' +
        "</tr>";
    }).join("");
    renderChart();
  }

  /* Simplified SVG chart: closes over time (x), price (y), jump points marked. */
  function renderChart() {
    var sel = state.selMarket;
    var host = $("jump-chart");
    if (!sel || !state.data[sel] || !state.data[sel].length) {
      host.innerHTML = '<p class="empty">Choose a market to plot its closes and marked jump points.</p>';
      $("chart-meta").textContent = "";
      return;
    }
    var pts = state.data[sel];
    var withPrice = pts.filter(function (p) { return p.price != null; });
    var jumps = state.jumps.filter(function (j) { return j.market === sel; });
    $("chart-meta").textContent = sel + " · " + withPrice.length + " closes · " + jumps.length + " jumps ≥ threshold · prices from " + (state.mode === "LIVE" ? "live official candlesticks" : "verified snapshot");
    if (withPrice.length < 2) { host.innerHTML = '<p class="empty">Fewer than two priced closes for this market in the selected window.</p>'; return; }

    var W = 760, H = 260, padL = 44, padR = 10, padT = 10, padB = 34;
    var ts = withPrice.map(function (p) { return p.t; });
    var ps = withPrice.map(function (p) { return p.price; });
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts);
    var p0 = Math.min.apply(null, ps), p1 = Math.max.apply(null, ps);
    if (t1 === t0) t1 = t0 + 1;
    if (p1 === p0) { p1 = p0 + 0.01; }
    var X = function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
    var Y = function (p) { return H - padB - (p - p0) / (p1 - p0) * (H - padT - padB); };

    var line = withPrice.map(function (p, i) { return (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.price).toFixed(1); }).join(" ");
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Price closes with jump points">';
    /* gridlines + y labels */
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var yv = p0 + f * (p1 - p0), y = Y(yv);
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e2e8f0" stroke-width="1"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 4).toFixed(1) + '" font-size="10" fill="#64748b" text-anchor="end">' + fmt$(yv) + "</text>";
    });
    /* x labels: first, middle, last time (UTC) */
    [0, Math.floor(withPrice.length / 2), withPrice.length - 1].forEach(function (i) {
      var p = withPrice[i];
      svg += '<text x="' + X(p.t).toFixed(1) + '" y="' + (H - padB + 16) + '" font-size="10" fill="#64748b" text-anchor="middle">' + esc(fmtT(p.t).slice(0, 16)) + "</text>";
    });
    svg += '<text x="' + padL + '" y="' + (H - 4) + '" font-size="10" fill="#64748b">time (UTC) →</text>';
    svg += '<text x="4" y="14" font-size="10" fill="#64748b">price $</text>';
    svg += '<path d="' + line + '" fill="none" stroke="#1d4ed8" stroke-width="1.6"/>';
    jumps.forEach(function (j) {
      var i = indexOfT(withPrice, j.t);
      if (i < 0) return;
      var c = withPrice[i];
      var col = j.dir === "up" ? "#dc2626" : "#16a34a";
      svg += '<circle cx="' + X(c.t).toFixed(1) + '" cy="' + Y(c.price).toFixed(1) + '" r="4.5" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>';
    });
    svg += "</svg>";
    host.innerHTML = svg;
  }
  function indexOfT(pts, t) {
    for (var i = 0; i < pts.length; i++) { if (pts[i].t === t) return i; }
    return -1;
  }

  function renderMarketSelect() {
    var sel = $("chart-market");
    sel.innerHTML = '<option value="">Choose a market to chart…</option>';
    WATCHLIST.forEach(function (w) {
      if (state.activeCat !== "all" && w.topic !== state.activeCat) return;
      sel.innerHTML += '<option value="' + esc(w.ticker) + '">' + esc(CATS_LABEL[w.topic] + " · " + w.ticker) + "</option>";
    });
  }

  function recompute() {
    /* Detect per market: points from different markets must never be compared
     * (concatenating series would create false cross-market jumps). */
    state.jumps = [];
    Object.keys(state.data).forEach(function (k) {
      if (state.data[k]) state.jumps = state.jumps.concat(detectJumps(state.data[k], state.threshold));
    });
    renderKPIs();
    renderTable();
  }

  function refresh() {
    if (state.busy) return;
    state.busy = true;
    state.fetchErrors = [];
    setBanner("warn", "Connecting to the official demo API…");
    loadLive().then(function () {
      var ok = Object.keys(state.data).filter(function (k) { return state.data[k]; }).length;
      if (ok > 0) {
        state.mode = "LIVE";
        setBanner("live", "LIVE · prices from the official Kalshi demo API (candlesticks endpoint). " +
          (state.fetchErrors.length ? state.fetchErrors.length + " market(s) failed; their cells stay blank." : "All watched markets fetched."));
      } else {
        return loadSnapshot().then(function () {
          state.mode = "SNAPSHOT";
          setBanner("warn", "SNAPSHOT · the live demo API could not be reached. Showing the verified snapshot captured " +
            "2026-11-20 (each record carries its official request URL). Nothing is invented.");
        });
      }
    }).catch(function () {
      return loadSnapshot().then(function () {
        state.mode = "SNAPSHOT";
        setBanner("warn", "SNAPSHOT · live fetch failed. Showing the verified snapshot captured 2026-11-20. Nothing is invented.");
      }).catch(function (e) {
        state.mode = "";
        setBanner("", "No data available: live fetch failed (" + esc(e.message) + ") and the snapshot could not be loaded. Cells stay blank.");
      });
    }).then(function () {
      state.busy = false;
      recompute();
      renderMarketSelect();
      if (!state.selMarket) state.selMarket = Object.keys(state.data)[0] || "";
      renderChart();
    });
  }

  /* ---------- wiring ---------- */
  function init() {
    var cats = $("cat-filter");
    cats.innerHTML = '<button class="chip active" data-cat="all">All topics</button>' +
      CATS.map(function (c) { return '<button class="chip" data-cat="' + c + '">' + CATS_LABEL[c] + "</button>"; }).join("");
    cats.addEventListener("click", function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      Array.prototype.forEach.call(cats.querySelectorAll(".chip"), function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.activeCat = b.getAttribute("data-cat");
      renderKPIs(); renderTable(); renderMarketSelect(); renderChart();
    });
    $("interval").addEventListener("change", function (e) {
      state.interval = Number(e.target.value);
      refresh();
    });
    $("threshold").addEventListener("input", function (e) {
      var v = num(e.target.value);
      if (v != null && v >= 0) { state.threshold = v; recompute(); }
    });
    $("chart-market").addEventListener("change", function (e) {
      state.selMarket = e.target.value; renderChart();
    });
    $("refresh").addEventListener("click", refresh);
    $("auto-refresh").addEventListener("change", function (e) {
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
      if (e.target.checked) state.pollTimer = setInterval(refresh, 120000);
    });
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
