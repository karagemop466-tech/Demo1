import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const dataFiles = {
  '../tape-desk/data/watchlist.json': json('tape-desk/data/watchlist.json'),
  '../snapshot/charts.json': json('snapshot/charts.json'),
  '../alert-desk/data/seed.json': json('alert-desk/data/seed.json'),
  '../sim-desk/data/performance.json': json('sim-desk/data/performance.json'),
  '../docs/data/snapshot.json': json('docs/data/snapshot.json')
};
let html = read('dashboard-shell/index.html');
for (const [src, file] of [
  ['../tape-desk/core.js', 'tape-desk/core.js'],
  ['../trade-desk/assets/util.js', 'trade-desk/assets/util.js'],
  ['../trade-desk/assets/chart.js', 'trade-desk/assets/chart.js'],
  ['app.js', 'dashboard-shell/app.js']
]) html = html.replace(`<script src="${src}"></script>`, () => `<script>${read(file)}</script>`);
const watch = dataFiles['../tape-desk/data/watchlist.json'];
const topics = Object.values(watch.watchlist);
const first = watch.watchlist.gas_prices.events[0].markets[0].market_ticker;
const eventCount = topics.reduce((n, g) => n + g.events.length, 0);
const marketCount = topics.reduce((n, g) => n + g.events.reduce((m, e) => m + e.markets.length, 0), 0);
const firstEventCount = topics.filter(g => g.events.length).length;
const firstMarketCount = topics.reduce((n, g) => n + (g.events[0]?.markets.length || 0), 0);
const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, label) {
  for (let i = 0; i < 150; i++) { if (test()) return; await wait(10); }
  throw new Error('Timed out waiting for ' + label);
}
function build(mode) {
  let phase = 0;
  const calls = [], errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, {
    url: 'https://karagemop466-tech.github.io/Demo1/dashboard-shell/index.html',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (url, options = {}) => {
        url = String(url); calls.push({ url, options });
        if (Object.hasOwn(dataFiles, url)) {
          if (mode === 'missing-local' && phase === 0 && url.includes('watchlist')) return { ok: false, status: 500 };
          return ok(dataFiles[url]);
        }
        if (!url.startsWith('https://external-api.demo.kalshi.co/trade-api/v2')) throw Error('Unexpected request: ' + url);
        if (mode === 'offline' || mode === 'missing-local') throw new TypeError('network unavailable');
        if (phase === 2) return { ok: false, status: 429, json: async () => ({}) };
        const u = new URL(url), p = u.pathname;
        if ((phase === 3 && p.endsWith('/orderbook')) || (phase === 5 && p.endsWith('/candlesticks')) || (phase === 4 && p.endsWith('/markets/' + first))) return { ok: false, status: 503, json: async () => ({}) };
        if (p.endsWith('/markets/trades')) {
          const when = Date.now() - (phase === 0 ? 10000 : 5000);
          return ok({ trades: [{ trade_id: 'trade-' + phase, ticker: first, yes_price_dollars: phase === 0 ? '0.5000' : '0.6000', count_fp: '2.00', created_time: new Date(when).toISOString() }], cursor: phase === 6 ? 'next-page' : '' });
        }
        if (p.endsWith('/orderbook')) return ok({ orderbook_fp: { yes_dollars: [['0.4900','12.00'], ['0.3000', null]], no_dollars: [['0.4500','8.00']] } });
        if (p.endsWith('/candlesticks')) {
          const now = Math.floor(Date.now() / 1000);
          if (phase === 8) return ok({ candlesticks: [{ end_period_ts: now - 180, price: { close_dollars: '0.5000' } }, { end_period_ts: now - 120, price: { close_dollars: null } }, { end_period_ts: now - 60, price: { close_dollars: '0.7000' } }] });
          return ok({ candlesticks: [{ end_period_ts: now - 120, price: { close_dollars: '0.5000' } }, { end_period_ts: now - 60, price: { close_dollars: '0.6000' } }] });
        }
        const ticker = decodeURIComponent(p.split('/').pop());
        const lifecycle = ticker === first && phase === 9 ? { status: 'determined', result: 'yes' } : ticker === first && phase === 10 ? { status: 'finalized', result: '' } : ticker === first && phase === 11 ? { status: 'finalized', result: 'no' } : { status: 'active', result: '' };
        return ok({ market: { ticker, title: 'Live mock title', ...lifecycle, last_price_dollars: '0.5000', previous_price_dollars: '0.1000', yes_bid_dollars: '0.5000', yes_ask_dollars: '0.5500', yes_bid_size_fp: '10.00', yes_ask_size_fp: '8.00', volume_24h_fp: '1000.00', open_interest_fp: '400.00' } });
      };
    }
  });
  return { dom, calls, errors, setPhase: (x) => { phase = x; } };
}
function officialRows(document) {
  const bad = [...document.querySelectorAll('tbody tr')].filter((r) => ![...r.querySelectorAll('a[href]')].some((a) => /^https:\/\/(external-api\.demo\.kalshi\.co|demo-api\.kalshi\.co|docs\.kalshi\.com|kalshi\.com|docs\.github\.com)\//.test(a.href)));
  assert.equal(bad.length, 0, 'every rendered table row has an official source: ' + bad.map(r => r.textContent.trim()).join('; '));
}
let checks = 0;
function check(label, fn) { try { fn(); checks++; } catch (e) { e.message = label + ': ' + e.message; throw e; } }

// Offline boot: real, dated repository fixtures and no invented live values.
{
  const h = build('offline'), { window: w } = h.dom, d = w.document;
  await until(() => w.DashboardShell && w.DashboardShell.state.mode === 'snapshot' && !w.DashboardShell.state.running, 'offline render');
  check('bounded watchlist', () => assert.equal(d.querySelector('#stat-watch').textContent, String(marketCount)));
  check('offline badge', () => assert.match(d.querySelector('#connection').textContent, /Offline \/ stale/));
  check('offline retry disclosure', () => assert.match(d.querySelector('#notice').textContent, /snapshot.*retry/i));
  check('live counts do not include historical examples', () => { assert.equal(d.querySelector('#stat-alerts').textContent, '0'); assert.equal(d.querySelector('#all-count').textContent, '0'); });
  check('historical examples explicitly marked', () => assert.match(d.querySelector('#all-feed').textContent, /SNAPSHOT.*24-hour change/));
  check('model fallback explicitly marked', () => assert.match(d.querySelector('#model-feed').textContent, /SNAPSHOT.*24-hour change/));
  check('fallback chart is a dated archive or honestly empty', () => { const text = d.querySelector('#chart-basis').textContent; assert.match(text, /Archived snapshot|No history available/); if (/Archived/.test(text)) { assert.match(d.querySelector('#chart-note').textContent, /snapshot .* UTC/); assert.ok(d.querySelector('#chart path')); } });
  check('last price has its own timestamp and source', () => { assert.match(d.querySelector('#current-price-source').textContent, /Snapshot .* UTC/); assert.ok(d.querySelector('#current-price-source a[href*="/markets/"]')); });
  check('paper equity explicitly simulated', () => { const p = dataFiles['../sim-desk/data/performance.json']; assert.match(d.querySelector('.paper-badge').textContent, /SIMULATED/); assert.equal(d.querySelector('#paper-equity').textContent, p.simulated && Number.isFinite(p.equity) ? '$' + p.equity.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—'); });
  check('paper provenance warning visible', () => assert.match(d.querySelector('.paper-warning').textContent, /source mismatch/));
  check('non-final snapshot outcomes are not presented as final', () => { for (const r of watch.resolutions.slice(0,5)) { const row = [...d.querySelectorAll('#outcomes tr')].find(x => x.textContent.includes(r.market_ticker)); assert.ok(row); if (r.snapshot.status !== 'finalized' || !['yes','no','scalar'].includes(r.snapshot.result)) assert.match(row.textContent, /NOT FINAL/); } });
  check('initial table is bounded and grouped', () => { assert.equal(d.querySelectorAll('#market-body .event-row').length, firstEventCount); assert.equal(d.querySelectorAll('#market-body tr:not(.event-row)').length, firstMarketCount); });
  check('leading events use the newer bounded collection and official sources', () => { assert.equal(d.querySelectorAll('#ranking-body tr').length, 5); assert.match(d.querySelector('#ranking-asof').textContent, /Collected .* UTC/); assert.ok([...d.querySelectorAll('#ranking-body tr')].every(r => r.querySelector('a[href^="https://external-api.demo.kalshi.co/"],a[href^="https://docs.kalshi.com/"]'))); });
  check('candidate links to a chart when that event is watched', () => { const event = w.DashboardShell.state.ranking.topics.gas.top_events[0]; const match = watch.watchlist.gas_prices.events.find(x => x.event_ticker === event.event_ticker); if (match && match.markets.length) { const button = d.querySelector('#ranking-body [data-select="' + match.markets[0].market_ticker + '"]'); assert.ok(button); button.click(); assert.equal(w.DashboardShell.state.selected, match.markets[0].market_ticker); } });
  check('ranking estimates fail closed when saved input is truncated', () => { const event = w.DashboardShell.state.ranking.topics.gas.top_events[0]; const old = event.markets_truncated; event.markets_truncated = true; d.querySelector('[data-topic="gas_prices"]').click(); const row = d.querySelector('#ranking-body tr'); assert.equal(row.cells[1].textContent, '—'); assert.match(row.cells[2].textContent, /incomplete.*flagged/i); event.markets_truncated = old; d.querySelector('[data-topic="all"]').click(); });
  check('missing ranking input cannot become zero', () => { const event = w.DashboardShell.state.ranking.topics.gas.top_events[0]; const old = event.markets[0].last_price_dollars; event.markets[0].last_price_dollars = ' '; d.querySelector('[data-topic="gas_prices"]').click(); assert.equal(d.querySelector('#ranking-body tr').cells[1].textContent, '—'); event.markets[0].last_price_dollars = old; d.querySelector('[data-topic="all"]').click(); });
  check('mismatched snapshot sources blank the corresponding values and flag them', () => { const m = w.DashboardShell.state.data.watchlist.gas_prices.events[0].markets[0]; const original = { ...m.snapshot.sources }; m.snapshot.sources.market = 'https://example.com/wrong'; m.snapshot.sources.dollar_notional_24h = 'https://example.com/wrong'; d.querySelector('[data-topic="gas_prices"]').click(); const row = [...d.querySelectorAll('#market-body tr')].find(r => r.textContent.includes(m.market_ticker)); assert.equal(row.cells[1].textContent, '—'); assert.match(row.cells[2].textContent, /—.*flag/); assert.match(row.cells[4].textContent, /flag/); Object.assign(m.snapshot.sources, original); d.querySelector('[data-topic="all"]').click(); });
  check('every populated table row has an official source', () => officialRows(d));
  check('all five topics plus all filter', () => assert.equal(d.querySelectorAll('#topic-filters button').length, 6));
  check('mobile navigation retains topic pages, summary and review', () => { assert.equal(d.querySelectorAll('.mobile-topic-pages a').length, 5); assert.ok(d.querySelector('.mobile-extra[href="summary.html"]')); assert.ok(d.querySelector('.mobile-extra[href="review.html"]')); });
  check('historical alert has official source and unverified news label', () => { assert.ok(d.querySelector('#all-feed a[href^="https://external-api.demo.kalshi.co/"]')); assert.match(d.querySelector('#all-feed').textContent, /News search \(unverified\)/); });
  check('winning screen threshold inclusive', () => assert.ok(w.DashboardShell.modelScreen({ bid: .75, ask: .8, volume: 100 })));
  check('screen fails closed on missing data', () => { assert.equal(w.DashboardShell.modelScreen({ bid: null, ask: .8, volume: 100 }), null); assert.equal(w.DashboardShell.modelScreen({ bid: .74, ask: .8, volume: 100 }), null); assert.equal(w.DashboardShell.modelScreen({ bid: .8, ask: .8001, volume: 100 }), null); });
  check('jump boundary includes exactly ten cents', () => { const x = w.DashboardShell.adjacentJumps([{ts: 1, price: .5},{ts: 2, price: .6},{ts: 3, price: .6999}], 'T'); assert.equal(x.length, 1); });
  check('chart does not call changes across missing candles sudden moves', () => assert.equal(w.DashboardShell.adjacentJumps([{ts: 0, price: .5},{ts: 120000, price: .7}], 'T', 90000).length, 0));
  d.querySelector('#show-all').click();
  check('all saved events accessible', () => { assert.equal(d.querySelectorAll('#market-body .event-row').length, eventCount); assert.equal(d.querySelectorAll('#market-body tr:not(.event-row)').length, marketCount); officialRows(d); });
  d.querySelector('[data-topic="golf"]').click();
  check('topic filter', () => { assert.equal(d.querySelectorAll('#market-body .event-row').length, watch.watchlist.golf.events.length); assert.ok([...d.querySelectorAll('#market-body .event-row')].every(r => r.textContent.includes('Golf'))); assert.equal(d.querySelectorAll('#ranking-body tr').length, 1); assert.match(d.querySelector('#ranking-body').textContent, /Golf/); });
  d.querySelector('[data-window="30s"]').click();
  check('seconds view does not fabricate historical samples', () => { assert.match(d.querySelector('#chart-note').textContent, /browser-observed/); assert.match(d.querySelector('#chart-readout').textContent, /No official prices/); });
  check('blank account data', () => assert.equal(d.querySelector('.muted-value').textContent, '—'));
  check('no undefined or NaN in UI', () => assert.doesNotMatch(d.querySelector('#main').textContent, /\bundefined\b|\bNaN\b/));
  check('no runtime exceptions', () => assert.deepEqual(h.errors, []));
  h.dom.window.close();
}

// Live path: timestamped official-shaped payloads, threshold, screen, orderbook, then 429.
{
  const h = build('live'), { window: w } = h.dom, d = w.document;
  await until(() => w.DashboardShell && w.DashboardShell.state.mode === 'live' && !w.DashboardShell.state.running, 'first live poll');
  check('live badge reflects successful polling', () => assert.match(d.querySelector('#connection').textContent, /Live polling/));
  check('previous-day price is not misreported as a live move', () => assert.equal(w.DashboardShell.state.alerts.length, 0));
  check('live book implies ask from NO bid and preserves quantity', () => { assert.match(d.querySelector('#book-body').textContent, /\$0\.55\s*8\s*YES ask/); assert.match(d.querySelector('#book-body').textContent, /\$0\.49\s*12\s*YES bid/); });
  check('missing depth is never filled with zero', () => assert.doesNotMatch(d.querySelector('#book-body').textContent, /\$0\.30/));
  check('chart uses returned live candles', () => { assert.equal(d.querySelector('#chart-basis').textContent, 'API candles'); assert.match(d.querySelector('#chart-jump').textContent, /\+\$0\.10/); assert.match(d.querySelector('#chart-jump').textContent, /not a verified cause/); });
  h.setPhase(1);
  await w.DashboardShell.cycle();
  check('inclusive live alert', () => { assert.ok(w.DashboardShell.state.alerts.length >= 1); assert.match(d.querySelector('#all-feed').textContent, /\+\$0\.10/); });
  check('model gets a fresh source-linked quote', () => { assert.ok(w.DashboardShell.state.modelAlerts.length >= 1); assert.match(d.querySelector('#model-feed').textContent, /before fees/); assert.ok(d.querySelector('#model-feed a[href*="/markets/"]')); });
  check('model quote time is shown separately from the movement', () => assert.match(d.querySelector('#model-feed').textContent, /quote .* UTC/));
  check('live messages labeled and not mixed with seed', () => assert.match(d.querySelector('#all-feed').textContent, /OBSERVED THIS SESSION/));
  check('live rendered rows retain official sources', () => officialRows(d));
  check('all outbound API calls are public GETs', () => assert.ok(h.calls.filter(c => c.url.startsWith('https://external-api')).every(c => c.options.method === 'GET' && !('KALSHI-ACCESS-KEY' in (c.options.headers || {})))));
  h.setPhase(3); await w.DashboardShell.cycle();
  check('book failure is partial even when tape and markets succeed', () => assert.equal(w.DashboardShell.state.mode, 'partial'));
  h.setPhase(4); w.DashboardShell.state.slice = 0; await w.DashboardShell.cycle();
  check('one failed market is partial even when others succeed', () => assert.equal(w.DashboardShell.state.mode, 'partial'));
  h.setPhase(5); delete w.DashboardShell.state.candles[first + '|6h']; await w.DashboardShell.cycle();
  check('candle failure is partial even when other requests succeed', () => assert.equal(w.DashboardShell.state.mode, 'partial'));
  h.setPhase(6); await w.DashboardShell.cycle();
  check('trade-page cap is partial and disclosed', () => { assert.equal(w.DashboardShell.state.mode, 'partial'); assert.equal(w.DashboardShell.state.truncated, true); assert.match(d.querySelector('#feed-disclosure').textContent, /cap was reached/); });
  h.setPhase(8); delete w.DashboardShell.state.candles[first + '|6h']; await w.DashboardShell.cycle();
  check('missing candle produces a visual line break, not a jump marker', () => { const line = d.querySelector('#chart path[stroke]').getAttribute('d'); assert.equal((line.match(/M/g) || []).length, 2); assert.equal(d.querySelector('#chart-jump').hidden, true); });
  check('live candle fetch time and market source remain visible', () => { assert.match(d.querySelector('#chart-note').textContent, /fetched .* UTC/); assert.match(d.querySelector('#current-price-source').textContent, /Observed .* UTC/); });
  h.setPhase(9); w.DashboardShell.state.slice = 0; await w.DashboardShell.cycle();
  check('determined YES is not presented as final', () => { const row = [...d.querySelectorAll('#outcomes tr')].find(r => r.textContent.includes(first)); assert.ok(row); assert.match(row.textContent, /NOT FINAL.*determined/); });
  h.setPhase(10); w.DashboardShell.state.slice = 0; await w.DashboardShell.cycle();
  check('finalized with blank result remains unresolved', () => { const row = [...d.querySelectorAll('#outcomes tr')].find(r => r.textContent.includes(first)); assert.ok(row); assert.match(row.textContent, /NOT FINAL.*finalized/); });
  h.setPhase(11); w.DashboardShell.state.slice = 0; await w.DashboardShell.cycle();
  check('previously blank final result is retried and observed NO', () => { const row = [...d.querySelectorAll('#outcomes tr')].find(r => r.textContent.includes(first)); assert.ok(row); assert.match(row.textContent, /NO.*finalized/); });
  d.querySelector('#pause').click();
  check('pause works', () => { assert.equal(w.DashboardShell.state.paused, true); assert.match(d.querySelector('#connection').textContent, /paused/); });
  d.querySelector('#pause').click();
  await until(() => !w.DashboardShell.state.running, 'resume poll');
  h.setPhase(2);
  await w.DashboardShell.cycle();
  check('429 causes backoff and an honest stale state', () => { assert.ok(w.DashboardShell.state.backoff > 20000); assert.match(d.querySelector('#connection').textContent, /Offline \/ stale|Partial/); assert.match(d.querySelector('#notice').textContent, /snapshot|incomplete/i); });
  check('no runtime exceptions', () => assert.deepEqual(h.errors, []));
  h.dom.window.close();
}

// Local watchlist failure does not claim that monitoring is running; retry succeeds.
{
  const h = build('missing-local'), { window: w } = h.dom, d = w.document;
  await until(() => w.DashboardShell && w.DashboardShell.state.mode === 'unavailable' && !w.DashboardShell.state.booting, 'unavailable local data');
  check('missing watchlist is visible, without fake alert counts', () => { assert.match(d.querySelector('#connection').textContent, /Data unavailable/); assert.match(d.querySelector('#notice').textContent, /watchlist/); assert.equal(d.querySelector('#all-count').textContent, '—'); officialRows(d); });
  h.setPhase(1); d.querySelector('#refresh').click();
  await until(() => w.DashboardShell.state.mode === 'snapshot' && !w.DashboardShell.state.running, 'retry watchlist');
  check('retry loads saved watchlist without duplicated listeners', () => { assert.equal(d.querySelector('#stat-watch').textContent, String(marketCount)); d.querySelector('#show-all').click(); assert.match(d.querySelector('#show-all').textContent, /fewer/); });
  check('no runtime exceptions', () => assert.deepEqual(h.errors, []));
  h.dom.window.close();
}

// Static evidence tables, including their loading/empty rows.
for (const file of ['dashboard-shell/index.html','dashboard-shell/summary.html','dashboard-shell/review.html']) {
  const dom = new JSDOM(read(file), { url: 'https://karagemop466-tech.github.io/Demo1/' + file });
  check(file + ' static row sources', () => officialRows(dom.window.document));
  dom.window.close();
}
console.log(`dashboard-shell: ${checks} checks passed`);
