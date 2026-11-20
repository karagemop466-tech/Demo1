/* Trade analysis: categorise fills and score them against reported resolutions. */

import { DOC } from '../config.js';
import { $, esc, num, count, money, fmtDateTime, srcLink, statusBadge, topicCell, toast } from '../util.js';
import { getUniverse } from '../universe.js';
import { loadSnapshot } from '../data.js';
import { fetchAccount, normaliseAccount, hasCredentials } from '../account.js';

const depth = 1;

const STRATEGIES = [
  {
    id: 'spread-capture-lite',
    entry: 'Passive YES bid at the best YES bid when (1 − best NO bid) − best YES bid ≥ the configured edge.',
    exit: 'Order rests until filled, cancelled, or the market closes. No discretionary exit.',
    limits: 'Max contracts per order, max orders per run, price band, topic allowlist — all configurable.',
    state: 'Implemented in scripts/run-demo-trade.mjs; disabled unless KALSHI_ENABLE_TRADING=1.',
    source: DOC.createOrder,
  },
  {
    id: 'resolution-follower',
    entry: 'Take the side that already matches the outcome implied by the market status (determined / finalized).',
    exit: 'Hold to settlement.',
    limits: 'Only markets with a reported result may be used; never inferred from price.',
    state: 'Documented. Not implemented — it needs a decision on whether trading after determination is permitted.',
    source: DOC.lifecycle,
  },
  {
    id: 'spread-capture-wide',
    entry: 'As spread-capture-lite but with a wider minimum edge and a smaller size, for markets with thin books.',
    exit: 'Order rests until filled, cancelled, or the market closes.',
    limits: 'Size scales inversely with the number of levels inside the spread.',
    state: 'Documented. Not implemented; needs a sizing rule approved first.',
    source: DOC.orderbook,
  },
  {
    id: 'topic-concentration',
    entry: 'Cap total open exposure per topic so no single topic dominates the book.',
    exit: 'Reduce exposure when the topic cap is breached.',
    limits: 'Per-topic notional cap derived from open interest notional.',
    state: 'Documented. Needs a cap value to be agreed before it can be enabled.',
    source: DOC.getMarkets,
  },
];

function bandOf(price) {
  if (price === null || price === undefined) return 'unknown';
  const c = Math.round(price * 100);
  if (c < 10) return '0–9¢';
  if (c < 20) return '10–19¢';
  if (c < 30) return '20–29¢';
  if (c < 40) return '30–39¢';
  if (c < 50) return '40–49¢';
  if (c < 60) return '50–59¢';
  if (c < 70) return '60–69¢';
  if (c < 80) return '70–79¢';
  if (c < 90) return '80–89¢';
  return '90–100¢';
}

function groupStats(rows) {
  const stats = {
    trades: rows.length,
    contracts: rows.reduce((s, r) => s + (r.contracts || 0), 0),
    cost: rows.reduce((s, r) => s + (r.cost || 0), 0),
    payout: rows.reduce((s, r) => s + (r.payout || 0), 0),
    fees: rows.reduce((s, r) => s + (r.fees || 0), 0),
    resolved: 0,
    wins: 0,
  };
  for (const r of rows) {
    if (r.outcome === 'win') { stats.resolved += 1; stats.wins += 1; }
    else if (r.outcome === 'loss') stats.resolved += 1;
  }
  stats.pnl = Math.round((stats.payout - stats.cost - stats.fees) * 100) / 100;
  stats.winRate = stats.resolved ? stats.wins / stats.resolved : null;
  return stats;
}

