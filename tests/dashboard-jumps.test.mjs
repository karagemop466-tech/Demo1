/*
 * Headless test for the root live dashboard (dashboard.html + assets/dashboard.js).
 * Focuses on the sharp-move feature: consecutive price changes >= $0.10 are detected,
 * marked on the chart, and rendered in the "Sharp moves" table with the market's
 * official page + API source links.
 *
 * Fixtures are field-for-field shapes of the verified demo API responses (see
 * docs/api-verification.md). jsdom is a devDependency (npm install).
 *
 *   node tests/dashboard-jumps.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/tests\/$/, '');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TICKER = 'KXAAAGASD-26NOV20-3.6900';
const marketFixture = {
  ticker: TICKER, event_ticker: 'KXAAAGASD-26NOV20', series_ticker: null,
  title: 'Will average gas prices be above $3.6900?', status: 'active', result: '',
  close_time: '2026-11-20T04:59:00Z', volume_fp: '24.52', volume_24h_fp: '24.52',
  open_interest_fp: '24.52', notional_value_dollars: '1.0000', last_price_dollars: '0.1500',
  yes_bid_dollars: '0.1500', yes_ask_dollars: '0.5400', no_bid_dollars: '0.0000', no_ask_dollars: '1.0000',
  yes_bid_size_fp: '0.00', yes_ask_size_fp: '0.00',
  market_url: 'https://kalshi.com/markets/KXAAAGASD-26NOV20',
  source_markets: 'https://external-api.demo.kalshi.co/trade-api/v2/markets'
};
// Candles: 0.10 -> 0.25 (up $0.15) -> 0.25 -> 0.10 (down $0.15): two sharp moves.
const candlesFixture = {
  ticker: TICKER,
  candlesticks: [
    { end_period_ts: 1795136400, price: { close_dollars: '0.1000' }, volume_fp: '1.00' },
    { end_period_ts: 1795140000, price: { close_dollars: '0.2500' }, volume_fp: '1.00' },
    { end_period_ts: 1795143600, price: { close_dollars: '0.2500' }, volume_fp: '1.00' },
    { end_period_ts: 1795147200, price: { close_dollars: '0.1000' }, volume_fp: '1.00' }
  ]
};
const orderbookFixture = { orderbook_fp: { yes_dollars: [['0.1500', '10.00']], no_dollars: [['0.4600', '5.00']] } };

function mockFetch(log) {
  return async function (url) {
    const u = String(url);
    log.push(u);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('data/markets.json')) return json({ markets: [marketFixture] });
    if (u.includes('/orderbook')) return json(orderbookFixture);
    if (u.includes('/candlesticks')) return json(candlesFixture);
    if (u.includes('/markets/' + encodeURIComponent(TICKER))) return json({ market: marketFixture });
    throw new Error('unexpected fetch in test: ' + u);
  };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')); }
};

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
vc.on('error', (m) => errors.push('console.error: ' + m));

const dom = new JSDOM(read('dashboard.html'), {
  url: 'https://karagemop466-tech.github.io/Demo1/dashboard.html',
  runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
});
const w = dom.window;
const fetched = [];
w.fetch = mockFetch(fetched);
w.confirm = () => true;
w.eval(read('assets/common.js'));
w.eval(read('assets/dashboard.js'));
// The parser already fired DOMContentLoaded; re-dispatch so the dashboard boots.
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

// allow the fetch chain (markets.json -> init -> refresh -> candlesticks) to settle
for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 25));

const doc = w.document;
const jumpsHtml = doc.getElementById('jumps').innerHTML;
const svgHtml = doc.getElementById('chart').innerHTML;
const jumpsText = doc.getElementById('jumps').textContent.replace(/\s+/g, ' ');

console.log('\n== root dashboard sharp-move feature ==');
check('no script errors', errors.length === 0, errors.join(' | '));
check('markets.json loaded to seed the market dropdown', typeof w.KD_MARKETS !== 'undefined' && w.KD_MARKETS.length === 1);
check('candlesticks fetched with required params',
  fetched.some((u) => u.includes('/candlesticks') && u.includes('start_ts=') && u.includes('period_interval=')), fetched.join(' | '));
check('sharp-move table rendered two jumps (up $0.15, down $0.15)',
  /▲ up/.test(jumpsText) && /▼ down/.test(jumpsText) && (jumpsText.match(/▲ up|▼ down/g) || []).length === 2, jumpsText.slice(0, 200));
check('jump magnitude >= $0.10 shown', /\$0\.1500/.test(jumpsText), jumpsText.slice(0, 200));
check('jump row links to the official market page', /kalshi\.com\/markets\/KXAAAGASD-26NOV20/.test(jumpsHtml), jumpsHtml.slice(0, 200));
check('jump row links to the API source', /external-api\.demo\.kalshi\.co\/trade-api\/v2\/markets/.test(jumpsHtml), jumpsHtml.slice(0, 200));
check('chart marks jumps with dashed vertical markers', /stroke-dasharray/.test(svgHtml), svgHtml.slice(0, 120));
check('no fabricated cause asserted (only market page + API source links)',
  !/caused by|because of|news|reason:/i.test(jumpsText + doc.getElementById('jumps-card').textContent));

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL CHECKS PASSED') + '  (passed: ' + pass + ')');
process.exit(fail ? 1 : 0);
