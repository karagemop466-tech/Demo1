/*
 * Headless functional test for the live dashboard, resolution tracker and trade ledger.
 * Fixtures are field-for-field shapes of the verified demo API responses recorded in
 * docs/api-verification.md, so the test asserts the page asks for the right endpoints and
 * renders only returned values. Run (jsdom is not vendored in the repo):
 *
 *   mkdir -p /tmp/kdtest && cd /tmp/kdtest && npm init -y && npm i jsdom@24
 *   cp $PWD/tests/dashboard.test.mjs .   # or edit ROOT below
 *   node dashboard.test.mjs
 *
 * 46/46 checks passed on 2026-11-20 (jsdom 24.1.3, node 22).
 */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = process.env.KD_ROOT || new URL('..', import.meta.url).pathname.replace(/\/tests\/$/, '');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const golfMarket = {
  ticker: 'KXPGATOUR-THRC26-GHIG', event_ticker: 'KXPGATOUR-THRC26', title: 'The RSM Classic: Garrick Higgo wins',
  yes_sub_title: 'Garrick Higgo', status: 'active', result: '', close_time: '2026-12-06T00:00:00Z',
  last_price_dollars: '0.0180', yes_bid_dollars: '0.0170', yes_bid_size_fp: '10352.92', yes_ask_dollars: '0.0180',
  yes_ask_size_fp: '195.78', no_bid_dollars: '0.9820', no_ask_dollars: '0.9830',
  volume_fp: '187565.81', volume_24h_fp: '176465.73', open_interest_fp: '178084.16', notional_value_dollars: '1.0000'
};
const electionMarket = {
  ticker: 'KXPRESNOMD-28-JS', event_ticker: 'KXPRESNOMD-28', title: 'Will Josh Shapiro be the Democratic Presidential nominee in 2028?',
  yes_sub_title: 'Josh Shapiro', status: 'active', result: '', close_time: '2028-11-07T15:00:00Z',
  last_price_dollars: '0.0490', yes_bid_dollars: '0.0470', yes_bid_size_fp: '17730.45', yes_ask_dollars: '0.0490', yes_ask_size_fp: '12192.91',
  no_bid_dollars: '0.9510', no_ask_dollars: '0.9530', volume_fp: '60150347.85', volume_24h_fp: '7647.32',
  open_interest_fp: '18109179.85', notional_value_dollars: '1.0000'
};
const trades = [
  { ticker: 'KXPGATOUR-THRC26-GHIG', count_fp: '1.42', created_time: '2026-11-20T11:11:02.149142Z', is_block_trade: false, no_price_dollars: '0.9820', taker_book_side: 'bid', taker_outcome_side: 'yes', taker_side: 'yes', yes_price_dollars: '0.0180', trade_id: 't1' },
  { ticker: 'KXPRESNOMD-28-JS', count_fp: '1.09', created_time: '2026-11-20T11:11:02.136473Z', is_block_trade: false, no_price_dollars: '0.9510', taker_book_side: 'bid', taker_outcome_side: 'yes', taker_side: 'yes', yes_price_dollars: '0.0490', trade_id: 't2' },
  { ticker: 'KXPGATOUR-THRC26-GHIG', count_fp: '2.00', created_time: '2026-11-20T11:10:02.129257Z', is_block_trade: false, no_price_dollars: '0.9800', taker_book_side: 'ask', taker_outcome_side: 'no', taker_side: 'no', yes_price_dollars: '0.0200', trade_id: 't3' }
];
const events = [
  { event_ticker: 'KXPGATOUR-THRC26', series_ticker: 'KXPGATOUR', title: 'Who wins The RSM Classic?', category: 'Sports', mutually_exclusive: true, collateral_return_type: 'MECNET' },
  { event_ticker: 'KXPRESNOMD-28', series_ticker: 'KXPRESNOMD', title: 'Who will be the 2028 Democratic presidential nominee?', category: 'Elections' }
];
const seriesByTopic = {
  'category=Sports': [{ ticker: 'KXPGATOUR', title: 'PGA Tour', category: 'Sports', categories: ['Sports'], tags: ['Golf'], volume_fp: '10' }],
  'category=Elections': [{ ticker: 'KXPRESNOMD', title: 'Democrat Presidential Nominee 2028', category: 'Elections', categories: ['Elections'], tags: ['Democratic primaries'], volume_fp: '10' }],
  'category=Crypto': [{ ticker: 'KXBTC', title: 'Bitcoin price', category: 'Crypto', categories: ['Crypto'], tags: ['BTC'], volume_fp: '10' }],
  'category=Entertainment': [{ ticker: 'KXOSCAR', title: 'Oscars', category: 'Entertainment', categories: ['Entertainment'], tags: ['Awards'], volume_fp: '10' }],
  'category=Commodities': [{ ticker: 'KXGAS', title: 'Gas price', category: 'Commodities', categories: ['Commodities'], tags: ['Oil & Gas'], volume_fp: '10' }],
  'category=Economics': [{ ticker: 'KXOIL', title: 'Oil and energy', category: 'Economics', categories: ['Economics'], tags: ['Oil and energy'], volume_fp: '10' }],
  'category=Politics': []
};
const orderbook = {
  orderbook_fp: {
    yes_dollars: [['0.0020', '249999.99'], ['0.0030', '166666.65'], ['0.0150', '11111.11'], ['0.0160', '10416.66'], ['0.0170', '10352.92']],
    no_dollars: [['0.9780', '7575.75'], ['0.9790', '7936.50'], ['0.9800', '8333.33'], ['0.9820', '202.30']]
  }
};
const candles = {
  ticker: 'KXPGATOUR-THRC26-GHIG',
  candlesticks: [
    { end_period_ts: 1795165200, open_interest_fp: '177230.40', price: { close_dollars: '0.0180', high_dollars: '0.0180', low_dollars: '0.0180', open_dollars: '0.0180', mean_dollars: '0.0180', previous_dollars: '0.0180' }, volume_fp: '325.26', yes_ask: { close_dollars: '0.0180', high_dollars: '0.0180', low_dollars: '0.0180', open_dollars: '0.0180' }, yes_bid: { close_dollars: '0.0170', high_dollars: '0.0170', low_dollars: '0.0170', open_dollars: '0.0170' } },
    { end_period_ts: 1795168800, open_interest_fp: '177608.08', price: { close_dollars: '0.0190', high_dollars: '0.0190', low_dollars: '0.0180', open_dollars: '0.0180', mean_dollars: '0.0185', previous_dollars: '0.0180' }, volume_fp: '377.68', yes_ask: { close_dollars: '0.0190', high_dollars: '0.0190', low_dollars: '0.0180', open_dollars: '0.0180' }, yes_bid: { close_dollars: '0.0180', high_dollars: '0.0180', low_dollars: '0.0170', open_dollars: '0.0170' } },
    { end_period_ts: 1795172400, open_interest_fp: '177949.46', price: { close_dollars: '0.0180', high_dollars: '0.0190', low_dollars: '0.0175', open_dollars: '0.0190', mean_dollars: '0.0182', previous_dollars: '0.0190' }, volume_fp: '341.38', yes_ask: { close_dollars: '0.0180', high_dollars: '0.0190', low_dollars: '0.0175', open_dollars: '0.0190' }, yes_bid: { close_dollars: '0.0170', high_dollars: '0.0180', low_dollars: '0.0170', open_dollars: '0.0180' } }
  ]
};
const settled = {
  markets: [
    Object.assign({}, golfMarket, { result: 'no', status: 'settled', settlement_ts: '2026-11-22T00:11:00Z', settlement_value_dollars: '0.0000' }),
    Object.assign({}, golfMarket, { ticker: 'KXPGATOUR-THRC26-SCH', result: 'yes', status: 'settled', settlement_ts: '2026-11-22T00:11:00Z', settlement_value_dollars: '1.0000' })
  ], cursor: ''
};

