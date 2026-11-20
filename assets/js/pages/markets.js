/* Markets page: live scan, filters and dollar ranking. */

import { DOC } from '../config.js';
import { $, esc, num, money, count, fmtDateTime, srcLink, statusBadge, statusKind, resultCell, topicCell, setConn, toast } from '../util.js';
import { TOPICS } from '../config.js';
import { getUniverse, quotes, sortMarkets, setSelectedTicker } from '../universe.js';

const depth = 1;
let state = { rows: [], topic: 'all', search: '', status: 'all', sort: 'oi', source: '', meta: null };

function buildTopicChips() {
  const host = $('#m-topics');
  const chips = [{ id: 'all', label: 'All topics' }, ...TOPICS];
  host.innerHTML = chips
    .map((t) => `<button class="chip${state.topic === t.id ? ' active' : ''}" data-topic="${t.id}">${t.label}</button>`)
    .join('');
  host.querySelectorAll('[data-topic]').forEach((b) => {
    b.addEventListener('click', () => {
      state.topic = b.dataset.topic;
      buildTopicChips();
      render();
    });
  });
}

function visibleRows() {
  const q = state.search.trim().toLowerCase();
  let rows = state.rows.filter((r) => {
    const m = r.m;
    if (state.topic !== 'all' && m.topic !== state.topic) return false;
    if (state.status !== 'all' && m.status !== state.status) return false;
    if (q) {
      const hay = `${m.title || ''} ${m.ticker || ''} ${m.event_ticker || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  rows = sortMarkets(rows, state.sort);
  return rows;
}

function classificationNote(m) {
  if (!m.topic) return '<span class="small">not classified</span>';
  const how = m.topic_method === 'series-category' ? 'series category' : m.topic_method === 'series-allowlist' ? 'series allowlist' : 'keyword';
  const ev = m.topic_evidence ? ` (${esc(m.topic_evidence)})` : '';
  return `${topicCell(m.topic)}<span class="ticker">${esc(how)}${ev}</span>`;
}

function render() {
  const rows = visibleRows();
  const body = $('#m-rows');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty">No markets match the current filters. Unavailable values are never substituted.</td></tr>';
  } else {
    body.innerHTML = rows
      .slice(0, 400)
      .map(({ m, metrics }) => {
        const q = quotes(m);
        const oiNotional = metrics.openInterestNotional;
        const v24 = metrics.volume24hNotional;
        const topOi = state.rows.length && metrics.openInterestNotional === Math.max(...state.rows.map((r) => r.metrics.openInterestNotional ?? -Infinity));
        return `<tr>
          <td class="title">${esc(m.title || m.yes_sub_title || m.ticker)}<span class="ticker">${esc(m.ticker)}</span></td>
          <td>${classificationNote(m)}</td>
          <td class="num">${q.yesBid === null ? '—' : `$${q.yesBid.toFixed(2)}`}<span class="ticker">${m.yes_bid_size_fp === null ? '' : count(m.yes_bid_size_fp)}</span></td>
          <td class="num">${q.yesAsk === null ? '—' : `$${q.yesAsk.toFixed(2)}`}<span class="ticker">${m.yes_ask_size_fp === null ? '' : count(m.yes_ask_size_fp)}</span></td>
          <td class="num">${q.noBid === null ? '—' : `$${q.noBid.toFixed(2)}`}</td>
          <td class="num">${m.last_price_dollars === null ? '—' : `$${m.last_price_dollars.toFixed(2)}`}</td>
          <td class="num">${count(m.open_interest_fp)}</td>
          <td class="num">${oiNotional === null ? '—' : money(oiNotional)}${topOi ? ' <span class="badge ok">top</span>' : ''}</td>
          <td class="num">${v24 === null ? '—' : money(v24)}</td>
          <td class="num">${q.spread === null ? '—' : `${(q.spread * 100).toFixed(1)}¢`}</td>
          <td>${statusBadge(m.status || 'unknown', statusKind(m.status))}</td>
          <td>${resultCell(m.result)}</td>
          <td>${srcLink(DOC.getMarkets, 'api')} ${srcLink(DOC.getMarket, 'market')}</td>
        </tr>`;
      })
      .join('');
  }

  $('#m-count').textContent = count(rows.length);
  $('#m-open').textContent = count(rows.filter((r) => r.m.status === 'active').length);

  const oiVals = state.rows.map((r) => r.metrics.openInterestNotional).filter((v) => v !== null);
  const volVals = state.rows.map((r) => r.metrics.volume24hNotional).filter((v) => v !== null);
  const topOi = oiVals.length ? Math.max(...oiVals) : null;
  const topVol = volVals.length ? Math.max(...volVals) : null;
  $('#m-topoi').textContent = topOi === null ? '—' : money(topOi);
  $('#m-topoi-note').textContent = topOi === null ? 'No open interest reported' : 'across all tracked markets';
  $('#m-topvol').textContent = topVol === null ? '—' : money(topVol);
  $('#m-topvol-note').textContent = topVol === null ? 'No 24h volume reported' : 'across all tracked markets';

  const src = state.source === 'live' ? 'live demo API' : 'committed snapshot';
  $('#m-freshness').textContent = ` · source: ${src}${state.meta?.captured_at ? ` · snapshot ${fmtDateTime(state.meta.captured_at)}` : ''}`;
}

async function load() {
  const universe = await getUniverse({ depth });
  state.rows = universe.markets.map((m) => ({ m, metrics: universe.metrics[m.ticker] }));
  state.source = universe.source;
  state.meta = universe.meta;
  if (universe.source === 'live') {
    setConn('live', 'live');
  } else if (universe.markets.length) {
    setConn('snapshot', 'snapshot');
  } else {
    setConn('offline', 'no data');
  }
  if (universe.liveError) {
    toast(`Live API unavailable from this browser (${universe.liveError}). Showing the committed snapshot.`, 7000);
  }
  render();
}

function wire() {
  buildTopicChips();
  $('#m-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });
  $('#m-status').addEventListener('change', (e) => {
    state.status = e.target.value;
    render();
  });
  $('#m-sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    render();
  });
  $('#m-refresh').addEventListener('click', async () => {
    $('#m-refresh').disabled = true;
    await load();
    $('#m-refresh').disabled = false;
  });
  $('#m-rows').addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (!row) return;
    const ticker = row.querySelector('.ticker');
    if (!ticker) return;
    const value = ticker.textContent.trim();
    if (!value) return;
    setSelectedTicker(value);
  });
}

wire();
load();
