/* Trading page: signed demo order ticket plus the trade journal. */

import { DOC } from '../config.js';
import { $, esc, num, count, money, fmtDateTime, srcLink, statusBadge, toast } from '../util.js';
import { getUniverse, quotes, setSelectedTicker } from '../universe.js';
import { signedRequest } from '../api.js';
import { getCredentials, setCredentials, clearCredentials, hasCredentials } from '../account.js';
import { getJournal, addJournalEntry } from '../store.js';
import { loadSnapshot } from '../data.js';

const depth = 1;

/* Guardrails. These mirror the limits enforced in scripts/run-demo-trade.mjs. */
const RISK = {
  maxContracts: 10,
  minPriceCents: 1,
  maxPriceCents: 99,
  maxOrdersPerSession: 20,
};

const state = { markets: [], ticker: '', ordersThisSession: 0, snapshotTrades: null };

function currentMarket() {
  return state.markets.find((m) => m.ticker === state.ticker) || null;
}

function preview() {
  const m = currentMarket();
  const box = $('#t-preview');
  if (!m) {
    box.textContent = 'Choose a market to preview the order.';
    return;
  }
  const q = quotes(m);
  const side = $('#t-side').value;
  const price = num($('#t-price').value);
  const contracts = num($('#t-count').value);
  const noEquiv = price === null ? null : Math.round((1 - price) * 10000) / 10000;
  const notional = price === null || contracts === null ? null : Math.round(price * contracts * 100) / 100;
  box.innerHTML = `
    <strong>${esc(m.title || m.ticker)}</strong> <span class="mono">${esc(m.ticker)}</span><br>
    ${side === 'bid' ? 'Buy YES' : 'Sell YES'} at <strong>$${price === null ? '—' : price.toFixed(4)}</strong>
    (equivalent NO price $${noEquiv === null ? '—' : noEquiv.toFixed(4)}) ·
    ${count(contracts)} contracts ·
    notional ${notional === null ? '—' : money(notional)}<br>
    <span class="small">Live quote: YES bid ${q.yesBid === null ? '—' : '$' + q.yesBid.toFixed(4)} ·
    YES ask ${q.yesAsk === null ? '—' : '$' + q.yesAsk.toFixed(4)} ·
    status ${esc(m.status || 'unknown')}</span>`;
  applyRiskChecks(price, contracts);
}

function applyRiskChecks(price, contracts) {
  const issues = [];
  if (price === null) issues.push('Enter a valid price.');
  else {
    const cents = Math.round(price * 100);
    if (cents < RISK.minPriceCents || cents > RISK.maxPriceCents) {
      issues.push(`Price ${cents}¢ is outside the ${RISK.minPriceCents}¢–${RISK.maxPriceCents}¢ band.`);
    }
  }
  if (contracts === null || contracts <= 0) issues.push('Contracts must be greater than zero.');
  else if (contracts > RISK.maxContracts) issues.push(`This ticket caps orders at ${RISK.maxContracts} contracts.`);
  if (state.ordersThisSession >= RISK.maxOrdersPerSession) {
    issues.push(`Session cap of ${RISK.maxOrdersPerSession} orders reached.`);
  }
  const btn = $('#t-submit');
  btn.disabled = issues.length > 0;
  let note = document.getElementById('t-risk');
  if (!note) {
    note = document.createElement('div');
    note.id = 't-risk';
    note.className = 'small';
    note.style.marginTop = '10px';
    $('#t-preview').after(note);
  }
  note.innerHTML = issues.length
    ? `<span class="severity-high">Blocked:</span> ${issues.map(esc).join(' · ')}`
    : 'Within the configured guardrails.';
}

