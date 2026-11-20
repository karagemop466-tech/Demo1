/*
 * tape-desk/core.js — all decision logic of the live tape desk, kept DOM-free so it can
 * be unit-tested in node and reused verbatim by the page.
 *
 * Only two things ever enter a bubble or a pick:
 *   1. a number that came from an official Kalshi demo API response (the request URL is
 *      carried with it), and
 *   2. the committed snapshot values this session built into data/watchlist.json.
 * Nothing is inferred. A market whose topic cannot be looked up from the committed
 * series map is counted as OFF-TOPIC and never shown as one of the five topics.
 *
 * Alert rule (the brief): a swing of >= $0.10 in either direction.
 * Pick rule (transparent, published next to every pick): follow-through of the jump at the
 * post-jump price, on the side with a live resting quote, scored with the committed
 * settlement-study band frequency and the official taker fee, requiring a band sample of at
 * least `min_band_n` settled markets. It is a rule, not a forecast.
 */
(function (root, factory) {
  var core = factory();
  root.TapeDeskCore = core;
  if (typeof module === 'object' && module.exports) module.exports = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var THRESHOLD = 0.10;
  var MAX_POINTS = 900;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v));
    return isFinite(n) ? n : null;
  }

  function r4(v) {
    return v === null || v === undefined ? null : Math.round(v * 10000) / 10000;
  }

  /* Official fee schedule (https://kalshi.com/docs/kalshi-fee-schedule.pdf), as implemented
   * and asserted against that schedule's General Trading Fees table by engine/test_engine.py:
   *   taker fee = round up( M x 0.07 x C x P x (1 - P) )   (in cents)                    */
  function takerFeeCent(price, contracts, multiplier) {
    var p = Math.max(0, Math.min(1, num(price) || 0));
    var C = contracts === undefined ? 1 : contracts;
    var M = multiplier === undefined ? 1 : multiplier;
    return Math.ceil(M * 0.07 * C * p * (1 - p) * 100 - 1e-9);
  }

  function money(x) {
    return x === null || x === undefined ? '' : '$' + x.toFixed(2);
  }

  /* A no-bid at x is a yes ask at 1 - x — official order-book page. */
  function levelPrice(lvl) { return num(Array.isArray(lvl) ? lvl[0] : (lvl && (lvl.price !== undefined ? lvl.price : lvl[0]))); }
  function levelSize(lvl) {
    return num(Array.isArray(lvl) ? lvl[1] : (lvl && (lvl.contracts !== undefined ? lvl.contracts : lvl.size)));
  }

  function impliedYesAsks(noBids) {
    var out = [];
    (noBids || []).forEach(function (lvl) {
      var price = levelPrice(lvl);
      var size = levelSize(lvl);
      if (price === null) return;
      out.push([r4(1 - price), size === null ? 0 : size]);
    });
    return out.sort(function (a, b) { return a[0] - b[0]; });
  }

  function yesBidLevels(yesBids) {
    var out = [];
    (yesBids || []).forEach(function (lvl) {
      var price = levelPrice(lvl);
      var size = levelSize(lvl);
      if (price === null) return;
      out.push([price, size === null ? 0 : size]);
    });
    return out.sort(function (a, b) { return b[0] - a[0]; });
  }

  function bestAsk(asks) {
    return asks && asks.length ? asks[0] : null;
  }

  function bestBid(bids) {
    return bids && bids.length ? bids[0] : null;
  }

  function bandFor(price, bandsLiquid, bandsAll, minN) {
    var series = [['liquid_only', bandsLiquid || []], ['all', bandsAll || []]];
    for (var s = 0; s < series.length; s++) {
      var list = series[s][1];
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (b.lo <= price && price <= b.hi && (b.n || 0) >= (minN || 0)) {
          return {
            label: b.label, lo: b.lo, hi: b.hi, n: b.n, yes: b.yes, no: b.no,
            p_yes: b.p_yes, net_roi_pct: b.net_roi_pct, source: series[s][0]
          };
        }
      }
    }
    return null;
  }

  /* Follow-through value of one contract.
   * `price` is always the YES price of the market (the settlement study buckets markets by their
   * YES `last_price_dollars`), while the entry is what the taken side actually costs: a YES costs
   * the YES price, a NO costs $1.00 − YES price. Fee is the official taker formula on the price
   * actually paid (symmetric in P and 1−P, so the two conventions agree). */
  function roiFor(price, side, band) {
    if (band === null || band === undefined) return null;
    var pWin = side === 'no' ? 1 - band.p_yes : band.p_yes;
    var entry = side === 'no' ? 1 - price : price;
    var fee = takerFeeCent(entry) / 100;
    var cost = entry + fee;
    if (!(cost > 0)) return null;
    return (pWin * 1 - cost) / cost;
  }

    /* candles from GET /series/{s}/markets/{t}/candlesticks -> [t, close, yes_bid, yes_ask] */
  function candlePoints(payload) {
    var out = [];
    ((payload && payload.candlesticks) || []).forEach(function (c) {
      var t = c.end_period_ts;
      var close = num(c.price && (c.price.close_dollars !== undefined ? c.price.close_dollars : c.price.close));
      var bid = num(c.yes_bid && (c.yes_bid.close_dollars !== undefined ? c.yes_bid.close_dollars : c.yes_bid.close));
      var ask = num(c.yes_ask && (c.yes_ask.close_dollars !== undefined ? c.yes_ask.close_dollars : c.yes_ask.close));
      if (t === null || t === undefined) return;
      out.push({ t: t, close: close, bid: bid, ask: ask,
                 volume: num(c.volume_fp), open_interest: num(c.open_interest_fp) });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  /* candles also carry swings >= threshold: adjacent closes, never a filled null */
  function candleSwings(points, ticker, requestUrl, thresholdOpt) {
  var threshold = thresholdOpt === undefined ? THRESHOLD : thresholdOpt;
    var found = [];
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1].close, b = points[i].close;
      if (a === null || b === null) continue;
      if (Math.abs(b - a) >= threshold - 1e-9) {
        found.push({ t: points[i].t, ticker: ticker, from: r4(a), to: r4(b),
                     delta: r4(b - a), direction: b > a ? 'up' : 'down', source_url: requestUrl });
      }
    }
    return found;
  }

  /* ------------------------------------------------------------------ engine */
  function createEngine(opts) {
    var meta = (opts && opts.meta) || {};
    var hooks = (opts && opts.hooks) || {};
    var threshold = num(opts && opts.threshold) !== null ? opts.threshold : THRESHOLD;
    var model = meta.model || {};
    var bandsLiquid = model.bands_liquid || model.bands || [];
    var bandsAll = model.bands_all || model.bands || [];
    var minBand = model.min_band_n || 20;
    var seriesTopic = meta.series_topic || {};
    var patterns = meta.topic_patterns || {};
    var ledgerSet = {};
    var watch = {};

    function emit(name, a, b) {
      if (typeof hooks[name] === 'function') hooks[name](a, b);
    }

    /* watchlist: ticker -> {topic, event, series, title, model snapshot} */
    (function loadWatch() {
      var wl = meta.watchlist || {};
      Object.keys(wl).forEach(function (topic) {
        (wl[topic].events || []).forEach(function (ev) {
          (ev.markets || []).forEach(function (m) {
            var t = m.market_ticker;
            watch[t] = {
              topic: topic, topic_label: wl[topic].label, event_ticker: ev.event_ticker,
              event_title: ev.event_title, series_ticker: ev.series_ticker, title: m.title,
              model: m.model || null, snapshot: m.snapshot || {}
            };
            if (m.model && m.model.rule_p_ledger) ledgerSet[t] = true;
          });
        });
      });
    })();

    function topicFor(ticker) {
      var w = watch[ticker];
      if (w) return { topic: w.topic, label: w.topic_label, known: true };
      var series = String(ticker || '').split('-')[0];
      if (seriesTopic[series]) {
        return { topic: seriesTopic[series], label: (meta.topics || {})[seriesTopic[series]] ?
          (meta.topics || {})[seriesTopic[series]].label : seriesTopic[series], known: true };
      }
      var title = (meta.titles && meta.titles[ticker]) || '';
      var keys = Object.keys(patterns);
      for (var i = 0; i < keys.length; i++) {
        var pats = patterns[keys[i]] || [];
        for (var j = 0; j < pats.length; j++) {
          try {
            if (new RegExp(pats[j], 'i').test(series) || (title && new RegExp(pats[j], 'i').test(title))) {
              return { topic: keys[i], label: (meta.topics || {})[keys[i]] ?
                (meta.topics || {})[keys[i]].label : keys[i], known: true, by: 'pattern' };
            }
          } catch (e) { /* a bad pattern can never create a label */ }
        }
      }
      return { topic: null, label: 'off-topic', known: false };
    }

    var markets = {};   // ticker -> state
    var bubbles = [];   // chat 1
    var picks = [];     // chat 2
    var trades = [];    // simulated ledger
    var resolutions = [];
    var counters = { observations: 0, off_topic: 0, sub_threshold: 0, deduped: 0, ignored_no_topic: 0 };
    var seenKeys = {};

    function state(ticker) {
      if (!markets[ticker]) {
        markets[ticker] = {
          ticker: ticker, points: [], last: null, last_basis: {}, title: '',
          quotes: null, model: null, topic: topicFor(ticker), finalized: false,
          trades: 0, requests: []
        };
      }
      return markets[ticker];
    }

    function dedupKey(ticker, from, to, t) {
      return [ticker, (from || 0).toFixed(2), (to || 0).toFixed(2), Math.floor(t / 300)].join('|');
    }

    function scorePick(ticker, price, dir) {
      var st = state(ticker);
      var w = watch[ticker] || {};
      var band = bandFor(price, bandsLiquid, bandsAll, minBand);
      var side = dir === 'up' ? 'yes' : 'no';
      var roi = roiFor(price, side, band);
      var entry = side === 'no' ? r4(1 - price) : r4(price);
      var out = {
        side: side, yes_price: r4(price), entry: entry, fee_cents: takerFeeCent(entry),
        band: band, min_band_n: minBand, expected_roi: roi === null ? null : r4(roi),
        ledger: !!ledgerSet[ticker], reasons: [], pass: false
      };
      if (band === null) {
        out.reasons.push('no settled market band of >= ' + minBand + ' at ' + money(price) + ' — no sample, no pick');
        return out;
      }
      if (roi === null) {
        out.reasons.push('fee-adjusted ROI undefined at this price');
        return out;
      }
      if (!(roi > 0)) {
        out.reasons.push('fee-adjusted expected ROI ' + (roi * 100).toFixed(1) + '% is not positive');
        return out;
      }
      var exec = executability(ticker, side);
      if (!exec.ok) {
        out.reasons.push('not executable: ' + exec.why);
        return out;
      }
      out.pass = true;
      out.entry_exec = exec.price;
      out.fee_exec_cents = takerFeeCent(exec.price);
      out.cost = r4(exec.price + out.fee_exec_cents / 100);
      out.p_win = side === 'no' ? r4(1 - band.p_yes) : r4(band.p_yes);
      out.topic = (st.topic && st.topic.topic) || w.topic || null;
      return out;
    }

    /* Executability comes from the live quote only: a YES buy needs a resting YES ask, a NO
     * buy needs a resting YES bid (that bid is the NO ask). Sizes come from the API, so a
     * stale last-trade price can never pose as a fillable quote. */
    function executability(ticker, side) {
      var st = state(ticker);
      var q = st.quotes;
      if (!q) {
        if (watch[ticker] && watch[ticker].snapshot) {
          var s = watch[ticker].snapshot;
          var ask = num(s.yes_ask), bid = num(s.yes_bid);
          var askSize = num(s.yes_ask_size), bidSize = num(s.yes_bid_size);
          if (side === 'yes') {
            return (ask !== null && (askSize || 0) > 0)
              ? { ok: true, price: ask, basis: 'snapshot book' }
              : { ok: false, why: 'no resting YES ask in the snapshot book' };
          }
          return (bid !== null && (bidSize || 0) > 0)
            ? { ok: true, price: r4(1 - bid), basis: 'snapshot book' }
            : { ok: false, why: 'no resting YES bid (the NO ask) in the snapshot book' };
        }
        return { ok: false, why: 'no quote seen for this market yet' };
      }
      if (side === 'yes') {
        var a = num(q.yes_ask), asz = num(q.yes_ask_size);
        return (a !== null && (asz || 0) > 0)
          ? { ok: true, price: a, size: asz, basis: 'live book' }
          : { ok: false, why: 'YES ask ' + (a === null ? 'absent' : money(a)) +
              ' has ' + (asz === null ? 'unknown' : asz) + ' contracts resting' };
      }
      var b = num(q.yes_bid), bsz = num(q.yes_bid_size);
      return (b !== null && (bsz || 0) > 0)
        ? { ok: true, price: r4(1 - b), size: bsz, basis: 'live book' }
        : { ok: false, why: 'YES bid ' + (b === null ? 'absent' : money(b)) +
            ' has ' + (bsz === null ? 'unknown' : bsz) + ' contracts resting' };
    }

    /* One observation of a market's price. Returns the bubble it created, or null. */
    function observe(ticker, price, t, src, basis, extra) {
      var n = num(price);
      if (n === null || !isFinite(n)) return null;
      var st = state(ticker);
      if (!extra || !extra.internal) st.observations = (st.observations || 0) + 1;
      st.points.push([t, n, basis || 'tape']);
      if (st.points.length > MAX_POINTS) st.points.splice(0, st.points.length - MAX_POINTS);
      if (src) st.requests.push({ t: t, url: src, basis: basis || 'tape' });
      if (st.requests.length > 60) st.requests.splice(0, st.requests.length - 60);
      if (extra && extra.title) st.title = extra.title;
      counters.observations++;
      var basisKey = basis || 'tape';
      /* swings are measured within one price basis, so a trade print and a book mid are
       * never compared with each other (they are different quantities) */
      var prev = st.last_basis[basisKey];
      st.last = n;
      st.last_basis[basisKey] = n;
      if (typeof prev !== 'number') return null;
      var delta = r4(n - prev);
      if (Math.abs(delta) < threshold - 1e-9) {
        counters.sub_threshold++;
        return null;
      }
      var top = topicFor(ticker);
      if (!top.known) {
        counters.off_topic++;
        return null;
      }
      var key = dedupKey(ticker, prev, n, t);
      if (seenKeys[key]) {
        counters.deduped++;
        return null;
      }
      seenKeys[key] = true;
      var dir = delta > 0 ? 'up' : 'down';
      var bubble = {
        id: 'b' + (bubbles.length + 1),
        t: t, ticker: ticker, topic: top.topic, topic_label: top.label,
        title: st.title || (watch[ticker] && watch[ticker].title) || '',
        event_ticker: (watch[ticker] && watch[ticker].event_ticker) || null,
        from: r4(prev), to: r4(n), delta: delta, abs: r4(Math.abs(delta)), direction: dir,
        basis: basis || 'tape', source_url: src || null,
        count: extra && extra.count !== undefined ? extra.count : null,
        side: extra && extra.side ? extra.side : null,
        score: null
      };
      bubble.score = scorePick(ticker, n, dir);
      bubbles.push(bubble);
      emit('onBubble', bubble);
      if (bubble.score && bubble.score.pass) {
        picks.push(bubble);
        emit('onPick', bubble);
        openTrade(bubble);
      }
      return bubble;
    }

    /* A tape page from GET /markets/trades. Newest first in the API response; order is not
     * assumed — each trade is applied by its own created_time so a shuffled page is stable. */
    function ingestTrades(payload, requestUrl) {
      var rows = (payload && payload.trades) || [];
      var applied = 0;
      rows.slice().sort(function (a, b) {
        return Date.parse(a.created_time || 0) - Date.parse(b.created_time || 0);
      }).forEach(function (tr) {
        var ticker = tr.ticker;
        if (!ticker) return;
        var top = topicFor(ticker);
        if (!top.known) return;              // outside the five topics: not shown, not counted as a swing
        var price = num(tr.yes_price_dollars);
        if (price === null) return;
        var t = tr.created_time ? Math.floor(Date.parse(tr.created_time) / 1000) : Math.floor(Date.now() / 1000);
        var st = state(ticker);
        if (t <= (st.lastTradeTs || 0)) return;   // already applied
        st.lastTradeTs = t;
        st.trades++;
        observe(ticker, price, t, requestUrl, 'traded',
          { count: num(tr.count_fp), side: tr.taker_side || null });
        applied++;
      });
      return applied;
    }

    /* A market object from GET /markets/{ticker} or GET /markets. */
    function ingestMarket(m, requestUrl, nowSec) {
      if (!m || !m.ticker) return null;
      var ticker = m.ticker;
      var st = state(ticker);
      st.quotes = {
        last_price: num(m.last_price_dollars), previous_price: num(m.previous_price_dollars),
        yes_bid: num(m.yes_bid_dollars), yes_ask: num(m.yes_ask_dollars),
        yes_bid_size: num(m.yes_bid_size_fp), yes_ask_size: num(m.yes_ask_size_fp),
        no_bid: num(m.no_bid_dollars), no_ask: num(m.no_ask_dollars),
        status: m.status || null, result: m.result || null,
        settlement_value: num(m.settlement_value_dollars), settlement_ts: m.settlement_ts || null,
        close_time: m.close_time || null, updated_time: m.updated_time || null,
        volume_24h: num(m.volume_24h_fp), volume: num(m.volume_fp),
        open_interest: num(m.open_interest_fp), exchange_index: m.exchange_index,
        request_url: requestUrl || null
      };
      st.rules = m.rules_primary || st.rules || '';
      if (m.title) st.title = m.title;
      var t = nowSec === undefined ? Math.floor(Date.now() / 1000) : nowSec;
      var last = num(m.last_price_dollars);
      var prev = num(m.previous_price_dollars);
      if (prev !== null && last !== null && !st.seeded) {
        /* seed the 'exchange previous/last' basis so the first live observation of a market is
         * compared with the exchange's own previous price, not dropped as "no history" */
        st.last_basis = st.last_basis || {};
        if (typeof st.last_basis['last'] !== 'number') st.last_basis['last'] = prev;
        st.points.push([t, prev, 'last (previous print)']);
        if (st.points.length > MAX_POINTS) st.points.splice(0, st.points.length - MAX_POINTS);
      }
      /* The exchange's own previous-vs-last pair is a documented swing signal and is used
       * only when the desk has not seen the market before (no double counting). */
      if (last !== null && prev !== null && !st.seeded) {
        st.seeded = true;
        if (Math.abs(last - prev) >= threshold - 1e-9) {
          var top = topicFor(ticker);
          if (top.known) {
            var key = dedupKey(ticker, prev, last, t);
            if (!seenKeys[key]) {
              seenKeys[key] = true;
              var dir = last > prev ? 'up' : 'down';
              var bubble = {
                id: 'b' + (bubbles.length + 1), t: t, ticker: ticker,
                topic: top.topic, topic_label: top.label, title: st.title || '',
                event_ticker: (watch[ticker] && watch[ticker].event_ticker) || null,
                from: r4(prev), to: r4(last), delta: r4(last - prev),
                abs: r4(Math.abs(last - prev)), direction: dir, basis: 'exchange previous/last',
                source_url: requestUrl || null, count: null, side: null, score: null
              };
              bubble.score = scorePick(ticker, last, dir);
              bubbles.push(bubble);
              emit('onBubble', bubble);
              if (bubble.score && bubble.score.pass) {
                picks.push(bubble);
                emit('onPick', bubble);
                openTrade(bubble);
              }
            }
          }
        }
      }
      if (last !== null) observe(ticker, last, t, requestUrl, 'last', { internal: false });
      if (m.status === 'finalized' && !st.finalized) {
        st.finalized = true;
        var rec = {
          ticker: ticker, title: st.title || (watch[ticker] && watch[ticker].title) || '',
          topic: (topicFor(ticker).topic) || null,
          result: m.result || null, settlement_value: num(m.settlement_value_dollars),
          settlement_ts: m.settlement_ts || null, status: m.status,
          source_url: requestUrl || null, t: t
        };
        resolutions.push(rec);
        emit('onResolution', rec);
        settleTrades(ticker, rec);
      }
      return st;
    }

    /* ------------------------- simulated trading (no orders, ever) --------------------- */
    function openTrade(bubble) {
      var sc = bubble.score;
      if (!sc || !sc.pass) return null;
      for (var i = 0; i < trades.length; i++) {
        if (trades[i].ticker === bubble.ticker && trades[i].status === 'open') return null;
      }
      var entry = sc.entry_exec !== undefined ? sc.entry_exec : sc.entry;
      var fee = (sc.fee_exec_cents !== undefined ? sc.fee_exec_cents : sc.fee_cents) / 100;
      var tr = {
        id: 'T' + (trades.length + 1),
        opened_t: bubble.t, ticker: bubble.ticker, topic: bubble.topic,
        side: sc.side, contracts: 1, entry: r4(entry), fee: r4(fee),
        cost: r4(entry + fee), mark: r4(entry), mark_t: bubble.t,
        realised: null, status: 'open', category: 'swing follow-through',
        band: sc.band ? sc.band.label : null, band_n: sc.band ? sc.band.n : null,
        p_win: sc.p_win, expected_roi: sc.expected_roi,
        trigger: { from: bubble.from, to: bubble.to, delta: bubble.delta, basis: bubble.basis,
                   url: bubble.source_url },
        settlement: null, result: null
      };
      trades.push(tr);
      emit('onTrade', tr);
      return tr;
    }

    function markTrades() {
      trades.forEach(function (tr) {
        if (tr.status !== 'open') return;
        var st = markets[tr.ticker];
        if (!st || st.last === null) return;
        var value = tr.side === 'no' ? r4(1 - st.last) : r4(st.last);
        tr.mark = value;
        tr.mark_t = st.points.length ? st.points[st.points.length - 1][0] : tr.mark_t;
        tr.unrealised = r4(value - tr.cost);
      });
    }

    function settleTrades(ticker, rec) {
      trades.forEach(function (tr) {
        if (tr.ticker !== ticker || tr.status !== 'open') return;
        var payout = null;
        if (rec.settlement_value !== null && rec.settlement_value !== undefined) {
          payout = rec.settlement_value;
        } else if (rec.result === 'yes') {
          payout = 1;
        } else if (rec.result === 'no') {
          payout = 0;
        }
        if (payout === null) {
          tr.status = 'pending-settlement-value';
          tr.settlement_note = 'finalized without a settlement_value_dollars in the response — left blank';
          return;
        }
        /* A YES contract pays settlement_value_dollars; a NO contract pays 1 - that value
         * (settlement page: $1 per winning contract). */
        var received = tr.side === 'no' ? r4(1 - payout) : r4(payout);
        tr.settlement_value = r4(payout);
        tr.received = received;
        tr.result = rec.result || null;
        tr.settlement_ts = rec.settlement_ts || null;
        tr.settlement_url = rec.source_url || null;
        tr.realised = r4(received - tr.cost);
        tr.status = 'settled';
        tr.roi = tr.cost > 0 ? r4(tr.realised / tr.cost) : null;
      });
      markTrades();
    }

    function stats() {
      var settled = trades.filter(function (t) { return t.status === 'settled'; });
      var open = trades.filter(function (t) { return t.status === 'open'; });
      var wins = settled.filter(function (t) { return (t.realised || 0) > 0; }).length;
      var net = 0, cost = 0;
      settled.forEach(function (t) { net += t.realised || 0; cost += t.cost || 0; });
      var unreal = 0;
      open.forEach(function (t) { unreal += (t.unrealised || 0); });
      function group(key) {
        var g = {};
        settled.forEach(function (t) {
          var k = t[key] || 'unclassified';
          g[k] = g[k] || { n: 0, wins: 0, net: 0, cost: 0 };
          g[k].n++;
          g[k].net += t.realised || 0;
          g[k].cost += t.cost || 0;
          if ((t.realised || 0) > 0) g[k].wins++;
        });
        Object.keys(g).forEach(function (k) {
          g[k].net = r4(g[k].net);
          g[k].roi_pct = g[k].cost > 0 ? r4((g[k].net / g[k].cost) * 100) : null;
          g[k].win_rate = g[k].n ? r4(g[k].wins / g[k].n) : null;
        });
        return g;
      }
      return {
        trades: trades.length, settled: settled.length, open: open.length,
        wins: wins, losses: settled.length - wins,
        net: r4(net), cost: r4(cost),
        roi_pct: cost > 0 ? r4((net / cost) * 100) : null,
        unrealised: r4(unreal),
        by_topic: group('topic'), by_band: group('band'), by_category: group('category')
      };
    }

    function pointsFor(ticker, sinceSec) {
      var st = markets[ticker];
      if (!st) return [];
      return st.points.filter(function (p) { return p[0] >= sinceSec; });
    }

    return {
      threshold: threshold,
      counters: counters,
      markets: markets,
      bubbles: bubbles,
      picks: picks,
      trades: trades,
      resolutions: resolutions,
      watch: watch,
      observe: observe,
      ingestTrades: ingestTrades,
      ingestMarket: ingestMarket,
      markTrades: markTrades,
      stats: stats,
      scorePick: scorePick,
      executability: executability,
      topicFor: topicFor,
      candlePoints: candlePoints,
      candleSwings: function (pts, ticker, url) { return candleSwings(pts, ticker, url, threshold); },
      pointsFor: pointsFor,
      takerFeeCent: takerFeeCent,
      impliedYesAsks: impliedYesAsks,
      yesBidLevels: yesBidLevels,
      bandFor: bandFor,
      roiFor: roiFor,
      num: num,
      money: money
    };
  }

  return {
    THRESHOLD: THRESHOLD,
    num: num,
    r4: r4,
    money: money,
    takerFeeCent: takerFeeCent,
    impliedYesAsks: impliedYesAsks,
    yesBidLevels: yesBidLevels,
    bestAsk: bestAsk,
    bestBid: bestBid,
    bandFor: bandFor,
    roiFor: roiFor,
    candlePoints: candlePoints,
    candleSwings: candleSwings,
    createEngine: createEngine
  };
});