function mockFetch(log) {
  return async function (url) {
    const u = String(url);
    log.push(u);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('/exchange/status')) return json({ exchange_active: true, trading_active: true, intra_exchange_transfers_active: true, exchange_index_statuses: [] });
    if (u.includes('/markets/trades')) return json({ trades: trades, cursor: '' });
    if (u.includes('/markets?limit=1000&tickers=')) return json({ markets: [golfMarket, electionMarket], cursor: '' });
    if (u.includes('/markets?status=open&series_ticker=KXBTC')) return json({ markets: [], cursor: '' });
    if (u.includes('/markets?limit=1000&event_ticker=')) return json(settled);
    if (u.includes('/events?limit=200&tickers=')) return json({ events: events, cursor: '' });
    if (u.includes('/series?include_volume=true')) {
      const hit = Object.keys(seriesByTopic).find((k) => u.includes(k) && u.includes(k.split('=')[1]));
      const key = Object.keys(seriesByTopic).find((k) => u.indexOf(k) > -1);
      return json({ series: hit ? seriesByTopic[hit] : (key ? seriesByTopic[key] : []) });
    }
    if (u.includes('/orderbook')) return json(orderbook);
    if (u.includes('/candlesticks')) return json(candles);
    if (u.includes('/portfolio/')) return json({ error: 'bridge_not_configured_in_test' });
    throw new Error('unexpected fetch in test: ' + u);
  };
}

