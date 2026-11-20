/*
 * kalshi.js — engine for the Kalshi demo dashboard.
 *
 * Pure functions only (no DOM, no fetch side effects except in `net`), so every
 * non-trivial rule in this file is unit-tested in tests/kalshi.test.mjs.
 *
 * Verification discipline:
 *   - Field names/semantics come from the live demo API responses recorded in
 *     data/snapshot.json and from https://docs.kalshi.com (links in `SOURCES`).
 *   - Where the API does not provide something (e.g. dollar volume), this file
 *     computes an estimate and labels it as such. It never invents a value:
 *     absent/empty fields stay null and are rendered as "—" with an unverified flag.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.Kalshi = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ----------------------------------------------------------------- *
   * 1. Endpoints (verbatim from the official docs, see SOURCES[0])
   * ----------------------------------------------------------------- */
  const BASES = [
    {
      id: "demo-external",
      env: "demo",
      label: "Demo — external REST (recommended)",
      rest: "https://external-api.demo.kalshi.co/trade-api/v2",
      ws: "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
      verified: true,
    },
    {
      id: "demo-shared",
      env: "demo",
      label: "Demo — shared host (also supported)",
      rest: "https://demo-api.kalshi.co/trade-api/v2",
      ws: "wss://demo-api.kalshi.co/trade-api/ws/v2",
      verified: false, // documented as supported; not exercised in this session
    },
    {
      id: "prod-external",
      env: "production",
      label: "Production — external REST",
      rest: "https://external-api.kalshi.com/trade-api/v2",
      ws: "wss://external-api-ws.kalshi.com/trade-api/ws/v2",
      verified: false,
    },
    {
      id: "prod-shared",
      env: "production",
      label: "Production — shared host (also supported)",
      rest: "https://api.elections.kalshi.com/trade-api/v2",
      ws: "wss://api.elections.kalshi.com/trade-api/ws/v2",
      verified: false,
    },
  ];

  const SOURCES = {
    demoEnv: "https://docs.kalshi.com/getting_started/demo_env",
    quickStartOrder: "https://docs.kalshi.com/getting_started/quick_start_create_order",
    markets: "https://docs.kalshi.com/api-reference/market/get-markets.md",
    events: "https://docs.kalshi.com/api-reference/events/get-events.md",
    seriesList: "https://docs.kalshi.com/api-reference/market/get-series-list.md",
    candlesticks: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md",
    orderbook: "https://docs.kalshi.com/getting_started/orderbook_responses.md",
    feeSchedule: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    websocket: "https://docs.kalshi.com/websockets/websocket-connection",
    apiKeys: "https://docs.kalshi.com/getting_started/api_keys",
    rateLimits: "https://docs.kalshi.com/getting_started/rate_limits",
    pagination: "https://docs.kalshi.com/getting_started/pagination",
    historical: "https://docs.kalshi.com/getting_started/historical_data",
  };

  /* ----------------------------------------------------------------- *
   * 2. Fixed-point helpers — the API returns decimal *strings*
   * ----------------------------------------------------------------- */

  /** Parse an API fixed-point/dollar string. Empty, null, or garbage -> null. */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }

  /** Read a possibly nested field ("orderbook_fp.yes_dollars") without throwing. */
  function path(obj, dotted) {
    return dotted.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
  }

  const usd = (n, dp = 2) => (n === null || n === undefined ? "—" : "$" + Number(n).toFixed(dp));
  const cents = (n) => (n === null || n === undefined ? "—" : (n * 100).toFixed(1) + "¢");
  const count = (n) =>
    n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const pct = (n) => (n === null || n === undefined ? "—" : (n * 100).toFixed(1) + "%");

  const centicentCeil = (dollars) => Math.ceil(Math.round(dollars * 1e8) / 1e6) / 100;

  /**
   * Kill binary-float noise on money. 100 * 0.29 evaluates to 28.999999999999996,
   * which is unacceptable in a P&L column, so every computed dollar amount is
   * normalised to micro-dollar precision before it is rounded for display.
   */
  const money = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);

  /* ----------------------------------------------------------------- *
   * 3. Kalshi's published fee model
   *    fees = roundup(M x 0.07 x C x P x (1-P))          (taker)
   *    fees = roundup(M x 0.0175 x C x P x (1-P))        (maker)
   *    Source: official fee schedule, SOURCES.feeSchedule.
   *    tests/kalshi.test.mjs reproduces 8 rows of the published table.
   * ----------------------------------------------------------------- */
  const FEE_COEFF = { taker: 0.07, maker: 0.0175 };

  function tradeFee({ contracts, price, multiplier = 1, role = "taker" }) {
    const c = num(contracts);
    const p = num(price);
    if (!c || p === null || p < 0 || p > 1) return null;
    const m = num(multiplier);
    if (m === null) return null;
    const coeff = FEE_COEFF[role];
    if (coeff === undefined) return null;
    return centicentCeil(m * coeff * c * p * (1 - p));
  }

  /** Total cost to buy `contracts` YES at `price`, incl. taker fee (payout $1/contract). */
  function buyCost({ contracts, price, multiplier = 1, role = "taker" }) {
    const c = num(contracts);
    const p = num(price);
    if (!c || p === null) return null;
    const fee = tradeFee({ contracts: c, price: p, multiplier, role });
    const position = money(c * p);
    const total = fee === null ? null : money(position + fee);
    return {
      positionCost: position,
      fee: fee === null ? null : fee,
      total,
      maxPayout: c,
      breakevenPrice: total === null ? null : money(total / c),
      edgeAtFair: null,
    };
  }

  /* ----------------------------------------------------------------- *
   * 4. Topic taxonomy — the five topics the brief asks for
   * ----------------------------------------------------------------- */
  const TOPICS = [
    {
      id: "gas-prices",
      label: "Gas prices",
      seriesPrefixes: ["KXAAAGAS"],
      categories: ["Economics"],
      keywords: ["gas price", "gas prices", "gasoline", "aaa national", "diesel price", "pump price"],
    },
    {
      id: "elections",
      label: "Elections",
      seriesPrefixes: [],
      categories: ["Elections"],
      tags: ["US Elections", "Primaries", "Referendums", "Senate", "Midterms"],
      keywords: [
        "election", "ballot", "senate", "house majority", "governor", "mayor", "nominee",
        "primary", "president", "midterm", "approval", "debate", "confirm", "majority",
      ],
    },
    {
      id: "culture",
      label: "Culture",
      seriesPrefixes: [],
      categories: ["Culture"],
      keywords: [
        "oscar", "academy award", "best picture", "box office", "time person", "person of the year",
        "grammy", "emmy", "album", "box-office", "rotten tomatoes", "grossing", "banned",
      ],
    },
    {
      id: "crypto",
      label: "Crypto",
      seriesPrefixes: ["KXBTC", "KXETH", "KXSOL", "KXXRP", "KXDOGE", "KXCRYPTO", "BTC", "ETH"],
      categories: ["Crypto"],
      keywords: ["bitcoin", "btc", "ethereum", "solana", "xrp", "dogecoin", "crypto", "stablecoin", "altcoin"],
    },
    {
      id: "golf",
      label: "Golf",
      seriesPrefixes: ["KXPGA", "KXGOLF", "KXMASTERS", "KXUSOPEN"],
      categories: ["Sports"],
      tags: ["Golf"],
      keywords: ["golf", "pga", "ryder cup", "masters", "open championship", "tour championship", "lpga"],
    },
  ];

  const topicById = (id) => TOPICS.find((t) => t.id === id) || null;

  /**
   * Assign a topic, recording HOW it was decided so the UI can show confidence.
   * Priority: series-ticker prefix (exact, stable) > tag > explicit category > keyword.
   * Returns { topic, basis } or null when nothing matches.
   */
  function classifyTopic(entity) {
    if (!entity) return null;
    const series = String(entity.series_ticker || entity.ticker || "").toUpperCase();
    const text = [entity.title, entity.sub_title, entity.event_ticker, entity.series_ticker]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const cats = [entity.category].concat(entity.categories || []).filter(Boolean);
    const tags = (entity.tags || []).map((t) => String(t).toLowerCase());

    for (const t of TOPICS) {
      if (series && t.seriesPrefixes.some((p) => series.startsWith("KX" + p.replace(/^KX/, "")))) {
        return { topic: t.id, basis: "series-prefix" };
      }
    }
    for (const t of TOPICS) {
      if (t.tags && t.tags.some((tag) => tags.includes(tag.toLowerCase()))) {
        return { topic: t.id, basis: "series-tag" };
      }
    }
    // Golf is a tag under the Sports category; check before generic category rules.
    if (cats.includes("Sports") && tags.includes("golf")) return { topic: "golf", basis: "series-tag" };
    for (const t of TOPICS) {
      if (t.categories.some((c) => cats.includes(c))) {
        // A Sports category alone is not golf, and Economics alone is not gas prices.
        if (t.id === "golf" || t.id === "gas-prices") {
          if (t.keywords.some((k) => text.includes(k))) return { topic: t.id, basis: "category+keyword" };
          continue;
        }
        return { topic: t.id, basis: "category" };
      }
    }
    for (const t of TOPICS) {
      if (t.keywords.some((k) => text.includes(k))) return { topic: t.id, basis: "keyword" };
    }
    return null;
  }

  /* ----------------------------------------------------------------- *
   * 5. Market / event metrics
   * ----------------------------------------------------------------- */

  /** Best two-sided YES quote, or null when one side is missing (no NBBO). */
  function quote(market) {
    const bid = num(market.yes_bid_dollars);
    const ask = num(market.yes_ask_dollars);
    const bidSize = num(market.yes_bid_size_fp);
    const askSize = num(market.yes_ask_size_fp);
    const noBid = num(market.no_bid_dollars);
    const out = {
      bid,
      ask,
      bidSize,
      askSize,
      spread: bid !== null && ask !== null ? ask - bid : null,
      mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
      // Implied YES ask from the best NO bid, per the binary reciprocal rule.
      impliedAskFromNo: noBid !== null ? 1 - noBid : null,
      twoSided: !(ask >= 1 && bid <= 0),
    };
    return out;
  }

  /**
   * Kalshi's market payload reports contract counts only (volume_fp), so dollar
   * turnover must be derived. This is an ESTIMATE: it uses the last traded price,
   * while true turnover is the sum over fills. Documented in flagged.html FL-1.
   */
  function turnoverEstimate(market) {
    const vol = num(market.volume_fp);
    const px = num(market.last_price_dollars) ?? num(market.yes_bid_dollars);
    if (vol === null || px === null || !vol) return null;
    return money(vol * px);
  }

  function marketOutcome(market) {
    const r = String(market.result || "").toLowerCase();
    return r === "yes" || r === "no" ? r : null;
  }

  function marketIsResolved(market) {
    return marketOutcome(market) !== null || market.status === "finalized";
  }

  /** Event-level resolution state: an event is done only when every market is done. */
  function eventResolution(event) {
    const markets = event.markets || [];
    const settled = markets.filter(marketIsResolved);
    const pending = markets.filter((m) => !marketIsResolved(m)).map((m) => m.ticker);
    const yes = settled.filter((m) => marketOutcome(m) === "yes").length;
    const no = settled.filter((m) => marketOutcome(m) === "no").length;
    const lastTs = settled.map((m) => m.settlement_ts).filter(Boolean).sort().slice(-1)[0] || null;
    return {
      totalMarkets: markets.length,
      settled: settled.length,
      yes,
      no,
      pending,
      complete: markets.length > 0 && pending.length === 0,
      lastSettlementTs: lastTs,
      // The event endpoint can return a still-open event whose markets are finalized.
      mixedState: settled.length > 0 && pending.length > 0,
    };
  }

  /**
   * Mutually-exclusive (MECNET) events must sum to $1. Deviation is a tradeable
   * signal; `sumYesAsk < 1` means buying every YES leg locks a guaranteed payout.
   */
  function mecMispricing(event) {
    if (!event || event.mutually_exclusive !== true) return null;
    const legs = (event.markets || []).map((m) => num(m.yes_ask_dollars));
    if (legs.some((v) => v === null)) return null;
    const sumAsk = legs.reduce((a, b) => a + b, 0);
    const bids = (event.markets || []).map((m) => num(m.yes_bid_dollars));
    const sumBid = bids.reduce((a, b) => a + b, 0);
    return {
      legs: legs.length,
      sumYesAsk: sumAsk,
      sumYesBid: sumBid,
      // buying all legs costs sumAsk each paying $1 -> profit 1 - sumAsk (before fees)
      buyAllEdge: 1 - sumAsk,
      sellAllEdge: sumBid - 1,
    };
  }

  function eventMetrics(event) {
    const markets = event.markets || [];
    const turnover = markets.map(turnoverEstimate);
    const known = turnover.filter((v) => v !== null);
    const res = eventResolution(event);
    const vols = markets.map((m) => num(m.volume_fp)).filter((v) => v !== null);
    const oi = markets.map((m) => num(m.open_interest_fp)).filter((v) => v !== null);
    const v24 = markets.map((m) => num(m.volume_24h_fp)).filter((v) => v !== null);
    const sizes = markets
      .map((m) => quote(m))
      .map((q) => (q.bidSize === null && q.askSize === null ? null : (q.bidSize || 0) + (q.askSize || 0)))
      .filter((v) => v !== null);
    // Never present a partial sum as if it were the whole event: if any market's
    // volume was not captured, the total is flagged as a floor, not a figure.
    const partial = known.length > 0 && known.length < markets.length;
    const dollarVolumeEstimate = known.length === 0 ? null : money(known.reduce((a, b) => a + b, 0));
    return {
      dollarVolumeEstimate,
      dollarVolumeIsFloor: partial,
      contracts: vols.length ? money(vols.reduce((a, b) => a + b, 0)) : null,
      contracts24h: v24.length ? money(v24.reduce((a, b) => a + b, 0)) : null,
      openInterest: oi.length ? money(oi.reduce((a, b) => a + b, 0)) : null,
      topOfBookContracts: sizes.length ? money(sizes.reduce((a, b) => a + b, 0)) : null,
      marketsTracked: markets.length,
      turnoverCovered: known.length,
      incompleteTurnover: known.length < markets.length,
      resolution: res,
      mec: mecMispricing(event),
      closeTime: markets.map((m) => m.close_time).filter(Boolean).sort().slice(-1)[0] || null,
    };
  }

  /** Rank events by estimated dollar volume, highest first; nulls sink to the bottom. */
  function rankEvents(events, opts) {
    const o = opts || {};
    const rows = (events || []).map((e) => {
      const cls = o.preclassified ? { topic: e.topic, basis: "snapshot" } : classifyTopic(e);
      return { event: e, topic: cls ? cls.topic : null, basis: cls ? cls.basis : null, metrics: eventMetrics(e) };
    });
    const filtered = o.topics && o.topics.length ? rows.filter((r) => o.topics.includes(r.topic)) : rows;
    filtered.sort((a, b) => {
      const av = a.metrics.dollarVolumeEstimate;
      const bv = b.metrics.dollarVolumeEstimate;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return typeof o.limit === "number" ? filtered.slice(0, o.limit) : filtered;
  }

  /* ----------------------------------------------------------------- *
   * 6. Order book -> depth ladder ("how many contracts at a given price")
   *    Shape + semantics per SOURCES.orderbook:
   *    orderbook_fp.yes_dollars / .no_dollars are [price_dollars, count_fp]
   *    string pairs, ascending, best bid LAST. Empty arrays also mean
   *    "unknown ticker" (200, never 404) - cross-check GET /markets/{ticker}.
   * ----------------------------------------------------------------- */
  function ladder(book) {
    const yes = (path(book, "orderbook_fp.yes_dollars") || []).map((l) => ({ price: num(l[0]), contracts: num(l[1]) }));
    const no = (path(book, "orderbook_fp.no_dollars") || []).map((l) => ({ price: num(l[0]), contracts: num(l[1]) }));
    const byPrice = new Map();
    const put = (side, lvl) => {
      if (!lvl || lvl.price === null) return;
      const key = lvl.price.toFixed(4);
      if (!byPrice.has(key)) byPrice.set(key, { price: lvl.price, yesBid: 0, noBid: 0 });
      const row = byPrice.get(key);
      if (side === "yes") row.yesBid += lvl.contracts || 0;
      else row.noBid += lvl.contracts || 0;
    };
    yes.forEach((l) => put("yes", l));
    no.forEach((l) => put("no", l));
    const rows = [...byPrice.values()].sort((a, b) => a.price - b.price);
    // Running depth: YES buyers below, NO buyers above (a NO bid at Y is a YES ask at 1-Y).
    let cumYes = 0;
    rows.forEach((r) => {
      cumYes += r.yesBid;
      r.cumYesBid = cumYes;
      r.impliedYesAsk = 1 - r.price;
    });
    let cumNo = 0;
    [...rows].reverse().forEach((r) => {
      cumNo += r.noBid;
      r.cumNoBid = cumNo;
    });
    const best = {
      yesBid: yes.length ? yes[yes.length - 1] : null,
      noBid: no.length ? no[no.length - 1] : null,
    };
    return {
      rows,
      bestYesBid: best.yesBid ? best.yesBid.price : null,
      bestNoBid: best.noBid ? best.noBid.price : null,
      bestYesAsk: best.noBid ? 1 - best.noBid.price : null,
      yesSpreadContracts: yes.reduce((a, l) => a + (l.contracts || 0), 0),
      noSpreadContracts: no.reduce((a, l) => a + (l.contracts || 0), 0),
      empty: rows.length === 0,
    };
  }

  /** Contracts resting at a specific price level (both sides). */
  function atPrice(lad, price) {
    const key = Number(price).toFixed(4);
    const row = (lad.rows || []).find((r) => r.price.toFixed(4) === key);
    return row ? { yesBid: row.yesBid, noBid: row.noBid, total: row.yesBid + row.noBid } : { yesBid: 0, noBid: 0, total: 0 };
  }

  /**
   * Walk the book for a market order and return the average fill price, the
   * slippage vs the touch, and the fee — the numbers a trader actually needs.
   */
  function walkBook(lad, { side = "buy", outcome = "yes", contracts = 1 }) {
    const want = num(contracts);
    if (!want || want <= 0) return null;
    let levels;
    if (outcome === "yes" && side === "buy") {
      // consume NO bids from the top down (each is a YES ask at 1 - price)
      levels = (lad.rows || [])
        .slice()
        .sort((a, b) => b.price - a.price)
        .map((r) => ({ price: 1 - r.price, contracts: r.noBid }));
    } else if (outcome === "yes" && side === "sell") {
      // A resting seller takes the HIGHEST YES bids first (best execution).
      levels = (lad.rows || []).slice().sort((a, b) => b.price - a.price).map((r) => ({ price: r.price, contracts: r.yesBid }));
    } else if (outcome === "no" && side === "buy") {
      // A NO ask is implied by a YES bid: NO ask = 1 - YES bid, so the best NO ask
      // comes from the HIGHEST YES bid.
      levels = (lad.rows || []).slice().sort((a, b) => b.price - a.price).map((r) => ({ price: 1 - r.price, contracts: r.yesBid }));
    } else {
      levels = (lad.rows || [])
        .slice()
        .sort((a, b) => b.price - a.price)
        .map((r) => ({ price: r.price, contracts: r.noBid }));
    }
    let left = want;
    let notional = 0;
    const fills = [];
    for (const lvl of levels) {
      if (left <= 0) break;
      if (!lvl.contracts || lvl.contracts <= 0) continue;
      const take = Math.min(left, lvl.contracts);
      notional += take * lvl.price;
      left -= take;
      fills.push({ price: lvl.price, contracts: take });
    }
    const filled = want - left;
    const touch = filled > 0 ? fills[0].price : null;
    const avg = filled > 0 ? money(notional / filled) : null;
    return {
      side,
      outcome,
      requested: want,
      filled,
      unfilled: left,
      fullyFillable: left === 0,
      notional: money(notional),
      averagePrice: avg,
      touchPrice: money(touch),
      slippage: avg !== null && touch !== null ? money(side === "buy" ? avg - touch : touch - avg) : null,
      fee: avg !== null ? tradeFee({ contracts: filled, price: avg, multiplier: 1, role: "taker" }) : null,
      fills,
    };
  }

  /* ----------------------------------------------------------------- *
   * 7. Time series: candlesticks + granularity selection
   *    GET /series/{series}/markets/{ticker}/candlesticks accepts
   *    period_interval in {1, 60, 1440} MINUTES only (SOURCES.candlesticks),
   *    so "seconds" cannot come from REST. Seconds-level charts need the
   *    authenticated WebSocket feed (ticker / trade / cfbenchmarks_value_5hz).
   * ----------------------------------------------------------------- */
  const GRANULARITIES = [
    {
      id: "seconds",
      label: "Seconds",
      periodInterval: null,
      supported: false,
      bucketSeconds: 60,
      note: "REST candlesticks have no sub-minute period. Use WS channel cfbenchmarks_value_5hz (5 Hz) or trade/ticker updates, or bucket /trades timestamps.",
    },
    { id: "minutes", label: "Minutes", periodInterval: 1, supported: true, bucketSeconds: 60 },
    { id: "hours", label: "Hours", periodInterval: 60, supported: true, bucketSeconds: 3600 },
    { id: "days", label: "Days", periodInterval: 1440, supported: true, bucketSeconds: 86400 },
  ];

  const granularity = (id) => GRANULARITIES.find((g) => g.id === id) || null;

  /** Build a candlestick URL and validate it the way the API will. */
  function candlestickUrl({ base, seriesTicker, ticker, startTs, endTs, granularityId })
  {
    const g = granularity(granularityId || "minutes");
    if (!g) return { error: "unknown granularity" };
    if (!g.supported) return { error: g.note };
    if (!Number.isInteger(startTs) || !Number.isInteger(endTs)) return { error: "start_ts/end_ts must be integer Unix SECONDS" };
    if (startTs > 1e11 || endTs > 1e11) return { error: "millisecond timestamps are rejected with 400 bad_request" };
    if (endTs <= startTs) return { error: "end_ts must be after start_ts" };
    const periods = ((endTs - startTs) / 60) * 1;
    const periodCount = Math.floor((endTs - startTs) / (g.periodInterval * 60));
    if (periodCount > 5000) {
      return { error: `range needs ${periodCount} periods; the API caps one request at 5000 - split the range` };
    }
    const q = new URLSearchParams({
      start_ts: String(startTs),
      end_ts: String(endTs),
      period_interval: String(g.periodInterval),
    });
    return {
      url: `${base}/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`,
      periodInterval: g.periodInterval,
      periodCount,
    };
  }

  /** Resample candles to a coarser bucket (also how a seconds view is faked safely). */
  function resample(candles, bucketSeconds) {
    const src = (candles || []).filter((c) => c && typeof c.end_period_ts === "number");
    const out = new Map();
    for (const c of src) {
      const end = c.end_period_ts - (c.end_period_ts % bucketSeconds);
      const o = num(path(c, "price.open_dollars"));
      const h = num(path(c, "price.high_dollars"));
      const l = num(path(c, "price.low_dollars"));
      const cl = num(path(c, "price.close_dollars"));
      const v = num(c.volume_fp);
      const openInt = num(c.open_interest_fp);
      if (!out.has(end)) {
        out.set(end, {
          end_period_ts: end,
          open: o, high: h, low: l, close: cl,
          volume: v || 0, openInterest: openInt, samples: 1,
        });
        continue;
      }
      const b = out.get(end);
      b.high = [b.high, h].filter((x) => x !== null).reduce((a, x) => Math.max(a, x), -Infinity);
      b.low = [b.low, l].filter((x) => x !== null).reduce((a, x) => Math.min(a, x), Infinity);
      if (cl !== null) b.close = cl;
      if (b.open === null && o !== null) b.open = o;
      b.volume += v || 0;
      b.openInterest = openInt !== null ? openInt : b.openInterest;
      b.samples += 1;
    }
    return [...out.values()].sort((a, b) => a.end_period_ts - b.end_period_ts);
  }

  /** Aggregate public trade records into fixed-seconds buckets (sub-minute view). */
  function tradesToBuckets(trades, seconds) {
    const size = Math.max(1, Math.floor(seconds || 1));
    const map = new Map();
    for (const t of trades || []) {
      const ms = t.created_time ? Date.parse(t.created_time) : null;
      if (!ms) continue;
      const sec = Math.floor(ms / 1000);
      const bucket = sec - (sec % size);
      const p = num(t.yes_price_dollars ?? t.price);
      const c = num(t.count ?? t.contracts);
      if (!map.has(bucket)) map.set(bucket, { ts: bucket, turnover: 0, contracts: 0, last: null, trades: 0 });
      const b = map.get(bucket);
      if (p !== null) {
        b.turnover += p * (c || 0);
        b.contracts += c || 0;
        b.last = p;
      }
      b.trades += 1;
    }
    return [...map.values()]
      .sort((a, b) => a.ts - b.ts)
      .map((b) => ({ ...b, averagePrice: b.contracts ? b.turnover / b.contracts : null }));
  }

  /* ----------------------------------------------------------------- *
   * 8. Chart geometry (pure maths; app.js only paints it)
   * ----------------------------------------------------------------- */
  function niceTicks(min, max, target) {
    const span = max - min || 1;
    const rough = span / Math.max(1, target || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  /** Map a series of {x,y} points into an SVG viewBox with axis ticks. */
  function chartScales(points, { width = 860, height = 300, padL = 52, padR = 12, padT = 14, padB = 26, yDomain } = {}) {
    const xs = points.map((p) => p.x).filter((v) => typeof v === "number" && isFinite(v));
    const ys = points.map((p) => p.y).filter((v) => typeof v === "number" && isFinite(v));
    if (!xs.length || !ys.length) return null;
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = yDomain ? yDomain[0] : Math.min(...ys);
    const yMax = yDomain ? yDomain[1] : Math.max(...ys);
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const spanX = xMax - xMin || 1;
    const spanY = yMax - yMin || 1;
    return {
      width, height, padL, padR, padT, padB, plotW, plotH,
      xMin, xMax, yMin, yMax,
      x: (v) => padL + ((v - xMin) / spanX) * plotW,
      y: (v) => padT + plotH - ((v - yMin) / spanY) * plotH,
      yTicks: niceTicks(yMin, yMax, 5),
      xTicks: niceTicks(xMin, xMax, 6),
      path(pts) {
        let d = "";
        let pen = false;
        for (const p of pts) {
          if (typeof p.y !== "number" || !isFinite(p.y)) { pen = false; continue; }
          d += (pen ? " L" : " M") + this.x(p.x).toFixed(2) + " " + this.y(p.y).toFixed(2);
          pen = true;
        }
        return d.trim();
      },
    };
  }

  /* ----------------------------------------------------------------- *
   * 9. Request layer — resilient, CORS-aware, never silently fake
   * ----------------------------------------------------------------- */
  async function fetchJson(url, { timeoutMs = 9000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const json = await res.json();
      return { ok: true, status: res.status, data: json, fetchedAt: new Date().toISOString() };
    } catch (err) {
      // A blocked CORS read and a network failure look identical to JS: opaque TypeError.
      return { ok: false, status: 0, error: String(err && err.message ? err.message : err), kind: "network-or-cors" };
    } finally {
      clearTimeout(timer);
    }
  }

  function buildUrl(base, route, params) {
    const u = base + route;
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    });
    const s = q.toString();
    return s ? `${u}?${s}` : u;
  }

  /**
   * Cursor pagination exactly as documented: pass the returned cursor back
   * unchanged and stop when it is empty. Deduplicate by event_ticker because a
   * close-time reordering during paging can repeat or skip rows (SOURCES.markets).
   */
  async function scanEvents({ base, status = "open", maxPages = 5, pageSize = 200, onProgress } = {}) {
    const seen = new Map();
    let cursor = "";
    let pages = 0;
    let lastError = null;
    for (let i = 0; i < maxPages; i += 1) {
      const url = buildUrl(base, "/events", {
        limit: pageSize,
        status,
        with_nested_markets: "true",
        cursor: cursor || undefined,
      });
      const res = await fetchJson(url);
      if (!res.ok) { lastError = res.error; break; }
      pages += 1;
      const data = res.data || {};
      for (const ev of data.events || []) if (!seen.has(ev.event_ticker)) seen.set(ev.event_ticker, ev);
      if (onProgress) onProgress({ page: pages, events: seen.size });
      if (!data.cursor) break;
      cursor = data.cursor;
    }
    return { events: [...seen.values()], pages, error: lastError };
  }

  /* ----------------------------------------------------------------- *
   * 10. Strategy taxonomy + trade classification
   * ----------------------------------------------------------------- */
  const STRATEGIES = [
    {
      id: "favorite-drift",
      label: "Favorite convergence",
      theme: "mean-reversion",
      hypothesis: "High-probability contracts (0.90-0.99) drift toward $1.00 as the resolution clock runs down.",
      entry: "last_price_dollars >= 0.90 AND close_time within 72h AND open_interest_fp > 500",
      exit: "settlement (payout 1.00) or price >= 0.99",
      dataNeeded: ["last_price_dollars", "close_time", "open_interest_fp", "volume_fp"],
      risks: "Tail risk: one late fact flips 0.95 to 0. Fee at 0.95 is small (0.07xPx(1-P)) but edge per contract is ~0.04.",
      observableNow: true,
    },
    {
      id: "longshot-decay",
      label: "Longshot time decay",
      theme: "theta / short-bias",
      hypothesis: "Contracts under 5c decay toward zero on a known clock; selling them harvests decay.",
      entry: "last_price_dollars <= 0.05 AND no two-sided improvement AND time to close > 1h",
      exit: "buy back <= 0.01 or market resolves no",
      dataNeeded: ["last_price_dollars", "yes_bid_dollars", "close_time", "volume_24h_fp"],
      risks: "Requires margin and the ability to hold a short; a surprise flip costs the full dollar.",
      observableNow: true,
    },
    {
      id: "resolution-snipe",
      label: "Determination lag capture",
      theme: "event-driven",
      hypothesis: "Outcome is publicly certain before the exchange settles; Kalshi rules allow accelerated determination once media project a winner.",
      entry: "market.status == 'active' AND an official source is already decisive",
      exit: "settlement_ts within minutes of entry",
      dataNeeded: ["status", "result", "settlement_ts", "settlement_timer_seconds", "rules_primary"],
      risks: "Rules ambiguity; the price is usually already at 0.99. Needs a real news feed to detect the lag.",
      observableNow: true,
    },
    {
      id: "crypto-15m-momentum",
      label: "Short-horizon crypto momentum",
      theme: "momentum",
      hypothesis: "15-minute up/down series (KXBTC15M) reprice as the index walks the strike; the candle tape shows the decay inside the window.",
      entry: "underlying 15m return sign + remaining time > 5m",
      exit: "close_time (auto-settles; settlement_timer_seconds = 1 observed)",
      dataNeeded: ["floor_strike", "expiration_value", "occurrence_datetime", "candlesticks"],
      risks: "Needs the CF Benchmarks BRTI print used by the rules, not an exchange spot price; fee multiplier 1 taker.",
      observableNow: false,
      blockedBy: "Underlying index stream requires the authenticated WS channel cfbenchmarks_value_5hz",
    },
    {
      id: "maker-spread",
      label: "Spread provision",
      theme: "market-making",
      hypothesis: "Where the top of book is one-sided, a resting order earns the 0.0175 maker coefficient instead of the 0.07 taker coefficient.",
      entry: "quote.spread >= 0.02 OR quote.twoSided == false",
      exit: "fill or cancel before close_time",
      dataNeeded: ["orderbook depth ladder", "spread", "queue position (portfolio API)"],
      risks: "Adverse selection on fast-resolving markets; queue position requires auth.",
      observableNow: false,
      blockedBy: "Queue-position and order endpoints require an API key",
    },
    {
      id: "gas-strike-ladder",
      label: "Strike ladder vs daily print",
      theme: "macro/data-driven",
      hypothesis: "KXAAAGASM strikes sit on a public daily input (AAA national average), so the distance to strike is observable all month.",
      entry: "AAA average vs floor_strike gap, priced against time remaining",
      exit: "month-end settlement (settlement_timer_seconds 300 observed)",
      dataNeeded: ["floor_strike", "strike_type", "last_price_dollars", "settlement source AAA"],
      risks: "Series fee multipliers are 1/1 (maker 1, taker 1) per the official schedule, so no maker rebate here.",
      observableNow: true,
    },
    {
      id: "mec-basket",
      label: "Mutually-exclusive basket check",
      theme: "arbitrage / mispricing",
      hypothesis: "In a MECNET event the YES legs must sum to $1; a sum below $1 across asks is a covered basket.",
      entry: "mec.sumYesAsk < 1.00 after fees",
      exit: "event resolution pays exactly one leg",
      dataNeeded: ["collateral_return_type", "mutually_exclusive", "yes_ask_dollars per leg"],
      risks: "Requires filling every leg at once; partial fills leave naked exposure.",
      observableNow: true,
    },
  ];

  const TRADE_AXES = [
    { axis: "Direction", values: "YES or NO", derivedFrom: "order side + outcome_side", note: "order direction is expressed by outcome_side/book_side on v2 responses" },
    { axis: "Role", values: "maker or taker", derivedFrom: "whether the order rested before filling", note: "fee coefficient differs (0.0175 vs 0.07) so the role changes P&L" },
    { axis: "Horizon", values: "<1h, 1-24h, 1-7d, >7d", derivedFrom: "close_time - open_time of the position", note: "demo cadence series (15m/hourly/daily) make short horizons observable" },
    { axis: "Topic", values: TOPICS.map((t) => t.id).join(", "), derivedFrom: "series_ticker / series categories", note: "classification basis is recorded per row" },
    { axis: "Price bucket", values: "longshot <=0.05, mid, favorite >=0.90", derivedFrom: "last_price_dollars at entry", note: "needed because the fee curve and payoff skew are price-dependent" },
    { axis: "Intent", values: STRATEGIES.map((s) => s.id).join(", "), derivedFrom: "strategy tag applied at order placement", note: "store the tag in client_order_id so it survives on fills" },
    { axis: "Liquidity context", values: "top-of-book contracts at entry", derivedFrom: "orderbook ladder + yes_bid_size_fp", note: "separates thin-print fills from real two-sided liquidity" },
    { axis: "Outcome", values: "yes / no / open", derivedFrom: "market result field after settlement", note: "settlement_value_dollars 1.0000 or 0.0000 confirms the payout" },
  ];

  /**
   * Categorise a fill/order record into the axes above.
   * `horizon` is the trader's holding window: time from ENTRY to market close.
   * Pass ctx.openTime only when you mean the market's own lifespan instead.
   */
  function categorizeTrade(trade, ctx) {
    const t = trade || {};
    const c = ctx || {};
    const price = num(t.price ?? t.yes_price_dollars);
    const from = c.entryTime || c.openTime;
    const to = c.closeTime || c.marketCloseTime;
    const horizonSecs = from && to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))
      ? (Date.parse(to) - Date.parse(from)) / 1000
      : null;
    const horizon =
      horizonSecs === null ? "unknown"
      : horizonSecs < 3600 ? "<1h"
      : horizonSecs < 86400 ? "1-24h"
      : horizonSecs < 604800 ? "1-7d" : ">7d";
    const bucket = price === null ? "unknown" : price <= 0.05 ? "longshot" : price >= 0.9 ? "favorite" : "mid";
    return {
      direction: t.outcome_side || t.side || "unknown",
      role: t.role || (t.taker ? "taker" : "unknown"),
      horizon,
      topic: c.topic || "unknown",
      priceBucket: bucket,
      intent: c.strategy || "unlabelled",
      liquidity: c.topOfBookContracts === undefined ? null : c.topOfBookContracts,
      outcome: c.result || "open",
    };
  }

  /** Deterministic paper-trade P&L: one contract per record, $1 payout on the winning side. */
  function positionPnl({ side, entryPrice, contracts, result, fee }) {
    const p = num(entryPrice);
    const n = num(contracts);
    const f = num(fee) || 0;
    if (p === null || !n) return null;
    const won = result === "yes" || result === "no";
    if (!won) return { markToMarket: -n * p - f, realised: null, status: "open" };
    const payoutSide = side === "yes" || side === "bid" ? (result === "yes" ? 1 : 0) : result === "no" ? 1 : 0;
    const gross = payoutSide * n;
    const realised = money(gross - n * p - f);
    return { markToMarket: realised, realised, status: "settled", payoutPerContract: payoutSide };
  }

  /* ----------------------------------------------------------------- *
   * 11. Portfolio maths (demo account is mock money, so no liquidation logic)
   * ----------------------------------------------------------------- */
  function portfolioView(positions, balanceCents) {
    const rows = (positions || []).map((p) => {
      const size = num(p.size_fp ?? p.size ?? p.contracts);
      const cost = num(p.entry_price_dollars ?? p.price);
      const mark = num(p.mark_price_dollars ?? cost);
      const pnl = size !== null && cost !== null && mark !== null ? money(size * (mark - cost)) : null;
      return { ...p, size, cost, mark, unrealisedPnl: pnl };
    });
    const equity =
      num(balanceCents) !== null
        ? money(num(balanceCents) / 100 + rows.reduce((a, r) => a + (r.unrealisedPnl || 0), 0))
        : null;
    const byTopic = {};
    for (const r of rows) {
      const k = r.topic || "unassigned";
      byTopic[k] = byTopic[k] || { positions: 0, pnl: 0 };
      byTopic[k].positions += 1;
      byTopic[k].pnl += r.unrealisedPnl || 0;
    }
    const wins = rows.filter((r) => r.realisedPnl > 0).length;
    const losses = rows.filter((r) => r.realisedPnl < 0).length;
    return {
      rows,
      equity,
      byTopic,
      counts: { positions: rows.length, wins, losses },
      hitRate: wins + losses ? wins / (wins + losses) : null,
      worst: rows.slice().sort((a, b) => (a.realisedPnl ?? a.unrealisedPnl ?? 0) - (b.realisedPnl ?? b.unrealisedPnl ?? 0))[0] || null,
      best: rows.slice().sort((a, b) => (b.realisedPnl ?? b.unrealisedPnl ?? 0) - (a.realisedPnl ?? a.unrealisedPnl ?? 0))[0] || null,
    };
  }

  /** Equity curve from a list of {ts, equityUsd}; also returns drawdown stats. */
  function equityCurve(points) {
    const pts = (points || []).filter((p) => num(p.equityUsd) !== null && p.ts).sort((a, b) => a.ts - b.ts);
    if (!pts.length) return { points: [], maxDrawdown: null, totalReturn: null, CAGRish: null };
    let peak = pts[0].equityUsd;
    let maxDd = 0;
    const withDd = pts.map((p) => {
      peak = Math.max(peak, p.equityUsd);
      const dd = peak ? (p.equityUsd - peak) / peak : 0;
      maxDd = Math.min(maxDd, dd);
      return { ...p, drawdown: dd };
    });
    const first = withDd[0].equityUsd;
    const last = withDd[withDd.length - 1].equityUsd;
    return {
      points: withDd,
      maxDrawdown: maxDd,
      totalReturn: first ? (last - first) / first : null,
      startEquity: first,
      endEquity: last,
    };
  }


  /* ----------------------------------------------------------------- *
   * 11b. Replay simulator — fills derived from RECORDED candles only.
   *      Used because no API key exists in this session: it is a
   *      simulation, never an order sent to Kalshi.
   * ----------------------------------------------------------------- */
  /**
   * Walk recorded candlesticks and apply an entry/exit price rule.
   * rule.entry / rule.exit: (candle, ctx) -> target price | null (fire when non-null).
   * Payout uses the recorded market result when the position is held to
   * settlement; otherwise the last candle's close marks the position.
   */
  function replaySim(candles, rule, ctx) {
    const c = ctx || {};
    const contracts = num(c.contracts) || 1;
    const role = c.role === "maker" ? "maker" : "taker";
    const out = [];
    let open = null;
    const list = (candles || []).slice().sort((a, b) => a.end_period_ts - b.end_period_ts);
    for (let i = 0; i < list.length; i += 1) {
      const k = list[i];
      const px = num(path(k, "price.close_dollars"));
      if (px === null) continue;
      if (!open) {
        const entryPx = rule.entry ? rule.entry(k, { index: i, candles: list }) : null;
        const price = entryPx === null || entryPx === undefined ? null : num(entryPx);
        if (price === null) continue;
        const fee = tradeFee({ contracts, price, multiplier: c.multiplier === undefined ? 1 : c.multiplier, role });
        open = { entryTs: k.end_period_ts, entryPrice: price, contracts, fee, notional: money(price * contracts) };
        continue;
      }
      const exitPx = rule.exit ? rule.exit(k, { open, index: i, candles: list }) : null;
      const last = i === list.length - 1;
      if (exitPx === null && !last) continue;
      const exitPrice = exitPx === null || exitPx === undefined ? px : num(exitPx);
      const exitFee = exitPrice === null ? 0 : tradeFee({ contracts, price: exitPrice, multiplier: c.multiplier === undefined ? 1 : c.multiplier, role });
      const gross = money((exitPrice - open.entryPrice) * contracts);
      const fees = money((open.fee || 0) + (exitFee || 0));
      out.push({
        entryTs: open.entryTs,
        exitTs: k.end_period_ts,
        entryPrice: open.entryPrice,
        exitPrice,
        contracts,
        grossPnl: gross,
        fees,
        netPnl: money(gross - fees),
        heldToFinalCandle: exitPx === null && last,
      });
      open = null;
    }
    const totals = out.reduce((a, t) => ({ net: money(a.net + t.netPnl), gross: money(a.gross + t.grossPnl), fees: money(a.fees + t.fees) }), { net: 0, gross: 0, fees: 0 });
    return {
      trades: out,
      counts: { trades: out.length, wins: out.filter((t) => t.netPnl > 0).length, losses: out.filter((t) => t.netPnl < 0).length },
      totals,
      basis: "simulated from recorded candlesticks - no order was sent to Kalshi",
    };
  }

  /* -----------------------------------------------------------------
   * 12. Snapshot <-> live merge
   * ----------------------------------------------------------------- */
  /** Merge live API rows over snapshot rows; live always wins, gaps stay snapshot. */
  function mergeEvents(snapshotEvents, liveEvents) {
    const map = new Map();
    for (const e of snapshotEvents || []) map.set(e.event_ticker, { ...e, _origin: "snapshot" });
    for (const e of liveEvents || []) {
      const prev = map.get(e.event_ticker);
      map.set(e.event_ticker, { ...(prev || {}), ...e, _origin: "live", _marketsFrom: (e.markets ? "live" : "snapshot") });
    }
    return [...map.values()];
  }

  function enrichSnapshot(snapshot) {
    const topics = {};
    for (const t of TOPICS) topics[t.id] = [];
    const events = (snapshot && snapshot.events) || [];
    const rows = events.map((e) => {
      const metrics = eventMetrics(e);
      const topic = e.topic || (classifyTopic(e) || {}).topic || null;
      if (topic && topics[topic]) topics[topic].push(e.event_ticker);
      return { ...e, metrics, topic, classificationBasis: e.topic ? "snapshot-tag" : (classifyTopic(e) || {}).basis || null };
    });
    rows.sort((a, b) => {
      const av = a.metrics.dollarVolumeEstimate;
      const bv = b.metrics.dollarVolumeEstimate;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return { rows, topics, snapshot };
  }

  return {
    BASES, SOURCES, TOPICS, STRATEGIES, TRADE_AXES, GRANULARITIES, FEE_COEFF,
    num, path, usd, cents, count, pct, centicentCeil, money,
    tradeFee, buyCost,
    classifyTopic, topicById,
    quote, turnoverEstimate, marketOutcome, marketIsResolved, eventResolution, eventMetrics, mecMispricing, rankEvents,
    ladder, atPrice, walkBook,
    granularity, candlestickUrl, resample, tradesToBuckets,
    niceTicks, chartScales,
    fetchJson, buildUrl, scanEvents, mergeEvents, enrichSnapshot,
    categorizeTrade, positionPnl, portfolioView, equityCurve, replaySim,
  };
});
