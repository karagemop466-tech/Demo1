/* Loads the committed snapshot files produced by scripts/fetch-demo-data.mjs.
 *
 * The snapshot is the site's guaranteed baseline: it is served from the same
 * origin as the site, so it always loads even when the browser cannot reach the
 * Kalshi API directly (CORS or network restrictions). Pages then try to
 * upgrade to live data and say clearly which source they are showing.
 */

export const DATA_BASE = 'data/';

const cache = new Map();

export async function loadJson(path, { optional = true } = {}) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) {
        if (optional) return null;
        throw new Error(`HTTP ${res.status} for ${path}`);
      }
      return await res.json();
    } catch (err) {
      if (optional) return null;
      throw err;
    }
  })();
  cache.set(path, promise);
  return promise;
}

/** Resolve a site-relative data path from a page at any depth.
 *  depth 0 = site root (index.html), depth 1 = one directory down (markets/). */
export function dataPath(name, depth = 1) {
  return depth === 0 ? `${DATA_BASE}${name}` : `../${DATA_BASE}${name}`;
}

export async function loadSnapshot(depth = 1) {
  const [meta, markets, events, orderbooks, candles, resolutions, portfolio, trades] = await Promise.all([
    loadJson(dataPath('meta.json', depth)),
    loadJson(dataPath('markets.json', depth)),
    loadJson(dataPath('events.json', depth)),
    loadJson(dataPath('orderbooks.json', depth)),
    loadJson(dataPath('candles.json', depth)),
    loadJson(dataPath('resolutions.json', depth)),
    loadJson(dataPath('portfolio.json', depth)),
    loadJson(dataPath('trades.json', depth)),
  ]);
  return { meta, markets: markets || [], events: events || [], orderbooks: orderbooks || {}, candles: candles || {}, resolutions: resolutions || null, portfolio: portfolio || null, trades: trades || null };
}

/* ------------------------------------------------------------------ */
/* Derivations shared by several pages                                 */
/* ------------------------------------------------------------------ */

/**
 * Dollar metrics for a market.
 *
 * notional_value_dollars is the dollar notional of one contract and
 * open_interest_fp / volume_24h_fp are fixed-point contract counts
 * (Get Markets schema). A binary contract pays $1 on a winning outcome
 * (Market Settlement guide), so the products below are dollar amounts.
 * The formula is stated on the page so any number can be recomputed.
 */
export function dollarMetrics(m) {
  const notional = Number(m?.notional_value_dollars);
  const oi = Number(m?.open_interest_fp);
  const v24 = Number(m?.volume_24h_fp);
  const vol = Number(m?.volume_fp);
  const has = (v) => Number.isFinite(v);
  return {
    openInterestNotional: has(notional) && has(oi) ? round2(oi * notional) : null,
    volume24hNotional: has(notional) && has(v24) ? round2(v24 * notional) : null,
    volumeLifetimeNotional: has(notional) && has(vol) ? round2(vol * notional) : null,
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Best bid/ask implied from a snapshot order book. */
export function bookSummary(book) {
  if (!book) return null;
  const yes = book.yes_bids || [];
  const no = book.no_bids || [];
  return {
    bestYesBid: book.best_yes_bid ?? (yes.length ? yes[yes.length - 1].price : null),
    bestNoBid: book.best_no_bid ?? (no.length ? no[no.length - 1].price : null),
    impliedYesAsk: book.implied_yes_ask ?? null,
    impliedNoAsk: book.implied_no_ask ?? null,
    yesDepthContracts: book.yes_bid_depth_contracts ?? null,
    noDepthContracts: book.no_bid_depth_contracts ?? null,
    yesDepthNotional: book.yes_bid_depth_notional_usd ?? null,
    noDepthNotional: book.no_bid_depth_notional_usd ?? null,
  };
}

/** Aggregate topic totals for the stat strip. */
export function topicTotals(markets) {
  const out = {};
  for (const m of markets) {
    const topic = m.topic || 'other';
    if (!out[topic]) out[topic] = { topic, markets: 0, open: 0, resolved: 0, openInterestNotional: 0, volume24hNotional: 0 };
    const t = out[topic];
    t.markets += 1;
    if (m.status === 'active') t.open += 1;
    if (m.status === 'finalized') t.resolved += 1;
    const d = dollarMetrics(m);
    t.openInterestNotional += d.openInterestNotional || 0;
    t.volume24hNotional += d.volume24hNotional || 0;
  }
  for (const t of Object.values(out)) {
    t.openInterestNotional = round2(t.openInterestNotional);
    t.volume24hNotional = round2(t.volume24hNotional);
  }
  return out;
}
