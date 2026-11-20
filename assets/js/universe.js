/* Builds the market universe used by the markets, chart, liquidity and events pages.
 *
 * Order of preference:
 *   1. live public REST from the Kalshi demo API (when the browser can reach it)
 *   2. the committed snapshot in /data (always available, same origin)
 *
 * Live rows are merged over snapshot rows ticker by ticker, so fields that only
 * the snapshot knows (topic classification, series ticker) survive the merge.
 */

import { loadSnapshot, dollarMetrics } from './data.js';
import { apiGet, transportState } from './api.js';

const SELECTED_KEY = 'kalshidemo.selectedTicker';

export function getSelectedTicker() {
  try {
    return localStorage.getItem(SELECTED_KEY) || '';
  } catch {
    return '';
  }
}

export function setSelectedTicker(ticker) {
  try {
    if (ticker) localStorage.setItem(SELECTED_KEY, ticker);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
}

/** Normalise a raw API market into the shape the pages use. */
export function normaliseMarket(m, prev = {}) {
  const n = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    ticker: m.ticker ?? prev.ticker ?? null,
    event_ticker: m.event_ticker ?? prev.event_ticker ?? null,
    series_ticker: m.series_ticker ?? prev.series_ticker ?? null,
    title: m.title ?? m.yes_sub_title ?? prev.title ?? null,
    yes_sub_title: m.yes_sub_title ?? prev.yes_sub_title ?? null,
    topic: prev.topic ?? null,
    topic_method: prev.topic_method ?? null,
    topic_evidence: prev.topic_evidence ?? null,
    status: m.status ?? prev.status ?? null,
    result: m.result === '' ? null : (m.result ?? prev.result ?? null),
    close_time: m.close_time ?? prev.close_time ?? null,
    expected_expiration_time: m.expected_expiration_time ?? prev.expected_expiration_time ?? null,
    settlement_ts: m.settlement_ts ?? prev.settlement_ts ?? null,
    settlement_value_dollars: n(m.settlement_value_dollars ?? prev.settlement_value_dollars),
    yes_bid_dollars: n(m.yes_bid_dollars ?? prev.yes_bid_dollars),
    yes_ask_dollars: n(m.yes_ask_dollars ?? prev.yes_ask_dollars),
    no_bid_dollars: n(m.no_bid_dollars ?? prev.no_bid_dollars),
    no_ask_dollars: n(m.no_ask_dollars ?? prev.no_ask_dollars),
    yes_bid_size_fp: n(m.yes_bid_size_fp ?? prev.yes_bid_size_fp),
    yes_ask_size_fp: n(m.yes_ask_size_fp ?? prev.yes_ask_size_fp),
    last_price_dollars: n(m.last_price_dollars ?? prev.last_price_dollars),
    previous_price_dollars: n(m.previous_price_dollars ?? prev.previous_price_dollars),
    open_interest_fp: n(m.open_interest_fp ?? prev.open_interest_fp),
    volume_fp: n(m.volume_fp ?? prev.volume_fp),
    volume_24h_fp: n(m.volume_24h_fp ?? prev.volume_24h_fp),
    notional_value_dollars: n(m.notional_value_dollars ?? prev.notional_value_dollars),
    updated_time: m.updated_time ?? prev.updated_time ?? null,
    rules_primary: m.rules_primary ?? prev.rules_primary ?? null,
  };
}

/**
 * @param {{depth?: number, statuses?: string[], live?: boolean}} options
 */
export async function getUniverse({ depth = 1, statuses = ['open', 'closed', 'settled'], live = true } = {}) {
  const snapshot = await loadSnapshot(depth);
  const byTicker = new Map();
  for (const m of snapshot.markets || []) {
    byTicker.set(m.ticker, { ...normaliseMarket(m, m), ...m });
  }

  let source = 'snapshot';
  let liveError = null;
  let liveCount = 0;

  if (live) {
    try {
      for (const status of statuses) {
        const { data } = await apiGet('/markets', { status, limit: 1000 });
        const rows = Array.isArray(data?.markets) ? data.markets : [];
        liveCount += rows.length;
        for (const m of rows) {
          const prev = byTicker.get(m.ticker) || {};
          byTicker.set(m.ticker, normaliseMarket(m, prev));
        }
      }
      source = 'live';
    } catch (err) {
      liveError = err.message;
    }
  }

  const markets = [...byTicker.values()];
  return {
    markets,
    snapshot,
    source,
    liveError,
    liveCount,
    transport: transportState.active,
    meta: snapshot.meta,
    resolutions: snapshot.resolutions,
    orderbooks: snapshot.orderbooks,
    candles: snapshot.candles,
    metrics: Object.fromEntries(markets.map((m) => [m.ticker, dollarMetrics(m)])),
  };
}

/** Best bid/ask for a market from whatever fields are available. */
export function quotes(m) {
  const yesBid = m.yes_bid_dollars ?? null;
  const noBid = m.no_bid_dollars ?? null;
  const yesAsk = m.yes_ask_dollars ?? (noBid === null ? null : Math.round((1 - noBid) * 10000) / 10000);
  const noAsk = m.no_ask_dollars ?? (yesBid === null ? null : Math.round((1 - yesBid) * 10000) / 10000);
  const spread = yesBid !== null && yesAsk !== null ? Math.round((yesAsk - yesBid) * 10000) / 10000 : null;
  return { yesBid, yesAsk, noBid, noAsk, spread };
}

/** Sort helper used by the markets table. */
export function sortMarkets(rows, key) {
  const arr = rows.slice();
  const val = (r) => {
    switch (key) {
      case 'oi': return r.metrics.openInterestNotional ?? -Infinity;
      case 'vol24': return r.metrics.volume24hNotional ?? -Infinity;
      case 'vol': return r.metrics.volumeLifetimeNotional ?? -Infinity;
      case 'contracts': return r.m.open_interest_fp ?? -Infinity;
      case 'spread': {
        const s = quotes(r.m).spread;
        return s === null ? Infinity : s;
      }
      case 'updated': return Date.parse(r.m.updated_time || 0) || 0;
      default: return -Infinity;
    }
  };
  arr.sort((a, b) => val(b) - val(a));
  return arr;
}
