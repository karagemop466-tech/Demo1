/* sim-desk dashboard renderer.
 * Data: data/ledger.json + data/performance.json (committed by the CI engine run).
 * Rule: render only values present in the committed JSON. Missing values render
 * blank with an "unverified" badge — never inferred, never fabricated.
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function money(v) {
    if (v === null || v === undefined || isNaN(v)) return "";
    var sign = v < 0 ? "-" : "";
    return sign + "$" + Math.abs(v).toFixed(2);
  }
  function price(v) {
    if (v === null || v === undefined || isNaN(v)) return "";
    return "$" + Number(v).toFixed(2);
  }
  function pct(v) {
    if (v === null || v === undefined || isNaN(v)) return "";
    return (v * 100).toFixed(1) + "%";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function apiMarketUrl(ticker) {
    // Official demo Trade API endpoint for this market (the exact read URL).
    var base = "https://external-api.demo.kalshi.co/trade-api/v2/markets/";
    return base + encodeURIComponent(ticker || "");
  }
  function newsUrl(title) {
    return "https://news.google.com/search?q=" + encodeURIComponent(title || "");
  }
  function sidePill(side) {
    return '<span class="pill ' + (side === "yes" ? "yes" : "no") + '">' + esc(side.toUpperCase()) + "</span>";
  }
  function resultPill(result) {
    if (result !== "yes" && result !== "no") return '<span class="badge unverified">unverified</span>';
    return '<span class="pill ' + result + '">' + esc(result.toUpperCase()) + "</span>";
  }
  function topicPill(topic) {
    return '<span class="pill topic">' + esc(topic || "?") + "</span>";
  }

  function setKpis(perf, ledger) {
    var kpis = [
      ["Equity (sim)", money(perf.equity), "cash + open positions marked to market"],
      ["Cash (sim)", money(perf.cash), "after fills, fees, payouts"],
      ["Open positions", perf.open_count, "awaiting result yes/no"],
      ["Settled trades", perf.settled_count, perf.result_counts ? (perf.result_counts.yes + " yes / " + perf.result_counts.no + " no") : ""],
      ["Realized P&L", money(perf.realized_pnl), "settled trades, fees included"],
      ["ROI on start", pct(perf.roi_on_started_cash), "started " + money(perf.started_cash_dollars) + " (sim)"],
    ];
    var html = kpis.map(function (k) {
      var cls = "value";
      if (typeof k[1] === "string" && k[1].indexOf("-") === 0) cls += " bad";
      else if (typeof k[1] === "string" && k[1].indexOf("$") === 0 && k[0].indexOf("P&L") >= 0) cls += " good";
      return '<div class="kpi"><div class="label">' + esc(k[0]) + '</div><div class="' + cls + '">' + k[1] +
        '</div><div class="sub">' + esc(k[2] || "") + "</div></div>";
    }).join("");
    $("kpis").innerHTML = html;
    $("meta-line").innerHTML =
      "ledger updated <b>" + esc((ledger.meta && ledger.meta.updated_ts) || "") + "</b> · " +
      (ledger.meta && ledger.meta.runs) + " CI runs · base <span class='mono'>" + esc((ledger.meta && ledger.meta.base_url) || "") + "</span>";
  }

  function renderEquity(curve) {
    var el = $("equity-chart");
    if (!curve || curve.length < 2) {
      el.innerHTML = '<div class="muted small">Equity curve appears after two CI runs. Points: ' +
        (curve ? curve.length : 0) + ". Each point is one engine run timestamp.</div>";
      return;
    }
    var W = 1060, H = 240, padL = 56, padR = 14, padT = 14, padB = 30;
    var xs = curve.map(function (d, i) { return i; });
    var ys = curve.map(function (d) { return Number(d.equity); }).filter(function (v) { return !isNaN(v); });
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    if (yMax - yMin < 1) { yMax = yMin + 1; }
    var pad = (yMax - yMin) * 0.08; yMin -= pad; yMax += pad;
    function X(i) { return padL + (i * (W - padL - padR)) / (curve.length - 1); }
    function Y(v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB); }
    var pts = curve.map(function (d, i) { return X(i).toFixed(1) + "," + Y(Number(d.equity)).toFixed(1); }).join(" ");
    var yTicks = [yMin, yMin + (yMax - yMin) / 2, yMax];
    var svg = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="simulated equity over time">'];
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#161b23" rx="8"/>');
    yTicks.forEach(function (t) {
      svg.push('<line x1="' + padL + '" y1="' + Y(t) + '" x2="' + (W - padR) + '" y2="' + Y(t) + '" stroke="#2a3442" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (Y(t) + 4) + '" fill="#8b98a9" font-size="11" text-anchor="end">$' + t.toFixed(0) + "</text>");
    });
    [0, Math.floor((curve.length - 1) / 2), curve.length - 1].forEach(function (i) {
      svg.push('<text x="' + X(i) + '" y="' + (H - 8) + '" fill="#8b98a9" font-size="11" text-anchor="middle">' + esc(curve[i].ts) + "</text>");
    });
    svg.push('<polyline points="' + pts + '" fill="none" stroke="#4da3ff" stroke-width="2"/>');
    var last = curve[curve.length - 1];
    svg.push('<circle cx="' + X(curve.length - 1) + '" cy="' + Y(Number(last.equity)) + '" r="3.5" fill="#4da3ff"/>');
    svg.push('<text x="' + (X(curve.length - 1) - 6) + '" y="' + (Y(Number(last.equity)) - 10) + '" fill="#e8edf2" font-size="12" text-anchor="end">$' + Number(last.equity).toFixed(2) + "</text>");
    svg.push("</svg>");
    el.innerHTML = svg.join("");
  }

  function rollupTable(rows, opts) {
    if (!rows) return '<div class="muted small">no data yet</div>';
    var keys = Object.keys(rows);
    if (!keys.length) return '<div class="muted small">no trades recorded yet — the CI engine opens its first positions on its next run</div>';
    var head = "<tr><th>" + opts.keyLabel + "</th><th class='num'>opened</th><th class='num'>settled</th><th class='num'>win rate</th><th class='num'>invested</th><th class='num'>fees</th><th class='num'>realized P&amp;L</th><th class='num'>ROI</th></tr>";
    var body = keys.sort(function (a, b) {
      return (rows[b].realized_pnl || 0) - (rows[a].realized_pnl || 0);
    }).map(function (k) {
      var r = rows[k];
      var pnl = r.realized_pnl === undefined || r.realized_pnl === null ? "" :
        '<span class="' + (r.realized_pnl > 0 ? "value good" : r.realized_pnl < 0 ? "value bad" : "") + '">' + money(r.realized_pnl) + "</span>";
      return "<tr><td>" + esc(k) + "</td><td class='num'>" + r.opened + "</td><td class='num'>" + r.settled +
        "</td><td class='num'>" + pct(r.win_rate) + "</td><td class='num'>" + money(r.invested) +
        "</td><td class='num'>" + money(r.fees) + "</td><td class='num'>" + pnl + "</td><td class='num'>" + pct(r.roi) + "</td></tr>";
    }).join("");
    return '<div class="tablewrap"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function renderRollups(perf) {
    $("strategy-rollup").innerHTML = rollupTable(perf.by_strategy, { keyLabel: "strategy" });
    $("topic-rollup").innerHTML = rollupTable(perf.by_topic, { keyLabel: "topic" });
    $("band-rollup").innerHTML = rollupTable(perf.by_band, { keyLabel: "entry price band ($)" });
    var m = perf.category_matrix || [];
    if (!m.length) {
      $("category-matrix").innerHTML = '<div class="muted small">no trades recorded yet</div>';
    } else {
      var html = "<tr><th>topic</th><th>strategy</th><th class='num'>opened</th><th class='num'>settled</th><th class='num'>wins</th><th class='num'>realized P&amp;L</th></tr>";
      html += m.map(function (row) {
        return "<tr><td>" + topicPill(row.topic) + "</td><td>" + esc(row.strategy) + "</td><td class='num'>" + (row.opened || 0) +
          "</td><td class='num'>" + (row.settled || 0) + "</td><td class='num'>" + (row.wins || 0) +
          "</td><td class='num'>" + (row.realized_pnl === undefined ? "" : money(row.realized_pnl)) + "</td></tr>";
      }).join("");
      $("category-matrix").innerHTML = '<div class="tablewrap"><table><thead>' + html + "</thead></table></div>";
    }
  }

  function positionRows(positions) {
    if (!positions || !positions.length) {
      return '<div class="muted small">no open positions right now — the CI engine evaluates the top dollar-volume markets every 30 minutes and opens at most ' +
        "3 simulated trades per run</div>";
    }
    var head = "<tr><th>opened (UTC)</th><th>market</th><th>topic</th><th>strategy</th><th>side</th><th class='num'>contracts</th>" +
      "<th class='num'>entry</th><th class='num'>fee</th><th class='num'>mark</th><th class='num'>value</th>" +
      "<th>signal</th><th>status</th><th>sources</th></tr>";
    var body = positions.slice().sort(function (a, b) { return (b.entry_ts || "").localeCompare(a.entry_ts || ""); }).map(function (p) {
      var value = (p.contracts && p.mark_price !== undefined) ? money(p.contracts * p.mark_price) : "";
      return "<tr>" +
        "<td class='mono'>" + esc(p.entry_ts) + "</td>" +
        "<td class='wrap'><b>" + esc(p.title || p.ticker) + "</b><div class='mono muted small'>" + esc(p.ticker) + "</div></td>" +
        "<td>" + topicPill(p.topic) + "</td>" +
        "<td>" + esc(p.strategy) + "</td>" +
        "<td>" + sidePill(p.side) + "</td>" +
        "<td class='num'>" + p.contracts + "</td>" +
        "<td class='num'>" + price(p.entry_price) + "</td>" +
        "<td class='num'>" + money(p.entry_fee) + "</td>" +
        "<td class='num'>" + price(p.mark_price) + "</td>" +
        "<td class='num'>" + value + "</td>" +
        "<td class='wrap small'>" + esc(p.signal_reason || "") + "</td>" +
        "<td><span class='pill open'>open — awaiting yes/no</span></td>" +
        "<td class='small'><a href='" + apiMarketUrl(p.ticker) + "' target='_blank' rel='noreferrer'>API market ↗</a> · " +
        "<a href='" + esc(p.orderbook_source_url || apiMarketUrl(p.ticker)) + "' target='_blank' rel='noreferrer'>book ↗</a> · " +
        "<a href='" + esc(p.candlestick_source_url || apiMarketUrl(p.ticker)) + "' target='_blank' rel='noreferrer'>candles ↗</a> · " +
        "<a href='" + newsUrl(p.title) + "' target='_blank' rel='noreferrer'>news (cause unverified) ↗</a></td>" +
        "</tr>";
    }).join("");
    return '<div class="tablewrap"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function settledRows(trades) {
    if (!trades || !trades.length) {
      return '<div class="muted small">no settled trades yet — open positions are carried across CI runs and settle automatically when the market reports status=settled with result yes or no ($1 per winning contract, official settlement rule)</div>';
    }
    var head = "<tr><th>settled (UTC)</th><th>market</th><th>topic</th><th>strategy</th><th>side</th><th>result</th>" +
      "<th class='num'>contracts</th><th class='num'>entry</th><th class='num'>fee</th><th class='num'>payout</th>" +
      "<th class='num'>realized P&amp;L</th><th>settled at</th><th>sources</th></tr>";
    var body = trades.slice().sort(function (a, b) { return (b.exit_ts || "").localeCompare(a.exit_ts || ""); }).map(function (t) {
      var cls = t.realized_pnl > 0 ? "value good" : t.realized_pnl < 0 ? "value bad" : "";
      return "<tr>" +
        "<td class='mono'>" + esc(t.exit_ts) + "</td>" +
        "<td class='wrap'><b>" + esc(t.title || t.ticker) + "</b><div class='mono muted small'>" + esc(t.ticker) + "</div></td>" +
        "<td>" + topicPill(t.topic) + "</td>" +
        "<td>" + esc(t.strategy) + "</td>" +
        "<td>" + sidePill(t.side) + "</td>" +
        "<td>" + resultPill(t.result) + "</td>" +
        "<td class='num'>" + t.contracts + "</td>" +
        "<td class='num'>" + price(t.entry_price) + "</td>" +
        "<td class='num'>" + money(t.entry_fee) + "</td>" +
        "<td class='num'>" + money(t.payout) + "</td>" +
        "<td class='num'><span class='" + cls + "'>" + money(t.realized_pnl) + "</span></td>" +
        "<td class='mono small'>" + esc(t.settlement_ts || "") + "</td>" +
        "<td class='small'><a href='" + esc(t.settlement_source_url || apiMarketUrl(t.ticker)) + "' target='_blank' rel='noreferrer'>settlement read ↗</a> · " +
        "<a href='" + apiMarketUrl(t.ticker) + "' target='_blank' rel='noreferrer'>API market ↗</a></td>" +
        "</tr>";
    }).join("");
    return '<div class="tablewrap"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function renderRunLog(rl) {
    var s = (rl && rl.summary) || {};
    var dot = "ok";
    if (!s.api_calls) dot = "";
    if (s.request_errors) dot = "err";
    var html = '<div class="status-line"><span class="dot ' + dot + '"></span>' +
      "last engine run <b>" + esc(s.run_id || rl.ts || "") + "</b> · " +
      "API calls: <b>" + esc(s.api_calls === undefined ? "" : s.api_calls) + "</b> · " +
      "request errors: <b>" + esc(s.request_errors === undefined ? "" : s.request_errors) + "</b> · " +
      "new trades: <b>" + esc(s.new_trades === undefined ? "" : s.new_trades) + "</b> · " +
      "settled: <b>" + esc(s.settled === undefined ? "" : s.settled) + "</b></div>";
    var skips = (rl && rl.skips) || [];
    if (skips.length) {
      html += '<div class="small muted">skips this run (logged, never retried blindly): ' +
        skips.slice(0, 6).map(function (k) {
          return "<span class='mono'>" + esc(k.ticker) + "</span> — " + esc(k.reason);
        }).join(" · ") + "</div>";
    }
    html += '<div class="small muted">full request log with the exact official URL behind every number: <a href="data/run_log.json" target="_blank" rel="noreferrer">data/run_log.json</a></div>';
    $("runlog").innerHTML = html;
  }

  function renderFlags(ledger) {
    var notes = (ledger.meta && ledger.meta.notes) || [];
    $("flags").innerHTML = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") +
      '<li>Entry price is the <b>implied best ask</b> (1 − best opposite bid) per the official bids-only orderbook rule; ask-side depth is implied, not observed — real fills at size may differ.</li>' +
      '<li>Marks use the official <span class="mono">last_price_dollars</span>; API listing responses are cached for a short time and can lag the exchange.</li>' +
      '<li>"Highest dollar amount" ranking uses computed 24h traded notional (volume_24h × last price) — Kalshi publishes no official dollar-volume field.</li>' +
      '<li>The taker multiplier M=1 is confirmed for KXAAAGASM (gas) and KXBTCMAX150 (crypto) in the official fee table; the full non-standard-fee table is not machine-readable from the PDF, so M=1 is assumed and disclosed for all simulated fees.</li>';
  }

  function showLoadError(msg) {
    $("kpis").innerHTML = "";
    $("load-error").innerHTML = "Data could not be loaded: " + esc(msg) +
      " — nothing is rendered from memory; wait for the next CI run or check data/ledger.json.";
    $("load-error").style.display = "block";
  }

  function load(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + " -> HTTP " + r.status);
      return r.json();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Promise.all([load("data/ledger.json"), load("data/performance.json"), load("data/run_log.json")])
      .then(function (res) {
        var ledger = res[0], perf = res[1], runlog = res[2];
        setKpis(perf, ledger);
        renderEquity(perf.equity_curve);
        renderRollups(perf);
        $("open-positions").innerHTML = positionRows(ledger.positions_open);
        $("settled-trades").innerHTML = settledRows(ledger.trades_settled);
        renderRunLog(runlog);
        renderFlags(ledger);
      })
      .catch(function (err) { showLoadError(err && err.message || err); });
  });
})();
