/*
 * Kalshi demo — live alert tapes.
 *
 * Two scrolling chat feeds driven by the official Kalshi demo Trade API:
 *   • Tape A "All events"  — every price swing of >= $0.10 in either direction
 *   *   Tape B "Model picks" — only the swings on events the ROI screen likes
 *
 * Everything here is computed from documented, unauthenticated endpoints:
 *   GET /markets?tickers=a,b,c            (quotes; unpaged when tickers is the only filter)
 *   GET /markets/orderbooks?tickers=...    (bids only, <=100 tickers, ascending, best bid last)
 *   GET /markets/trades?limit=1000         (public trade tape)
 *   GET /series/{s}/markets/{t}/candlesticks?period_interval=1|60|1440
 * Sources: https://docs.kalshi.com/api-reference/market/get-markets,
 *          https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks,
 *          https://docs.kalshi.com/api-reference/market/get-trades,
 *          https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 * Payout/fee math: https://docs.kalshi.com/getting_started/market_settlement ($1 per winning contract)
 *                  https://kalshi.com/docs/kalshi-fee-schedule.pdf (taker 0.07, maker 0.0175)
 *                  https://docs.kalshi.com/getting_started/fee_rounding (fees rounded up)
 * Reciprocal book rule (a NO bid at Y is a YES ask at 1-Y):
 *                  https://docs.kalshi.com/getting_started/orderbook_responses
 *
 * No orders are placed and no credentials are used: the browser path is read-only.
 * The module is dependency-free and exposes pure functions so the maths can be unit-tested.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KA = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DOC = {
    demoRest: "https://external-api.demo.kalshi.co/trade-api/v2",
    demoWs: "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
    prodRest: "https://external-api.kalshi.com/trade-api/v2",
    demoSite: "https://demo.kalshi.co/",
    environments: "https://docs.kalshi.com/getting_started/api_environments",
    demoEnv: "https://docs.kalshi.com/getting_started/demo_env",
    markets: "https://docs.kalshi.com/api-reference/market/get-markets",
    orderbooksBatch: "https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks",
    orderbookShape: "https://docs.kalshi.com/getting_started/orderbook_responses",
    trades: "https://docs.kalshi.com/api-reference/market/get-trades",
    candles: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    settlement: "https://docs.kalshi.com/getting_started/market_settlement",
    lifecycle: "https://docs.kalshi.com/getting_started/market_lifecycle",
    feePdf: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    feeRounding: "https://docs.kalshi.com/getting_started/fee_rounding",
    rateLimits: "https://docs.kalshi.com/getting_started/rate_limits",
    wsQuickstart: "https://docs.kalshi.com/getting_started/quick_start_websockets",
    modelDoc: "docs/alerts-model.html"
  };

  var DEFAULTS = {
    threshold: 0.10,      // brief: swing >= $0.10 either direction
    pollMs: 15000,        // unauthenticated public limits apply -> stay polite
    watchPerTopic: 10,
    maxTapeLines: 300,
    cooldownMs: 60000,    // at most one alert per market per side per minute
    minContractsAtAsk: 1,
    minRoi: 0.10,
    depthCapContracts: 100,
    takerRate: 0.07,
    makerRate: 0.0175,
    payoutPerContract: 1
  };

  // ---------------------------------------------------------------- helpers
  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // Round up to `dp` decimals — the fee schedule rounds fees up ("round up such that the
  // fee + positionCost is rounded to a centicent"); rounding up keeps the model conservative.
  function roundUp(v, dp) {
    var f = Math.pow(10, dp);
    return Math.ceil((v - Number.EPSILON) * f) / f;
  }

  function money(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return "";
    return "$" + Number(v).toFixed(dp === undefined ? 4 : dp);
  }

  function pct(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return "";
    return (v * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function iso(ts) {
    return new Date(ts * 1000).toISOString().replace("T", " ").replace(".000Z", "Z");
  }

  function clock(tsMs) {
    var d = new Date(tsMs);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function seriesOf(ticker) { return String(ticker || "").split("-")[0]; }

  // ---------------------------------------------------------------- fees / ROI
  // fees = round up(M x 0.07 x C x P x (1-P))  (taker)
  // fees = round up(M x 0.0175 x C x P x (1-P)) (maker)
  function takerFee(price, contracts, mult) {
    return feeAt(DEFAULTS.takerRate, price, contracts, mult === undefined ? 1 : mult);
  }
  function makerFee(price, contracts, mult) {
    return feeAt(DEFAULTS.makerRate, price, contracts, mult === undefined ? 0 : mult);
  }
  function feeAt(rate, price, contracts, mult) {
    var p = num(price), c = num(contracts), m = num(mult);
    if (p === null || p <= 0 || p >= 1 || c === null || c <= 0) return null;
    if (m === null || m < 0) m = 0;
    return roundUp(m * rate * c * p * (1 - p), 2);
  }

  // Economics of buying `contracts` of one side at `entry` and holding to resolution.
  // A winning contract pays $1.00 (docs market_settlement); a losing one pays $0.
  function sideEconomics(entry, contracts, opts) {
    opts = opts || {};
    var p = num(entry), c = num(contracts);
    if (p === null || p <= 0 || p >= 1 || c === null || c <= 0) return null;
    var mult = opts.mult === undefined ? 1 : opts.mult;
    var rate = opts.maker ? DEFAULTS.makerRate : DEFAULTS.takerRate;
    var fee = feeAt(rate, p, c, mult);
    if (fee === null) return null;
    var position = p * c;
    var outlay = position + fee;
    var payout = c * (opts.payoutPerContract === undefined ? DEFAULTS.payoutPerContract : opts.payoutPerContract);
    return {
      entry: p, contracts: c, fee: fee, positionCost: roundUp(position, 2), outlay: roundUp(outlay, 4),
      payoutIfWins: payout, netProfitIfWins: roundUp(payout - outlay, 4),
      lossIfLoses: roundUp(outlay, 4),
      roi: (payout - outlay) / outlay,
      breakevenWinProb: outlay / payout
    };
  }

  // ---------------------------------------------------------------- order book
  // Documented shape: {orderbook_fp: {yes_dollars: [[price, count], ...], no_dollars: [...]}}
  // ascending by price, best (highest) bid last. Asks are not returned: a bid on the
  // opposite side at price Y is an ask on this side at 1 - Y.
  function parseLevels(levels) {
    if (!Array.isArray(levels)) return [];
    return levels
      .filter(function (l) { return Array.isArray(l) && l.length >= 2; })
      .map(function (l) { return { price: num(l[0]), count: num(l[1]) }; })
      .filter(function (l) { return l.price !== null && l.count !== null; });
  }

  function bestBid(levels) {
    var parsed = parseLevels(levels);
    if (!parsed.length) return null;
    return parsed.reduce(function (a, b) { return b.price > a.price ? b : a; });
  }

  function depthAtOrBetter(levels, price) {
    var parsed = parseLevels(levels), tot = 0;
    for (var i = 0; i < parsed.length; i++) if (parsed[i].price >= price) tot += parsed[i].count;
    return tot;
  }

  function bookSides(orderbook) {
    var ob = (orderbook && (orderbook.orderbook_fp || orderbook.orderbook)) || {};
    var yesBid = bestBid(ob.yes_dollars), noBid = bestBid(ob.no_dollars);
    return {
      raw: ob,
      yes_bid: yesBid,
      no_bid: noBid,
      // YES ask is implied by the best NO bid (and vice versa)
      yes_ask: noBid ? { price: roundUp(1 - noBid.price, 4), contracts: noBid.count, derived_from: "NO bid" } : null,
      no_ask: yesBid ? { price: roundUp(1 - yesBid.price, 4), contracts: yesBid.count, derived_from: "YES bid" } : null
    };
  }

  function vwap(trades) {
    var notional = 0, contracts = 0;
    (trades || []).forEach(function (t) {
      var price = num(t.yes_price_dollars), c = num(t.count_fp);
      if (price === null || c === null || c <= 0) return;
      notional += price * c; contracts += c;
    });
    if (!contracts) return null;
    return { price: notional / contracts, contracts: contracts, notional: notional };
  }

  // ---------------------------------------------------------------- swings
  function swing(prev, cur, threshold) {
    var a = num(prev), b = num(cur);
    if (a === null || b === null) return null;
    var d = b - a;
    if (Math.abs(d) + 1e-9 < (threshold === undefined ? DEFAULTS.threshold : threshold)) return null;
    return { delta: Math.round(d * 1e4) / 1e4, dir: d > 0 ? "up" : "down", from: a, to: b };
  }

  // A market's reference "mark": traded last price when present, else the mid of the
  // best YES bid and the implied YES ask (both documented fields/identities).
  function markOf(market, book) {
    var last = num(market && market.last_price_dollars);
    if (last !== null && last > 0) return { value: last, kind: "last trade" };
    var bid = book && book.yes_bid ? book.yes_bid.price : num(market && market.yes_bid_dollars);
    var ask = book && book.yes_ask ? book.yes_ask.price : num(market && market.yes_ask_dollars);
    if (bid === null && ask !== null) bid = roundUp(1 - ask, 4);
    if (ask === null && bid !== null) ask = roundUp(1 - bid, 4);
    if (bid === null || ask === null) return { value: null, kind: "" };
    return { value: Math.round(((bid + ask) / 2) * 1e4) / 1e4, kind: "book mid" };
  }

  // ---------------------------------------------------------------- ROI screen
  /*
   * The screen is a rule set, not a forecast. Every gate reads one documented field.
   *  G1 in-window     market is open and its close time is in the future
   *  G2 fillable      an ask exists on the candidate side with >= minContractsAtAsk contracts
   *  G3 reversion     the ask is at least `minPull` below the session VWAP of public trades
   *                   (the crowd paid more today than the price being offered now)
   *  G4 payoff        fee-adjusted ROI to resolution >= minRoi
   *  G5 swing         a >= $0.10 swing fired on this market in this tape cycle (the trigger)
   */
  function screen(market, ctx) {
    ctx = ctx || {};
    var cfg = extend(DEFAULTS, ctx.cfg || {});
    var minPull = ctx.cfg && ctx.cfg.minPull !== undefined ? ctx.cfg.minPull : 0.02;
    var book = ctx.book || null;
    var now = ctx.nowSec === undefined ? nowSec() : ctx.nowSec;
    var v = ctx.vwap || null;
    var gates = [];
    var fail = {};
    var push = function (name, pass, detail, why) {
      gates.push({ name: name, pass: !!pass, detail: detail });
      if (!pass) fail[name] = why || detail;
      return !!pass;
    };

    // G1 - the event is still live: open status and a close time in the future.
    var status = String((market && market.status) || "").toLowerCase();
    var openish = status === "active" || status === "open" || status === "unopened";
    var closeTs = parseIso(market && (market.close_time || market.expected_expiration_time));
    push("G1 in-window", openish && closeTs !== null && closeTs > now,
      "status=" + (status || "blank") + ", close " + (closeTs === null ? "blank" : iso(closeTs)) +
      (closeTs !== null && closeTs <= now ? " (already past)" : ""),
      "market is not open with a future close time");

    // G2 - a fillable ask with at least one contract: implied asks from the returned
    // bids (documented identity), or the quoted ask fields when no book came back.
    var sides = [];
    if (book) {
      if (book.yes_ask) sides.push({ side: "YES", ask: book.yes_ask });
      if (book.no_ask) sides.push({ side: "NO", ask: book.no_ask });
    }
    if (!sides.length) {
      var ya = num(market && market.yes_ask_dollars), na = num(market && market.no_ask_dollars);
      var ys = num(market && market.yes_ask_size_fp), ns = num(market && market.no_ask_size_fp);
      if (ya !== null && ya > 0 && ya < 1) sides.push({ side: "YES", ask: { price: ya, contracts: ys === null ? 0 : ys, derived_from: "quoted ask" } });
      if (na !== null && na > 0 && na < 1) sides.push({ side: "NO", ask: { price: na, contracts: ns === null ? 0 : ns, derived_from: "quoted ask" } });
    }

    var best = null;
    var rankOf = function (c) { return (c.eco ? c.eco.roi : -1) + (c.pull || 0); };
    sides.forEach(function (s) {
      var eco = sideEconomics(s.ask.price, 1, { mult: ctx.feeMult === undefined ? 1 : ctx.feeMult });
      var pull = v && v.price !== null ? Math.round((v.price - s.ask.price) * 1e4) / 1e4 : null;
      var cand = { side: s.side, ask: s.ask, pull: pull, eco: eco };
      if (!best || rankOf(cand) > rankOf(best)) best = cand;
    });

    if (!best) {
      push("G2 fillable", false, "no ask returned on either side", "no fillable ask in the returned book");
      push("G3 reversion", false, "no candidate side", "no candidate side");
      push("G4 payoff", false, "no candidate side", "no candidate side");
      push("G5 swing", !!ctx.swing, ctx.swing ? "swing " + ctx.swing.dir : "no swing this cycle", "no swing this cycle");
      return { eligible: false, gates: gates, reason: "no fillable ask", firstFailed: Object.keys(fail)[0] || "" };
    }

    push("G2 fillable", (best.ask.contracts || 0) >= cfg.minContractsAtAsk,
      best.side + " ask " + money(best.ask.price) + " x " + fmtCount(best.ask.contracts) + " contracts (" + best.ask.derived_from + ")",
      "less than " + cfg.minContractsAtAsk + " contract resting at the ask");

    // G3 - mean-reversion lead: the offer sits below what buyers paid on average today.
    push("G3 reversion", best.pull !== null && best.pull >= minPull,
      v ? "session VWAP " + money(v.price) + " over " + fmtCount(v.contracts) + " contracts - ask = " + money(best.pull) +
          ", needs >= " + money(minPull)
        : "no public trades observed in this window, so the VWAP is blank",
      "ask is not below today's traded VWAP by at least " + money(minPull));

    // G4 - fee-adjusted payoff to resolution must clear the threshold.
    var roi = best.eco ? best.eco.roi : null;
    push("G4 payoff", roi !== null && roi >= cfg.minRoi,
      roi === null ? "entry price unusable" :
        "net ROI " + pct(roi) + " per contract (entry " + money(best.ask.price) + ", fee " + money(best.eco.fee) +
        ", payout " + money(best.eco.payoutIfWins) + ", breakeven win probability " + pct(best.eco.breakevenWinProb) + ")",
      "net ROI below " + pct(cfg.minRoi));

    // G5 - the tape trigger itself.
    push("G5 swing", !!ctx.swing,
      ctx.swing ? money(ctx.swing.from) + " -> " + money(ctx.swing.to) + " (" + ctx.swing.dir + " " + money(Math.abs(ctx.swing.delta)) + ")" : "no swing this cycle",
      "no qualifying swing this cycle");

    var eligible = gates.every(function (g) { return g.pass; });
    var depthW = 0.5 + 0.5 * Math.min(1, (best.ask.contracts || 0) / cfg.depthCapContracts);
    var pullW = 1 + Math.min(1, Math.max(0, best.pull || 0) / 0.2);
    var score = eligible && roi !== null ? Math.round(roi * depthW * pullW * 1e4) / 1e4 : null;
    return {
      eligible: eligible, gates: gates,
      side: best.side, entry: best.ask.price, ask_source: best.ask.derived_from,
      contracts_available: best.ask.contracts, roi: roi, pull: best.pull,
      fee: best.eco ? best.eco.fee : null, payout: best.eco ? best.eco.payoutIfWins : null,
      breakeven: best.eco ? best.eco.breakevenWinProb : null,
      score: score,
      reason: eligible ? "all five gates passed" : (fail[Object.keys(fail)[0]] || ""),
      firstFailed: Object.keys(fail)[0] || ""
    };
  }

  function parseIso(s) {
    if (!s) return null;
    var t = Date.parse(s);
    return isNaN(t) ? null : Math.floor(t / 1000);
  }

  function fmtCount(v) {
    var n = num(v);
    if (n === null) return "";
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n * 100) / 100);
  }

  function extend(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (b[k] !== undefined) o[k] = b[k];
    return o;
  }

  // ---------------------------------------------------------------- tape model
  // A tape line is plain data; the renderer turns it into a chat message.
  function makeLine(o) {
    var topics = o.topicLabels || {};
    return {
      id: o.id,
      ts: o.ts,
      kind: o.kind,                       // swing | resolved | info
      topic: o.topic,
      topicLabel: topics[o.topic] || o.topic || "",
      ticker: o.ticker,
      eventTicker: o.eventTicker || "",
      title: o.title || "",
      side: o.side || "",
      from: o.from, to: o.to, delta: o.delta, dir: o.dir || "",
      sourceUrl: o.sourceUrl || "",
      bookUrl: o.bookUrl || "",
      eventUrl: o.eventUrl || "",
      searchQuery: o.searchQuery || "",
      roi: o.roi === undefined ? null : o.roi,
      score: o.score === undefined ? null : o.score,
      result: o.result || "",
      model: o.model || null,
      markKind: o.markKind || "",
      note: o.note || ""
    };
  }

  function dedupeKey(line) { return line.ticker + "|" + line.side + "|" + line.kind + "|" + Math.floor(line.ts / 60); }

  // Snapshot-derived tape: the committed candle history so the page is never empty.
  function swingsFromCandles(entry, threshold) {
    var out = [];
    var windows = (entry && entry.windows) || {};
    Object.keys(windows).forEach(function (wk) {
      var pts = (windows[wk] && windows[wk].points) || [];
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        var pa = num(a.price_close), pb = num(b.price_close);
        var src = "traded close";
        if (pa === null || pb === null) {
          pa = midOf(a); pb = midOf(b); src = "book mid";
        }
        var s = swing(pa, pb, threshold);
        if (!s) continue;
        out.push({
          ts: b.t, ticker: entry.market_ticker, series: entry.series_ticker, window: wk,
          from: pa, to: pb, delta: s.delta, dir: s.dir, source: src,
          sourceUrl: "snapshot/charts.json"
        });
      }
    });
    out.sort(function (x, y) { return x.ts - y.ts; });
    return out;
  }
  function midOf(pt) {
    var b = num(pt && pt.yes_bid_close), a = num(pt && pt.yes_ask_close);
    if (b === null || a === null) return null;
    return Math.round(((a + b) / 2) * 1e4) / 1e4;
  }

  // Topic membership for the public trades tape, from the collector's own published rules.
  function buildTopicIndex(markets) {
    var seriesTopic = {}, byTicker = {}, byEvent = {};
    (markets || []).forEach(function (m) {
      var s = m.series_ticker || seriesOf(m.market_ticker || m.ticker);
      var t = m.topic;
      if (s && t && !seriesTopic[s]) seriesTopic[s] = t;
      var tk = m.market_ticker || m.ticker;
      if (tk) { byTicker[tk] = m; byEvent[tk] = m.event_ticker || ""; }
    });
    return { seriesTopic: seriesTopic, byTicker: byTicker, byEvent: byEvent };
  }

  function topicOfTicker(index, ticker) {
    return index.seriesTopic[seriesOf(ticker)] || null;
  }

  // ---------------------------------------------------------------- ranking
  function topByDollar(markets, perTopic) {
    var byTopic = {};
    (markets || []).forEach(function (m) {
      if (!m.topic) return;
      (byTopic[m.topic] = byTopic[m.topic] || []).push(m);
    });
    var out = [];
    Object.keys(byTopic).forEach(function (t) {
      var rows = byTopic[t].slice().sort(function (a, b) {
        return (dollarOf(b) === null ? -1 : dollarOf(b)) - (dollarOf(a) === null ? -1 : dollarOf(a));
      });
      out = out.concat(rows.slice(0, perTopic));
    });
    return out;
  }
  function dollarOf(m) {
    var n = m && m.dollar_notional_24h && num(m.dollar_notional_24h.value);
    if (n !== null) return n;
    var v = num(m && m.volume_24h_contracts);
    var p = num(m && (m.last_price && m.last_price.value) || m.last_price);
    return v !== null && p !== null ? v * p : null;
  }

  // ---------------------------------------------------------------- polling
  // One cycle = 3 documented requests no matter how many markets are watched.
  function chunk(list, size) {
    var out = [], i;
    for (i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function apiUrl(base, path, params) {
    var q = Object.keys(params || {}).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function (k) {
        var v = params[k];
        if (Array.isArray(v)) return v.map(function (x) { return encodeURIComponent(k) + "=" + encodeURIComponent(x); }).join("&");
        return encodeURIComponent(k) + "=" + encodeURIComponent(v);
      }).join("&");
    return base + path + (q ? (q.indexOf("?") >= 0 ? q : "?" + q) : "");
  }

  return {
    DOC: DOC, DEFAULTS: DEFAULTS,
    num: num, roundUp: roundUp, money: money, pct: pct, clock: clock, iso: iso, nowSec: nowSec,
    seriesOf: seriesOf, parseIso: parseIso, fmtCount: fmtCount, extend: extend,
    takerFee: takerFee, makerFee: makerFee, feeAt: feeAt, sideEconomics: sideEconomics,
    parseLevels: parseLevels, bestBid: bestBid, depthAtOrBetter: depthAtOrBetter, bookSides: bookSides, vwap: vwap,
    swing: swing, markOf: markOf, screen: screen, midOf: midOf,
    makeLine: makeLine, dedupeKey: dedupeKey, swingsFromCandles: swingsFromCandles,
    buildTopicIndex: buildTopicIndex, topicOfTicker: topicOfTicker,
    topByDollar: topByDollar, dollarOf: dollarOf, chunk: chunk, apiUrl: apiUrl
  };
});
