/* Events page: lifecycle status and resolution tracking. */

import { DOC, TOPICS } from '../config.js';
import { $, esc, count, fmtDateTime, srcLink, statusBadge, statusKind, resultCell, topicCell, setConn } from '../util.js';
import { getUniverse } from '../universe.js';
import { loadSnapshot } from '../data.js';

const depth = 1;
const state = { events: [], markets: [], topic: 'all', resolution: 'all', search: '' };

function buildChips() {
  const host = $('#e-topics');
  const chips = [{ id: 'all', label: 'All topics' }, ...TOPICS];
  host.innerHTML = chips
    .map((t) => `<button class="chip${state.topic === t.id ? ' active' : ''}" data-topic="${t.id}">${t.label}</button>`)
    .join('');
  host.querySelectorAll('[data-topic]').forEach((b) =>
    b.addEventListener('click', () => {
      state.topic = b.dataset.topic;
      buildChips();
      render();
    }),
  );
}

function render() {
  const q = state.search.trim().toLowerCase();
  const rows = state.events.filter((e) => {
    if (state.topic !== 'all' && e.topic !== state.topic) return false;
    const result = e.result || '';
    if (state.resolution === 'open' && result) return false;
    if (state.resolution === 'yes' && result !== 'yes') return false;
    if (state.resolution === 'no' && result !== 'no') return false;
    if (state.resolution === 'scalar' && result !== 'scalar') return false;
    if (q) {
      const hay = `${e.title || ''} ${e.event_ticker || ''} ${e.series_ticker || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const body = $('#e-rows');
  body.innerHTML = rows.length
    ? rows
        .map((e) => {
          const status = e.status || 'unknown';
          const result = e.result || null;
          const value = e.settlement_value_dollars;
          return `<tr>
            <td class="title">${esc(e.title || e.event_ticker)}</td>
            <td>${topicCell(e.topic)}</td>
            <td><span class="mono">${esc(e.series_ticker || '—')}</span><span class="ticker">${esc(e.event_ticker || '')}</span></td>
            <td class="num">${count(e.market_count ?? null)}</td>
            <td class="nowrap">${e.close_time ? fmtDateTime(e.close_time) : '—'}</td>
            <td>${statusBadge(status, statusKind(status))}</td>
            <td>${resultCell(result)}</td>
            <td class="nowrap">${e.settlement_ts ? fmtDateTime(e.settlement_ts) : '—'}</td>
            <td class="num">${value === null || value === undefined ? '—' : `$${Number(value).toFixed(4)}`}</td>
            <td>${srcLink(DOC.getEvents, 'events')} ${srcLink(DOC.lifecycle, 'lifecycle')}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="10" class="empty">No events match the current filters.</td></tr>';

  $('#e-count').textContent = count(state.events.length);
  $('#e-open').textContent = count(state.events.filter((e) => e.status === 'active').length);
  $('#e-yes').textContent = count(state.events.filter((e) => e.result === 'yes').length);
  $('#e-no').textContent = count(state.events.filter((e) => e.result === 'no').length);
}

function renderLedger(ledger) {
  const body = $('#e-ledger');
  const entries = ledger?.entries || [];
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No ledger rows yet — the refresh workflow writes this file after its first successful capture.</td></tr>';
    return;
  }
  const sorted = entries.slice().sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')));
  body.innerHTML = sorted
    .map(
      (e) => `<tr>
        <td class="title">${esc(e.title || e.ticker)}<span class="ticker">${esc(e.ticker)}</span></td>
        <td>${topicCell(e.topic)}</td>
        <td>${statusBadge(e.status || 'unknown', statusKind(e.status))}</td>
        <td>${resultCell(e.result)}</td>
        <td class="nowrap">${e.first_seen_at ? fmtDateTime(e.first_seen_at) : '—'}</td>
        <td class="mono">${esc(e.transition || '—')}</td>
        <td class="nowrap">${e.observed_at ? fmtDateTime(e.observed_at) : '—'}</td>
        <td>${srcLink(DOC.getMarkets, 'api')}</td>
      </tr>`,
    )
    .join('');
}

async function boot() {
  buildChips();
  const universe = await getUniverse({ depth, statuses: ['open', 'closed', 'settled'] });
  state.markets = universe.markets;

  // Prefer the event-level records; fall back to per-market records.
  if (universe.snapshot.events?.length) {
    state.events = universe.snapshot.events.map((e) => ({
      ...e,
      result: e.result ?? null,
      settlement_value_dollars: e.settlement_value_dollars ?? null,
      status: e.status || e.markets?.[0]?.status || null,
    }));
  } else {
    const byEvent = new Map();
    for (const m of universe.markets) {
      if (!m.event_ticker) continue;
      if (!byEvent.has(m.event_ticker)) {
        byEvent.set(m.event_ticker, {
          event_ticker: m.event_ticker,
          series_ticker: m.series_ticker,
          title: m.title,
          topic: m.topic,
          status: m.status,
          result: m.result,
          close_time: m.close_time,
          settlement_ts: m.settlement_ts,
          settlement_value_dollars: m.settlement_value_dollars,
          market_count: 0,
        });
      }
      const row = byEvent.get(m.event_ticker);
      row.market_count += 1;
      if (m.result && !row.result) row.result = m.result;
      if (m.status === 'finalized') { row.status = 'finalized'; row.settlement_ts = row.settlement_ts || m.settlement_ts; }
    }
    state.events = [...byEvent.values()];
  }

  setConn(universe.source === 'live' ? 'live' : universe.markets.length ? 'snapshot' : 'offline', universe.source);
  $('#e-freshness').textContent = universe.meta?.captured_at ? ` · snapshot ${fmtDateTime(universe.meta.captured_at)}` : '';
  render();
  renderLedger(universe.resolutions);

  $('#e-state').addEventListener('change', (e) => {
    state.resolution = e.target.value;
    render();
  });
  $('#e-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });
  $('#e-reload').addEventListener('click', async () => {
    const snapshot = await loadSnapshot(depth);
    renderLedger(snapshot.resolutions);
  });
}

boot();
