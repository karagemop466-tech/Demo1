#!/usr/bin/env node
/**
 * Execute demo trades against the Kalshi DEMO environment and journal them.
 *
 * SAFETY MODEL (deliberate, and enforced in code below):
 *  - The DEMO environment uses mock funds only
 *    (https://docs.kalshi.com/getting_started/demo_env).
 *  - Trading is OFF unless KALSHI_ENABLE_TRADING=1 is set AND credentials exist.
 *  - Hard limits: max contracts per order, max orders per run, price band,
 *    topic allowlist, and a minimum dollar edge so the strategy cannot fire
 *    on a random book.
 *  - Every order is written to data/trades.json with the full request/response,
 *    so the analysis page can compute outcomes from real records only.
 *
 * Strategy "spread-capture-lite" (documented on the trading page):
 *   For each candidate market in the allowlist, look at the public order book.
 *   If the best YES bid is at or above the configured floor AND the implied YES
 *   ask (1 - best NO bid) exceeds the best YES bid by at least the configured
 *   edge, place a single resting YES bid at the best YES bid for `count`
 *   contracts. This is a passive bid: it does not cross the spread.
 *
 * Endpoints:
 *   GET  /markets/{ticker}/orderbook     (public)  https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *   POST /portfolio/events/orders         (signed) https://docs.kalshi.com/getting_started/quick_start_create_order
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEMO_REST, DOC, getJSON, signedRequest, fp } from './kalshi-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades.json');
const MARKETS = path.join(ROOT, 'data', 'markets.json');

const RISK = {
  maxContractsPerOrder: Number(process.env.KALSHI_MAX_CONTRACTS || '10'),
  maxOrdersPerRun: Number(process.env.KALSHI_MAX_ORDERS || '3'),
  minPriceCents: Number(process.env.KALSHI_MIN_PRICE_CENTS || '5'),
  maxPriceCents: Number(process.env.KALSHI_MAX_PRICE_CENTS || '95'),
  minEdgeCents: Number(process.env.KALSHI_MIN_EDGE_CENTS || '3'),
  allowedTopics: (process.env.KALSHI_TOPICS || 'golf,crypto,elections,culture,gas').split(','),
};

function readKey() {
  const raw = process.env.KALSHI_PRIVATE_KEY || '';
  if (!raw) return null;
  if (raw.includes('-----BEGIN')) return raw;
  try {
    const d = Buffer.from(raw, 'base64').toString('utf8');
    if (d.includes('-----BEGIN')) return d;
  } catch {
    /* ignore */
  }
  return raw;
}

async function main() {
  const apiKeyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPem = readKey();
  const enabled = process.env.KALSHI_ENABLE_TRADING === '1';

  if (!apiKeyId || !privateKeyPem) {
    console.log('[trade] no credentials — nothing placed');
    return;
  }
  if (!enabled) {
    console.log('[trade] KALSHI_ENABLE_TRADING is not 1 — nothing placed');
    return;
  }

  let markets = [];
  try {
    markets = JSON.parse(await fs.readFile(MARKETS, 'utf8'));
  } catch {
    console.log('[trade] data/markets.json missing — run scripts/fetch-demo-data.mjs first');
    return;
  }

  const candidates = markets
    .filter((m) => m.status === 'active' && RISK.allowedTopics.includes(m.topic))
    .filter((m) => {
      const p = Math.round((fp(m.yes_bid_dollars) ?? -1) * 100);
      return p >= RISK.minPriceCents && p <= RISK.maxPriceCents;
    })
    .slice(0, RISK.maxOrdersPerRun * 3);

  let journal = { updated_at: null, trades: [] };
  try {
    journal = JSON.parse(await fs.readFile(TRADES, 'utf8'));
  } catch {
    /* first run */
  }
  journal.trades = journal.trades || [];

  let placed = 0;
  for (const m of candidates) {
    if (placed >= RISK.maxOrdersPerRun) break;
    let book;
    try {
      book = await getJSON(`${DEMO_REST}/markets/${encodeURIComponent(m.ticker)}/orderbook?depth=25`);
    } catch (e) {
      journal.trades.push({
        ts: new Date().toISOString(),
        status: 'skipped',
        reason: `orderbook failed: ${e.message}`,
        ticker: m.ticker,
      });
      continue;
    }
    const ob = book?.orderbook_fp || {};
    const yes = (ob.yes_dollars || []).map(([p, c]) => ({ p: fp(p), c: fp(c) }));
    const no = (ob.no_dollars || []).map(([p, c]) => ({ p: fp(p), c: fp(c) }));
    if (!yes.length || !no.length) continue;
    const bestYesBid = yes[yes.length - 1].p;
    const bestNoBid = no[no.length - 1].p;
    const impliedYesAsk = 1 - bestNoBid;
    const edgeCents = Math.round((impliedYesAsk - bestYesBid) * 100);
    const priceCents = Math.round(bestYesBid * 100);
    if (edgeCents < RISK.minEdgeCents) continue;
    if (priceCents < RISK.minPriceCents || priceCents > RISK.maxPriceCents) continue;

    const order = {
      ticker: m.ticker,
      side: 'bid',
      count: String(RISK.maxContractsPerOrder),
      price: (priceCents / 100).toFixed(4),
      time_in_force: 'good_till_canceled',
      self_trade_prevention_type: 'taker_at_cross',
      client_order_id: `kalshidemo-${crypto.randomUUID().slice(0, 24)}`,
    };

    const record = {
      ts: new Date().toISOString(),
      strategy: 'spread-capture-lite',
      topic: m.topic,
      ticker: m.ticker,
      title: m.title,
      request: order,
      context: {
        best_yes_bid: bestYesBid,
        implied_yes_ask: Number(impliedYesAsk.toFixed(4)),
        edge_cents: edgeCents,
        depth_at_bid: yes[yes.length - 1].c,
        risk_limits: RISK,
      },
    };

    try {
      const res = await signedRequest({
        base: DEMO_REST,
        method: 'POST',
        path: '/portfolio/events/orders',
        body: order,
        apiKeyId,
        privateKeyPem,
      });
      record.status = 'accepted';
      record.response = res;
      record.order_id = res?.order_id ?? null;
      placed++;
      console.log('[trade] placed', m.ticker, order.price, order.count);
    } catch (e) {
      record.status = 'rejected';
      record.error = e.message;
      record.response_body = e.body ?? null;
      console.log('[trade] rejected', m.ticker, e.message);
    }
    journal.trades.push(record);
  }

  journal.updated_at = new Date().toISOString();
  journal.environment = 'demo';
  journal.risk_limits = RISK;
  journal.sources = { createOrder: DOC.createOrder, orderbook: DOC.getOrderbook, demoEnv: DOC.demoEnv };
  await fs.mkdir(path.dirname(TRADES), { recursive: true });
  await fs.writeFile(TRADES, JSON.stringify(journal, null, 2) + '\n', 'utf8');
  console.log('[trade] orders placed:', placed, 'journal entries:', journal.trades.length);
}

main().catch((e) => {
  console.error('[trade] fatal', e.message);
  process.exitCode = 1;
});
