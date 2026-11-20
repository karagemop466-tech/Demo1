// Live dashboard: price chart (X = time, Y = YES contract price in dollars) + orderbook liquidity.
// Endpoints (documented at docs.kalshi.com):
//   GET {base}/series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=1|60|1440
//   GET {base}/markets/{ticker}                       (current bid/ask/last)
//   GET {base}/markets/{ticker}/orderbook?depth=N     (resting YES and NO bids with contract counts)
// Seconds view: built in this browser from polled snapshots (candlesticks are minimum 1 minute).
(function () {
  var BASES = {
    production: "https://external-api.kalshi.com/trade-api/v2",
    demo: "https://external-api.demo.kalshi.co/trade-api/v2"
  };
  var POLL_MS = 5000;
  var WINDOWS = {
    seconds: [["1m", 60], ["5m", 300], ["15m", 900]],
    minutes: [["30m", 1800], ["2h", 7200], ["6h", 21600], ["24h", 86400]],
    hours: [["24h", 86400], ["7d", 604800], ["30d", 2592000]]
  };
  var PERIOD = { minutes: 1, hours: 60 };

  var state = {
    env: "production", ticker: "", series: "", gran: "minutes", windowSec: 21600,
    ticks: [], timer: null, lastOk: null, lastErr: ""
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.KD.esc;

  function base() { return BASES[state.env]; }

  function seriesOf(ticker) { return ticker.split("-")[0]; }

  function setBanner(kind, msg) {
    var b = $("dash-banner");
    b.className = "banner " + (kind || "");
    b.innerHTML = msg;
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " from " + url.split("?")[0]);
      return r.json();
    });
  }

  function num(v) { return v === "" || v == null ? null : Number(v); }

  // ---------- data ----------
  function fetchMarket() {
    return getJSON(base() + "/markets/" + encodeURIComponent(state.ticker)).then(function (j) {
      return j.market || j;
    });
  }

  function fetchOrderbook() {
    return getJSON(base() + "/markets/" + encodeURIComponent(state.ticker) + "/orderbook?depth=12");
  }

  function fetchCandles() {
    var end = Math.floor(Date.now() / 1000);
    var start = end - state.windowSec;
    var url = base() + "/series/" + encodeURIComponent(state.series) + "/markets/" +
      encodeURIComponent(state.ticker) + "/candlesticks?start_ts=" + start + "&end_ts=" + end +
      "&period_interval=" + PERIOD[state.gran];
    return getJSON(url).then(function (j) {
      return (j.candlesticks || []).map(function (c) {
        var p = c.price || {};
        return {
          t: c.end_period_ts * 1000,
          y: num(p.close_dollars),
          bid: num(c.yes_bid && c.yes_bid.close_dollars),
          ask: num(c.yes_ask && c.yes_ask.close_dollars),
          vol: num(c.volume_fp)
        };
      }).filter(function (p) { return p.y !== null; });
    });
  }

  // ---------- rendering ----------
  function fmtTime(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    if (state.gran === "seconds") return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    if (state.gran === "minutes") return p(d.getHours()) + ":" + p(d.getMinutes());
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":00";
  }

  function drawChart(points) {
    var svg = $("chart");
    var W = 1000, H = 340, L = 64, R = 16, T = 14, B = 40;
    if (!points.length) {
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="#5b6474">No price points yet for this window.</text>';
      return;
    }
    var t0 = points[0].t, t1 = points[points.length - 1].t;
    if (t1 === t0) t1 = t0 + 1000;
    var ys = points.map(function (p) { return p.y; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = Math.max((hi - lo) * 0.15, 0.002);
    lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    if (hi - lo < 0.004) { hi = lo + 0.004; }
    var X = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); };
    var Y = function (y) { return T + (1 - (y - lo) / (hi - lo)) * (H - T - B); };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var yv = lo + (hi - lo) * i / 4, yy = Y(yv);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e7ef"/>';
      g += '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="12" fill="#5b6474">$' + yv.toFixed(3) + '</text>';
    }
    for (var j = 0; j <= 4; j++) {
      var tv = t0 + (t1 - t0) * j / 4, xx = X(tv);
      g += '<line x1="' + xx + '" x2="' + xx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#f0f3f7"/>';
      g += '<text x="' + xx + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="12" fill="#5b6474">' + fmtTime(tv) + '</text>';
    }
    var line = points.map(function (p, k) { return (k ? "L" : "M") + X(p.t).toFixed(1) + "," + Y(p.y).toFixed(1); }).join(" ");
    var dots = points.length <= 120 ? points.map(function (p) {
      return '<circle cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2.5" fill="#0b7a5a"><title>' +
        fmtTime(p.t) + " — $" + p.y.toFixed(4) + '</title></circle>';
    }).join("") : "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = g +
      '<line x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#9aa3b2"/>' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="#9aa3b2"/>' +
      '<path d="' + line + '" fill="none" stroke="#0b7a5a" stroke-width="2"/>' + dots +
      '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="12" fill="#5b6474">Time (' + state.gran + ' view)</text>' +
      '<text transform="translate(14,' + (H / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" fill="#5b6474">YES contract price (USD)</text>';
  }

  function renderSummary(m) {
    // [label, value, kind]: kind "price" = dollars per contract, "count" = contracts, "text" = as returned
    var rows = [
      ["YES bid", m.yes_bid_dollars, "price"], ["YES ask", m.yes_ask_dollars, "price"],
      ["Last trade", m.last_price_dollars, "price"],
      ["Volume (contracts)", m.volume_fp, "count"], ["Open interest (contracts)", m.open_interest_fp, "count"],
      ["YES ask size (contracts)", m.yes_ask_size_fp, "count"], ["YES bid size (contracts)", m.yes_bid_size_fp, "count"],
      ["Status", m.status, "text"], ["Close time (UTC)", m.close_time, "text"]
    ];
    $("summary").innerHTML = rows.map(function (r) {
      var v;
      if (r[1] == null || r[1] === "") v = '<span class="blank">not returned</span>';
      else if (r[2] === "price") v = "$" + Number(r[1]).toFixed(4) + " (" + (Number(r[1]) * 100).toFixed(1) + "¢)";
      else if (r[2] === "count") v = Number(r[1]).toLocaleString("en-US", { maximumFractionDigits: 2 });
      else v = esc(r[1]);
      return "<tr><th>" + esc(r[0]) + "</th><td>" + v + "</td></tr>";
    }).join("");
    $("title").textContent = m.title || state.ticker;
  }

  function renderBook(ob) {
    var book = (ob && (ob.orderbook_fp || ob.orderbook)) || {};
    var yes = (book.yes_dollars || []).map(function (l) { return [Number(l[0]), Number(l[1])]; });
    var no = (book.no_dollars || []).map(function (l) { return [Number(l[0]), Number(l[1])]; });
    // YES bids: resting buy-YES orders at price p (sorted high to low).
    yes.sort(function (a, b) { return b[0] - a[0]; });
    // NO bids at q are equivalent to YES asks at 1 - q (binary-market identity; see Sources).
    var asks = no.map(function (l) { return [1 - l[0], l[1]]; }).sort(function (a, b) { return a[0] - b[0]; });
    var cum = 0, bidRows = yes.map(function (l) { cum += l[1]; return [l[0], l[1], cum]; });
    cum = 0; var askRows = asks.map(function (l) { cum += l[1]; return [l[0], l[1], cum]; });
    var html = '<div class="table-wrap"><table><thead><tr><th>YES bid price</th><th class="num">Contracts available</th><th class="num">Cumulative</th></tr></thead><tbody>';
    html += bidRows.length ? bidRows.map(function (r) {
      return "<tr><td>$" + r[0].toFixed(4) + "</td><td class='num'>" + r[1].toLocaleString("en-US") + "</td><td class='num'>" + r[2].toLocaleString("en-US") + "</td></tr>";
    }).join("") : '<tr><td colspan="3" class="note">No resting YES bids returned.</td></tr>';
    html += '</tbody></table></div>';
    var html2 = '<div class="table-wrap"><table><thead><tr><th>YES ask price (from NO bids: 1 − NO price)</th><th class="num">Contracts available</th><th class="num">Cumulative</th></tr></thead><tbody>';
    html2 += askRows.length ? askRows.map(function (r) {
      return "<tr><td>$" + r[0].toFixed(4) + "</td><td class='num'>" + r[1].toLocaleString("en-US") + "</td><td class='num'>" + r[2].toLocaleString("en-US") + "</td></tr>";
    }).join("") : '<tr><td colspan="3" class="note">No resting NO bids returned.</td></tr>';
    html2 += '</tbody></table></div>';
    $("book-yes").innerHTML = html;
    $("book-ask").innerHTML = html2;
  }

  // ---------- refresh loop ----------
  function refresh() {
    if (!state.ticker) return;
    var tasks = [fetchMarket(), fetchOrderbook()];
    return Promise.all(tasks).then(function (res) {
      var m = res[0], ob = res[1];
      renderSummary(m);
      renderBook(ob);
      var y = num(m.last_price_dollars);
      if (y === null || y === 0) y = num(m.yes_bid_dollars) || y;
      if (state.gran === "seconds") {
        var mid = (num(m.yes_bid_dollars) != null && num(m.yes_ask_dollars) != null) ?
          (num(m.yes_bid_dollars) + num(m.yes_ask_dollars)) / 2 : null;
        state.ticks.push({ t: Date.now(), y: mid != null ? mid : y, last: num(m.last_price_dollars) });
        var cutoff = Date.now() - state.windowSec * 1000;
        state.ticks = state.ticks.filter(function (p) { return p.t >= cutoff; });
        drawChart(state.ticks);
        setBanner("ok", "Live: polling every " + POLL_MS / 1000 + "s from Kalshi (" + state.env + "). Y = mid of YES bid/ask; " +
          "points collected in this browser session only. Updated " + new Date().toLocaleTimeString() + ".");
      } else {
        return fetchCandles().then(function (pts) {
          drawChart(pts);
          setBanner("ok", "Live: candlesticks (" + (state.gran === "minutes" ? "1-minute" : "1-hour") + " periods) and current orderbook from Kalshi (" +
            state.env + "). Updated " + new Date().toLocaleTimeString() + ".");
        });
      }
    }).catch(function (e) {
      state.lastErr = e.message || String(e);
      setBanner("bad", "Could not load live data in this browser: <b>" + esc(state.lastErr) + "</b>. " +
        "Kalshi's public endpoints must allow browser requests (CORS). This was NOT verified from the build environment. " +
        "The static snapshot values on the Markets page remain the only verified values.");
    });
  }

  function restartTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(refresh, POLL_MS);
  }

  function setWindows() {
    var wrap = $("win");
    wrap.innerHTML = WINDOWS[state.gran].map(function (w) {
      return '<button data-sec="' + w[1] + '"' + (w[1] === state.windowSec ? ' class="on"' : "") + ">" + w[0] + "</button>";
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (b) {
      b.onclick = function () {
        state.windowSec = Number(b.getAttribute("data-sec"));
        state.ticks = [];
        setWindows(); refresh();
      };
    });
  }

  function setGran(g) {
    state.gran = g;
    state.windowSec = WINDOWS[g][Math.min(1, WINDOWS[g].length - 1)][1];
    state.ticks = [];
    Array.prototype.forEach.call(document.querySelectorAll("#gran button"), function (b) {
      b.className = b.getAttribute("data-g") === g ? "on" : "";
    });
    setWindows(); refresh();
  }

  function load(ticker, series) {
    state.ticker = ticker.trim();
    state.series = (series && series.trim()) || seriesOf(state.ticker);
    state.ticks = [];
    $("ticker-label").textContent = state.ticker + "  (series " + state.series + ")";
    refresh(); restartTimer();
  }

  function init() {
    var sel = $("market");
    var seen = {};
    window.KD_MARKETS.forEach(function (m) {
      if (!m.ticker || seen[m.ticker]) return;
      seen[m.ticker] = 1;
      var o = document.createElement("option");
      o.value = m.ticker; o.textContent = m.category + " — " + (m.outcome || m.ticker);
      o.setAttribute("data-series", m.series);
      sel.appendChild(o);
    });
    sel.onchange = function () {
      var o = sel.options[sel.selectedIndex];
      $("ticker-input").value = o.value;
      $("series-input").value = o.getAttribute("data-series") || "";
      load(o.value, o.getAttribute("data-series"));
    };
    $("go").onclick = function () {
      var t = $("ticker-input").value;
      if (!t) return;
      load(t, $("series-input").value);
    };
    $("env").onchange = function () { state.env = this.value; if (state.ticker) { state.ticks = []; refresh(); } };
    Array.prototype.forEach.call(document.querySelectorAll("#gran button"), function (b) {
      b.onclick = function () { setGran(b.getAttribute("data-g")); };
    });
    $("ticker-input").value = sel.options.length > 1 ? sel.options[1].value : "";
    if (sel.options.length > 1) { sel.selectedIndex = 1; sel.onchange(); }
    setGran("minutes");
  }

  window.addEventListener("DOMContentLoaded", function () {
    fetch("data/markets.json").then(function (r) { return r.json(); }).then(function (d) {
      window.KD_MARKETS = d.markets;
      init();
    }).catch(function (e) {
      setBanner("bad", "Could not load data/markets.json: " + esc(e.message));
    });
  });
})();
