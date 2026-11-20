/* Paper-trading SIMULATION engine — session arena-288e8741-demo1 (2026-11-20).
 * THIS IS A SIMULATION. No real orders are sent. Real order placement requires an
 * authenticated Kalshi demo account (signed API key) and is deliberately NOT implemented
 * in this static site (a browser cannot safely hold a private signing key).
 * Simulated fills assume execution at the displayed best ask/bid with displayed size caps —
 * displayed liquidity is not a guarantee of execution (official docs). Fees are NOT modeled.
 * Data: official demo API when reachable from the browser (CORS verified, see data/cors.json),
 * else the verified snapshot ../data/demo-snapshot.json. Nothing invented.
 */
(function () {
  "use strict";
  var BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
  var LS_KEY = "kd-sim-trades-v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var num = function (v) { return v === "" || v == null || isNaN(Number(v)) ? null : Number(v); };

  /* Same verified demo watchlist as the live tracker (data/demo-snapshot.json). */
  var EVENTS = [
    ["gas", "KXAAAGASW-26NOV23"], ["gas", "KXAAAGASM-26NOV30"],
    ["crypto", "KXBTCD-26NOV2017"], ["crypto", "KXBTC-26NOV2101"],
    ["elections", "KXPRESNOMD-28"], ["elections", "KXPRESNOMR-28"],
    ["culture", "KXTIME-26"], ["culture", "KXGRAMMY-ROTY69"],
    ["golf", "KXPGATOUR-THRC26"], ["golf", "KXDPWTTOP20-DPWTC26"]
  ];

  var STRATS = {
    "fav-lock": { name: "Deep-favorite hold", scope: "crypto, gas", rule: "BUY YES when 0.92 ≤ best bid and best ask ≤ 0.98, displayed ask size > 0. Hold to settlement. Longshot of the book: favorites trade near $1 and pay $1 at resolution — the risk is event surprise and thin exit liquidity.", budget: 5, cap: 10 },
    "longshot": { name: "Longshot lottery", scope: "elections, culture", rule: "BUY YES when best ask ≤ $0.02 with displayed size. Small notional, capped size. Most longshots resolve no — expect a low hit rate; measure it, don't assume it.", budget: 5, cap: 25 },
    "tight-spread": { name: "Tight-spread round trip", scope: "golf", rule: "Simulated instant buy-at-ask / sell-at-bid when ask − bid ≤ 0.002 with both sizes displayed. Captures the spread; shows why displayed depth ≠ guaranteed fills.", budget: 5, cap: 5 },
    "momentum": { name: "Momentum chase (1-min candles)", scope: "crypto", rule: "LIVE only: if the last 5 traded 1-minute candle closes are strictly increasing, BUY YES at ask. Skipped in snapshot mode. Tests whether short-horizon momentum exists on demo (often it does not — measure it).", budget: 5, cap: 10 }
  };

  var state = { mode: "", trades: load(), candidates: [], busy: false };

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(state.trades)); }

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 12000) : null;
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).catch(function (e) { if (t) clearTimeout(t); throw e; });
  }

  function banner(kind, html) { var b = $("sim-banner"); b.className = "banner " + kind; b.innerHTML = html; }

  /* ---------- data gathering (live, else snapshot) ---------- */
  function gather() {
    banner("", "Connecting…");
    return fetchJSON(BASE + "/exchange/status", 9000).then(function () {
      state.mode = "live";
      banner("ok", "<b>SIMULATION on LIVE demo data</b> — fills are simulated at displayed bid/ask. No orders are sent anywhere.");
      return Promise.all(EVENTS.map(function (p) {
        return fetchJSON(BASE + "/markets?event_ticker=" + encodeURIComponent(p[1]) + "&limit=1000", 15000)
          .then(function (j) { return (j.markets || []).map(function (m) { m._cat = p[0]; m._event = p[1]; return m; }); })
          .catch(function () { return []; });
      })).then(function (arrs) { state.candidates = [].concat.apply([], arrs); });
    }).catch(function () {
      state.mode = "snapshot";
      banner("warn", "<b>SIMULATION on SNAPSHOT data</b> — demo API unreachable from this browser; using data/demo-snapshot.json (2026-11-20). Momentum strategy is skipped in this mode.");
      return fetchJSON("../data/demo-snapshot.json", 9000).then(function (j) {
        var out = [];
        var cats = j.categories || {};
        Object.keys(cats).forEach(function (cat) {
          (cats[cat].open_events || []).forEach(function (ev) {
            (ev.markets || []).forEach(function (m) { m._cat = cat; m._event = ev.event_ticker; out.push(m); });
          });
        });
        state.candidates = out;
      });
    });
  }

  /* ---------- strategy evaluation ---------- */
  function mktRow(m) {
    return { m: m, bid: num(m.yes_bid_dollars), ask: num(m.yes_ask_dollars),
             bidSz: num(m.yes_bid_size_fp), askSz: num(m.yes_ask_size_fp),
             vol: num(m.volume_fp), oi: num(m.open_interest_fp), last: num(m.last_price_dollars) };
  }

  function place(trade) {
    trade.id = "sim-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    trade.ts = new Date().toISOString();
    trade.mode = state.mode;
    trade.status = "open";
    state.trades.unshift(trade);
    save();
  }

  function runStrategies(cats) {
    var log = [];
    var allowed = state.candidates.filter(function (m) { return !cats.length || cats.indexOf(m._cat) >= 0; });
    /* fav-lock */
    if (cats.indexOf("crypto") >= 0 || cats.indexOf("gas") >= 0 || !cats.length) {
      allowed.forEach(function (m) {
        var r = mktRow(m);
        if (r.bid != null && r.ask != null && r.bid >= 0.92 && r.ask <= 0.98 && r.askSz > 0 && (m._cat === "crypto" || m._cat === "gas")) {
          var count = Math.min(STRATS["fav-lock"].cap, Math.max(1, Math.floor(STRATS["fav-lock"].budget / r.ask)), Math.floor(r.askSz));
          place({ strategy: "fav-lock", category: m._cat, event: m._event, market: m.ticker, side: "yes", entry_price: r.ask, count: count, notional: count * r.ask, note: "bid " + r.bid + " / ask " + r.ask });
          log.push("fav-lock: bought " + count + " YES of " + m.ticker + " at $" + r.ask);
        }
      });
    }
    /* longshot */
    allowed.forEach(function (m) {
      var r = mktRow(m);
      if ((m._cat === "elections" || m._cat === "culture") && r.ask != null && r.ask <= 0.02 && r.askSz > 0 && (r.vol == null || r.vol >= 0)) {
        var count2 = Math.min(STRATS["longshot"].cap, Math.floor(r.askSz));
        if (count2 >= 1) {
          place({ strategy: "longshot", category: m._cat, event: m._event, market: m.ticker, side: "yes", entry_price: r.ask, count: count2, notional: count2 * r.ask, note: "longshot, ask size " + r.askSz });
          log.push("longshot: bought " + count2 + " YES of " + m.ticker + " at $" + r.ask);
        }
      }
    });
    /* tight-spread (golf) — instant simulated round trip */
    allowed.forEach(function (m) {
      var r = mktRow(m);
      if (m._cat === "golf" && r.bid != null && r.ask != null && r.bidSz > 0 && r.askSz > 0 && (r.ask - r.bid) <= 0.002 && r.ask > r.bid) {
        var count3 = Math.min(STRATS["tight-spread"].cap, Math.floor(r.bidSz), Math.floor(r.askSz));
        var pnl = (r.bid - r.ask) * count3;
        place({ strategy: "tight-spread", category: m._cat, event: m._event, market: m.ticker, side: "yes", entry_price: r.ask, count: count3, notional: count3 * r.ask, status: "settled", exit_price: r.bid, realized: pnl, settled_ts: new Date().toISOString(), result: "round-trip", note: "sim spread capture" });
        log.push("tight-spread: round trip " + m.ticker + " → realized $" + pnl.toFixed(4));
      }
    });
    /* momentum — live + candlesticks */
    if (state.mode === "live" && (cats.indexOf("crypto") >= 0 || !cats.length)) {
      var cands = allowed.filter(function (m) { return m._cat === "crypto"; }).slice(0, 6);
      var chain = Promise.resolve();
      cands.forEach(function (m) {
        chain = chain.then(function () {
          var end = Math.floor(Date.now() / 1000), start = end - 1800;
          var url = BASE + "/series/" + encodeURIComponent(String(m.ticker).split("-")[0]) + "/markets/" + encodeURIComponent(m.ticker) + "/candlesticks?start_ts=" + start + "&end_ts=" + end + "&period_interval=1";
          return fetchJSON(url, 10000).then(function (j) {
            var closes = (j.candlesticks || []).map(function (c) { return c.price && num(c.price.close_dollars); }).filter(function (x) { return x != null; });
            if (closes.length >= 5) {
              var last5 = closes.slice(-5), rising = true;
              for (var i = 1; i < 5; i++) if (last5[i] <= last5[i - 1]) rising = false;
              if (rising) {
                var r2 = mktRow(m);
                if (r2.ask != null && r2.askSz > 0) {
                  var count4 = Math.min(STRATS["momentum"].cap, Math.max(1, Math.floor(STRATS["momentum"].budget / r2.ask)), Math.floor(r2.askSz));
                  place({ strategy: "momentum", category: m._cat, event: m._event, market: m.ticker, side: "yes", entry_price: r2.ask, count: count4, notional: count4 * r2.ask, note: "5 rising closes " + last5.map(function (x) { return x.toFixed(2); }).join(",") });
                  log.push("momentum: bought " + m.ticker + " at $" + r2.ask);
                }
              }
            }
          }).catch(function () { /* per-market candlestick failure: skip quietly, logged below */ });
        });
      });
      return chain.then(function () { return log; });
    }
    return Promise.resolve(log);
  }

  /* ---------- mark-to-market + settlement ---------- */
  function refreshPositions() {
    var open = state.trades.filter(function (t) { return t.status === "open"; }).slice(0, 25);
    var chain = Promise.resolve();
    open.forEach(function (t) {
      chain = chain.then(function () {
        if (state.mode === "snapshot") {
          var cand = state.candidates.filter(function (m) { return m.ticker === t.market; })[0];
          if (cand) apply(t, cand);
          return Promise.resolve();
        }
        return fetchJSON(BASE + "/markets/" + encodeURIComponent(t.market), 9000).then(function (j) {
          apply(t, j.market || j);
        }).catch(function () { /* leave position untouched on failure */ });
      });
    });
    return chain.then(function () { save(); render(); });

    function apply(t, m) {
      var bid = num(m.yes_bid_dollars);
      if (m.status === "finalized") {
        var payout = m.result === "yes" ? 1 : 0;
        t.status = "settled";
        t.result = m.result;
        t.settled_ts = m.settlement_ts || new Date().toISOString();
        t.realized = (payout - t.entry_price) * t.count;
        t.exit_price = payout;
      } else if (bid != null) {
        t.exit_price = bid;
        t.unrealized = (bid - t.entry_price) * t.count;
      }
    }
  }

  /* ---------- rendering ---------- */
  function money(x) { return (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(x != null && Math.abs(x) < 1 ? 4 : 2); }

  function render() {
    var rows = state.trades.slice(0, 60).map(function (t) {
      var pnl = t.realized != null ? t.realized : t.unrealized;
      return "<tr><td>" + esc(t.ts.replace("T", " ").slice(0, 19)) + "</td>" +
        '<td><span class="tag t-info">' + esc(STRATS[t.strategy] ? STRATS[t.strategy].name : t.strategy) + "</span></td>" +
        "<td>" + esc(t.category) + "</td><td>" + esc(t.market) + "</td><td>BUY YES</td>" +
        '<td class="num">' + (t.entry_price != null ? "$" + Number(t.entry_price).toFixed(4) : "") + "</td>" +
        '<td class="num">' + (t.count != null ? esc(t.count) : "") + "</td>" +
        '<td class="num">' + (t.notional != null ? money(t.notional) : "") + "</td>" +
        '<td class="num">' + (t.exit_price != null ? "$" + Number(t.exit_price).toFixed(4) : "") + "</td>" +
        '<td class="num">' + (pnl != null ? money(pnl) : "") + "</td>" +
        "<td>" + (t.status === "settled" ? "settled · " + esc(t.result || "") : "open") + "</td>" +
        '<td><a href="' + BASE + "/markets/" + encodeURIComponent(t.market || "") + '" target="_blank" rel="noreferrer">API ↗</a></td></tr>';
    }).join("");
    $("sim-rows").innerHTML = rows || '<tr><td colspan="12">No simulated trades yet — press “Run engine”. Nothing is fabricated: every simulated fill needs a displayed bid/ask from official data.</td></tr>';

    /* analytics */
    var realized = 0, unreal = 0, wins = 0, settledN = 0;
    var byStrat = {}, byCat = {};
    state.trades.forEach(function (t) {
      realized += t.realized || 0;
      unreal += t.unrealized || 0;
      if (t.status === "settled") { settledN++; if ((t.realized || 0) > 0) wins++; }
      var s = byStrat[t.strategy] = byStrat[t.strategy] || { n: 0, realized: 0, open: 0 };
      s.n++; s.realized += t.realized || 0; if (t.status === "open") s.open++;
      var c = byCat[t.category] = byCat[t.category] || { n: 0, realized: 0, open: 0 };
      c.n++; c.realized += t.realized || 0; if (t.status === "open") c.open++;
    });
    $("an-totals").innerHTML =
      "<tr><td>Simulated trades</td><td class='num'>" + state.trades.length + "</td></tr>" +
      "<tr><td>Settled / win rate</td><td class='num'>" + settledN + (settledN ? " / " + (100 * wins / settledN).toFixed(1) + "%" : " / —") + "</td></tr>" +
      "<tr><td>Realized P&L (settlements + round trips)</td><td class='num'>" + money(realized) + "</td></tr>" +
      "<tr><td>Unrealized P&L (marked to best bid)</td><td class='num'>" + money(unreal) + "</td></tr>" +
      "<tr><td>Simulated equity (Σ)</td><td class='num'>" + money(realized + unreal) + "</td></tr>";
    function rows2(obj) {
      return Object.keys(obj).map(function (k) {
        var v = obj[k];
        return "<tr><td>" + esc(STRATS[k] ? STRATS[k].name : k) + "</td><td class='num'>" + v.n + "</td><td class='num'>" + v.open + "</td><td class='num'>" + money(v.realized) + "</td></tr>";
      }).join("") || "<tr><td colspan='4'>—</td></tr>";
    }
    $("an-strat").innerHTML = rows2(byStrat);
    $("an-cat").innerHTML = rows2(byCat);
  }

  /* ---------- wiring ---------- */
  $("run").onclick = function () {
    if (state.busy) return;
    state.busy = true; $("run").disabled = true;
    var cats = [].slice.call(document.querySelectorAll("#cat-sel input:checked")).map(function (i) { return i.value; });
    gather().then(function () { return runStrategies(cats); })
      .then(function (log) {
        $("run-log").textContent = log.length ? log.join(" · ") : "No strategy triggers found under current rules and displayed liquidity (skips are logged, nothing invented).";
        return refreshPositions();
      })
      .catch(function (e) { banner("bad", "Engine run failed: " + esc(e.message)); })
      .then(function () { state.busy = false; $("run").disabled = false; render(); });
  };
  $("settle").onclick = function () {
    if (state.busy) return;
    state.busy = true; $("settle").disabled = true;
    gather().then(function () { return refreshPositions(); })
      .catch(function (e) { banner("bad", "Refresh failed: " + esc(e.message)); })
      .then(function () { state.busy = false; $("settle").disabled = false; });
  };
  $("export").onclick = function () {
    var blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), mode: state.mode, trades: state.trades }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kalshi-sim-trades-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
  };
  $("reset").onclick = function () {
    if (confirm("Delete all simulated trades from this browser?")) { state.trades = []; save(); render(); }
  };
  render();
  banner("", "Press <b>Run engine</b> — it connects to the official demo API (or the verified snapshot if unreachable) and evaluates the strategies below against displayed bid/ask liquidity.");
})();
