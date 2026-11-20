/* trade-desk/assets/strategies.js — controller for strategies.html.
 *
 * "Run the strategies now" does the same work a human would to test a rule:
 *   1. fetch the open markets in the five topics;
 *   2. fetch the official trades tape for the recent window;
 *   3. for each market with a qualifying >= $0.10 jump, score it with the
 *      published model (Engine.score) and ask every strategy whether it would
 *      enter;
 *   4. write paper fills through Engine.openPosition (fee and cash checked);
 *   5. on "check settlements", ask the API for each open ticker and settle only
 *      when a result is returned.
 *
 * Every step is bounded so the page cannot spam the public API.
 */
(function () {
  "use strict";
  var TD = window.TD, Api = window.Api, Engine = window.Engine;
  var MAX_NEW_POSITIONS = 6;
  var SIZE = 10;

  var state = { ledger: null, seriesMap: null, busy: false };

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }
  function banner(msg, cls) {
    var b = $("banner");
    if (!b) return;
    b.hidden = false;
    b.className = "callout " + (cls || "warn");
    b.textContent = msg;
  }

  TD.onReady(function () {
    state.ledger = Engine.loadLedger();
    loadMap().then(render);
    $("run-now").addEventListener("click", runStrategies);
    $("settle-now").addEventListener("click", checkSettlements);
    $("reset").addEventListener("click", function () {
      if (!confirm("Erase the local paper ledger and start again with $1,000 of paper cash?")) return;
      state.ledger = Engine.emptyLedger();
      Engine.saveLedger(state.ledger);
      render();
      banner("Ledger reset. Nothing was sent to Kalshi.", "warn");
    });
  });

  function loadMap() {
    return fetch("data/series-map.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { state.seriesMap = j && j.map ? j.map : null; })
      .catch(function () { state.seriesMap = null; });
  }

  function classify(market) {
    var series = String(market.ticker || "").split("-")[0];
    var row = state.seriesMap ? state.seriesMap[series] : null;
    var hit = null;
    if (row) {
      hit = TD.classifyBySeries({ ticker: series, title: row[2], category: row[1], tags: row[3] ? row[3].split("|") : [] });
    }
    if (!hit) hit = TD.classifyByTicker(market.ticker, market.title);
    return hit ? hit.id : null;
  }

  /* --------------------------------------------------------------- run */
  function runStrategies() {
    if (state.busy) return;
    state.busy = true;
    setText("ledger-state", "running the strategies…");
    banner("Running: fetching open markets, the trades tape and quotes. This makes a bounded number of public requests.");

    Api.markets({ limit: 1000 }).then(function (res) {
      if (!res.ok) throw new Error("open markets: " + res.error);
      var open = {};
      (res.data.markets || []).forEach(function (m) {
        var topic = classify(m);
        if (topic) open[m.ticker] = { market: m, topic: topic };
      });
      var nowSec = Math.floor(Date.now() / 1000);
      return Api.trades({ limit: 1000, min_ts: nowSec - 30 * 60 }).then(function (tr) {
        if (!tr.ok) throw new Error("trades: " + tr.error);
        var relevant = (tr.data.trades || []).filter(function (t) { return open[t.ticker]; });
        var jumps = Engine.scanTrades(relevant, { now: Date.now(), windowMs: 30 * 60 * 1000 });
        if (!jumps.length) {
          banner("No qualifying jump on the five topics in the last 30 minutes, so no strategy had an entry. An empty run is a real result; nothing was invented to fill it.");
          return null;
        }
        /* quotes for the jumping markets, then books for the strongest few */
        var tickers = jumps.map(function (j) { return j.ticker; }).slice(0, 30);
        return Api.marketsByTicker(tickers).then(function (qres) {
          var quotes = {};
          if (qres.ok && qres.data && qres.data.markets) {
            qres.data.markets.forEach(function (q) { quotes[q.ticker] = q; });
          }
          var bookJobs = jumps.slice(0, 8).map(function (j) {
            return Api.orderbook(j.ticker, 10).then(function (b) { return { ticker: j.ticker, data: b.ok ? b.data : null }; });
          });
          return Promise.all(bookJobs).then(function (books) {
            var bookFor = {};
            books.forEach(function (b) { bookFor[b.ticker] = b.data; });
            applyStrategies(jumps, open, quotes, bookFor);
            return null;
          });
        });
      });
    }).catch(function (err) {
      banner("Run failed: " + (err && err.message ? err.message : err) + ". No paper fill was created from a failed request.", "bad");
    }).then(function () {
      state.busy = false;
      setText("ledger-state", "ledger loaded");
      render();
    });
  }

  function applyStrategies(jumps, open, quotes, bookFor) {
    var ledger = state.ledger;
    var opened = 0, considered = 0, notes = [];
    Engine.STRATEGIES.forEach(function (strategy) {
      jumps.forEach(function (jump) {
        if (opened >= MAX_NEW_POSITIONS) return;
        if (ledger.positions[jump.ticker]) return;
        var info = open[jump.ticker];
        if (!info) return;
        var q = quotes[jump.ticker] || info.market;
        var ctx = {
          jump: jump,
          book: bookFor[jump.ticker] || null,
          ask: TD.num(q.yes_ask_dollars),
          bid: TD.num(q.yes_bid_dollars),
          now: Date.now()
        };
        var scored = Engine.score(q, ctx);
        ctx.scored = scored;
        considered += 1;
        if (!strategy.select(ctx)) return;
        var res = Engine.openPosition(ledger, {
          ticker: jump.ticker,
          event_ticker: info.market.event_ticker,
          title: info.market.title,
          topic: info.topic,
          strategy: strategy.id,
          ask: scored.entryAsk,
          contracts: SIZE,
          max_roi: scored.maxRoi,
          score: scored.score,
          evidence: jump.source
        }, { now: new Date().toISOString() });
        if (res.ok) opened += 1;
        else if (notes.length < 4) notes.push(strategy.id + " / " + jump.ticker + ": " + res.error);
      });
    });
    if (opened) {
      Engine.recordMark(ledger);
      Engine.saveLedger(ledger);
    }
    banner(opened + " paper position(s) opened from " + considered + " strategy/signal pairs evaluated." +
      (notes.length ? " Skipped: " + notes.join("; ") : "") +
      " Sizing is " + SIZE + " contracts each, capped at " + MAX_NEW_POSITIONS + " new positions per run.", "warn");
  }

  /* --------------------------------------------------------- settlements */
  function checkSettlements() {
    if (state.busy) return;
    var ledger = state.ledger;
    var tickers = Object.keys(ledger.positions);
    if (!tickers.length) {
      banner("No open paper positions to settle.");
      render();
      return;
    }
    state.busy = true;
    setText("ledger-state", "checking settlements with the official API…");
    Api.settleMarkets(tickers).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      var by = {};
      (res.data.markets || []).forEach(function (m) { by[m.ticker] = m; });
      var settled = 0, marks = {};
      tickers.forEach(function (t) {
        var m = by[t];
        if (!m) return;
        var last = TD.num(m.last_price_dollars);
        if (last !== null) marks[t] = last;
        var r = Engine.settlePosition(ledger, t, m, { now: new Date().toISOString() });
        if (r.ok) settled += 1;
      });
      Engine.recordMark(ledger);
      Engine.saveLedger(ledger);
      banner(settled
        ? settled + " position(s) settled from the API's own result field. Payouts used the result and, for scalar markets, settlement_value_dollars."
        : "No open position has a settlement result yet. Markets carry until the API reports yes / no / scalar, and their marks are recorded meanwhile.");
    }).catch(function (err) {
      banner("Settlement check failed: " + (err && err.message ? err.message : err), "bad");
    }).then(function () {
      state.busy = false;
      setText("ledger-state", "ledger loaded");
      render();
    });
  }

  /* -------------------------------------------------------------- render */
  function fmtMoney(v) { return v === null || v === undefined ? "—" : TD.money(v, 2); }
  function fmtPct(v, dp) { return v === null || v === undefined ? "—" : TD.pct(v, dp === undefined ? 1 : dp); }

  function render() {
    var ledger = state.ledger;
    var perf = Engine.performance(ledger);

    setText("eq", fmtMoney(perf.equity));
    setText("cash", fmtMoney(perf.cash));
    setText("open-count", String(perf.open));
    setText("settled-count", String(perf.settled));

    setText("kpi-equity", fmtMoney(perf.equity));
    var pnlEl = $("kpi-pnl");
    pnlEl.textContent = TD.signedMoney(perf.realized, 2);
    pnlEl.className = "value " + (perf.realized > 0 ? "up" : perf.realized < 0 ? "down" : "");
    setText("kpi-win", perf.settled ? fmtPct(perf.winRate, 0) : "—");
    setText("kpi-win-note", perf.settled ? perf.wins + " win / " + perf.losses + " loss of " + perf.settled : "settled trades only");
    setText("kpi-roi", perf.settled ? fmtPct(perf.realizedRoi, 1) : "—");
    setText("kpi-fees", fmtMoney(perf.fees));
    setText("open-note", ledger.positions ? Object.keys(ledger.positions).length + " open · marks recorded from the last settlement check" : "");

    /* strategy table with per-strategy counts */
    var st = $("strategy-table").querySelector("tbody");
    var openBy = {};
    Object.keys(ledger.positions).forEach(function (t) {
      var s = ledger.positions[t].strategy;
      openBy[s] = (openBy[s] || 0) + 1;
    });
    st.innerHTML = Engine.STRATEGIES.map(function (strategy) {
      var n = ledger.trades.filter(function (t) { return t.strategy === strategy.id; }).length;
      return "<tr><td><b>" + TD.esc(strategy.name) + "</b></td><td class=small>" + TD.esc(strategy.rule) + "</td>" +
        '<td class="num">' + n + '</td><td class="num">' + (openBy[strategy.id] || 0) + "</td></tr>";
    }).join("");

    table("by-strategy", perf.byStrategy);
    table("by-topic", perf.byTopic);
    table("by-band", perf.byBand);
    table("by-result", perf.byResult);

    renderOpen(ledger);
    renderSettled(perf);
    drawEquity(ledger.marks || []);
  }

  function table(id, rows) {
    var tbody = $(id).querySelector("tbody");
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="blank">no settled trades in this category yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      return "<tr><td>" + TD.esc(r.key) + '</td><td class="num">' + r.n + '</td><td class="num">' + fmtPct(r.winRate, 0) +
        '</td><td class="num ' + (r.pnl > 0 ? "up" : r.pnl < 0 ? "down" : "") + '">' + TD.signedMoney(r.pnl, 2) +
        '</td><td class="num">' + fmtPct(r.roi, 1) + "</td></tr>";
    }).join("");
  }

  function renderOpen(ledger) {
    var tbody = $("open-table").querySelector("tbody");
    var tickers = Object.keys(ledger.positions);
    if (!tickers.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="blank">no open positions — run the strategies on the dashboard</td></tr>';
      return;
    }
    tbody.innerHTML = tickers.map(function (t) {
      var p = ledger.positions[t];
      var label = TD.topicById(p.topic);
      return "<tr>" +
        '<td><span class="chip ' + TD.attr(p.topic || "") + '">' + TD.esc(label ? label.label : (p.topic || "other")) + "</span></td>" +
        '<td><a href="' + TD.attr(TD.marketUrl(p.ticker, p.event_ticker)) + '" target="_blank" rel="noopener">' + TD.esc(p.title) + "</a>" +
        '<div class="mono muted">' + TD.esc(p.ticker) + "</div></td>" +
        '<td class="num">' + p.contracts + "</td>" +
        '<td class="num">' + TD.esc(TD.cents(p.entry_ask, 1)) + "</td>" +
        '<td class="num">' + fmtMoney(p.entry_fee) + "</td>" +
        '<td class="num">' + fmtMoney(p.entry_cost) + "</td>" +
        "<td>" + TD.esc(p.strategy) + "</td>" +
        '<td class="small">open since ' + TD.esc(String(p.opened_at).slice(0, 16).replace("T", " ")) + "Z<br>awaiting result</td>" +
        '<td class="small">' + (p.evidence ? '<a href="' + TD.attr(p.evidence) + '" target="_blank" rel="noopener">signal</a> · ' : "") +
        '<a href="' + TD.attr(TD.apiUrl("/markets?tickers=" + encodeURIComponent(t))) + '" target="_blank" rel="noopener">API</a></td>' +
        "</tr>";
    }).join("");
  }

  function renderSettled(perf) {
    var tbody = $("settled-table").querySelector("tbody");
    setText("settled-note", perf.rows.length ? perf.rows.length + " settled trade(s)" : "—");
    if (!perf.rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="blank">no settled trades yet — positions settle when the official API returns a result</td></tr>';
      return;
    }
    tbody.innerHTML = perf.rows.map(function (t) {
      var label = TD.topicById(t.topic);
      return "<tr>" +
        '<td><span class="chip ' + TD.attr(t.topic || "") + '">' + TD.esc(label ? label.label : (t.topic || "other")) + "</span></td>" +
        "<td>" + TD.esc(t.title) + '<div class="mono muted">' + TD.esc(t.ticker) + "</div></td>" +
        '<td class="num">' + TD.esc(TD.cents(t.entry_ask, 1)) + "</td>" +
        '<td class="num">' + TD.esc(TD.cents(t.payout_per, 2)) + "</td>" +
        '<td class="num">' + fmtMoney(t.fee) + "</td>" +
        '<td class="num ' + (t.pnl > 0 ? "up" : t.pnl < 0 ? "down" : "") + '">' + TD.signedMoney(t.pnl, 2) + "</td>" +
        '<td class="num">' + fmtPct(t.roi, 1) + "</td>" +
        "<td>" + (t.result === "yes" ? '<b class="up">YES</b>' : t.result === "no" ? '<b class="down">NO</b>' : TD.esc(t.result || "")) + "</td>" +
        "<td>" + TD.esc(t.strategy) + "</td>" +
        '<td class="nowrap small">' + TD.esc(String(t.at).slice(0, 16).replace("T", " ")) + "Z</td>" +
        "</tr>";
    }).join("");
  }

  function drawEquity(marks) {
    var svg = $("equity-chart");
    if (!svg) return;
    var pts = marks.slice(-200);
    if (pts.length < 2) {
      svg.innerHTML = "";
      setText("equity-readout", pts.length ? "one mark so far — the curve appears after a second run or settlement" : "no marks yet — run the strategies");
      return;
    }
    var W = 100, H = 100, padL = 8, padR = 2, padT = 4, padB = 8;
    var vals = pts.map(function (p) { return p.equity; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var start = state.ledger.starting_cash;
    min = Math.min(min, start); max = Math.max(max, start);
    var span = max - min || 1;
    function x(i) { return padL + (i / (pts.length - 1)) * (W - padL - padR); }
    function y(v) { return padT + (1 - (v - min) / span) * (H - padT - padB); }
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(2) + " " + y(p.equity).toFixed(2); }).join("");
    var startY = y(start).toFixed(2);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML =
      '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + startY + '" y2="' + startY + '" stroke="#cbd5e1" stroke-width="0.2" stroke-dasharray="1 1" vector-effect="non-scaling-stroke"/>' +
      '<text x="' + (W - padR) + '" y="' + (Number(startY) - 1) + '" font-size="2.6" fill="#64748b" text-anchor="end">start ' + TD.esc(fmtMoney(start)) + "</text>" +
      '<path d="' + d + '" fill="none" stroke="#1d4ed8" stroke-width="1.2" vector-effect="non-scaling-stroke"/>';
    setText("equity-readout", "min " + fmtMoney(min) + " · max " + fmtMoney(max) +
      " · latest " + fmtMoney(vals[vals.length - 1]) + " · " + pts.length + " marks");
  }

  window.__strategies = { state: state, runStrategies: runStrategies, checkSettlements: checkSettlements, render: render };
})();