function renderJournal() {
  const local = getJournal();
  const published = state.snapshotTrades?.trades || [];
  const rows = [
    ...published.map((t) => ({
      at: t.ts,
      ticker: t.ticker,
      strategy: t.strategy || '—',
      side: t.request?.side || '—',
      price: t.request?.price,
      count: t.request?.count,
      status: t.status,
      orderId: t.order_id || t.response?.order_id || '',
      source: 'workflow journal',
    })),
    ...local.map((t) => ({
      at: t.at,
      ticker: t.ticker,
      strategy: t.strategy || 'manual ticket',
      side: t.side,
      price: t.price,
      count: t.count,
      status: t.status,
      orderId: t.orderId || '',
      source: 'this browser',
    })),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const body = $('#t-rows');
  body.innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td class="nowrap">${r.at ? fmtDateTime(r.at) : '—'}</td>
            <td class="title">${esc(r.ticker || '—')}</td>
            <td>${esc(r.strategy)}</td>
            <td>${esc(r.side || '—')}</td>
            <td class="num">${r.price === undefined || r.price === null ? '—' : `$${Number(r.price).toFixed(4)}`}</td>
            <td class="num">${count(r.count)}</td>
            <td>${statusBadge(r.status || 'unknown', r.status === 'accepted' ? 'ok' : r.status === 'rejected' ? 'bad' : 'neutral')}</td>
            <td><span class="mono">${esc(r.orderId || '')}</span></td>
            <td>${srcLink(DOC.createOrderV2, 'api')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="empty">No trades recorded yet. Place an order above, or run the refresh workflow with <code class="mono">execute_demo_trades</code> enabled.</td></tr>';
}

async function placeOrder() {
  const m = currentMarket();
  if (!m) return;
  const creds = getCredentials();
  if (!hasCredentials()) {
    $('#t-status').textContent = 'No demo key configured in this browser session.';
    toast('Connect a demo API key on the Portfolio page first.', 6000);
    return;
  }
  const side = $('#t-side').value;
  const price = num($('#t-price').value);
  const contracts = num($('#t-count').value);
  const body = {
    ticker: m.ticker,
    client_order_id: `kdm-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    side,
    count: contracts === null ? '1' : String(contracts),
    price: price === null ? '0.5000' : price.toFixed(4),
    time_in_force: $('#t-tif').value,
    self_trade_prevention_type: $('#t-stp').value,
    post_only: $('#t-post').checked,
    cancel_order_on_pause: $('#t-pause').checked,
  };

  const confirmed = window.confirm(
    `Place ${side === 'bid' ? 'BUY YES' : 'SELL YES'} ${body.count} contract(s) of ${m.ticker} at $${body.price}?\n\nThis order is sent to the Kalshi DEMO environment (mock funds).\nClient order id: ${body.client_order_id}`,
  );
  if (!confirmed) return;

  $('#t-status').textContent = 'Signing and sending…';
  try {
    const res = await signedRequest({
      method: 'POST',
      path: '/portfolio/events/orders',
      body,
      keyId: creds.keyId,
      privateKeyPem: creds.privateKey,
    });
    state.ordersThisSession += 1;
    const orderId = res?.order_id || '';
    addJournalEntry({
      ticker: m.ticker,
      title: m.title,
      side,
      price: body.price,
      count: body.count,
      status: 'accepted',
      orderId,
      request: body,
      response: res,
      strategy: 'manual ticket',
    });
    $('#t-status').textContent = 'Order accepted.';
    $('#t-result').innerHTML = `<div class="callout"><strong>Order accepted (201).</strong>
      Order id <span class="mono">${esc(orderId)}</span> ·
      filled <span class="mono">${esc(res?.fill_count ?? '—')}</span> ·
      remaining <span class="mono">${esc(res?.remaining_count ?? '—')}</span> ·
      avg fill price <span class="mono">${res?.average_fill_price ? '$' + res.average_fill_price : '—'}</span><br>
      <span class="small">A 201 means the order was accepted, not that it is resting. Check <code class="mono">remaining_count</code>.
      Source: <a href="${DOC.createOrderV2}" target="_blank" rel="noreferrer">Create Order (V2) ↗</a></span></div>`;
    renderJournal();
    preview();
  } catch (err) {
    addJournalEntry({
      ticker: m.ticker,
      title: m.title,
      side,
      price: body.price,
      count: body.count,
      status: 'rejected',
      strategy: 'manual ticket',
      request: body,
      error: err.message,
    });
    $('#t-status').textContent = 'Rejected.';
    $('#t-result').innerHTML = `<div class="callout danger"><strong>Order rejected.</strong> ${esc(err.message)}
      ${err.body ? `<br><span class="mono">${esc(JSON.stringify(err.body).slice(0, 400))}</span>` : ''}
      <br><span class="small">Error codes: <a href="${DOC.orderErrors}" target="_blank" rel="noreferrer">order errors ↗</a></span></div>`;
    renderJournal();
  }
}

async function boot() {
  $('#g-max').textContent = `${RISK.maxContracts} contracts`;
  $('#g-band').textContent = `${RISK.minPriceCents}¢ – ${RISK.maxPriceCents}¢`;
  $('#g-maxorders').textContent = String(RISK.maxOrdersPerSession);

  const universe = await getUniverse({ depth });
  state.markets = universe.markets;
  const sel = $('#t-market');
  sel.innerHTML =
    `<option value="">Select a market…</option>` +
    universe.markets
      .slice()
      .sort((a, b) => (b.open_interest_fp ?? 0) - (a.open_interest_fp ?? 0))
      .map((m) => `<option value="${esc(m.ticker)}">${esc((m.title || m.ticker).slice(0, 64))} — ${esc(m.ticker)}</option>`)
      .join('');

  const snapshot = await loadSnapshot(depth);
  state.snapshotTrades = snapshot.trades;
  renderJournal();

  const preferred = new URLSearchParams(location.search).get('ticker');
  if (preferred && universe.markets.some((m) => m.ticker === preferred)) {
    state.ticker = preferred;
    sel.value = preferred;
    setSelectedTicker(preferred);
    const m = currentMarket();
    const q = quotes(m);
    if (q.yesBid !== null) $('#t-price').value = q.yesBid.toFixed(4);
  }

  sel.addEventListener('change', (e) => {
    state.ticker = e.target.value;
    setSelectedTicker(state.ticker);
    const m = currentMarket();
    if (m) {
      const q = quotes(m);
      if (q.yesBid !== null) $('#t-price').value = q.yesBid.toFixed(4);
    }
    preview();
  });
  $('#t-side').addEventListener('change', preview);
  $('#t-price').addEventListener('input', preview);
  $('#t-count').addEventListener('input', preview);
  $('#t-submit').addEventListener('click', placeOrder);
  $('#t-disconnect').addEventListener('click', () => {
    clearCredentials();
    $('#t-status').textContent = 'Key removed from this session.';
  });
  $('#t-export').addEventListener('click', () => {
    const payload = { exportedAt: new Date().toISOString(), local: getJournal(), published: state.snapshotTrades };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kalshi-demo-trades.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  preview();
}

boot();
