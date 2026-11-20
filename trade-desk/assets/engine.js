/* trade-desk/assets/engine.js — the analysis layer.
 *
 * Everything here is a pure function over official API payloads, so the DOM
 * tests exercise exactly the code the browser runs. Nothing in this file fetches.
 *
 *   JumpScanner   turns the official trades tape into contract-price jumps of at
 *                 least JUMP_THRESHOLD ($0.10) in either direction, per market.
 *   score()       the "model likes this" filter. It is a published, auditable
 *                 score with no hidden inputs; every term is shown in the UI.
 *   PaperTrader   simulated fills at the official implied ask, official taker
 *                 fee, settlement at $1/$0 when the API reports a result.
 *
 * Why jumps come from trades and not candles: GET /markets/{t}/candlesticks
 * rejects anything but 1/60/1440-minute periods
 * (https://docs.kalshi.com/api-reference/market/get-market-candlesticks) and the
 * demo returns empty candle arrays for the active markets checked on 2026-11-20.
 * The trades tape is the only official source with sub-minute timestamps
 * (https://docs.kalshi.com/api-reference/market/get-trades).
 */
(function (root) {
  "use strict";
  var TD = root.TD;

  var JUMP_THRESHOLD = 0.10;      /* brief: >= $0.10 either direction */
  /* Price comparisons happen in integer mills (1/1000 of a dollar), never in
   * floating-point dollars: 0.60 - 0.50 evaluates to 0.09999999999999998 in
   * IEEE 754, which would silently drop a genuine $0.10 move. The brief's
   * threshold is inclusive, so a move of exactly 100 mills fires and 99 mills
   * does not. */
  var THRESHOLD_EPS = 1e-9;

  function mills(dollars) {
    return Math.round(Number(dollars) * 1000);
  }

  /* Keep the exact fixed-point strings the API sent and compare those, so no
   * float ever enters the decision. `move` is only used for display. */
  function millsFromStrings(a, b) {
    function scale(str) {
      var parts = String(str).split(".");
      var frac = (parts[1] || "").padEnd(3, "0").slice(0, 3);
      return Number(parts[0]) * 1000 + Number(frac);
    }
    return Math.abs(scale(a) - scale(b));
  }

  function reachesThreshold(moveDollars, thresholdDollars) {
    /* used for float inputs (tests, UI); exact-string callers use millsFromStrings */
    return mills(moveDollars) >= mills(thresholdDollars) && Math.abs(Math.abs(moveDollars) - Math.abs(thresholdDollars)) >= 0
      ? Math.abs(moveDollars) >= Math.abs(thresholdDollars) - 1e-9
      : false;
  }
  var DEFAULT_WINDOW_MIN = 15;    /* look-back used for "sudden" */
  var MAX_MARKETS_SCORED = 60;    /* keep the alert loop cheap and rate-limit safe */

  /* ------------------------------------------------------------------ jumps
   * scanTrades(trades, {threshold, windowMs, now}) → jumps[]
   *
   * A jump is the difference between the FIRST and LAST traded YES price inside
   * a rolling window for one market, reported when |Δ| >= threshold. Each jump
   * carries the exact trades that bound it, so the chat row can link to evidence.
   * A market whose window contains only one trade cannot produce a jump: with a
   * single print there is no movement to measure, and this is counted, not
   * guessed at.
   */
  function scanTrades(trades, opts) {
    opts = opts || {};
    var threshold = opts.threshold === undefined ? JUMP_THRESHOLD : opts.threshold;
    var now = opts.now || Date.now();
    var windowMs = opts.windowMs || 15 * 60 * 1000;

    var byTicker = {};
    (trades || []).forEach(function (t) {
      var price = TD.num(t.yes_price_dollars);
      var ts = new Date(t.created_time).getTime();
      if (price === null || !isFinite(ts)) return;
      if (now - ts > windowMs) return;
      (byTicker[t.ticker] = byTicker[t.ticker] || []).push({
        /* keep BOTH representations: `price` for display maths, `priceStr` for
         * the exact threshold comparison */
        ts: ts, price: price, priceStr: String(t.yes_price_dollars),
        count: TD.num(t.count_fp) || 0,
        id: t.trade_id, time: t.created_time, ticker: t.ticker
      });
    });

    var out = [];
    Object.keys(byTicker).forEach(function (ticker) {
      var rows = byTicker[ticker].sort(function (a, b) { return a.ts - b.ts; });
      if (rows.length < 2) return;
      var first = rows[0];
      var last = rows[rows.length - 1];
      /* Peak-to-trough inside the window is reported separately from open→close:
       * a market that spiked and retraced still moved >= $0.10 and a trader
       * watching it needed to know. */
      var hi = rows[0], lo = rows[0];
      rows.forEach(function (r) {
        if (r.price > hi.price) hi = r;
        if (r.price < lo.price) lo = r;
      });
      /* Two official measurements of "sudden swing" inside the window:
       *   net  = last traded price − first traded price
       *   peak = highest traded price − lowest traded price
       * A spike-and-retrace has a small net move but a large peak move, and a
       * trader watching the book needed to see it, so the row reports whichever
       * is larger. `mode` says which one produced the alert. */
      var openClose = last.price - first.price;
      var range = hi.price - lo.price;
      var move, mode, fromRow, toRow;
      if (Math.abs(openClose) >= range) {
        move = openClose;
        mode = "net";
        fromRow = first;
        toRow = last;
      } else {
        move = lo.ts <= hi.ts ? range : -range;
        mode = "peak";
        fromRow = move >= 0 ? lo : hi;
        toRow = move >= 0 ? hi : lo;
      }
      /* Exact comparison on the API's own fixed-point strings, so no float ever
       * decides whether an alert fires. */
      if (millsFromStrings(toRow.priceStr, fromRow.priceStr) < mills(threshold)) return;
      var from = fromRow.price, to = toRow.price;
      var volume = rows.reduce(function (s, r) { return s + r.count; }, 0);
      var notional = rows.reduce(function (s, r) { return s + r.count * r.price; }, 0);
      out.push({
        ticker: ticker,
        from: from,
        to: last.price,
        delta: openClose,
        move: move,
        mode: mode,
        peak: range,
        first_ts: first.ts,
        last_ts: last.ts,
        first_time: first.time,
        last_time: last.time,
        seconds: Math.max(0, Math.round((last.ts - first.ts) / 1000)),
        trades: rows.length,
        contracts: volume,
        notional: notional,
        source: TD.apiUrl("/markets/trades?ticker=" + encodeURIComponent(ticker)),
        tape: rows
      });
    });
    out.sort(function (a, b) { return b.last_ts - a.last_ts; });
    return out;
  }

  /* ------------------------------------------------------------- the model
   * score(market, ctx) → {score, roi, terms[], reasons[], flags[]}
   *
   * A deliberately simple, fully disclosed rule. The "model likes it" feed is
   * NOT an alpha claim: it is a screen that prefers markets where a $0.10 move
   * has just happened, the spread is tight enough to enter and exit within the
   * move, the book is deep enough to fill a small size, and the price has room
   * left to the $1 settlement cap. Weights are listed in WEIGHTS and printed on
   * the page so anyone can recompute a row by hand.
   *
   * maxRoi = (1 / entryAsk) - 1 is the return on a winning $1 settlement,
   * ignoring fees — the conventional prediction-market "max payout" figure, so a
   * 20¢ contract shows +400%.
   * netRoi = pnl_on_win / cost, where pnl_on_win = (1 − entryAsk) − feePerContract
   * and cost = entryAsk + feePerContract. This is the number the screen filters
   * on, because a fee of 2¢ on a 20¢ contract materially changes the return.
   * Both are the WIN case, not an expected value; the page labels them as such.
   */
  var WEIGHTS = {
    move: 30,        /* size of the last qualifying jump, capped at $0.30 */
    spread: 25,      /* tightness of the bid/ask, in cents */
    depth: 20,       /* resting contracts at the touch */
    room: 15,        /* distance from entry to the $1 cap */
    freshness: 10    /* how recently the jump printed */
  };

  function score(market, ctx) {
    ctx = ctx || {};
    var jump = ctx.jump || null;
    var book = ctx.book || null;
    var feeMultiplier = ctx.feeMultiplier === undefined ? 1 : ctx.feeMultiplier;
    var terms = [];
    var reasons = [];
    var flags = [];

    var ask = ctx.ask !== undefined && ctx.ask !== null ? ctx.ask : TD.num(market && market.yes_ask_dollars);
    var bid = ctx.bid !== undefined && ctx.bid !== null ? ctx.bid : TD.num(market && market.yes_bid_dollars);
    if (ask !== null && ask <= 0) { ask = null; flags.push("no YES ask"); }
    if (bid !== null && bid <= 0) bid = null;
    var ladder = book ? TD.ladder(book) : null;
    var spread = (ask !== null && bid !== null) ? Math.max(0, ask - bid) : null;
    var touchSize = null;
    if (ladder) touchSize = ladder.bestYesAskSize !== null ? ladder.bestYesAskSize : ladder.bestYesBidSize;

    var movePts = 0;
    if (jump) {
      var m = Math.min(1, Math.abs(jump.move) / 0.30);
      movePts = m * WEIGHTS.move;
      terms.push({ name: "Jump size", weight: WEIGHTS.move, value: TD.signedCents(jump.move), pts: movePts, why: "|move| / $0.30, capped" });
      reasons.push("printed " + TD.signedCents(jump.move) + " in " + jump.seconds + "s");
    } else {
      terms.push({ name: "Jump size", weight: WEIGHTS.move, value: "none in window", pts: 0, why: "no qualifying jump" });
    }

    if (spread !== null) {
      var s = Math.max(0, 1 - spread / 0.10);   /* 0¢ spread → full points, 10¢ → none */
      var sp = s * WEIGHTS.spread;
      terms.push({ name: "Spread", weight: WEIGHTS.spread, value: TD.cents(spread, 1), pts: sp, why: "1 − spread/10¢" });
      if (spread <= 0.02) reasons.push("tight " + TD.cents(spread, 1) + " spread");
    } else {
      terms.push({ name: "Spread", weight: WEIGHTS.spread, value: "one side missing", pts: 0, why: "needs a two-sided quote" });
      flags.push("one-sided quote");
    }

    if (touchSize !== null) {
      var d = Math.min(1, touchSize / 200);
      var dp = d * WEIGHTS.depth;
      terms.push({ name: "Depth at touch", weight: WEIGHTS.depth, value: TD.contracts(touchSize) + "ct", pts: dp, why: "contracts / 200 at the touch" });
      if (touchSize >= 100) reasons.push(TD.contracts(touchSize) + " contracts resting");
    } else {
      terms.push({ name: "Depth at touch", weight: WEIGHTS.depth, value: "from quote size", pts: 0, why: "no book fetched" });
    }

    var roomPts = 0;
    if (ask !== null && ask > 0 && ask < 1) {
      roomPts = Math.min(1, (1 - ask)) * WEIGHTS.room;
      terms.push({ name: "Room to $1", weight: WEIGHTS.room, value: TD.cents(1 - ask), pts: roomPts, why: "1 − entry ask" });
    } else {
      terms.push({ name: "Room to $1", weight: WEIGHTS.room, value: "n/a", pts: 0, why: "no entry price" });
    }

    var freshPts = 0;
    if (jump) {
      var ageMin = Math.max(0, ((ctx.now || Date.now()) - jump.last_ts) / 60000);
      freshPts = Math.max(0, 1 - ageMin / 15) * WEIGHTS.freshness;
      terms.push({ name: "Freshness", weight: WEIGHTS.freshness, value: Math.round(ageMin) + "m old", pts: freshPts, why: "1 − age/15m" });
    } else {
      terms.push({ name: "Freshness", weight: WEIGHTS.freshness, value: "n/a", pts: 0, why: "needs a jump" });
    }

    var total = terms.reduce(function (sum, t) { return sum + t.pts; }, 0);
    var netRoi = null, maxRoi = null, feePer = null;
    if (ask !== null && ask > 0 && ask < 1) {
      feePer = TD.fee(1, ask, feeMultiplier);
      netRoi = ((1 - ask) - feePer) / (ask + feePer);
      maxRoi = 1 / ask - 1;
    }

    return {
      score: Math.round(total * 10) / 10,
      maxScore: WEIGHTS.move + WEIGHTS.spread + WEIGHTS.depth + WEIGHTS.room + WEIGHTS.freshness,
      roi: netRoi,
      netRoi: netRoi,
      maxRoi: maxRoi,
      entryAsk: ask,
      feePerContract: feePer,
      spread: spread,
      touchSize: touchSize,
      terms: terms,
      reasons: reasons,
      flags: flags
    };
  }

  /* A "high ROI" row must clear an explicit bar; the numbers are printed. */
  var SELECT_BAR = { minScore: 55, minRoi: 0.25, maxAsk: 0.85 };

  function isHighRoi(scored) {
    if (!scored) return false;
    if (scored.entryAsk === null || scored.entryAsk <= 0) return false;
    if (scored.entryAsk > SELECT_BAR.maxAsk) return false;
    return scored.score >= SELECT_BAR.minScore && scored.roi !== null && scored.roi >= SELECT_BAR.minRoi;
  }

  /* ---------------------------------------------------------------- alerts
   * Alert rows power the two scrolling chats. They are plain objects so the
   * same row can be tested without a DOM.
   *
   * kind: "jump" (feed A) | "selected" (feed B) | "resolve" (both) | "info"
   */
  function jumpAlert(jump, market, topic, ctx) {
    ctx = ctx || {};
    var title = (market && (market.title || market.yes_sub_title)) || jump.ticker;
    return {
      id: "jump:" + jump.ticker + ":" + jump.last_ts + ":" + jump.move.toFixed(2),
      kind: "jump",
      at: jump.last_time,
      ts: jump.last_ts,
      topic: topic,
      ticker: jump.ticker,
      event_ticker: market ? market.event_ticker : null,
      title: title,
      message: TD.signedCents(jump.move) + " to " + TD.cents(jump.to) + " (" +
        jump.trades + " trades/" + jump.seconds + "s) · " + title,
      from: jump.from,
      to: jump.to,
      move: jump.move,
      evidence: jump.source,
      venue: market ? TD.marketUrl(market.ticker, market.event_ticker) : null,
      news: TD.newsSearch(title),
      sources: ctx.settlementLinks || []
    };
  }

  function selectedAlert(jump, market, topic, scored, ctx) {
    ctx = ctx || {};
    var title = (market && (market.title || market.yes_sub_title)) || jump.ticker;
    return {
      id: "sel:" + jump.ticker + ":" + jump.last_ts,
      kind: "selected",
      at: jump.last_time,
      ts: jump.last_ts,
      topic: topic,
      ticker: jump.ticker,
      event_ticker: market ? market.event_ticker : null,
      title: title,
      message: "SCREEN " + scored.score.toFixed(0) + "/100 · max ROI " + TD.pct(scored.roi, 0) +
        " at " + TD.cents(scored.entryAsk, 1) + " · " + scored.reasons.join(" · ") + " — " + title,
      from: jump.from,
      to: jump.to,
      move: jump.move,
      score: scored.score,
      roi: scored.roi,
      entryAsk: scored.entryAsk,
      feePerContract: scored.feePerContract,
      terms: scored.terms,
      reasons: scored.reasons,
      flags: scored.flags,
      evidence: jump.source,
      venue: market ? TD.marketUrl(market.ticker, market.event_ticker) : null,
      news: TD.newsSearch(title),
      sources: ctx.settlementLinks || []
    };
  }

  function resolveAlert(market, topic, ctx) {
    ctx = ctx || {};
    var result = (market && market.result) || "";
    var yes = result === "yes";
    return {
      id: "resolve:" + (market && market.ticker) + ":" + (market && market.settlement_ts),
      kind: "resolve",
      at: (market && market.settlement_ts) || ctx.now || new Date().toISOString(),
      ts: market && market.settlement_ts ? new Date(market.settlement_ts).getTime() : Date.now(),
      topic: topic,
      ticker: market.ticker,
      event_ticker: market.event_ticker,
      title: market.title || market.yes_sub_title,
      resolved: result,
      message: "RESOLVED " + (result ? result.toUpperCase() : "?") + (yes ? " · YES paid $1.00" : result === "no" ? " · NO paid $1.00" : "") + " — " + (market.title || market.yes_sub_title),
      settlement_value: TD.num(market.settlement_value_dollars),
      evidence: TD.apiUrl("/markets?tickers=" + encodeURIComponent(market.ticker)),
      venue: TD.marketUrl(market.ticker, market.event_ticker),
      news: TD.newsSearch((market.title || "") + " result"),
      sources: ctx.settlementLinks || []
    };
  }

  /* ---------------------------------------------------------- paper trading
   * PaperTrader keeps its ledger in localStorage. Fills are always TAKER fills at
   * the implied YES ask, because that is the side a new buyer actually pays. The
   * official fee formula is applied per fill. Settlement uses the API's own
   * result/status fields; nothing is settled by assumption.
   */
  var LEDGER_KEY = "tradeDesk.ledger.v1";

  function emptyLedger() {
    return {
      version: 1,
      created_at: new Date().toISOString(),
      starting_cash: 1000,
      cash: 1000,
      positions: {},       /* ticker → {ticker, side, contracts, entry_ask, entry_fee, opened_at, topic, strategy, title, event_ticker, max_roi, score} */
      trades: [],          /* every fill and settlement, append-only */
      marks: []            /* [{at, equity}] equity curve, newest last */
    };
  }

  function getStore(store) {
    if (store) return store;
    try { return root.localStorage; } catch (e) { return null; }
  }

  function loadLedger(store) {
    var s = getStore(store);
    if (!s) return emptyLedger();
    try {
      var raw = s.getItem(LEDGER_KEY);
      if (!raw) return emptyLedger();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return emptyLedger();
      return parsed;
    } catch (e) {
      return emptyLedger();
    }
  }

  function saveLedger(ledger, store) {
    var s = getStore(store);
    if (!s) return false;
    try { s.setItem(LEDGER_KEY, JSON.stringify(ledger)); return true; } catch (e) { return false; }
  }

  function openPosition(ledger, order, opts) {
    opts = opts || {};
    var contracts = Math.floor(TD.num(order.contracts) || 0);
    if (!contracts || contracts < 1) return { ok: false, error: "contracts must be a whole number of at least 1" };
    var ask = TD.num(order.ask);
    if (ask === null || ask <= 0 || ask >= 1) return { ok: false, error: "no tradable ask (the YES ask must be between $0.01 and $0.99)" };
    if (ledger.positions[order.ticker]) return { ok: false, error: "a paper position in " + order.ticker + " is already open" };

    var fee = TD.fee(contracts, ask, opts.feeMultiplier === undefined ? 1 : opts.feeMultiplier);
    var cost = contracts * ask + fee;
    if (cost > ledger.cash + 1e-9) {
      return { ok: false, error: "not enough paper cash: needs " + TD.money(cost) + ", have " + TD.money(ledger.cash) };
    }
    ledger.cash = Math.round((ledger.cash - cost) * 100) / 100;
    var pos = {
      ticker: order.ticker,
      event_ticker: order.event_ticker || null,
      title: order.title || order.ticker,
      topic: order.topic || null,
      strategy: order.strategy || "manual",
      side: "yes",
      contracts: contracts,
      entry_ask: ask,
      entry_fee: fee,
      entry_cost: Math.round(cost * 100) / 100,
      opened_at: opts.now || new Date().toISOString(),
      max_roi: order.max_roi === undefined ? null : order.max_roi,
      score: order.score === undefined ? null : order.score,
      evidence: order.evidence || null
    };
    ledger.positions[pos.ticker] = pos;
    ledger.trades.push({
      id: TD.uuid(), kind: "open", at: pos.opened_at, ticker: pos.ticker, side: "yes",
      contracts: contracts, price: ask, fee: fee, cash_delta: -Math.round(cost * 100) / 100,
      topic: pos.topic, strategy: pos.strategy, title: pos.title,
      max_roi: pos.max_roi, score: pos.score, evidence: pos.evidence
    });
    return { ok: true, position: pos };
  }

  /* Settle one position at the official settlement value. Default $1 / $0 for a
   * simple yes/no result; scalar results use settlement_value_dollars because
   * the market's own payout is not necessarily a full dollar. */
  function settlePosition(ledger, ticker, market, opts) {
    opts = opts || {};
    var pos = ledger.positions[ticker];
    if (!pos) return { ok: false, error: "no open paper position in " + ticker };
    var status = market && market.status;
    var result = market && market.result;
    if (!result || (status !== "finalized" && status !== "determined" && status !== "disputed" && status !== "amended")) {
      return { ok: false, error: "market has no settlement result yet (status " + (status || "unknown") + ")" };
    }
    var payoutPer;
    if (result === "yes") payoutPer = 1;
    else if (result === "no") payoutPer = 0;
    else if (result === "scalar") payoutPer = TD.num(market.settlement_value_dollars);
    else return { ok: false, error: "unrecognised result '" + result + "'" };
    if (payoutPer === null) return { ok: false, error: "scalar result without settlement_value_dollars" };

    var gross = pos.contracts * payoutPer;
    var fee = TD.fee(pos.contracts, 0, 1); /* settlement fee is zero (fee schedule, Settlement Fees) */
    var net = gross - fee;
    var pnl = net - pos.entry_cost;
    ledger.cash = Math.round((ledger.cash + net) * 100) / 100;
    delete ledger.positions[ticker];
    var row = {
      id: TD.uuid(), kind: "settle", at: (market && market.settlement_ts) || opts.now || new Date().toISOString(),
      ticker: ticker, side: "yes", result: result, contracts: pos.contracts,
      entry_ask: pos.entry_ask, payout_per: payoutPer, fee: fee,
      gross: Math.round(gross * 100) / 100, net: Math.round(net * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      roi: pos.entry_cost ? pnl / pos.entry_cost : null,
      topic: pos.topic, strategy: pos.strategy, title: pos.title,
      score: pos.score, max_roi: pos.max_roi, evidence: pos.evidence
    };
    ledger.trades.push(row);
    return { ok: true, trade: row };
  }

  function equity(ledger, marks) {
    var openValue = 0;
    Object.keys(ledger.positions).forEach(function (t) {
      var p = ledger.positions[t];
      var mark = marks && marks[t] !== undefined ? marks[t] : p.entry_ask;
      openValue += p.contracts * mark;
    });
    return Math.round((ledger.cash + openValue) * 100) / 100;
  }

  function recordMark(ledger, at) {
    var eq = equity(ledger);
    var last = ledger.marks[ledger.marks.length - 1];
    if (last && Math.abs(last.equity - eq) < 0.005 && ledger.marks.length > 1) return ledger.marks;
    ledger.marks.push({ at: at || new Date().toISOString(), equity: eq });
    if (ledger.marks.length > 2000) ledger.marks = ledger.marks.slice(-2000);
    return ledger.marks;
  }

  /* Performance rollups: by strategy, by topic, by side, by entry-price band. */
  function bands(price) {
    if (price === null || price === undefined) return "unknown";
    var p = Number(price);
    if (p < 0.15) return "$0.00–0.14";
    if (p < 0.35) return "$0.15–0.34";
    if (p < 0.65) return "$0.35–0.64";
    if (p < 0.85) return "$0.65–0.84";
    return "$0.85–1.00";
  }

  function performance(ledger) {
    var settled = ledger.trades.filter(function (t) { return t.kind === "settle"; });
    var opened = ledger.trades.filter(function (t) { return t.kind === "open"; });
    var wins = settled.filter(function (t) { return t.pnl > 0; });
    var losses = settled.filter(function (t) { return t.pnl < 0; });
    var realized = settled.reduce(function (s, t) { return s + t.pnl; }, 0);
    var invested = settled.reduce(function (s, t) { return s + (t.entry_ask * t.contracts + (t.fee || 0)); }, 0);
    var fees = opened.reduce(function (s, t) { return s + (t.fee || 0); }, 0) +
               settled.reduce(function (s, t) { return s + (t.fee || 0); }, 0);

    function group(keyFn) {
      var map = {};
      settled.forEach(function (t) {
        var k = keyFn(t) || "unknown";
        var g = map[k] || (map[k] = { key: k, n: 0, wins: 0, pnl: 0, invested: 0, best: 0, worst: 0 });
        g.n += 1;
        if (t.pnl > 0) g.wins += 1;
        g.pnl += t.pnl;
        g.invested += t.entry_ask * t.contracts + (t.fee || 0);
        if (t.pnl > g.best) g.best = t.pnl;
        if (t.pnl < g.worst) g.worst = t.pnl;
      });
      return Object.keys(map).sort().map(function (k) {
        var g = map[k];
        return {
          key: k, n: g.n, wins: g.wins, winRate: g.n ? g.wins / g.n : null,
          pnl: Math.round(g.pnl * 100) / 100,
          roi: g.invested ? g.pnl / g.invested : null,
          best: Math.round(g.best * 100) / 100, worst: Math.round(g.worst * 100) / 100
        };
      });
    }

    return {
      equity: equity(ledger),
      cash: ledger.cash,
      starting_cash: ledger.starting_cash,
      open: Object.keys(ledger.positions).length,
      opened: opened.length,
      settled: settled.length,
      wins: wins.length,
      losses: losses.length,
      winRate: settled.length ? wins.length / settled.length : null,
      realized: Math.round(realized * 100) / 100,
      invested: Math.round(invested * 100) / 100,
      realizedRoi: invested ? realized / invested : null,
      fees: Math.round(fees * 100) / 100,
      byStrategy: group(function (t) { return t.strategy; }),
      byTopic: group(function (t) { return t.topic; }),
      bySide: group(function (t) { return t.side; }),
      byBand: group(function (t) { return bands(t.entry_ask); }),
      byResult: group(function (t) { return t.result; }),
      rows: settled.slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); })
    };
  }

  /* Strategies the paper trader can run. Each is a rule over the SAME model
   * output, so the comparison isolates the sizing/selection choice. */
  var STRATEGIES = [
    {
      id: "jump-momentum",
      name: "Jump momentum",
      rule: "Buy YES when a ≥$0.10 up-jump prints and the screen clears the bar; exit on settlement.",
      select: function (ctx) { return ctx.jump && ctx.jump.move >= 0.10 && isHighRoi(ctx.scored); }
    },
    {
      id: "jump-fade",
      name: "Jump fade",
      rule: "Buy YES on a ≥$0.10 DOWN-jump when the screen still clears the bar (buy the dip).",
      select: function (ctx) { return ctx.jump && ctx.jump.move <= -0.10 && isHighRoi(ctx.scored); }
    },
    {
      id: "cheap-longshot",
      name: "Cheap longshot",
      rule: "Buy YES only when the ask is ≤ $0.20 and the screen clears the bar.",
      select: function (ctx) { return ctx.scored && ctx.scored.entryAsk !== null && ctx.scored.entryAsk <= 0.20 && isHighRoi(ctx.scored); }
    },
    {
      id: "balanced",
      name: "Balanced",
      rule: "Buy YES for any qualifying screen (no direction filter).",
      select: function (ctx) { return isHighRoi(ctx.scored); }
    }
  ];

  function strategyById(id) {
    for (var i = 0; i < STRATEGIES.length; i++) if (STRATEGIES[i].id === id) return STRATEGIES[i];
    return null;
  }

  root.Engine = {
    JUMP_THRESHOLD: JUMP_THRESHOLD,
    DEFAULT_WINDOW_MIN: DEFAULT_WINDOW_MIN,
    MAX_MARKETS_SCORED: MAX_MARKETS_SCORED,
    WEIGHTS: WEIGHTS,
    SELECT_BAR: SELECT_BAR,
    LEDGER_KEY: LEDGER_KEY,
    STRATEGIES: STRATEGIES,
    scanTrades: scanTrades,
    reachesThreshold: reachesThreshold,
    mills: mills,
    THRESHOLD_EPS: THRESHOLD_EPS,
    score: score,
    isHighRoi: isHighRoi,
    jumpAlert: jumpAlert,
    selectedAlert: selectedAlert,
    resolveAlert: resolveAlert,
    emptyLedger: emptyLedger,
    loadLedger: loadLedger,
    saveLedger: saveLedger,
    openPosition: openPosition,
    settlePosition: settlePosition,
    equity: equity,
    recordMark: recordMark,
    performance: performance,
    bands: bands,
    strategyById: strategyById
  };
  if (typeof module === "object" && module.exports) module.exports = root.Engine;
})(typeof globalThis !== "undefined" ? globalThis : this);
