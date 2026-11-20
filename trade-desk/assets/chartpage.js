/* trade-desk/assets/chartpage.js — controller for chart.html.
 *
 * One market at a time, chosen from the official open-market list. Samples come
 * from two official sources and are tagged with which one produced each point:
 *   - individual trades  → sub-minute, used for the seconds windows;
 *   - 1-minute candles   → the only official candle resolution, requested once
 *                          and disclosed when it comes back empty.
 * The ladder is the official order book; the walk table prices 10 contracts by
 * consuming the real ask levels and adding the official fee.
 */
(function () {
  "use strict";
  var TD = window.TD, Api = window.Api, Engine = window.Engine, TDChart = window.TDChart;

  var state = {
    seriesMap: null,
    markets: [],
    current: null,
    windowId: "15m",
    samples: [],
    trades: [],
    jumps: [],
    candleNote: null,
    bookUrl: null,
    loading: false
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }
  function banner(msg) {
    var b = $("banner");
    if (!b) return;
    b.hidden = false;
    b.textContent = msg;
  }

  TD.onReady(function () {
    buildWindows();
    loadMap().then(loadMarkets);
    $("reload").addEventListener("click", function () { loadMarket(state.current, true); });
    $("market-picker").addEventListener("change", function (e) { loadMarket(e.target.value, true); });
  });

  function buildWindows() {
    var box = $("windows");
    var groups = { seconds: [], minutes: [], hours: [] };
    TDChart.WINDOWS.forEach(function (w) { groups[w.unit].push(w); });
    box.innerHTML = Object.keys(groups).map(function (unit) {
      return '<span class="group" role="group" aria-label="' + unit + '">' + groups[unit].map(function (w) {
        return '<button type="button" data-window="' + w.id + '" aria-pressed="' + (w.id === state.windowId) + '">' + w.id + "</button>";
      }).join("") + "</span>";
    }).join("");
    box.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.windowId = b.getAttribute("data-window");
        box.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        drawChart();
      });
    });
  }

  function loadMap() {
    return fetch("data/series-map.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { state.seriesMap = j && j.map ? j.map : null; })
      .catch(function () { state.seriesMap = null; });
  }

  function classify(m) {
    var series = String(m.ticker || "").split("-")[0];
    var row = state.seriesMap ? state.seriesMap[series] : null;
    var hit = null;
    if (row) hit = TD.classifyBySeries({ ticker: series, title: row[2], category: row[1], tags: row[3] ? row[3].split("|") : [] });
    if (!hit) hit = TD.classifyByTicker(m.ticker, m.title);
    return hit ? hit.id : null;
  }

  function loadMarkets() {
    setText("api-state", "loading open markets…");
    return Api.markets({ limit: 1000 }).then(function (res) {
      if (!res.ok) {
        banner("Open markets failed: " + res.error);
        setText("api-state", "not connected · " + res.error);
        var dot = $("dot-api");
        if (dot) dot.className = "dot err";
        return;
      }
      state.markets = (res.data.markets || []).map(function (m) {
        return { ticker: m.ticker, title: m.title || m.yes_sub_title || m.ticker, topic: classify(m), market: m };
      }).filter(function (m) { return m.topic; })
        .sort(function (a, b) {
          var av = TD.num(b.market.volume_24h_fp) || 0, bv = TD.num(a.market.volume_24h_fp) || 0;
          return av - bv;
        });
      var picker = $("market-picker");
      picker.innerHTML = state.markets.slice(0, 300).map(function (m) {
        var t = TD.topicById(m.topic);
        return '<option value="' + TD.attr(m.ticker) + '">' + TD.esc((t ? t.label + " · " : "") + m.title) + "</option>";
      }).join("");
      setText("api-state", "connected · " + state.markets.length + " markets in five topics · 24h volume order");
      var dot = $("dot-api");
      if (dot) dot.className = "dot live";
      setText("calls", String(Api.stats().calls));
      var first = TD.qs("ticker") || (state.markets[0] && state.markets[0].ticker);
      if (first) { picker.value = first; loadMarket(first, true); }
    }).catch(function (err) {
      banner("Open markets failed: " + (err && err.message ? err.message : err));
    });
  }

  function loadMarket(ticker, force) {
    if (!ticker || state.loading) return;
    var entry = state.markets.filter(function (m) { return m.ticker === ticker; })[0];
    if (!entry) return;
    state.loading = true;
    state.current = entry;
    if (force) { state.samples = []; state.trades = []; state.jumps = []; state.candleNote = null; }
    setText("current-ticker", ticker);
    setText("chart-title", entry.title);
    setText("api-state", "loading " + ticker + "…");

    var series = String(ticker).split("-")[0];
    var now = Math.floor(Date.now() / 1000);

    var tradeReq = Api.trades({ ticker: ticker, limit: 1000 }).then(function (res) {
      if (!res.ok) { banner("Trades failed: " + res.error); return []; }
      return (res.data.trades || []).map(function (t) {
        var p = TD.num(t.yes_price_dollars);
        var ts = new Date(t.created_time).getTime();
        return p === null || !isFinite(ts) ? null : { ticker: ticker, ts: ts, price: p, source: res.url, count: TD.num(t.count_fp) };
      }).filter(Boolean);
    });

    var candleReq = Api.candles(series, ticker, now - 6 * 3600, now, 1).then(function (res) {
      if (!res.ok) {
        state.candleNote = { text: "1-minute candles unavailable (" + res.error + ")", url: res.url };
        return [];
      }
      var cs = (res.data && res.data.candlesticks) || [];
      if (!cs.length) {
        state.candleNote = { text: "the official 1-minute candlestick request returned an empty array for this market", url: res.url };
        return [];
      }
      state.candleNote = { text: cs.length + " official 1-minute candles", url: res.url };
      return cs.map(function (c) {
        var p = TD.num(c.price && c.price.close_dollars);
        if (p === null) p = TD.num(c.yes_ask && c.yes_ask.close_dollars);
        return p === null ? null : { ticker: ticker, ts: c.end_period_ts * 1000, price: p, source: res.url, kind: "candle" };
      }).filter(Boolean);
    });

    var bookReq = Api.orderbook(ticker, 20).then(function (res) {
      if (!res.ok) { state.bookUrl = null; return null; }
      state.bookUrl = res.url;
      return res.data;
    });

    Promise.all([tradeReq, candleReq, bookReq]).then(function (out) {
      state.trades = out[0];
      var candles = out[1];
      var seen = {};
      state.samples = out[0].concat(candles).filter(function (s) {
        var k = s.ts + ":" + s.price + ":" + (s.kind || "trade");
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      }).sort(function (a, b) { return a.ts - b.ts; });
      state.jumps = Engine.scanTrades(state.trades.map(function (t) {
        return { ticker: t.ticker, yes_price_dollars: String(t.price), count_fp: String(t.count || 0), created_time: new Date(t.ts).toISOString() };
      }), { now: Date.now(), windowMs: 6 * 3600 * 1000 });
      setText("sample-count", String(state.samples.length));
      setText("calls", String(Api.stats().calls));
      setText("api-state", "connected · " + ticker);
      if (out[2]) renderLadder(out[2]); else renderLadder(null);
      drawChart();
      renderJumps();
      state.loading = false;
    }).catch(function (err) {
      banner("Loading " + ticker + " failed: " + (err && err.message ? err.message : err));
      state.loading = false;
    });
  }

  function drawChart() {
    var svg = $("chart");
    if (!svg) return;
    var win = TDChart.windowById(state.windowId);
    var markers = state.jumps.map(function (j) {
      return { ts: j.last_ts, price: j.to, move: j.move, ticker: j.ticker };
    });
    TDChart.render(svg, {
      samples: state.samples,
      now: Date.now(),
      windowId: state.windowId,
      jumps: markers,
      color: "#1d4ed8",
      title: state.current ? state.current.title : "price",
      readoutEl: $("readout"),
      emptyText: "no official print in this " + win.label + " window"
    });
    var note = $("resolution-note");
    if (note && state.candleNote) {
      note.innerHTML = "x axis: time · y axis: YES price · " + TD.esc(state.candleNote.text) +
        ' (<a href="' + TD.attr(state.candleNote.url) + '" target="_blank" rel="noopener">candle request ↗</a>)' +
        "; the line also carries individual trades from the " +
        '<a href="' + TD.attr(TD.apiUrl("/markets/trades?ticker=" + encodeURIComponent(state.current ? state.current.ticker : ""))) + '" target="_blank" rel="noopener">trades tape ↗</a>.' +
        " Seconds windows use trades only, because no sub-minute candle resolution exists.";
    }
  }

  function renderLadder(book) {
    var lad = TD.ladder(book || {});
    var asks = TD.depth(lad.yesAsks, 10);
    var bids = TD.depth(lad.yesBids, 10);
    var maxSize = Math.max(1, asks.rows.concat(bids.rows).reduce(function (m, r) { return Math.max(m, r.size); }, 1));
    function rows(levels) {
      return levels.map(function (r) {
        return '<div class="bar-row"><span class="px">' + TD.cents(r.price, 1) + "</span>" +
          '<span class="bar" style="width:' + Math.max(1, r.size / maxSize * 100) + 'px"></span>' +
          '<span class="mono">' + TD.contracts(r.size) + "</span></div>";
      }).join("") || '<div class="blank">none returned</div>';
    }
    var spread = lad.bestYesAsk !== null && lad.bestYesBid !== null ? lad.bestYesAsk - lad.bestYesBid : null;
    $("ladder").innerHTML =
      '<div class="side asks"><h4>YES asks (implied)</h4>' + rows(asks.rows) + "</div>" +
      '<div class="mid"><div class="spread">' + (spread !== null ? "spread " + TD.cents(spread, 1) : "one-sided") + "</div></div>" +
      '<div class="side bids"><h4>YES bids</h4>' + rows(bids.rows) + "</div>";
    $("book-meta").innerHTML = "No order counts are returned by the API, only price levels and contract sizes. " +
      (state.bookUrl ? '<a href="' + TD.attr(state.bookUrl) + '" target="_blank" rel="noopener">order-book request ↗</a>' : "order-book request failed.");
    renderWalk(lad);
  }

  /* Cost to buy 10 contracts, walking the real ask levels and adding the fee. */
  function renderWalk(lad) {
    var tbody = $("walk-table").querySelector("tbody");
    var want = 10, got = 0, cost = 0, rows = [];
    (lad.yesAsks || []).forEach(function (level) {
      if (got >= want) return;
      var take = Math.min(want - got, level.size);
      if (take <= 0) return;
      cost += take * level.price;
      got += take;
      rows.push({ price: level.price, take: take, cum: cost });
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="blank">no resting ask to buy from — an empty book is not a zero price</td></tr>';
      return;
    }
    var fee = TD.fee(got, cost / got, 1);
    tbody.innerHTML = rows.map(function (r, i) {
      return "<tr><td>" + (i + 1) + '</td><td class="num">' + TD.cents(r.price, 1) + '</td><td class="num">' +
        TD.contracts(r.take) + '</td><td class="num">' + TD.money(r.cum, 2) + "</td></tr>";
    }).join("") +
      '<tr><td colspan="3"><b>Filled ' + TD.contracts(got) + " of " + want + " at the touch prices</b></td>" +
      '<td class="num"><b>' + TD.money(cost, 2) + "</b></td></tr>" +
      '<tr><td colspan="3">Official taker fee on this fill</td><td class="num">' + TD.money(fee, 2) + "</td></tr>" +
      '<tr><td colspan="3"><b>Total to pay</b></td><td class="num"><b>' + TD.money(cost + fee, 2) + "</b></td></tr>" +
      (got < want ? '<tr><td colspan="4" class="small down">Only ' + TD.contracts(got) + " contracts rest on the ask side, so the full " + want + " could not be filled from the returned depth.</td></tr>" : "");
  }

  function renderJumps() {
    var tbody = $("jump-table").querySelector("tbody");
    setText("jump-note", state.jumps.length + " jump(s) in the last 6 hours of trades");
    if (!state.jumps.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="blank">no move of $0.10 or more printed for this market in the last 6 hours</td></tr>';
      return;
    }
    tbody.innerHTML = state.jumps.map(function (j) {
      var cls = j.move >= 0 ? "up" : "down";
      return "<tr><td>" + TD.esc(TD.clock(j.last_time)) + "</td>" +
        '<td class="' + cls + '">' + (j.move >= 0 ? "▲ up" : "▼ down") + "</td>" +
        '<td class="num ' + cls + '">' + TD.esc(TD.signedCents(j.move)) + "</td>" +
        '<td class="num">' + TD.esc(TD.cents(j.from, 1)) + " → " + TD.esc(TD.cents(j.to, 1)) + "</td>" +
        '<td class="num">' + j.trades + "</td>" +
        "<td>" + TD.esc(j.mode === "peak" ? "peak-to-trough" : "first-to-last trade") + "</td>" +
        '<td class="small"><a href="' + TD.attr(j.source) + '" target="_blank" rel="noopener">trades request</a> · ' +
        '<a href="' + TD.attr(TD.newsSearch(j.title || j.ticker)) + '" target="_blank" rel="noopener">news search</a></td></tr>';
    }).join("");
  }

  window.__chartPage = { state: state, loadMarket: loadMarket, drawChart: drawChart };
})();