function renderGroupTable(target, groups, keyLabel) {
  const body = $(target);
  if (!groups.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No trades to categorise.</td></tr>`;
    return;
  }
  body.innerHTML = groups
    .map(([key, rows]) => {
      const s = groupStats(rows);
      return `<tr>
        <td class="title">${esc(keyLabel ? keyLabel(key) : key)}</td>
        <td class="num">${count(s.trades)}</td>
        <td class="num">${count(s.contracts)}</td>
        <td class="num">${money(s.cost)}</td>
        <td class="num">${money(s.payout)}</td>
        <td class="num">${money(s.fees)}</td>
        <td class="num">${s.pnl === 0 && !s.trades ? '—' : money(s.pnl, { sign: true })}</td>
        <td class="num">${s.winRate === null ? '—' : `${(s.winRate * 100).toFixed(0)}%`}<span class="ticker">${s.resolved} resolved</span></td>
        <td>${srcLink(DOC.getFills, 'fills')}</td>
      </tr>`;
    })
    .join('');
}

function renderLedger(rows) {
  const body = $('#a-ledger');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty">No account data loaded.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `<tr>
        <td class="nowrap">${r.createdTime ? fmtDateTime(r.createdTime) : '—'}</td>
        <td class="title">${esc(r.ticker || '—')}</td>
        <td>${topicCell(r.topic)}</td>
        <td>${esc(r.side || '—')}</td>
        <td class="num">${count(r.contracts)}</td>
        <td class="num">${r.price === null ? '—' : `$${r.price.toFixed(4)}`}</td>
        <td class="num">${money(r.cost)}</td>
        <td class="num">${r.fees === null ? '—' : money(r.fees)}</td>
        <td>${r.result ? `<span class="${r.result === 'yes' ? 'result-yes' : r.result === 'no' ? 'result-no' : ''}">${esc(r.result)}</span>` : '<span class="result-none">not resolved</span>'}</td>
        <td>${r.outcome === 'win' ? statusBadge('won', 'ok') : r.outcome === 'loss' ? statusBadge('lost', 'bad') : statusBadge('open', 'neutral')}</td>
        <td class="num">${r.outcome === 'open' ? '—' : money(r.pnl, { sign: true })}</td>
        <td>${srcLink(DOC.getFills, 'fills')}</td>
      </tr>`,
    )
    .join('');
}

function renderStrategies() {
  $('#a-strategies').innerHTML = STRATEGIES.map(
    (s) => `<tr>
      <td class="title">${esc(s.id)}</td>
      <td>${esc(s.entry)}</td>
      <td>${esc(s.exit)}</td>
      <td>${esc(s.limits)}</td>
      <td>${esc(s.state)}</td>
      <td>${srcLink(s.source, 'docs')}</td>
    </tr>`,
  ).join('');
}

async function boot() {
  renderStrategies();
  const universe = await getUniverse({ depth });
  const marketByTicker = new Map(universe.markets.map((m) => [m.ticker, m]));

  let fills = [];
  let source = '';

  // 1. live signed account
  if (hasCredentials()) {
    try {
      const data = await fetchAccount();
      fills = normaliseAccount(data).fills;
      source = 'live signed requests from this browser';
    } catch (err) {
      toast(`Live account data unavailable: ${err.message}`, 6000);
    }
  }
  // 2. workflow snapshot
  if (!fills.length) {
    const snapshot = await loadSnapshot(depth);
    const p = snapshot.portfolio?.normalized;
    if (p?.fills?.length) {
      fills = p.fills.map((f) => ({
        ticker: f.ticker,
        outcomeSide: f.outcome_side,
        bookSide: f.book_side,
        countFp: f.count_fp,
        yesPriceDollars: f.yes_price_dollars,
        noPriceDollars: f.no_price_dollars,
        isTaker: f.is_taker,
        feeCost: f.fee_cost,
        createdTime: f.created_time,
      }));
      source = `workflow snapshot · ${snapshot.portfolio.captured_at ? fmtDateTime(snapshot.portfolio.captured_at) : ''}`;
    }
  }

  if (!fills.length) {
    $('#a-total').textContent = '—';
    $('#a-resolved').textContent = '—';
    $('#a-winrate').textContent = '—';
    $('#a-pnl').textContent = '—';
    $('#a-winrate-note').textContent = 'No account fills are available yet';
    $('#a-pnl-note').textContent = source || 'Connect a demo account to populate this page';
    $('#a-by-topic').innerHTML = '<tr><td colspan="8" class="empty">No account data loaded. Connect a demo key on the Portfolio page, or publish a snapshot with the refresh workflow.</td></tr>';
    $('#a-by-side').innerHTML = '<tr><td colspan="5" class="empty">No account data loaded.</td></tr>';
    $('#a-by-band').innerHTML = '<tr><td colspan="5" class="empty">No account data loaded.</td></tr>';
    return;
  }

  const scored = fills.map((f) => {
    const contracts = num(f.countFp) || 0;
    const side = f.outcomeSide || f.bookSide || null;
    const price = side === 'no' ? num(f.noPriceDollars) : num(f.yesPriceDollars);
    const cost = price === null ? null : Math.round(price * contracts * 100) / 100;
    const market = marketByTicker.get(f.ticker);
    const result = market?.result || null;
    const fees = num(f.feeCost) || 0;
    let outcome = 'open';
    let payout = null;
    if (result === 'yes' || result === 'no') {
      const won = result === side;
      outcome = won ? 'win' : 'loss';
      payout = won ? contracts : 0;
    }
    const pnl = payout === null ? null : Math.round((payout - (cost || 0) - fees) * 100) / 100;
    return {
      ticker: f.ticker,
      topic: market?.topic || null,
      side,
      contracts,
      price,
      cost,
      fees,
      result,
      outcome,
      payout,
      pnl,
      createdTime: f.createdTime,
    };
  });

  const totals = groupStats(scored);
  $('#a-total').textContent = count(totals.trades);
  $('#a-resolved').textContent = count(totals.resolved);
  $('#a-winrate').textContent = totals.winRate === null ? '—' : `${(totals.winRate * 100).toFixed(0)}%`;
  $('#a-winrate-note').textContent = `${totals.resolved} resolved · ${totals.trades - totals.resolved} still open · ${source}`;
  $('#a-pnl').textContent = money(totals.pnl, { sign: true });
  $('#a-pnl-note').textContent = `${source}`;

  const byTopic = new Map();
  const bySide = new Map();
  const byBand = new Map();
  for (const r of scored) {
    const t = r.topic || 'unclassified';
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(r);
    const s = r.side || 'unknown';
    if (!bySide.has(s)) bySide.set(s, []);
    bySide.get(s).push(r);
    const b = bandOf(r.price);
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b).push(r);
  }
  renderGroupTable('a-by-topic', [...byTopic.entries()].sort(), (k) => k);
  renderGroupTable('a-by-side', [...bySide.entries()], (k) => k);
  renderGroupTable('a-by-band', [...byBand.entries()].sort((a, b) => a[0].localeCompare(b[0])), (k) => k);
  renderLedger(scored);
}

boot();
