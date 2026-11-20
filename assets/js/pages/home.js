/* Landing page: headline numbers and the largest dollar markets. */

import { DOC } from '../config.js';
import { $, esc, num, money, count, fmtDateTime, srcLink, statusBadge, statusKind, topicCell, setConn } from '../util.js';
import { loadSnapshot, dollarMetrics, topicTotals } from '../data.js';
import { apiGet, transportState } from '../api.js';

const root = document.body.dataset.root === 'true' ? 0 : 1;

function renderTop(markets) {
  const rows = markets
    .map((m) => ({ m, d: dollarMetrics(m) }))
    .filter((r) => r.d.openInterestNotional !== null || r.d.volume24hNotional !== null)
    .sort((a, b) => (b.d.openInterestNotional ?? -1) - (a.d.openInterestNotional ?? -1))
    .slice(0, 10);

  const body = $('#home-top');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No market data received. The demo API may be unreachable from this browser; see the source index for the endpoints used.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(({ m, d }) => {
      const yesBid = num(m.yes_bid_dollars);
      const yesAsk = num(m.yes_ask_dollars);
      return `<tr>
        <td class="title">${esc(m.title || m.yes_sub_title || m.ticker)}<span class="ticker">${esc(m.ticker)}</span></td>
        <td>${topicCell(m.topic)}</td>
        <td class="num">${count(m.open_interest_fp)}</td>
        <td class="num">${d.openInterestNotional === null ? '—' : money(d.openInterestNotional)}</td>
        <td class="num">${d.volume24hNotional === null ? '—' : money(d.volume24hNotional)}</td>
        <td class="num">${yesBid === null ? '—' : `$${yesBid.toFixed(2)}`} / ${yesAsk === null ? '—' : `$${yesAsk.toFixed(2)}`}</td>
        <td>${statusBadge(m.status || 'unknown', statusKind(m.status))}</td>
        <td>${srcLink(`${DOC.getMarkets}`, 'markets api')}</td>
      </tr>`;
    })
    .join('');
}

function renderStats(markets, resolutions) {
  const totals = topicTotals(markets);
  const total = Object.values(totals).reduce(
    (acc, t) => {
      acc.markets += t.markets;
      acc.open += t.open;
      acc.resolved += t.resolved;
      acc.oi = Math.max(acc.oi, t.openInterestNotional);
      acc.vol = Math.max(acc.vol, t.volume24hNotional);
      return acc;
    },
    { markets: 0, open: 0, resolved: 0, oi: 0, vol: 0 },
  );
  $('#s-markets').textContent = count(total.markets);
  $('#s-markets-note').textContent = `${count(total.open)} currently open · 5 focus topics`;
  $('#s-topnotional').textContent = total.oi ? money(total.oi) : '—';
  $('#s-topvol').textContent = total.vol ? money(total.vol) : '—';

  const resolvedCount = markets.filter((m) => m.status === 'finalized').length;
  const yesCount = markets.filter((m) => m.status === 'finalized' && m.result === 'yes').length;
  const noCount = markets.filter((m) => m.status === 'finalized' && m.result === 'no').length;
  $('#s-resolved').textContent = count(resolvedCount);
  $('#s-resolved-note').textContent = resolvedCount
    ? `${yesCount} YES · ${noCount} NO · ${resolutions?.entries?.length || 0} ledger rows`
    : 'No settled market yet in the current capture';
}

async function boot() {
  const snapshot = await loadSnapshot(root);
  let markets = snapshot.markets || [];

  $('#home-captured').textContent = snapshot.meta?.captured_at ? fmtDateTime(snapshot.meta.captured_at) : '—';
  if (markets.length) {
    renderStats(markets, snapshot.resolutions);
    renderTop(markets);
    setConn('snapshot', `snapshot ${fmtDateTime(snapshot.meta?.captured_at)}`);
    $('#home-status').textContent = 'Snapshot loaded';
    $('#home-status-note').textContent =
      `${markets.length} markets from the committed snapshot. Trying a live refresh…`;
  } else {
    $('#home-status').textContent = 'No snapshot yet';
    $('#home-status-note').textContent = 'The site has no committed data snapshot yet; trying a live request.';
  }

  try {
    const { data } = await apiGet('/markets', { status: 'open', limit: 1000 });
    const live = Array.isArray(data?.markets) ? data.markets : [];
    if (live.length) {
      // Merge: live rows replace snapshot rows for the same ticker.
      const byTicker = new Map(markets.map((m) => [m.ticker, m]));
      for (const m of live) {
        const prev = byTicker.get(m.ticker) || {};
        byTicker.set(m.ticker, {
          ...prev,
          ticker: m.ticker,
          event_ticker: m.event_ticker ?? prev.event_ticker ?? null,
          title: m.title ?? m.yes_sub_title ?? prev.title ?? null,
          topic: prev.topic ?? null,
          status: m.status ?? null,
          result: m.result === '' ? null : (m.result ?? null),
          yes_bid_dollars: num(m.yes_bid_dollars),
          yes_ask_dollars: num(m.yes_ask_dollars),
          no_bid_dollars: num(m.no_bid_dollars),
          no_ask_dollars: num(m.no_ask_dollars),
          last_price_dollars: num(m.last_price_dollars),
          open_interest_fp: num(m.open_interest_fp),
          volume_fp: num(m.volume_fp),
          volume_24h_fp: num(m.volume_24h_fp),
          notional_value_dollars: num(m.notional_value_dollars),
          close_time: m.close_time ?? null,
        });
      }
      markets = [...byTicker.values()];
      renderStats(markets, snapshot.resolutions);
      renderTop(markets);
      setConn('live', `live · ${transportState.active}`);
      $('#home-status').textContent = 'Live demo data';
      $('#home-status-note').textContent = `${live.length} open markets returned by the demo API just now.`;
      $('#home-transport').textContent = transportState.active || '—';
    }
  } catch (err) {
    setConn(markets.length ? 'snapshot' : 'offline', markets.length ? 'snapshot only' : 'offline');
    $('#home-transport').textContent = 'blocked';
    $('#home-status-note').textContent =
      `Live refresh unavailable from this browser (${err.message}). Showing the committed snapshot instead.`;
  }
}

boot();
