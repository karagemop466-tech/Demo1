/* trade-desk/assets/model.js — controller for model.html.
 *
 * Renders three things:
 *   1. the fee table, computed in the browser by the same function the ledger uses,
 *      beside the official schedule's own numbers;
 *   2. the calibration file produced by trade-desk/tools/calibrate.py from the
 *      committed official snapshot;
 *   3. a worked example: a real market pulled from the official API right now,
 *      scored step by step.
 */
(function () {
  "use strict";
  var TD = window.TD, Api = window.Api, Engine = window.Engine;

  var OFFICIAL_100 = {
    "0.01": 0.07, "0.05": 0.34, "0.10": 0.63, "0.15": 0.90, "0.20": 1.12,
    "0.25": 1.32, "0.30": 1.47, "0.35": 1.60, "0.40": 1.68, "0.45": 1.74,
    "0.50": 1.75, "0.55": 1.74, "0.60": 1.68, "0.65": 1.60, "0.70": 1.47,
    "0.75": 1.32, "0.80": 1.12, "0.85": 0.90, "0.90": 0.63, "0.95": 0.34,
    "0.99": 0.07
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }
  function money(v) { return v === null || v === undefined ? "—" : TD.money(v, 4); }

  TD.onReady(function () {
    setText("bar-score", String(Engine.SELECT_BAR.minScore));
    setText("bar-roi", TD.pct(Engine.SELECT_BAR.minRoi, 0));
    setText("bar-ask", TD.money(Engine.SELECT_BAR.maxAsk, 2));
    renderFees();
    loadCalibration();
    renderWorkedExample();
  });

  function renderFees() {
    var tbody = $("fee-table");
    if (!tbody) return;
    var rows = [];
    var mismatches = 0;
    Object.keys(OFFICIAL_100).forEach(function (price) {
      var p = Number(price);
      var ours1 = TD.fee(1, p);
      var ours100 = TD.fee(100, p);
      var official = OFFICIAL_100[price];
      var match = Math.abs(ours100 - official) < 1e-9;
      if (!match) mismatches += 1;
      rows.push("<tr><td class='num'>" + TD.cents(p, 0) + "</td><td class='num'>" + TD.money(ours1, 2) +
        "</td><td class='num'>" + TD.money(ours100, 2) + "</td><td class='num'>" + TD.money(official, 2) +
        (match ? ' <span class="up">✓</span>' : ' <span class="down">✗</span>') + "</td></tr>");
    });
    tbody.innerHTML = rows.join("") +
      '<tr><td colspan="4" class="small">' + (mismatches === 0
        ? "All 21 rows of the official table reproduce exactly in this browser."
        : mismatches + " row(s) differ from the official table — treat every fee figure on this site as suspect.") + "</td></tr>";
  }

  function loadCalibration() {
    return fetch("data/calibration.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(renderCalibration)
      .catch(function (err) {
        setText("calib-asof", "calibration file unavailable: " + err.message);
        $("calib").innerHTML = '<div class="callout bad" style="grid-column:1/-1">Calibration data is missing. Run ' +
          '<span class="mono">python3 trade-desk/tools/calibrate.py</span>. No figures are shown rather than showing guesses.</div>';
      });
  }

  function renderCalibration(d) {
    setText("calib-asof", "snapshot " + (d.inputs.snapshot_generated_utc || "?") + " · generated " + d.generated_utc);
    var br = d.base_rate;
    var zp = d.zero_last_price;
    var om = d.open_markets;

    $("calib").innerHTML = [
      kpi("YES base rate", TD.pct(br.yes_rate, 1), br.yes + " YES of " + br.settled_yes_or_no + " settled (demo)"),
      kpi("Settled markets", String(br.settled_yes_or_no), br.scalar_results + " scalar results in the same set"),
      kpi("Zero last price", String(zp.settled_markets_with_zero_last_price),
        zp.of_which_resolved_yes + " of them still resolved YES"),
      kpi("Open with a tradable ask", String(om.with_a_tradable_ask),
        om.with_a_two_sided_quote + " two-sided · " + om.with_a_one_sided_quote + " one-sided"),
      kpi("Clearing price + ROI bar", String(om.clearing_price_and_roi_bar),
        om.share_clearing === null ? "—" : TD.pct(om.share_clearing, 1) + " of priced markets"),
      kpi("Highest entry that clears", d.break_even && d.break_even.max_price_clearing_bar !== null
        ? TD.money(d.break_even.max_price_clearing_bar, 3) : "—", "25% net-ROI bar, 10-contract fill")
    ].join("");

    var topicRows = Object.keys(d.by_topic).map(function (k) {
      var t = d.by_topic[k];
      var label = TD.topicById(k);
      return "<tr><td>" + TD.esc(label ? label.label : k) + "</td><td class='num'>" + t.settled +
        "</td><td class='num'>" + t.yes + "</td><td class='num'>" + t.no +
        "</td><td class='num'>" + TD.pct(t.settled ? t.yes / t.settled : null, 1) + "</td></tr>";
    }).join("");

    var feeRows = d.fee_bands.map(function (b) {
      return "<tr><td>" + TD.esc(b.band) + "</td><td class='num'>" + TD.money(b.fee_per_1_contract, 2) +
        "</td><td class='num'>" + TD.pct(b.net_roi_on_win_1_contract, 0) + "</td><td class='num'>" +
        TD.pct(b.net_roi_on_win_100_contracts, 0) + "</td><td class='num'>" +
        TD.pct(b.max_roi, 0) + "</td><td>" + (b.clears_screen_at_1_contract
          ? '<span class="chip up">clears</span>' : '<span class="chip down">below bar</span>') + "</td></tr>";
    }).join("");

    $("calib-table").innerHTML =
      "<h3 style='font-size:14px;margin:6px 0'>Settled markets by topic</h3>" +
      "<div class='table-scroll short'><table><thead><tr><th>Topic</th><th class='num'>Settled</th><th class='num'>YES</th><th class='num'>NO</th><th class='num'>YES rate</th></tr></thead><tbody>" +
      topicRows + "</tbody></table></div>" +
      "<h3 style='font-size:14px;margin:16px 0 6px'>Fee drag and win-case ROI by entry price</h3>" +
      "<div class='table-scroll short'><table><thead><tr><th>Entry band</th><th class='num'>Fee / 1</th><th class='num'>Net ROI / 1</th><th class='num'>Net ROI / 100</th><th class='num'>Max ROI</th><th>Screen</th></tr></thead><tbody>" +
      feeRows + "</tbody></table></div>" +
      "<p class='small'>Net ROI is the win case after the official fee. Max ROI is the fee-free payout figure. " +
      "A single contract cannot pay less than a one-cent fee, so cheap entries lose a much larger share of their upside than the percentage formula suggests.</p>";

    $("calib-limits").innerHTML = "<p><b>What this calibration does not say.</b></p><ul style='margin:4px 0 0 18px;padding:0'>" +
      d.limits.map(function (l) { return "<li>" + TD.esc(l) + "</li>"; }).join("") +
      "<li>" + TD.esc(zp.note) + "</li></ul>";
  }

  function kpi(label, value, note) {
    return '<div class="kpi"><div class="label">' + TD.esc(label) + '</div><div class="value">' + TD.esc(value) +
      '</div><div class="note">' + TD.esc(note) + "</div></div>";
  }

  /* Pull one real open market, score it exactly as the alert feed would, and
   * print every intermediate number so the arithmetic can be checked. */
  function renderWorkedExample() {
    var pre = $("worked");
    if (!pre) return;
    Api.markets({ limit: 200 }).then(function (res) {
      if (!res.ok) {
        pre.textContent = "Could not reach the official API to build a worked example (" + res.error + "). No example is fabricated.";
        return;
      }
      var cands = (res.data.markets || []).filter(function (m) {
        var ask = TD.num(m.yes_ask_dollars);
        var bid = TD.num(m.yes_bid_dollars);
        return ask !== null && ask > 0.05 && ask < 0.9 && bid !== null && bid > 0;
      });
      if (!cands.length) {
        pre.textContent = "No open market returned a two-sided quote in a scoreable range, so no worked example is shown.";
        return;
      }
      var m = cands[0];
      return Api.orderbook(m.ticker, 10).then(function (bk) {
        var book = bk.ok ? bk.data : null;
        var lad = book ? TD.ladder(book) : null;
        var scored = Engine.score(m, {
          book: book,
          ask: TD.num(m.yes_ask_dollars),
          bid: TD.num(m.yes_bid_dollars),
          jump: null,
          now: Date.now()
        });
        var lines = [];
        lines.push("market         " + m.ticker);
        lines.push("title          " + (m.title || m.yes_sub_title));
        lines.push("quote (API)    yes_bid " + m.yes_bid_dollars + "  yes_ask " + m.yes_ask_dollars +
          "  (request: " + TD.apiUrl("/markets?tickers=" + encodeURIComponent(m.ticker)) + ")");
        if (lad) {
          lines.push("book           best yes bid " + lad.bestYesBid + " (" + lad.bestYesBidSize + " ct), " +
            "best implied yes ask " + (lad.bestYesAsk === null ? "none" : lad.bestYesAsk) + " (" + lad.bestYesAskSize + " ct)");
        }
        lines.push("");
        lines.push("score terms (no jump in this example, so the 30 jump points are unavailable):");
        scored.terms.forEach(function (t) {
          lines.push("  " + pad(t.name, 16) + pad(String(t.value), 18) + t.pts.toFixed(2) + " / " + t.weight + "   [" + t.why + "]");
        });
        lines.push("  " + pad("TOTAL", 16) + pad("", 18) + scored.score.toFixed(1) + " / " + scored.maxScore);
        lines.push("");
        if (scored.entryAsk !== null) {
          lines.push("fee            ceil(0.07 * 1 * " + scored.entryAsk.toFixed(4) + " * " +
            (1 - scored.entryAsk).toFixed(4) + ") = " + scored.feePerContract.toFixed(2) + " per contract (official formula)");
          lines.push("net ROI (win)  ((1 − " + scored.entryAsk.toFixed(4) + ") − " + scored.feePerContract.toFixed(4) + ") / (" +
            scored.entryAsk.toFixed(4) + " + " + scored.feePerContract.toFixed(4) + ") = " + TD.pct(scored.roi, 1));
          lines.push("max ROI (win)  1 / " + scored.entryAsk.toFixed(4) + " − 1 = " + TD.pct(scored.maxRoi, 1) + "  (fee-free)");
        } else {
          lines.push("entry          no tradable ask returned, so no ROI figure exists for this market");
        }
        lines.push("");
        lines.push("in feed B?     " + (Engine.isHighRoi(scored) ? "yes at these quotes" : "no at these quotes") +
          "   (bar: score ≥ " + Engine.SELECT_BAR.minScore + ", net ROI ≥ " + TD.pct(Engine.SELECT_BAR.minRoi, 0) +
          ", ask ≤ " + TD.money(Engine.SELECT_BAR.maxAsk, 2) + ")");
        pre.textContent = lines.join("\n");
      });
    }).catch(function (err) {
      pre.textContent = "Could not build the worked example: " + (err && err.message ? err.message : err) + ". Nothing is fabricated.";
    });
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s.slice(0, n) + " " : s + new Array(n - s.length + 1).join(" ");
  }

  window.__model = { renderFees: renderFees, renderCalibration: renderCalibration };
})();
