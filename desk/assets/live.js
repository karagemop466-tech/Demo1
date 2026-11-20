/* desk/assets/live.js — live dashboard behaviour.
 *
 * Everything shown is either (a) a value the official demo API returned just now, or
 * (b) a value transcribed from the committed collection. Nothing is synthesised: when
 * the browser cannot reach the API the tables say so and the cached snapshot stays.
 */
(function () {
  "use strict";
  var KD = window.KD;
  if (!KD) {
    /* core.js must be evaluated first; if it is not, retry once the document is ready. */
    document.addEventListener("DOMContentLoaded", function () {
      if (window.KD) {
        var s = document.createElement("script");
        s.src = "assets/live.js";
        document.body.appendChild(s);
      }
    });
    return;
  }

  var state = { window: "1m", market: null, series: null, timer: null, tickTimer: null, ticks: [] };

  function $(id) { return document.getElementById(id); }
  function fmtPx(v) {
    var n = KD.num(v);
    if (n === null) return "—";
    if (n <= 0) return "<span class='blank' title='no resting order on the opposite side'>—</span>";
    return KD.money(n, 2);
  }
  function fmtAsk(v) {   /* an ask of 0.00 means an empty opposite side, not a free contract */
    var n = KD.num(v);
    if (n === null || n <= 0) return "<span class='blank' title='no resting order on the opposite side'>—</span>";
    return KD.money(n, 2);
  }

  /* ---------------------------------------------------------------- live market table */
  function renderLiveTable(markets, opts) {
    var el = $("live-table");
    var topicFilter = ($("topic-filter") || {}).value || "all";
    var rankBy = ($("rank-by") || {}).value || "dollars";
    var rows = [];
    markets.forEach(function (m) {
      var topic = KD.classify(m);
      if (!topic) return;
      if (topicFilter !== "all" && topic.id !== topicFilter) return;
      var dv = KD.dollarVolume(m);
      rows.push({ m: m, topic: topic, dollars: dv, volume: KD.num(m.volume_24h_fp),
        oi: KD.num(m.open_interest_fp) });
    });
    rows.sort(function (a, b) {
      var ka = rankBy === "volume" ? a.volume : (rankBy === "oi" ? a.oi : a.dollars);
      var kb = rankBy === "volume" ? b.volume : (rankBy === "oi" ? b.oi : b.dollars);
      return (kb || -1) - (ka || -1);
    });
    var top = rows.slice(0, 40);
    var cnt = $("live-count");
    if (cnt) {
      cnt.textContent = rows.length.toLocaleString() + " open markets matched · showing top " +
        top.length + " · fetched " + new Date().toISOString().slice(11, 19) + "Z";
    }
    if (!top.length) {
      el.innerHTML = '<p class="loading" style="padding:14px">No live markets matched this filter ' +
        '(the API returned ' + markets.length + " open markets).</p>";
      return;
    }
    var html = '<div class="tablewrap"><table><thead><tr>' +
      "<th>Topic</th><th>Market</th><th class='num'>YES bid</th><th class='num'>YES ask</th>" +
      "<th class='num'>NO bid</th><th class='num'>24 h $ (proxy)</th><th class='num'>Open interest</th>" +
      "<th>Closes (UTC)</th><th>Source</th></tr></thead><tbody>";
    top.forEach(function (r) {
      var m = r.m;
      html += "<tr><td><a href='" + r.topic.slug + ".html'>" + KD.esc(r.topic.label) + "</a></td>" +
        "<td><a href='https://kalshi.com/markets/" + encodeURIComponent((m.series_ticker || "").toLowerCase()) +
        "' target='_blank' rel='noopener'>" + KD.esc((m.title || m.ticker || "").slice(0, 90)) + "</a>" +
        "<div class='src'>" + KD.esc(m.ticker) + "</div></td>" +
        "<td class='num'>" + fmtPx(m.yes_bid_dollars) + "</td>" +
        "<td class='num'>" + fmtAsk(m.yes_ask_dollars) + "</td>" +
        "<td class='num'>" + fmtPx(m.no_bid_dollars) + "</td>" +
        "<td class='num'>" + (r.dollars === null ? "—" : "$" + r.dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })) + "</td>" +
        "<td class='num'>" + (r.oi === null ? "—" : r.oi.toLocaleString("en-US", { maximumFractionDigits: 0 })) + "</td>" +
        "<td class='nowrap'>" + KD.when(m.close_time) + "</td>" +
        "<td><a class='src' href='" + KD.esc(KD.url("/markets", { status: "open", limit: 1000 })) +
        "' target='_blank' rel='noopener'>↗ source</a></td></tr>";
    });
    el.innerHTML = html + "</tbody></table></div>";
  }

  function loadLive() {
    var el = $("live-table");
    if (!el) return;
    var banner = $("api-banner");
    KD.logged(KD.get("/markets", { status: "open", limit: 1000 }), "open markets")
      .then(function (res) {
        var markets = (res.data && res.data.markets) || [];
        if (banner) {
          banner.className = "banner ok";
          banner.innerHTML = "<b>Live.</b> " + markets.length +
            " open markets returned by the official demo API just now. " +
            "<span class='fine'>Rows are filtered to the five topics with the published keyword rules.</span>";
        }
        window.__lastMarkets = markets;
        renderLiveTable(markets);
      })
      .catch(function () {
        if (banner) {
          banner.className = "banner bad";
          banner.innerHTML = "<b>Live fetch blocked.</b> This browser could not read " +
            "<code>https://external-api.demo.kalshi.co/trade-api/v2</code> " +
            "(network, CORS or an exchange outage). The snapshot tables below are unaffected — " +
            "no value has been replaced or estimated. See the request log at the bottom of the page.";
        }
        el.innerHTML = '<p class="loading" style="padding:14px">Live view unavailable; use the snapshot ' +
          'ranking further down, or the <a href="markets.html">Markets</a> page.</p>';
      });
  }

  /* ---------------------------------------------------------------- chart */
  function drawSeries(points, opts) {
    var canvas = $("price-chart");
    if (!canvas) return;
    var jumps = KD.findJumps(points, 0.10);
    KD.drawChart(canvas, points, Object.assign({ jumps: jumps }, opts || {}));
    var note = $("chart-note");
    if (note) {
      note.textContent = points.length + " points · " + jumps.length + " move(s) ≥ $0.10 in this window";
    }
  }

  function loadChart() {
    var marketSel = $("chart-market");
    var canvas = $("price-chart");
    if (!marketSel || !canvas) return;
    var ticker = marketSel.value;
    var series = ticker.split("-")[0];
    state.market = ticker;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }

    if (state.window === "ticks") {
      state.ticks = [];
      var poll = function () {
        KD.logged(KD.get("/markets/" + encodeURIComponent(ticker)), "tick " + ticker)
          .then(function (res) {
            var m = res.data && res.data.market;
            var p = m && KD.num(m.last_price_dollars);
            if (p === null || p === undefined) p = m ? KD.mid(m) : null;
            if (p === null) return;
            state.ticks.push({ t: Math.floor(Date.now() / 1000), y: p });
            if (state.ticks.length > 600) state.ticks.shift();
            if (state.ticks.length > 1) drawSeries(state.ticks, {});
            var note = $("chart-note");
            if (note) note.textContent = state.ticks.length + " live quotes polled every 5 s · " +
              "official 1-minute candles are used for longer windows";
          })
          .catch(function () {
            var note = $("chart-note");
            if (note) note.textContent = "Live tick poll blocked by the network/CORS. " +
              "Switch to a candle window — those are cached and still render.";
          });
      };
      poll();
      state.tickTimer = setInterval(poll, 5000);
      return;
    }

    KD.candles(series, ticker, state.window)
      .then(function (res) {
        if (!res.points.length) {
          var note = $("chart-note");
          if (note) note.textContent = "The API returned no candles for this market and window " +
            "(it may be too new, or outside the ≤ 5,000-period limit). Nothing is drawn.";
          return;
        }
        state.series = res;
        drawSeries(res.points, { dayAxis: state.window === "1d" });
        var note = $("chart-note");
        if (note) note.textContent = KD.WINDOWS[state.window].label + " · " +
          res.points.length + " candles · " + KD.findJumps(res.points).length + " moves ≥ $0.10";
      })
      .catch(function (err) {
        var note = $("chart-note");
        if (note) note.textContent = "Candles unavailable (" + (err.status ? "HTTP " + err.status : "network/CORS") +
          "). The snapshot charts below still work.";
      });
  }

  /* ---------------------------------------------------------------- depth ladder */
  function renderBook(ticker, data) {
    var el = $("book");
    if (!el) return;
    var book = data.orderbook_fp || data.orderbook || {};
    var yes = (book.yes_dollars || book.yes || []).map(function (l) {
      return { price: KD.num(l[0]), contracts: KD.num(l[1]) };
    }).sort(function (a, b) { return b.price - a.price; });
    var no = (book.no_dollars || book.no || []).map(function (l) {
      return { price: KD.num(l[0]), contracts: KD.num(l[1]) };
    }).sort(function (a, b) { return b.price - a.price; });
    var maxC = Math.max.apply(null, yes.concat(no).map(function (l) { return l.contracts || 0; }).concat([1]));

    function side(title, levels, cls, otherLabel) {
      var body = levels.length ? levels.map(function (l) {
        var width = Math.max(1, Math.round((l.contracts / maxC) * 100));
        return "<tr><td class='num'>" + KD.cents(l.price) + "</td>" +
          "<td class='num'>" + KD.contracts(l.contracts) + "</td>" +
          "<td class='num'>" + KD.money(l.price * l.contracts, 0) + "</td>" +
          "<td><div class='bar " + cls + "'><i style='width:" + width + "%'></i></div></td></tr>";
      }).join("") : "<tr><td colspan='4' class='blank'>No resting bids returned.</td></tr>";
      var best = levels.length ? levels[0] : null;
      var implied = best ? (1 - best.price) : null;
      var impliedTxt = implied === null ? "—"
        : (implied >= 1 ? "—" : KD.cents(implied)) +
          (implied !== null && implied >= 1 ? " <span class='fine'>(no resting order on the other side)</span>" : "");
      return "<div class='panel'><div class='side-h'>" + title + " (bids)</div>" +
        "<table><thead><tr><th class='num'>Price</th><th class='num'>Contracts</th>" +
        "<th class='num'>Dollars at this price</th><th>Depth</th></tr></thead><tbody>" + body + "</tbody></table>" +
        "<p class='fine' style='margin-top:8px'>Best " + title.toLowerCase() + " bid " +
        (best ? KD.cents(best.price) + " → implied " + otherLabel + " ask " + impliedTxt : "—") + "</p></div>";
    }
    el.innerHTML = side("YES", yes, "", "NO") + side("NO", no, "no", "YES");
    var note = $("book-note");
    if (note) note.textContent = "book for " + ticker + " · fetched " + new Date().toISOString().slice(11, 19) + "Z";
  }

  function loadBook() {
    var sel = $("book-market");
    if (!sel) return;
    var ticker = sel.value;
    var note = $("book-note");
    if (note) note.textContent = "loading " + ticker + "…";
    KD.logged(KD.get("/markets/" + encodeURIComponent(ticker) + "/orderbook"), "orderbook " + ticker)
      .then(function (res) { renderBook(ticker, res.data || {}); })
      .catch(function (err) {
        var el = $("book");
        if (el) el.innerHTML = "<div class='panel'><p class='loading'>Order book unavailable (" +
          (err.status ? "HTTP " + err.status : "network/CORS") + ").</p></div>";
      });
  }

  /* ---------------------------------------------------------------- jumps from snapshot */
  function renderJumps() {
    var el = $("jumps-list");
    if (!el) return;
    var data = window.KD_SNAPSHOT || null;
    var rows = [];
    var add = function (ticker, topicSlug, topicLabel, points, windowLabel) {
      var jumps = KD.findJumps(points, 0.10);
      jumps.forEach(function (j) {
        rows.push({ ticker: ticker, slug: topicSlug, label: topicLabel, j: j, window: windowLabel });
      });
    };
    if (data && data.charts) {
      data.charts.forEach(function (c) {
        var topic = null;
        Object.keys(data.topics || {}).forEach(function (k) {
          (data.topics[k].open_top || []).forEach(function (m) {
            if (m.market_ticker === c.market_ticker) topic = { key: k, slug: data.topics[k].slug, label: data.topics[k].label };
          });
        });
        ["1m/6h", "1h/7d"].forEach(function (w) {
          var win = c.windows[w];
          if (!win || !win.points) return;
          var pts = win.points.filter(function (p) { return p.c !== null && p.c !== undefined; })
            .map(function (p) { return { t: p.t, y: Number(p.c) }; });
          if (pts.length > 1) add(c.market_ticker, topic ? topic.slug : "index.html",
            topic ? topic.label : "—", pts, w);
        });
      });
    }
    rows.sort(function (a, b) { return Math.abs(b.j.delta) - Math.abs(a.j.delta); });
    if (!rows.length) {
      el.innerHTML = '<div class="panel"><p class="loading">No 1-minute close-to-close move of $0.10 or more ' +
        "exists in the committed candle windows. That is a real result for this snapshot, not a missing scan.</p></div>";
      return;
    }
    var html = '<div class="tablewrap"><table><thead><tr><th>When (UTC)</th><th>Topic</th>' +
      "<th>Market</th><th class='num'>From</th><th class='num'>To</th><th class='num'>Move</th>" +
      "<th>Direction</th><th>Possible-cause links (unverified)</th><th>Source</th></tr></thead><tbody>";
    rows.slice(0, 60).forEach(function (r) {
      var up = r.j.delta > 0;
      var when = new Date(r.j.tTo * 1000).toISOString().replace("T", " ").slice(0, 16);
      var news = "https://news.google.com/search?q=" + encodeURIComponent(r.ticker.split("-")[0] + " " +
        (r.label || "") + " market");
      html += "<tr><td class='nowrap'>" + when + "</td>" +
        "<td><a href='" + r.slug + ".html'>" + KD.esc(r.label) + "</a></td>" +
        "<td>" + KD.esc(r.ticker) + "</td>" +
        "<td class='num'>" + KD.money(r.j.from, 2) + "</td>" +
        "<td class='num'>" + KD.money(r.j.to, 2) + "</td>" +
        "<td class='num' style='color:" + (up ? "#22c55e" : "#ef4444") + "'>" +
        (up ? "+" : "") + (r.j.delta * 100).toFixed(0) + "¢</td>" +
        "<td>" + (up ? '<span class="badge ok">up</span>' : '<span class="badge bad">down</span>') + "</td>" +
        "<td><a href='https://kalshi.com/markets/" + encodeURIComponent(r.ticker.split("-")[0].toLowerCase()) +
        "' target='_blank' rel='noopener'>Kalshi market ↗</a> · " +
        "<a href='" + news + "' target='_blank' rel='noopener'>news search ↗</a> " +
        "<span class='fine'>cause unverified</span></td>" +
        "<td><a class='src' href='" + KD.esc(KD.url("/series/" + encodeURIComponent(r.ticker.split("-")[0]) +
        "/markets/" + encodeURIComponent(r.ticker) + "/candlesticks",
        { start_ts: r.j.tFrom - 60, end_ts: r.j.tTo + 60, period_interval: 1 })) +
        "' target='_blank' rel='noopener'>↗ candles</a></td></tr>";
    });
    el.innerHTML = html + "</tbody></table></div>" +
      '<p class="fine" style="margin-top:8px">' + rows.length + " move(s) of at least $0.10 across " +
      "the committed candle windows. A link to a news search is a research pointer; the desk does not " +
      "claim the story caused the move.</p>";
  }

  /* ---------------------------------------------------------------- wiring */
  function init() {
    KD.probeStatus();
    loadLive();

    var marketSel = $("chart-market");
    if (marketSel) {
      loadChart();
      marketSel.addEventListener("change", loadChart);
    }
    var seg = $("window-seg");
    if (seg) {
      seg.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-w]");
        if (!b) return;
        state.window = b.getAttribute("data-w");
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        loadChart();
      });
    }
    var bookSel = $("book-market");
    if (bookSel) {
      loadBook();
      bookSel.addEventListener("change", loadBook);
    }
    var refresh = $("book-refresh-btn");
    if (refresh) refresh.addEventListener("click", loadBook);

    var tf = $("topic-filter");
    if (tf) tf.addEventListener("change", function () {
      var el = $("live-table");
      if (el && window.__lastMarkets) renderLiveTable(window.__lastMarkets);
    });
    var rb = $("rank-by");
    if (rb) rb.addEventListener("change", function () {
      if (window.__lastMarkets) renderLiveTable(window.__lastMarkets);
    });

    setInterval(function () {
      if (window.__lastMarkets) renderLiveTable(window.__lastMarkets);
    }, 30000);

    /* Snapshot data powers the jump scanner and the cached tables. */
    fetch("data/snapshot-slim.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { window.KD_SNAPSHOT = j; })
      .catch(function () { window.KD_SNAPSHOT = null; })
      .then(renderJumps);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
