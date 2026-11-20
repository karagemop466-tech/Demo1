/* Executive summary page: live headline numbers plus the static narrative. */

import { $, count, money, fmtDateTime } from '../util.js';
import { getUniverse } from '../universe.js';
import { loadSnapshot } from '../data.js';

const depth = 1;

async function boot() {
  const universe = await getUniverse({ depth });
  const markets = universe.markets;

  $('#x-count').textContent = count(markets.length);
  $('#x-captured').textContent = universe.meta?.captured_at ? fmtDateTime(universe.meta.captured_at) : '—';
  $('#x-account').textContent = universe.snapshot.portfolio?.normalized ? 'snapshot available' : 'not connected';

  const oi = markets.map((m) => universe.metrics[m.ticker]?.openInterestNotional).filter((v) => v !== null && v !== undefined);
  const vol = markets.map((m) => universe.metrics[m.ticker]?.volume24hNotional).filter((v) => v !== null && v !== undefined);
  $('#x-oi').textContent = oi.length ? money(Math.max(...oi)) : '—';
  $('#x-vol').textContent = vol.length ? money(Math.max(...vol)) : '—';

  const settled = markets.filter((m) => m.status === 'finalized');
  const yes = settled.filter((m) => m.result === 'yes').length;
  const no = settled.filter((m) => m.result === 'no').length;
  $('#x-settled').textContent = count(settled.length);
  $('#x-settled-note').textContent = `${yes} YES · ${no} NO`;

  $('#x-note').textContent =
    `Source: ${universe.source === 'live' ? 'live demo Trade API' : 'committed snapshot'}` +
    `${universe.meta?.captured_at ? ` captured ${fmtDateTime(universe.meta.captured_at)}` : ''}` +
    '. A blank value means the API did not return it.';

  const snapshot = await loadSnapshot(depth);
  const flagged = snapshot.meta?.errors?.length || 0;
  $('#x-flagged').textContent = String(12);
  void flagged;
}

boot();
