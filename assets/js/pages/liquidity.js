/* Liquidity page: order-book depth per price level. */

import { DOC } from '../config.js';
import { $, esc, num, count, money, fmtDateTime, setConn, toast, srcLink } from '../util.js';
import { getUniverse, getSelectedTicker, setSelectedTicker } from '../universe.js';
import { fetchOrderbook } from '../api.js';
import { drawChart, cumulativeDepth } from '../chart.js';

const depth = 1;
const state = { markets: [], ticker: '', book: null, depthLevels: 25, source: '' };

function renderLevels(target, levels, side) {
  const body = $(target);
  if (!levels || !levels.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No resting ${side} bids were returned for this market.</td></tr>`;
    return;
  }
  const cum = cumulativeDepth(levels);
  body.innerHTML = cum
    .slice()
    .reverse()
    .map(
      (l) => `<tr>
        <td class="num">$${l.price.toFixed(4)}</td>
        <td class="num">${count(l.count)}</td>
        <td class="num">${money(l.notional)}</td>
        <td class="num">${count(l.cumulative)}</td>
        <td>${srcLink(DOC.getOrderbook, 'api')}</td>
      </tr>`,
    )
    .join('');
}

function renderChart() {
  const canvas = $('#l-chart');
  const msg = $('#l-msg');
  const b = state.book;
  if (!b || (!b.yes.length && !b.no.length)) {
    drawChart(canvas, { series: [], emptyMessage: 'No depth to plot.' });
    msg.classList.remove('hidden');
    msg.textContent = 'No resting orders were returned for this market.';
    $('#l-legend').innerHTML = '';
    return;
  }
  msg.classList.add('hidden');
  const yesSeries = cumulativeDepth(b.yes).map((l) => ({ t: l.price, v: l.cumulative }));
  const noSeries = cumulativeDepth(b.no).map((l) => ({ t: l.price, v: l.cumulative }));
  drawChart(canvas, {
    series: [
      { label: 'YES depth', color: '#14674a', points: yesSeries, width: 2 },
      { label: 'NO depth', color: '#a23434', points: noSeries, width: 2 },
    ],
    yLabel: 'Cumulative contracts',
    xGranularity: 'day',
    emptyMessage: 'No depth to plot.',
  });
  $('#l-legend').innerHTML = `
    <span><span class="swatch" style="background:#14674a"></span>YES cumulative depth</span>
    <span><span class="swatch" style="background:#a23434"></span>NO cumulative depth</span>
    <span class="mono">x-axis: price (USD) · y-axis: cumulative contracts</span>`;
}

function renderSummary() {
  const b = state.book;
  $('#l-yesbid').textContent = b?.bestYesBid === null || b?.bestYesBid === undefined ? '—' : `$${b.bestYesBid.toFixed(4)}`;
  $('#l-yesask').textContent = b?.impliedYesAsk === null || b?.impliedYesAsk === undefined ? '—' : `$${b.impliedYesAsk.toFixed(4)}`;
  const spread = b?.bestYesBid != null && b?.impliedYesAsk != null ? b.impliedYesAsk - b.bestYesBid : null;
  $('#l-spread').textContent = spread === null ? '—' : `${(spread * 100).toFixed(1)}¢`;
  const totalContracts = (b?.yesDepthContracts || 0) + (b?.noDepthContracts || 0);
  const totalNotional = (b?.yesDepthNotional || 0) + (b?.noDepthNotional || 0);
  $('#l-depthv').textContent = b ? count(totalContracts) : '—';
  $('#l-depthnote').textContent = b ? `${money(totalNotional)} resting at the shown prices` : '—';
}

async function loadBook() {
  if (!state.ticker) return;
  try {
    state.book = await fetchOrderbook(state.ticker, state.depthLevels);
    state.source = 'live order book';
  } catch (err) {
    // Fall back to the committed snapshot of the book.
    const snapshotBook = state.snapshotBooks?.[state.ticker];
    if (snapshotBook) {
      state.book = {
        yes: (snapshotBook.yes_bids || []).map((l) => ({ price: l.price, count: l.count, notional: l.notional_usd })),
        no: (snapshotBook.no_bids || []).map((l) => ({ price: l.price, count: l.count, notional: l.notional_usd })),
        bestYesBid: snapshotBook.best_yes_bid,
        bestNoBid: snapshotBook.best_no_bid,
        impliedYesAsk: snapshotBook.implied_yes_ask,
        impliedNoAsk: snapshotBook.implied_no_ask,
        yesDepthContracts: snapshotBook.yes_bid_depth_contracts,
        noDepthContracts: snapshotBook.no_bid_depth_contracts,
        yesDepthNotional: snapshotBook.yes_bid_depth_notional_usd,
        noDepthNotional: snapshotBook.no_bid_depth_notional_usd,
      };
      state.source = 'committed snapshot';
      toast(`Live order book unavailable (${err.message}). Showing the committed snapshot for this market.`, 7000);
    } else {
      state.book = null;
      state.source = 'unavailable';
      toast(`Order book unavailable: ${err.message}`, 6000);
    }
  }
  renderLevels('l-yes', state.book?.yes, 'YES');
  renderLevels('l-no', state.book?.no, 'NO');
  renderSummary();
  renderChart();
  $('#l-freshness').innerHTML = `source: ${esc(state.source)} ${state.source === 'live order book' ? '· ' + new Date().toISOString().slice(11, 19) + 'Z' : ''}`;
}

async function boot() {
  const universe = await getUniverse({ depth });
  state.markets = universe.markets;
  state.snapshotBooks = universe.orderbooks;
  setConn(universe.source === 'live' ? 'live' : universe.markets.length ? 'snapshot' : 'offline', universe.source);

  const sel = $('#l-market');
  sel.innerHTML =
    `<option value="">Select a market…</option>` +
    universe.markets
      .slice()
      .sort((a, b) => (b.open_interest_fp ?? 0) - (a.open_interest_fp ?? 0))
      .map((m) => `<option value="${esc(m.ticker)}">${esc((m.title || m.ticker).slice(0, 70))} — ${esc(m.ticker)}</option>`)
      .join('');

  const preferred = new URLSearchParams(location.search).get('ticker') || getSelectedTicker();
  if (preferred && universe.markets.some((m) => m.ticker === preferred)) {
    state.ticker = preferred;
    sel.value = preferred;
    setSelectedTicker(preferred);
  }

  sel.addEventListener('change', (e) => {
    state.ticker = e.target.value;
    setSelectedTicker(state.ticker);
    loadBook();
  });
  $('#l-depth').addEventListener('change', (e) => {
    state.depthLevels = Number(e.target.value);
    loadBook();
  });
  $('#l-refresh').addEventListener('click', loadBook);

  if (state.ticker) loadBook();
}

boot();
