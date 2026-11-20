#!/usr/bin/env node
/**
 * Capture the authenticated Kalshi DEMO account state.
 *
 * Credentials are read from the environment (never from the repo):
 *   KALSHI_API_KEY_ID   the key id shown when the key was created
 *   KALSHI_PRIVATE_KEY  the PEM private key (raw PEM, or base64 of the PEM)
 *
 * If either is missing the script exits 0 and writes NOTHING — the site then
 * shows "NOT CONNECTED" instead of fabricated numbers.
 *
 * Endpoints (all authenticated):
 *   GET /portfolio/balance
 *   GET /portfolio/positions
 *   GET /portfolio/fills
 *   GET /portfolio/orders
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_REST, DOC, signedRequest, fp } from './kalshi-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'portfolio.json');

function readKey() {
  const raw = process.env.KALSHI_PRIVATE_KEY || '';
  if (!raw) return null;
  if (raw.includes('-----BEGIN')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) return decoded;
  } catch {
    /* fall through */
  }
  return raw;
}

async function main() {
  const apiKeyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPem = readKey();
  if (!apiKeyId || !privateKeyPem) {
    console.log('[account] no credentials in environment — skipping (site will show NOT CONNECTED)');
    return;
  }

  const auth = { base: DEMO_REST, apiKeyId, privateKeyPem };
  const result = {
    captured_at: new Date().toISOString(),
    environment: 'demo',
    base_url: DEMO_REST,
    endpoints_used: [
      { path: '/portfolio/balance', doc: DOC.getBalance },
      { path: '/portfolio/positions', doc: DOC.getPositions },
      { path: '/portfolio/fills', doc: DOC.getFills },
      { path: '/portfolio/orders', doc: DOC.getOrders },
    ],
    balance: null,
    positions: [],
    fills: [],
    orders: [],
    errors: [],
  };

  const call = async (path, query, key) => {
    try {
      const body = await signedRequest({ ...auth, path, query });
      result[key] = body;
      console.log('[account] ok', path);
    } catch (e) {
      result.errors.push(`${path}: ${e.message}${e.body ? ` — ${JSON.stringify(e.body).slice(0, 300)}` : ''}`);
      console.log('[account] fail', path, e.message);
    }
  };

  await call('/portfolio/balance', {}, 'balance');
  await call('/portfolio/positions', { limit: 200 }, 'positions');
  await call('/portfolio/fills', { limit: 200 }, 'fills');
  await call('/portfolio/orders', { limit: 200 }, 'orders');

  /*
   * Normalise the shapes the site needs.
   * Field names follow the official schemas:
   *   Balance  : balance (cents), balance_dollars, portfolio_value (cents), updated_ts
   *   Positions: market_positions[], event_positions[]
   *   Fills    : fill_id, trade_id, order_id, ticker, outcome_side, book_side,
   *              count_fp, yes_price_dollars, no_price_dollars, is_taker, fee_cost
   *   Orders   : order_id, client_order_id, ticker, outcome_side, book_side, type,
   *              status, yes_price_dollars, no_price_dollars, fill_count_fp,
   *              remaining_count_fp, initial_count_fp
   */
  const marketPositions = result.positions?.market_positions || [];
  const eventPositions = result.positions?.event_positions || [];
  const fills = result.fills?.fills || [];
  const orders = result.orders?.orders || [];

  result.normalized = {
    cash_balance_cents: result.balance?.balance ?? null,
    cash_balance_dollars: fp(result.balance?.balance_dollars),
    portfolio_value_cents: result.balance?.portfolio_value ?? null,
    balance_updated_ts: result.balance?.updated_ts ?? null,
    balance_breakdown: Array.isArray(result.balance?.balance_breakdown)
      ? result.balance.balance_breakdown.map((b) => ({
          exchange_index: b.exchange_index ?? null,
          balance_dollars: fp(b.balance),
        }))
      : null,
    positions_count: marketPositions.length,
    event_positions_count: eventPositions.length,
    fills_count: fills.length,
    orders_count: orders.length,
    positions: marketPositions.map((p) => ({
      ticker: p.ticker ?? null,
      event_ticker: p.event_ticker ?? null,
      position_fp: fp(p.position),
      market_exposure_dollars: fp(p.market_exposure_dollars),
      realized_pnl_dollars: fp(p.realized_pnl_dollars),
      fees_paid_dollars: fp(p.fees_paid_dollars),
      last_updated_ts: p.last_updated_ts ?? null,
      netting_enabled: p.netting_enabled ?? null,
    })),
    event_positions: eventPositions.map((p) => ({
      event_ticker: p.event_ticker ?? null,
      total_cost_dollars: fp(p.total_cost_dollars),
      total_cost_shares_fp: fp(p.total_cost_shares_fp),
      event_exposure_dollars: fp(p.event_exposure_dollars),
      realized_pnl_dollars: fp(p.realized_pnl_dollars),
      fees_paid_dollars: fp(p.fees_paid_dollars),
    })),
    fills: fills.map((f) => ({
      fill_id: f.fill_id ?? null,
      trade_id: f.trade_id ?? null,
      order_id: f.order_id ?? null,
      ticker: f.ticker ?? f.market_ticker ?? null,
      outcome_side: f.outcome_side ?? null,
      book_side: f.book_side ?? null,
      count_fp: fp(f.count_fp),
      yes_price_dollars: fp(f.yes_price_dollars),
      no_price_dollars: fp(f.no_price_dollars),
      is_taker: f.is_taker ?? null,
      fee_cost: fp(f.fee_cost),
      created_time: f.created_time ?? null,
      liquidity: f.liquidity ?? null,
    })),
    orders: orders.map((o) => ({
      order_id: o.order_id ?? null,
      client_order_id: o.client_order_id ?? null,
      ticker: o.ticker ?? null,
      outcome_side: o.outcome_side ?? null,
      book_side: o.book_side ?? null,
      type: o.type ?? null,
      status: o.status ?? null,
      yes_price_dollars: fp(o.yes_price_dollars),
      no_price_dollars: fp(o.no_price_dollars),
      initial_count_fp: fp(o.initial_count_fp),
      fill_count_fp: fp(o.fill_count_fp),
      remaining_count_fp: fp(o.remaining_count_fp),
      taker_fees_dollars: fp(o.taker_fees_dollars),
      maker_fees_dollars: fp(o.maker_fees_dollars),
      created_time: o.created_time ?? null,
    })),
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log('[account] wrote', OUT);
}

main().catch((e) => {
  console.error('[account] fatal', e.message);
  process.exitCode = 1;
});
