/* Authenticated demo-account access from the browser.
 *
 * The private key never leaves the page: it is imported into the Web Crypto API
 * and used to sign each request locally. It is kept in sessionStorage only, so
 * it is discarded when the tab closes. Nothing is sent to this project's
 * server — GitHub Pages serves static files only.
 *
 * Signing rules: https://docs.kalshi.com/getting_started/api_keys
 */

import { signedRequest } from './api.js';
import { getCredentials, setCredentials, clearCredentials } from './store.js';

export { getCredentials, setCredentials, clearCredentials };

export function hasCredentials() {
  const c = getCredentials();
  return Boolean(c && c.keyId && c.privateKey);
}

/** Fetch the four authenticated account views. */
export async function fetchAccount(creds = getCredentials()) {
  if (!creds || !creds.keyId || !creds.privateKey) {
    throw new Error('No demo API credentials are configured in this browser session.');
  }
  const auth = { keyId: creds.keyId, privateKeyPem: creds.privateKey };
  const errors = [];

  const balance = await signedRequest({ ...auth, path: '/portfolio/balance' }).catch((e) => {
    errors.push(`balance: ${e.message}`);
    return null;
  });
  const positions = await signedRequest({ ...auth, path: '/portfolio/positions', query: { limit: 200 } }).catch((e) => {
    errors.push(`positions: ${e.message}`);
    return null;
  });
  const fills = await signedRequest({ ...auth, path: '/portfolio/fills', query: { limit: 200 } }).catch((e) => {
    errors.push(`fills: ${e.message}`);
    return null;
  });
  const orders = await signedRequest({ ...auth, path: '/portfolio/orders', query: { limit: 200 } }).catch((e) => {
    errors.push(`orders: ${e.message}`);
    return null;
  });

  return { balance, positions, fills, orders, errors, fetchedAt: new Date().toISOString() };
}

/** Normalise the API responses into the rows the pages render. */
export function normaliseAccount(data) {
  const balance = data?.balance || null;
  const marketPositions = data?.positions?.market_positions || [];
  const eventPositions = data?.positions?.event_positions || [];
  const fills = data?.fills?.fills || [];
  const orders = data?.orders?.orders || [];

  const n = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  return {
    cashBalanceCents: balance?.balance ?? null,
    cashBalanceDollars: n(balance?.balance_dollars),
    portfolioValueCents: balance?.portfolio_value ?? null,
    balanceUpdatedTs: balance?.updated_ts ?? null,
    balanceBreakdown: Array.isArray(balance?.balance_breakdown)
      ? balance.balance_breakdown.map((b) => ({ exchangeIndex: b.exchange_index ?? null, balanceDollars: n(b.balance) }))
      : null,
    positions: marketPositions.map((p) => ({
      ticker: p.ticker ?? null,
      eventTicker: p.event_ticker ?? null,
      positionFp: n(p.position),
      marketExposureDollars: n(p.market_exposure_dollars),
      realizedPnlDollars: n(p.realized_pnl_dollars),
      feesPaidDollars: n(p.fees_paid_dollars),
      lastUpdatedTs: p.last_updated_ts ?? null,
    })),
    eventPositions: eventPositions.map((p) => ({
      eventTicker: p.event_ticker ?? null,
      totalCostDollars: n(p.total_cost_dollars),
      totalCostSharesFp: n(p.total_cost_shares_fp),
      eventExposureDollars: n(p.event_exposure_dollars),
      realizedPnlDollars: n(p.realized_pnl_dollars),
      feesPaidDollars: n(p.fees_paid_dollars),
    })),
    fills: fills.map((f) => ({
      fillId: f.fill_id ?? null,
      orderId: f.order_id ?? null,
      ticker: f.ticker ?? f.market_ticker ?? null,
      outcomeSide: f.outcome_side ?? null,
      bookSide: f.book_side ?? null,
      countFp: n(f.count_fp),
      yesPriceDollars: n(f.yes_price_dollars),
      noPriceDollars: n(f.no_price_dollars),
      isTaker: f.is_taker ?? null,
      feeCost: n(f.fee_cost),
      createdTime: f.created_time ?? null,
    })),
    orders: orders.map((o) => ({
      orderId: o.order_id ?? null,
      clientOrderId: o.client_order_id ?? null,
      ticker: o.ticker ?? null,
      outcomeSide: o.outcome_side ?? null,
      bookSide: o.book_side ?? null,
      type: o.type ?? null,
      status: o.status ?? null,
      yesPriceDollars: n(o.yes_price_dollars),
      noPriceDollars: n(o.no_price_dollars),
      initialCountFp: n(o.initial_count_fp),
      fillCountFp: n(o.fill_count_fp),
      remainingCountFp: n(o.remaining_count_fp),
      takerFeesDollars: n(o.taker_fees_dollars),
      makerFeesDollars: n(o.maker_fees_dollars),
      createdTime: o.created_time ?? null,
    })),
  };
}

/** Price a fill in dollars, given the outcome side.
 *  outcome_side 'yes' pays the yes_price; 'no' pays the no_price. */
export function fillPrice(fill) {
  return fill.outcomeSide === 'no' ? fill.noPriceDollars : fill.yesPriceDollars;
}
