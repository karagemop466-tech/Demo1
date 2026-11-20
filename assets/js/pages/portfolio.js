/* Portfolio page: demo-account balance, positions, fills and orders.
 *
 * Two sources:
 *  1. a live signed request from this browser (when a demo key is connected)
 *  2. the snapshot written by the refresh workflow (data/portfolio.json)
 * The page always states which one it is showing.
 */

import { DOC } from '../config.js';
import { $, esc, num, count, money, fmtDateTime, srcLink, statusBadge, toast } from '../util.js';
import { loadSnapshot } from '../data.js';
import { fetchAccount, normaliseAccount, hasCredentials, setCredentials, clearCredentials, getCredentials } from '../account.js';

const depth = 1;
let connected = false;

function renderEmpty(message) {
  $('#p-positions-rows').innerHTML = `<tr><td colspan="8" class="empty">${esc(message)}</td></tr>`;
  $('#p-fills-rows').innerHTML = `<tr><td colspan="9" class="empty">${esc(message)}</td></tr>`;
  $('#p-orders-rows').innerHTML = `<tr><td colspan="9" class="empty">${esc(message)}</td></tr>`;
}

function renderAccount(a, source) {
  $('#p-conn').textContent = source;
  $('#p-cash').textContent = a.cashBalanceDollars !== null ? money(a.cashBalanceDollars) : a.cashBalanceCents !== null ? money(a.cashBalanceCents / 100) : '—';
  $('#p-value').textContent = a.portfolioValueCents !== null ? money(a.portfolioValueCents / 100) : '—';
  $('#p-positions').textContent = count(a.positions.length);
  const pnl = a.positions.reduce((s, p) => s + (p.realizedPnlDollars || 0), 0);
  const fees = a.positions.reduce((s, p) => s + (p.feesPaidDollars || 0), 0);
  $('#p-pnl').textContent = a.positions.length ? money(pnl) : '—';
  $('#p-fees').textContent = a.positions.length ? money(fees) : '—';
  $('#p-updated').textContent = a.balanceUpdatedTs ? fmtDateTime(new Date(Number(a.balanceUpdatedTs) * 1000).toISOString()) : '—';
  $('#p-conn-note').textContent = `Source: ${source}. Every figure below comes from the official portfolio endpoints.`;

  $('#p-positions-rows').innerHTML = a.positions.length
    ? a.positions
        .map(
          (p) => `<tr>
            <td class="title">${esc(p.ticker || '—')}</td>
            <td><span class="mono">${esc(p.eventTicker || '—')}</span></td>
            <td class="num">${count(p.positionFp)}</td>
            <td class="num">${p.marketExposureDollars === null ? '—' : money(p.marketExposureDollars)}</td>
            <td class="num">${p.realizedPnlDollars === null ? '—' : money(p.realizedPnlDollars, { sign: true })}</td>
            <td class="num">${p.feesPaidDollars === null ? '—' : money(p.feesPaidDollars)}</td>
            <td class="nowrap">${p.lastUpdatedTs ? fmtDateTime(p.lastUpdatedTs) : '—'}</td>
            <td>${srcLink(DOC.getPositions, 'api')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="8" class="empty">No positions reported.</td></tr>';

  $('#p-fills-rows').innerHTML = a.fills.length
    ? a.fills
        .map(
          (f) => `<tr>
            <td class="nowrap">${f.createdTime ? fmtDateTime(f.createdTime) : '—'}</td>
            <td class="title">${esc(f.ticker || '—')}</td>
            <td>${esc(f.outcomeSide || f.bookSide || '—')}</td>
            <td class="num">${count(f.countFp)}</td>
            <td class="num">${f.yesPriceDollars === null ? '—' : `$${f.yesPriceDollars.toFixed(4)}`}</td>
            <td class="num">${f.noPriceDollars === null ? '—' : `$${f.noPriceDollars.toFixed(4)}`}</td>
            <td class="num">${f.feeCost === null ? '—' : money(f.feeCost)}</td>
            <td>${f.isTaker === null ? '—' : f.isTaker ? 'taker' : 'maker'}</td>
            <td>${srcLink(DOC.getFills, 'api')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="empty">No fills reported.</td></tr>';

  $('#p-orders-rows').innerHTML = a.orders.length
    ? a.orders
        .map(
          (o) => `<tr>
            <td class="nowrap">${o.createdTime ? fmtDateTime(o.createdTime) : '—'}</td>
            <td class="title">${esc(o.ticker || '—')}</td>
            <td>${esc(o.outcomeSide || o.bookSide || '—')}</td>
            <td>${esc(o.type || '—')}</td>
            <td class="num">${o.yesPriceDollars === null ? '—' : `$${o.yesPriceDollars.toFixed(4)}`}</td>
            <td class="num">${count(o.fillCountFp)}</td>
            <td class="num">${count(o.remainingCountFp)}</td>
            <td>${statusBadge(o.status || 'unknown')}</td>
            <td><span class="mono">${esc(o.orderId || '')}</span></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="empty">No orders reported.</td></tr>';
}

/** Render the snapshot written by the refresh workflow. */
function renderSnapshot(snapshot) {
  const p = snapshot.portfolio;
  if (!p || !p.normalized) return false;
  const n = p.normalized;
  const a = {
    cashBalanceCents: n.cash_balance_cents,
    cashBalanceDollars: n.cash_balance_dollars,
    portfolioValueCents: n.portfolio_value_cents,
    balanceUpdatedTs: n.balance_updated_ts ? new Date(Number(n.balance_updated_ts) * 1000).toISOString() : null,
    positions: (n.positions || []).map((x) => ({
      ticker: x.ticker,
      eventTicker: x.event_ticker,
      positionFp: x.position_fp,
      marketExposureDollars: x.market_exposure_dollars,
      realizedPnlDollars: x.realized_pnl_dollars,
      feesPaidDollars: x.fees_paid_dollars,
      lastUpdatedTs: x.last_updated_ts,
    })),
    fills: (n.fills || []).map((x) => ({
      ticker: x.ticker,
      outcomeSide: x.outcome_side,
      bookSide: x.book_side,
      countFp: x.count_fp,
      yesPriceDollars: x.yes_price_dollars,
      noPriceDollars: x.no_price_dollars,
      isTaker: x.is_taker,
      feeCost: x.fee_cost,
      createdTime: x.created_time,
    })),
    orders: (n.orders || []).map((x) => ({
      orderId: x.order_id,
      clientOrderId: x.client_order_id,
      ticker: x.ticker,
      outcomeSide: x.outcome_side,
      bookSide: x.book_side,
      type: x.type,
      status: x.status,
      yesPriceDollars: x.yes_price_dollars,
      noPriceDollars: x.no_price_dollars,
      fillCountFp: x.fill_count_fp,
      remainingCountFp: x.remaining_count_fp,
      createdTime: x.created_time,
    })),
  };
  renderAccount(a, `workflow snapshot · ${p.captured_at ? fmtDateTime(p.captured_at) : 'time unknown'}`);
  $('#p-positions-note').textContent =
    'Positions from the snapshot published by the refresh workflow. Connect a key above for live data.';
  return true;
}

async function connect() {
  const keyId = $('#p-keyid').value.trim();
  const privateKey = $('#p-key').value.trim();
  if (!keyId || !privateKey) {
    $('#p-status').textContent = 'Enter both the API key id and the private key.';
    return;
  }
  $('#p-status').textContent = 'Signing a balance request…';
  setCredentials({ keyId, privateKey });
  try {
    const data = await fetchAccount({ keyId, privateKey });
    if (data.errors.length && !data.balance) {
      $('#p-status').textContent = `Failed: ${data.errors.join(' | ')}`;
      toast(`Could not read the account: ${data.errors.join(' | ')}`, 8000);
      return;
    }
    connected = true;
    $('#p-status').textContent = 'Connected.';
    $('#p-key').value = '';
    renderAccount(normaliseAccount(data), 'live signed requests from this browser');
  } catch (err) {
    $('#p-status').textContent = `Failed: ${err.message}`;
    toast(`Connection failed: ${err.message}`, 8000);
  }
}

async function boot() {
  const snapshot = await loadSnapshot(depth);
  const hasSnapshot = renderSnapshot(snapshot);

  if (hasCredentials()) {
    $('#p-keyid').value = getCredentials().keyId || '';
    $('#p-conn').textContent = 'Connecting…';
    try {
      const data = await fetchAccount();
      connected = true;
      renderAccount(normaliseAccount(data), 'live signed requests from this browser');
    } catch (err) {
      if (!hasSnapshot) {
        $('#p-conn').textContent = 'Not connected';
        $('#p-conn-note').textContent = `The saved key did not work: ${err.message}`;
        renderEmpty('Not connected — no account data loaded.');
      }
    }
  } else if (!hasSnapshot) {
    $('#p-conn').textContent = 'Not connected';
    $('#p-conn-note').textContent =
      'No demo key is configured in this browser and the workflow snapshot is empty. Connect a key above, or add KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY as repository secrets so the refresh workflow can publish one.';
    renderEmpty('Not connected — no account data loaded.');
  }

  $('#p-connect').addEventListener('click', connect);
  $('#p-disconnect').addEventListener('click', () => {
    clearCredentials();
    connected = false;
    $('#p-keyid').value = '';
    $('#p-key').value = '';
    $('#p-conn').textContent = 'Not connected';
    $('#p-status').textContent = 'Key removed from this session.';
    renderEmpty('Not connected — no account data loaded.');
  });
}

boot();