function canvasStub(win, calls) {
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'canvas') return null;
        if (['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'fillText', 'closePath', 'arc'].includes(prop)) {
          return (...args) => calls.push(String(prop) + '(' + args.map((a) => (typeof a === 'number' ? a.toFixed(1) : JSON.stringify(a))).join(',').slice(0, 40) + ')');
        }
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => {};
      },
      set() { return true; }
    });
  };
}

async function load(page, extra) {
  const html = read(page);
  const calls = [], fetched = [], errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  vc.on('error', (m) => errors.push('console.error: ' + m));
  const dom = new JSDOM(html, {
    url: 'https://karagemop466-tech.github.io/Demo1/' + page,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.fetch = mockFetch(fetched);
      win.CustomEvent = win.CustomEvent || function () {};
      win.confirm = () => true;
      win.URL.createObjectURL = () => 'blob:test';
      win.devicePixelRatio = 1;
      Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientWidth', { get: () => 620 });
      Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientHeight', { get: () => 300 });
      canvasStub(win, calls);
      if (extra) extra(win);
    }
  });
  const w = dom.window;
  w.eval(read('assets/js/kalshi-core.js'));
  if (fs.existsSync(path.join(ROOT, 'assets/js/kalshi-ui.js'))) w.eval(read('assets/js/kalshi-ui.js'));
  const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  const scriptTag = html.match(/<script src="\.\.\/assets\/js\/live\.js"><\/script>/);
  if (scriptTag) w.eval(read('assets/js/live.js'));
  else if (inline) w.eval(inline[1]);
  for (let i = 0; i < 40 && errors.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
  return { dom, w, calls, fetched, errors, doc: w.document };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')); } };

console.log('\n== pages/live.html ==');
{
  const { w, doc, calls, fetched, errors } = await load('pages/live.html');
  const txt = doc.getElementById('event-rows').textContent.replace(/\s+/g, ' ');
  check('no script errors', errors.length === 0, errors.join(' | '));
  check('demo reachability probed first', fetched[0] && fetched[0].includes('/exchange/status'), fetched[0]);
  check('scan hydrated markets + events + taxonomy',
    fetched.some((u) => u.includes('tickers=')) && fetched.some((u) => u.includes('/events?limit=200&tickers=')) && fetched.some((u) => u.includes('/series?include_volume=true')));
  check('two live events ranked', /Who wins The RSM Classic/.test(txt) && /Democratic presidential nominee/.test(txt), txt.slice(0, 160));
  check('dollar notional computed from official fields (60,150,347.85 x $1)', /\$60,150,347\.85/.test(txt), txt.slice(0, 400));
  check('golf event notional 187,565.81 shown', /\$187,565\.81/.test(txt));
  check('open exposure column uses open_interest x notional', /18,109,179\.85/.test(txt));
  check('topics classified via official series taxonomy (golf + elections)', /Golf/.test(txt) && /Elections/.test(txt), txt.slice(0, 200));
  check('result column reports open markets', /open/.test(txt));
  const rows = doc.querySelectorAll('#event-rows tr[data-ev]');
  check('rows carry API + Kalshi source links', rows.length === 2 && rows[0].querySelectorAll('td.src a').length === 2);
  check('request log rendered with statuses', doc.querySelectorAll('#req-log tr').length >= 5 && /200/.test(doc.getElementById('req-log').textContent));
  // click the top row -> chart + book
  rows[0].querySelector('td').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  check('candlestick request uses official path + required params', fetched.some((u) => u.indexOf('/series/') > -1 && u.indexOf('/candlesticks?start_ts=') > -1 && u.indexOf('&period_interval=') > -1), 'see url dump');
  check('chart drew points (stroke + line segments)', calls.filter((c) => c.startsWith('stroke(')).length > 0 && calls.filter((c) => c.startsWith('lineTo(')).length > 3, calls.slice(0, 4).join(' '));
  check('axis labels rendered', calls.some((c) => c.includes('fillText') && c.includes('$0.00')) && calls.some((c) => c.includes('YES contract price')), calls.slice(0, 8).join(' '));
  check('order book requested with depth', fetched.some((u) => /\/orderbook\?depth=30/.test(u)));
  const ladder = doc.getElementById('book-ladder').textContent;
  check('liquidity ladder shows contracts at each price', /0\.0170/.test(ladder) && /10,352\.92/.test(ladder), ladder.slice(0, 200));
  check('implied ask + spread derived from reciprocal rule', /0\.9820/.test(doc.getElementById('book-summary').textContent) && /Spread/.test(doc.getElementById('book-summary').textContent));
  check('depth dollars = contracts x price', /\$176/.test(ladder) || /2024\.68|176,?00|175,?999/.test(ladder), ladder.slice(-200));
  // seconds-resolution mode
  doc.getElementById('interval').value = 'ticks';
  doc.getElementById('reload-chart').dispatchEvent(new w.Event('click', { bubbles: true }));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  check('sub-minute mode switches to the trades endpoint', fetched.filter((u) => u.includes('/markets/trades?limit=1000&market_ticker=')).length > 0);
  // watch list
  const watchBtn = doc.querySelector('#event-rows [data-watch]');
  watchBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  check('watch persists to localStorage', Object.keys(JSON.parse(w.localStorage.getItem('kd.watchlist') || '{}')).length === 1, w.localStorage.getItem('kd.watchlist'));
    check('no simulated-data affordance on the page', !/simulat|mock|sample data|demo data \(fake/i.test(doc.body.innerHTML));
  check('auto-refresh default is 30s', doc.getElementById('cadence').value === '30000');
}

console.log('\n== pages/resolutions.html ==');
{
  const { doc, fetched, errors, w } = await load('pages/resolutions.html', (win) => {
    win.localStorage.setItem('kd.watchlist', JSON.stringify({ 'KXPGATOUR-THRC26': { title: 'Who wins The RSM Classic?', topics: ['golf'], firstSeen: '2026-11-20T11:00:00Z' } }));
  });
  const txt = doc.getElementById('rows').textContent.replace(/\s+/g, ' ');
  const mrows = doc.getElementById('market-rows').textContent.replace(/\s+/g, ' ');
  check('no script errors', errors.length === 0, errors.join(' | '));
  check('tracked event polled via official endpoint', fetched.some((u) => u.includes('/markets?limit=1000&event_ticker=KXPGATOUR-THRC26')), fetched[0]);
  check('resolution reported as YES / NO per market', /YES ×1/.test(txt) && /NO ×1/.test(txt), txt.slice(0, 220));
  check('settlement fields surfaced when returned', /2026-11-22T00:11:00Z/.test(txt), txt.slice(0, 300));
  check('append-only market log written with result', /YES/.test(mrows) && /NO/.test(mrows), mrows.slice(0, 200));
  check('log carries a clickable source URL', doc.querySelector('#market-rows a') && /event_ticker=/.test(doc.querySelector('#market-rows a').href), doc.querySelector('#market-rows a') && doc.querySelector('#market-rows a').href);
  const store = JSON.parse(w.localStorage.getItem('kd.resolutions') || '{}');
  check('resolution store keyed by market with result', !!store['m:KXPGATOUR-THRC26-GHIG'] && store['m:KXPGATOUR-THRC26-GHIG'].result === 'no', JSON.stringify(store).slice(0, 200));
}

console.log('\n== pages/strategy.html ==');
{
  const { doc, errors, w, fetched: strategyFetch } = await load('pages/strategy.html');
  check('no script errors', errors.length === 0, errors.join(' | '));
  check('bridge default is the documented localhost proxy', doc.getElementById('bridge-url').value === 'http://localhost:8787/trade-api/v2');
  // import fills in the official API shape
  doc.getElementById('paste').value = JSON.stringify({
    fills: [
      { fill_id: 'f1', ticker: 'KXPGATOUR-THRC26-GHIG', action: 'buy', outcome_side: 'yes', book_side: 'bid', count_fp: '100.00', yes_price_dollars: '0.0180', no_price_dollars: '0.9820', fee_cost: '0.0200', is_taker: true, created_time: '2026-11-20T10:00:00Z' },
      { fill_id: 'f2', ticker: 'KXPGATOUR-THRC26-GHIG', action: 'sell', outcome_side: 'yes', book_side: 'ask', count_fp: '50.00', yes_price_dollars: '0.0200', no_price_dollars: '0.9800', fee_cost: '0.0100', is_taker: false, created_time: '2026-11-20T10:05:00Z' }
    ]
  });
  doc.getElementById('import').dispatchEvent(new w.Event('click', { bubbles: true }));
  const ledger = doc.getElementById('fills').textContent.replace(/\s+/g, ' ');
  check('fills parsed into the ledger', /KXPGATOUR-THRC26-GHIG/.test(ledger) && /100\.00/.test(ledger), ledger.slice(0, 200));
  check('strategy rules tagged (longshot-buy + sell-side)', /longshot-buy/.test(ledger) && /sell-side/.test(ledger), ledger.slice(0, 300));
  check('taker/maker role preserved', /taker/.test(ledger) && /maker/.test(ledger));
  check('open trades excluded from settled ratios', /still open — excluded/.test(doc.getElementById('strategies').textContent.replace(/\s+/g, ' ')), doc.getElementById('strategies').textContent.slice(0, 160));
  // now mark a resolution so P&L becomes computable from official result data
  w.localStorage.setItem('kd.resolutions', JSON.stringify({ 'm:KXPGATOUR-THRC26-GHIG': { market_ticker: 'KXPGATOUR-THRC26-GHIG', result: 'no', seenAt: 'x' } }));
  doc.getElementById('paste').value = JSON.stringify({ fills: [
      { fill_id: 'f1', ticker: 'KXPGATOUR-THRC26-GHIG', action: 'buy', outcome_side: 'yes', book_side: 'bid', count_fp: '100.00', yes_price_dollars: '0.0180', no_price_dollars: '0.9820', fee_cost: '0.0200', is_taker: true, created_time: '2026-11-20T10:00:00Z' },
      { fill_id: 'f2', ticker: 'KXPGATOUR-THRC26-GHIG', action: 'sell', outcome_side: 'yes', book_side: 'ask', count_fp: '50.00', yes_price_dollars: '0.0200', no_price_dollars: '0.9800', fee_cost: '0.0100', is_taker: false, created_time: '2026-11-20T10:05:00Z' }
  ]});
  doc.getElementById('import').dispatchEvent(new w.Event('click', { bubbles: true }));
  const perf = doc.getElementById('strategies').textContent.replace(/\s+/g, ' ');
  const ledger2 = doc.getElementById('fills').textContent.replace(/\s+/g, ' ');
  check('settled by resolution log (NO)', /NO/.test(ledger2));
  check('realised P&L computed (buy YES at 0.018 lost; sell YES at 0.02 won)', /-\$1\.82|\$3\.18|-\$1\.8[0-9]/.test(ledger2), ledger2.slice(0, 320));
  check('scoreboard lists a strategy row with staked/net/ROI', /Longshot buy|favorite buy|midrange|unclassified/.test(perf) && /%/.test(perf), perf.slice(0, 240));
  // order builder must not send
  const before = w.location.href;
  doc.getElementById('o-ticker').value = 'KXPGATOUR-THRC26-SCH';
  doc.getElementById('draft').dispatchEvent(new w.Event('click', { bubbles: true }));
  const out = doc.getElementById('draft-out').textContent;
  check('draft shows exact POST body and refuses to send', /POST .*\/portfolio\/events\/orders/.test(out) && /"time_in_force": "good_till_canceled"/.test(out) && /Nothing has been sent/.test(out), out.slice(0, 200));
  check('page itself never issues a portfolio/order call', !strategyFetch.some((u) => /\/portfolio\//.test(u)), strategyFetch.filter((u)=>/portfolio/.test(u)).join(' '));
}

console.log('\n== shared engine invariants ==');
{
  const { w, errors } = await load('pages/live.html');
  const K = w.KalshiDemo;
  check('engine exposes the demo hosts from the official docs', K.HOSTS.recommended === 'https://external-api.demo.kalshi.co/trade-api/v2' && K.HOSTS.alt === 'https://demo-api.kalshi.co/trade-api/v2');
  check('WS hosts match the official docs', K.WS_URLS.recommended === 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2');
  check('usd()/cnt() keep blanks for missing values (no zero-padding)', K.usd(null) === '' && K.cnt(undefined) === '' && K.compact(null) === '');
  check('marketDollars multiplies official fields', JSON.stringify(K.marketDollars({ volume_fp: '187565.81', volume_24h_fp: '176465.73', open_interest_fp: '178084.16', notional_value_dollars: '1.0000' })) === JSON.stringify({ traded: 187565.81, traded24h: 176465.73, exposure: 178084.16 }));
  let threw = '';
  try { await K.candles('KXPGATOUR', 'X', '5m', 3600); } catch (e) { threw = e.message; }
  check('unsupported intervals are refused, not approximated', /only accepts period_interval 1, 60 or 1440/.test(threw), threw);
  check('no page errors during engine use', errors.length === 0, errors.join('|'));
}

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL CHECKS PASSED') + '  (passed: ' + pass + ')');
process.exit(fail ? 1 : 0);
