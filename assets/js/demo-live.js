/* Kalshi DEMO live tracker — session arena-288e8741-demo1 (2026-11-20).
 * Data sources:
 *  - LIVE mode: official Kalshi demo Trade API (https://external-api.demo.kalshi.co/trade-api/v2),
 *    public unauthenticated market-data endpoints, fetched from YOUR browser.
 *    CORS for the published Pages origin was verified by the repo pipeline (data/cors.json).
 *  - SNAPSHOT mode: fallback to ../data/demo-snapshot.json (values captured 2026-11-20, each with its source URL).
 * No value is ever invented. When a fetch fails, the affected cell is left blank and the failure is shown.
 * Endpoints (official docs at docs.kalshi.com):
 *   GET {base}/exchange/status
 *   GET {base}/markets?event_ticker={t}&limit=1000        (paginated by cursor)
 *   GET {base}/markets/{ticker}                           (snapshot quote)
 *   GET {base}/markets/{ticker}/orderbook                 (resting bids, both sides)
 *   GET {base}/series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=1|60|1440
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
  var fmt$ = function (v) { var n = num(v); return n == null ? "" : "$" + n.toFixed(n < 0.01 && n > 0 ? 4 : 2); };
  var fmtN = function (v) { var n = num(v); return n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }); };

  /* Curated watchlist — every entry was verified to exist on the demo API on 2026-11-20
   * (see data/demo-snapshot.json and docs/demo-data-verification.md). */
  var WATCHLIST = {
    gas: [{ event: "KXAAAGASW-26NOV23", label: "Weekly AAA gas price (settles ≤ Nov 23)" },
          { event: "KXAAAGASM-26NOV30", label: "Monthly AAA gas price (Nov 30)" }],
    crypto: [{ event: "KXBTCD-26NOV2017", label: "Bitcoin price today 5pm EST (settles today)" },
             { event: "KXBTC-26NOV2101", label: "Bitcoin price range Nov 21 1am EST" }],
    elections: [{ event: "KXPRESNOMD-28", label: "2028 Democratic presidential nominee" },
                { event: "KXPRESNOMR-28", label: "2028 Republican presidential nominee" }],
    culture: [{ event: "KXTIME-26", label: "Time Person of the Year 2026" },
              { event: "KXGRAMMY-ROTY69", label: "Grammy Record of the Year (2027)" }],
    golf: [{ event: "KXPGATOUR-THRC26", label: "The RSM Classic winner (live this week)" },
           { event: "KXDPWTTOP20-DPWTC26", label: "DP World Tour Championship top-20 (live this week)" }]
  };
  var CATS = ["gas", "elections", "culture", "crypto", "golf"];

  var state = { mode: "", activeCat: "all", events: {}, markets: [], selMarket: "",
                gran: "minutes", win: 21600, pollTimer: null, refreshTimer: null, ticks: [], busy: false };

  /* ---------- data mode ---------- */
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

  function probeLive() {
    return fetchJSON(BASE + "/exchange/status", 9000).then(function () { return true; });
  }

  function loadSnapshot() {
    return fetchJSON("../data/demo-snapshot.json", 9000).then(function (j) {
      /* Flatten snapshot events into the same shape as live fetches. */
      var cats = j.categories || {};
      Object.keys(cats).forEach(function (cat) {
        var bucket = [];
        (cats[cat].open_events || []).forEach(function (ev) {
          var mkts = (ev.markets || []).map(function (m) {
            return Object.assign({ event_ticker: ev.event_ticker }, m);
          });
          bucket.push({ event: ev.event_ticker, label: ev.title || ev.event_ticker, markets: mkts,
                        source: ev.source, coverage: ev.coverage || "", snapshot: true });
        });
        (cats[cat].resolved_examples || []).forEach(function (m) {
          bucket.push({ event: m.event_ticker || m.event_title, label: (m.event_title || m.event_ticker) + " (resolved)",
                        markets: [Object.assign({ event_ticker: m.event_ticker }, m)], source: m.source,
                        coverage: "resolved example", snapshot: true });
        });
        state.events[cat] = bucket;
      });
    });
  }

  function fetchEventMarkets(eventTicker, maxPages) {
    var pages = [], cursor = "", n = 0;
    function next() {
      var url = BASE + "/markets?event_ticker=" + encodeURIComponent(eventTicker) + "&limit=1000" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      return fetchJSON(url, 15000).then(function (j) {
        pages = pages.concat(j.markets || []);
        cursor = j.cursor || "";
        n++;
        if (cursor && n < (maxPages || 2)) return next();
        return pages;
      });
    }
    return next();
  }

  /* ---------- live refresh of watchlist ---------- */
  function refreshLive() {
    var jobs = [];
    CATS.forEach(function (cat) {
      WATCHLIST[cat].forEach(function (w) {
        jobs.push(fetchEventMarkets(w.event, 2).then(function (mkts) {
          var bucket = state.events[cat] || (state.events[cat] = []);
          var rec = { event: w.event, label: w.label, markets: mkts, source: BASE + "/markets?event_ticker=" + encodeURIComponent(w.event) + "&limit=1000", coverage: mkts.length + " markets fetched", snapshot: false };
          var idx = bucket.findIndex(function (b) { return b.event === w.event; });
          if (idx >= 0) bucket[idx] = rec; else bucket.push(rec);
        }).catch(function (e) {
          var bucket = state.events[cat] || (state.events[cat] = []);
          var rec = { event: w.event, label: w.label, markets: bucket.length ? (bucket.find(function (b) { return b.event === w.event; }) || {}).markets || [] : [], source: BASE + "/markets?event_ticker=" + encodeURIComponent(w.event), coverage: "live fetch failed: " + e.message, snapshot: true, error: e.message };
          var idx = bucket.findIndex(function (b) { return b.event === w.event; });
          if (idx >= 0) bucket[idx] = rec; else bucket.push(rec);
        }));
      });
    });
    return Promise.all(jobs);
  }

  /* ---------- derived metrics (documented formulas) ---------- */
  function eventAgg(rec) {
    var vol = 0, vol24 = 0, dollars = 0, dollars24 = 0, oi = 0, active = 0, finalized = 0, resolvedYes = 0, resolvedNo = 0, close = "";
    (rec.markets || []).forEach(function (m) {
      var v = num(m.volume_fp), v24 = num(m.volume_24h_fp), lp = num(m.last_price_dollars), o = num(m.open_interest_fp);
      if (v != null) vol += v;
      if (v24 != null) vol24 += v24;
      if (v != null && lp != null) dollars += v * lp;
      if (v24 != null && lp != null) dollars24 += v24 * lp;
      if (o != null) oi += o;
      if (m.status === "finalized") { finalized++; if (m.result === "yes") resolvedYes++; else if (m.result === "no") resolvedNo++; }
      else active++;
      if (!close && m.close_time) close = m.close_time;
      if (!close && m.expected_expiration_time) close = m.expected_expiration_time;
    });
    return { vol: vol, vol24: vol24, dollars: dollars, dollars24: dollars24, oi: oi, active: active,
             finalized: finalized, resolvedYes: resolvedYes, resolvedNo: resolvedNo, close: close };
  }

  /* ---------- rendering ---------- */
  function renderWatchlist() {
    var rows = [], totalDollars = 0;
    CATS.forEach(function (cat) {
      if (state.activeCat !== "all" && state.activeCat !== cat) return;
      (state.events[cat] || []).forEach(function (rec) {
        var a = eventAgg(rec);
        totalDollars += a.dollars;
        var resolution = "";
        if (a.finalized > 0) resolution = a.finalized + " finalized: " + a.resolvedYes + " yes / " + a.resolvedNo + " no";
        else if (a.active > 0) resolution = "open (" + a.active + " markets)";
        rows.push('<tr>' +
          '<td><b>' + esc(rec.label) + '</b><br><small>' + esc(rec.event) + '</small></td>' +
          '<td>' + esc(cat) + '</td>' +
          '<td>' + esc((rec.close || "").replace("T", " ").replace("Z", "Z")) + '</td>' +
          '<td>' + fmtN(a.vol) + '</td>' +
          '<td>' + (a.dollars ? "$" + a.dollars.toLocaleString("en-US", { maximumFractionDigits: 2 }) + ' <small>(est.)</small>' : "") + '</td>' +
          '<td>' + fmtN(a.oi) + '</td>' +
          '<td>' + esc(resolution) + '</td>' +
          '<td><a href="' + esc(rec.source) + '" target="_blank" rel="noreferrer">API ↗</a>' +
              (rec.coverage ? '<br><small>' + esc(rec.coverage) + '</small>' : "") + '</td>' +
          '<td><button class="btn" data-explore="' + esc(rec.event) + '">Markets</button></td>' +
          '</tr>');
      });
    });
    $("watch-rows").innerHTML = rows.length ? rows.join("") :
      '<tr><td colspan="9">No data yet. Click "Refresh" — values stay blank until an official response arrives.</td></tr>';
    $("kpi-dollars").textContent = totalDollars ? "$" + totalDollars.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";
    var nEv = 0, nMk = 0;
    CATS.forEach(function (c) { (state.events[c] || []).forEach(function (r) { nEv++; nMk += (r.markets || []).length; }); });
    $("kpi-events").textContent = nEv; $("kpi-markets").textContent = nMk;
    $("kpi-mode").textContent = state.mode.toUpperCase();
  }

  function findEventRec(eventTicker) {
    var found = null;
    CATS.forEach(function (c) { (state.events[c] || []).forEach(function (r) { if (r.event === eventTicker) found = r; }); });
    return found;
  }

  function renderExplorer() {
    var sel = $("explore-event");
    var opts = ['<option value="">Choose a tracked event…</option>'];
    CATS.forEach(function (c) {
      (state.events[c] || []).forEach(function (r) {
        opts.push('<option value="' + esc(r.event) + '"' + (r.event === state.selEvent ? " selected" : "") + '>' + esc(c + ": " + r.label) + '</option>');
      });
    });
    sel.innerHTML = opts.join("");
    var rec = state.selEvent ? findEventRec(state.selEvent) : null;
    var mkts = rec ? (rec.markets || []).slice() : [];
    mkts.sort(function (a, b) { return (num(b.volume_fp) || 0) - (num(a.volume_fp) || 0); });
    mkts = mkts.slice(0, 40);
    var rows = mkts.map(function (m) {
      return '<tr>' +
        '<td>' + esc(m.ticker) + '<br><small>' + esc(m.subtitle || m.yes_sub_title || m.title || "") + '</small></td>' +
        '<td>' + fmt$(m.last_price_dollars) + '</td>' +
        '<td>' + fmt$(m.yes_bid_dollars) + ' / ' + fmt$(m.yes_ask_dollars) + '</td>' +
        '<td>' + fmtN(m.yes_bid_size_fp) + ' / ' + fmtN(m.yes_ask_size_fp) + '</td>' +
        '<td>' + fmtN(m.volume_fp) + '</td>' +
        '<td>' + fmtN(m.volume_24h_fp) + '</td>' +
        '<td>' + fmtN(m.open_interest_fp) + '</td>' +
        '<td>' + esc(m.status || "") + (m.result ? " · " + esc(m.result) : "") + '</td>' +
        '<td><button class="btn" data-chart="' + esc(m.ticker) + '">Chart</button> <button class="btn" data-book="' + esc(m.ticker) + '">Book</button></td>' +
        '<td><a href="' + BASE + '/markets/' + encodeURIComponent(m.ticker || "") + '" target="_blank" rel="noreferrer">API ↗</a></td>' +
        '</tr>';
    }).join("");
    $("explorer-rows").innerHTML = rows || '<tr><td colspan="10">Select an event above. If the API is unreachable, only snapshot-captured markets are listed (partial coverage is disclosed per event).</td></tr>';
    $("explorer-rows").querySelectorAll("[data-chart]").forEach(function (b) {
      b.onclick = function () { selectMarket(b.getAttribute("data-chart")); };
    });
    $("explorer-rows").querySelectorAll("[data-book]").forEach(function (b) {
      b.onclick = function () { loadBook(b.getAttribute("data-book")); };
    });
    if (rec && rec.coverage) $("explorer-coverage").textContent = "Coverage: " + rec.coverage + (rec.source ? " · source: " : "");
    else $("explorer-coverage").textContent = "";
    if (rec && rec.source) {
      var a = document.createElement("a");
      a.href = rec.source; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = "open API response ↗";
      $("explorer-coverage").appendChild(a);
    }
  }

  /* ---------- chart ---------- */
  function seriesOf(ticker) { return String(ticker || "").split("-")[0]; }

  function selectMarket(ticker) {
    state.selMarket = ticker;
    state.ticks = [];
    $("chart-market").textContent = ticker;
    drawEmpty();
    if (state.gran === "seconds") startPolling();
    else { stopPolling(); loadCandles(); }
  }

  function drawEmpty(msg) {
    var svg = $("chart");
    svg.setAttribute("viewBox", "0 0 960 340");
    svg.innerHTML = '<text x="480" y="170" text-anchor="middle" fill="#6b7280">' + esc(msg || "No points yet.") + '</text>';
  }

  function drawSeries(points, label) {
    var W = 960, H = 340, L = 62, R = 14, T = 18, B = 42;
    var svg = $("chart");
    if (!points.length) return drawEmpty("No price points returned for this window — nothing invented.");
    var ys = points.map(function (p) { return p.y; }).filter(function (y) { return y != null; });
    if (!ys.length) return drawEmpty("No price values in returned data.");
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = Math.max((hi - lo) * 0.15, 0.01);
    lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    var t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
    var X = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); };
    var Y = function (y) { return T + (1 - (y - lo) / (hi - lo)) * (H - T - B); };
    var html = [];
    /* grid + y labels */
    for (var g = 0; g <= 4; g++) {
      var gy = lo + (hi - lo) * g / 4, yy = Y(gy);
      html.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e5e7eb"/>');
      html.push('<text x="' + (L - 6) + '" y="' + (yy + 3) + '" text-anchor="end" font-size="10" fill="#6b7280">$' + gy.toFixed(2) + '</text>');
    }
    /* x labels (4) */
    for (var k = 0; k <= 3; k++) {
      var tt = t0 + (t1 - t0) * k / 3, xx = X(tt);
      var d = new Date(tt);
      var lbl = state.gran === "seconds" || state.gran === "minutes"
        ? ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + (state.gran === "seconds" ? ":" + ("0" + d.getSeconds()).slice(-2) : "")
        : (d.getMonth() + 1) + "/" + d.getDate() + " " + ("0" + d.getHours()).slice(-2) + ":00";
      html.push('<text x="' + xx + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="10" fill="#6b7280">' + esc(lbl) + '</text>');
    }
    /* path */
    var path = "", started = false;
    points.forEach(function (p) {
      if (p.y == null) return;
      path += (started ? " L" : "M") + X(p.t).toFixed(1) + " " + Y(p.y).toFixed(1);
      started = true;
    });
    html.push('<path d="' + path + '" fill="none" stroke="#0e7c5a" stroke-width="2"/>');
    html.push('<text x="' + L + '" y="12" font-size="10" fill="#374151">' + esc(label) + '</text>');
    html.push('<text x="' + L + '" y="' + (H - 8) + '" font-size="9" fill="#9ca3af">X: time (UTC-local) · Y: YES contract price, USD (payout $1 if yes)</text>');
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = html.join("");
  }

  function loadCandles() {
    var t = state.selMarket;
    if (!t) return drawEmpty("Pick a market (Markets → Chart).");
    var period = state.gran === "hours" ? 60 : 1;
    var end = Math.floor(Date.now() / 1000), start = end - state.win;
    var url = BASE + "/series/" + encodeURIComponent(seriesOf(t)) + "/markets/" + encodeURIComponent(t) +
      "/candlesticks?start_ts=" + start + "&end_ts=" + end + "&period_interval=" + period;
    $("chart-note").textContent = "Loading official candlesticks (period_interval=" + period + " min)…";
    fetchJSON(url, 15000).then(function (j) {
      var pts = (j.candlesticks || []).map(function (c) {
        var price = c.price && num(c.price.close_dollars);
        var bid = c.yes_bid && num(c.yes_bid.close_dollars);
        var y = price != null ? price : bid; /* when no trades occurred, fall back to the closing best bid */
        return { t: (c.end_period_ts || 0) * 1000, y: y, traded: price != null };
      }).filter(function (p) { return p.t; });
      var nTraded = pts.filter(function (p) { return p.traded; }).length;
      drawSeries(pts, "YES price · " + (nTraded ? nTraded + " traded candles (price.close)" : "no trades in window — showing closing best bid (yes_bid.close)"));
      $("chart-note").textContent = pts.length + " candles returned by " + url.replace(BASE, "…trade-api/v2");
    }).catch(function (e) {
      drawEmpty("Candlesticks unavailable: " + e.message);
      $("chart-note").textContent = "";
    });
  }

  function startPolling() {
    stopPolling();
    if (!state.selMarket) return drawEmpty("Pick a market for the seconds view.");
    $("chart-note").textContent = "Seconds view: polling GET /markets/{ticker} every 3 s (Kalshi candlesticks minimum period is 1 minute). Points accumulate while the page stays open.";
    function tick() {
      fetchJSON(BASE + "/markets/" + encodeURIComponent(state.selMarket), 8000).then(function (j) {
        var m = j.market || j;
        var y = num(m.last_price_dollars);
        if (y == null) y = num(m.yes_bid_dollars);
        if (y == null) return;
        state.ticks.push({ t: Date.now(), y: y });
        var cutoff = Date.now() - state.win * 1000;
        state.ticks = state.ticks.filter(function (p) { return p.t >= cutoff; });
        drawSeries(state.ticks, "Polled snapshots (" + state.ticks.length + " points) — last_price (bid fallback)");
      }).catch(function (e) {
        $("chart-note").textContent = "Poll failed: " + e.message + " — no points invented.";
      });
    }
    tick();
    state.pollTimer = setInterval(tick, 3000);
  }
  function stopPolling() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

  /* ---------- order book ---------- */
  function loadBook(ticker) {
    var box = $("book-box");
    box.innerHTML = "Loading official order book…";
    state.selBook = ticker;
    fetchJSON(BASE + "/markets/" + encodeURIComponent(ticker) + "/orderbook", 12000).then(function (j) {
      var ob = (j.orderbook_fp || j.orderbook || {});
      var yes = (ob.yes_dollars || ob.yes || []).slice(-10).reverse();
      var no = (ob.no_dollars || ob.no || []).slice(-10).reverse();
      var rows = '<tr><th>Side</th><th>Price</th><th>Contracts available</th><th>$ depth (computed)</th></tr>';
      var yesTotal = 0, noTotal = 0, yesDollars = 0, noDollars = 0;
      yes.forEach(function (lv) {
        var p = num(lv[0]), c = num(lv[1]);
        if (p == null || c == null) return;
        yesTotal += c; yesDollars += p * c;
        rows += '<tr><td>YES bid</td><td>' + fmt$(p) + '</td><td>' + fmtN(c) + '</td><td>$' + (p * c).toFixed(2) + '</td></tr>';
      });
      no.forEach(function (lv) {
        var p = num(lv[0]), c = num(lv[1]);
        if (p == null || c == null) return;
        noTotal += c; noDollars += p * c;
        rows += '<tr><td>NO bid <small>(= YES ask ' + fmt$(1 - p) + ')</small></td><td>' + fmt$(p) + '</td><td>' + fmtN(c) + '</td><td>$' + (p * c).toFixed(2) + '</td></tr>';
      });
      rows += '<tr><td><b>Total</b></td><td></td><td><b>YES ' + fmtN(yesTotal) + ' · NO ' + fmtN(noTotal) + '</b></td><td><b>$' + yesDollars.toFixed(2) + ' · $' + noDollars.toFixed(2) + '</b></td></tr>';
      box.innerHTML = '<table class="tbl">' + rows + '</table>' +
        '<p class="note">Endpoint returns resting bids only (10 deepest per side shown). YES asks are derived as 1 − NO bid, per official docs. Source: <a href="' + BASE + '/markets/' + encodeURIComponent(ticker) + '/orderbook" target="_blank" rel="noreferrer">orderbook API ↗</a></p>';
    }).catch(function (e) {
      box.innerHTML = "Order book unavailable: " + esc(e.message) + ". Nothing substituted.";
    });
  }

  /* ---------- resolution tracker ---------- */
  function renderResolutions() {
    var box = $("res-rows");
    var items = [];
    CATS.forEach(function (cat) {
      (state.events[cat] || []).forEach(function (rec) {
        var a = eventAgg(rec);
        if (a.finalized > 0) {
          var yesMkts = (rec.markets || []).filter(function (m) { return m.result === "yes"; });
          var resolvedAt = yesMkts.length && (yesMkts[0].settlement_ts || "");
          items.push({ cat: cat, ev: rec.event, label: rec.label, stateTxt: "RESOLVED — " + a.resolvedYes + "× yes / " + a.resolvedNo + "× no" + (resolvedAt ? " · settled " + resolvedAt : ""), resolved: true, source: rec.source });
        } else {
          items.push({ cat: cat, ev: rec.event, label: rec.label, stateTxt: "open — closes " + (a.close || "?") + " · will be tracked until finalized", resolved: false, source: rec.source });
        }
      });
    });
    /* merge verified historical resolutions from the snapshot log */
    fetchJSON("../data/demo-resolution-log.json", 8000).then(function (log) {
      (log.resolved || []).forEach(function (r) {
        var dup = items.some(function (i) { return i.ev === r.event_ticker && i.resolved; });
        if (!dup) items.push({ cat: r.category, ev: r.event_ticker, label: r.market_ticker + " — " + r.question, stateTxt: "RESOLVED " + String(r.result).toUpperCase() + " · value " + r.settlement_value_dollars + " · settled " + r.settlement_ts, resolved: true, source: r.source });
      });
      paint();
    }).catch(function () { paint(); });
    function paint() {
      $("res-rows").innerHTML = items.map(function (i) {
        return '<tr><td>' + esc(i.cat) + '</td><td><b>' + esc(i.label) + '</b><br><small>' + esc(i.ev) + '</small></td><td>' +
          (i.resolved ? '<span class="tag res">' + esc(i.stateTxt) + '</span>' : '<span class="tag open">' + esc(i.stateTxt) + '</span>') +
          '</td><td><a href="' + esc(i.source) + '" target="_blank" rel="noreferrer">API ↗</a></td></tr>';
      }).join("") || '<tr><td colspan="4">No tracked events loaded yet.</td></tr>';
    }
  }

  /* ---------- wiring ---------- */
  function refreshAll() {
    if (state.busy) return;
    state.busy = true;
    $("refresh").disabled = true;
    setBanner("", "Connecting to the official demo API…");
    probeLive().then(function () {
      state.mode = "live";
      setBanner("live", "<b>LIVE mode</b> — your browser is reading the official Kalshi demo API directly (public endpoints, no key). Source of every cell is the linked API response.");
      return refreshLive();
    }).catch(function () {
      state.mode = "snapshot";
      setBanner("warn", "<b>SNAPSHOT mode</b> — the demo API did not respond from this browser. Showing the verified point-in-time snapshot (data/demo-snapshot.json, captured 2026-11-20 from the official API). Live chart/order book are unavailable in this mode; nothing is substituted.");
      return loadSnapshot();
    }).then(function () {
      renderWatchlist(); renderExplorer(); renderResolutions();
      if (state.mode === "live" && state.selMarket) { if (state.gran === "seconds") startPolling(); else loadCandles(); }
      if (state.mode === "live" && state.selBook) loadBook(state.selBook);
      state.busy = false; $("refresh").disabled = false;
    }).catch(function (e) {
      setBanner("warn", "Data load failed: " + esc(e.message) + ". Values remain blank.");
      state.busy = false; $("refresh").disabled = false;
    });
  }

  document.querySelectorAll("#cat-filter .chip").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#cat-filter .chip").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.activeCat = b.getAttribute("data-cat");
      renderWatchlist();
    };
  });
  document.querySelectorAll("#gran .segbtn").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#gran .segbtn").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.gran = b.getAttribute("data-g");
      if (state.gran === "seconds") startPolling(); else { stopPolling(); loadCandles(); }
    };
  });
  document.querySelectorAll("#win .segbtn").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#win .segbtn").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.win = Number(b.getAttribute("data-w"));
      if (state.gran === "seconds") startPolling(); else loadCandles();
    };
  });
  $("explore-event").onchange = function () { state.selEvent = this.value; renderExplorer(); };
  $("refresh").onclick = refreshAll;
  $("auto-refresh").onchange = function () {
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
    if (this.checked) state.refreshTimer = setInterval(refreshAll, 60000);
  };

  drawEmpty("Pick a market (Markets → Chart). Seconds = polled snapshots; minutes = 1-min candles; hours = 1-h candles.");
  refreshAll();
})();
