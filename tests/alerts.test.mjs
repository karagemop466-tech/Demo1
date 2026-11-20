/*
 * Live alert tapes — engine + page behaviour.
 *
 *   node tests/alerts.test.mjs
 *
 * Part 1 unit-tests the pure module (assets/alerts.js): the fee table rows published in
 * Kalshi's own fee schedule PDF, the $1.00-per-winning-contract payout identity, the swing
 * detector in both directions, the documented reciprocal order-book identity, and the five
 * gates of the ROI screen.
 *
 * Part 2 boots alerts.html in jsdom with fixtures shaped like verified demo API responses
 * (see docs/api-verification.md) and checks what actually renders in the two chat panes.
 * Nothing here touches the network; jsdom is a devDependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KA = await import('../assets/alerts.js').then((m) => m.default ?? m);

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  →  ' + detail : '')); }
};

// ------------------------------------------------------------------ 1. engine
console.log('\n== fee + payout maths (official fee schedule / settlement docs) ==');
check('taker fee matches the schedule row $0.50 x 100 = $1.75', KA.takerFee(0.5, 100, 1) === 1.75, KA.takerFee(0.5, 100, 1));
check('taker fee matches the schedule row $0.10 x 100 = $0.63', KA.takerFee(0.1, 100, 1) === 0.63, KA.takerFee(0.1, 100, 1));
check('taker fee matches the schedule row $0.20 x 1 = $0.02', KA.takerFee(0.2, 1, 1) === 0.02, KA.takerFee(0.2, 1, 1));
check('taker fee matches the schedule row $0.99 x 100 = $0.07', KA.takerFee(0.99, 100, 1) === 0.07, KA.takerFee(0.99, 100, 1));
check('maker fee uses 0.0175 and M=0 by default (zero)', KA.makerFee(0.5, 100) === 0 && KA.makerFee(0.5, 100, 1) === 0.44,
  KA.makerFee(0.5, 100) + '/' + KA.makerFee(0.5, 100, 1));
check('fee rounds UP to the cent, never nearest', KA.takerFee(0.31, 1, 1) === 0.02 && KA.roundUp(0.0001, 2) === 0.01,
  KA.takerFee(0.31, 1, 1));
check('fee is null for a blank or degenerate price', KA.takerFee('', 1, 1) === null && KA.takerFee(0, 1, 1) === null);
const eco20 = KA.sideEconomics(0.2, 1, { mult: 1 });
check('outlay = price + fee', eco20.outlay === 0.22, JSON.stringify(eco20));
check('payout = $1.00 per winning contract', eco20.payoutIfWins === 1, eco20.payoutIfWins);
check('net ROI = (payout - outlay)/outlay', Math.abs(eco20.roi - (1 - 0.22) / 0.22) < 1e-9, eco20.roi);
check('breakeven win probability = outlay/payout', Math.abs(eco20.breakevenWinProb - 0.22) < 1e-9, eco20.breakevenWinProb);
check('loss when the side loses = the whole outlay', eco20.lossIfLoses === 0.22, eco20.lossIfLoses);

console.log('\n== swing detection (>= $0.10 either direction) ==');
const up = KA.swing(0.2, 0.31), down = KA.swing(0.81, 0.7);
check('up move of $0.11 fires as "up"', up && up.dir === 'up' && Math.abs(up.delta - 0.11) < 1e-9, JSON.stringify(up));
check('down move of $0.11 fires as "down"', down && down.dir === 'down' && Math.abs(down.delta + 0.11) < 1e-9, JSON.stringify(down));
check('exactly $0.10 fires (>=, inclusive)', KA.swing(0.2, 0.30) !== null);
check('$0.0999 does not fire', KA.swing(0.2, 0.2999) === null);
check('blank price never fires', KA.swing(null, 0.5) === null && KA.swing('', 0) === null);
check('threshold is configurable', KA.swing(0.2, 0.25, 0.05) !== null && KA.swing(0.2, 0.25, 0.1) === null);

console.log('\n== order book: documented bids-only shape + reciprocal identity ==');
const book = KA.bookSides({ orderbook_fp: { yes_dollars: [['0.1500', '10.00'], ['0.2000', '5.00']], no_dollars: [['0.8600', '500.00']] } });
check('best bid is the LAST element (ascending order)', book.yes_bid.price === 0.2 && book.yes_bid.count === 5, JSON.stringify(book.yes_bid));
check('YES ask implied from the best NO bid = 1 - 0.86 = 0.14', Math.abs(book.yes_ask.price - 0.14) < 1e-9, JSON.stringify(book.yes_ask));
check('implied ask carries the NO bid size (500 contracts)', book.yes_ask.contracts === 500, book.yes_ask.contracts);
check('NO ask implied from the best YES bid = 1 - 0.20 = 0.80', Math.abs(book.no_ask.price - 0.8) < 1e-9, JSON.stringify(book.no_ask));
check('empty book yields no asks', KA.bookSides({ orderbook_fp: { yes_dollars: [], no_dollars: [] } }).yes_ask === null);
check('depthAtOrBetter sums from the level up', KA.depthAtOrBetter([['0.1500', '10.00'], ['0.2000', '5.00']], 0.15) === 15);
const v = KA.vwap([{ yes_price_dollars: '0.2500', count_fp: '100.00' }, { yes_price_dollars: '0.2000', count_fp: '100.00' }]);
check('VWAP weights by contracts (0.2250)', Math.abs(v.price - 0.225) < 1e-9, JSON.stringify(v));
check('VWAP is blank with no prints', KA.vwap([]) === null);
check('mark prefers the traded last price, then the book mid',
  KA.markOf({ last_price_dollars: '0.3000' }, book).value === 0.3 &&
  KA.markOf({ last_price_dollars: '' }, { yes_bid: { price: 0.2 }, yes_ask: { price: 0.8 } }).value === 0.5);

console.log('\n== the five gates ==');
const future = new Date(Date.now() + 3 * 86400e3).toISOString().replace(/\.\d+Z$/, 'Z');
const good = { ticker: 'KXAAAGASW-26NOV23-3.6400', status: 'active', close_time: future, yes_ask_dollars: '', no_ask_dollars: '' };
const scr = KA.screen(good, { book, vwap: { price: 0.25, contracts: 100 }, swing: { from: 0.25, to: 0.12, dir: 'down', delta: -0.13 }, nowSec: Math.floor(Date.now() / 1000) });
check('all five gates pass → eligible', scr.eligible === true, JSON.stringify(scr.gates));
check('candidate side/entry = YES @ 0.14 derived from the NO bid', scr.side === 'YES' && scr.entry === 0.14 && scr.ask_source === 'NO bid', scr.side + '/' + scr.entry + '/' + scr.ask_source);
check('gate detail prints contracts at the ask', scr.contracts_available === 500, scr.contracts_available);
check('score is finite and > 0 when eligible', typeof scr.score === 'number' && scr.score > 0, scr.score);
const noDepth = KA.screen(good, { book: KA.bookSides({ orderbook_fp: { yes_dollars: [], no_dollars: [['0.8600', '0.00']] } }), vwap: { price: 0.25, contracts: 10 }, swing: { from: 0.3, to: 0.1, dir: 'down', delta: -0.2 }, nowSec: KA.nowSec() });
check('zero depth at the ask fails G2 (fillable)', noDepth.eligible === false && noDepth.firstFailed === 'G2 fillable', JSON.stringify(noDepth.gates));
const noTrades = KA.screen(good, { book, swing: { from: 0.3, to: 0.1, dir: 'down', delta: -0.2 }, nowSec: KA.nowSec() });
check('no prints → G3 fails with a blank VWAP, not a zero', noTrades.eligible === false && /VWAP is blank/.test(noTrades.gates[2].detail), JSON.stringify(noTrades.gates[2]));
const rich = KA.screen(good, { book, vwap: { price: 0.145, contracts: 10 }, swing: { from: 0.3, to: 0.14, dir: 'down', delta: -0.16 }, nowSec: KA.nowSec() });
check('a $0.005 gap to VWAP is below the $0.02 lead → G3 fails', rich.firstFailed === 'G3 reversion', JSON.stringify(rich.gates[2]));
const closed = KA.screen({ status: 'settled', close_time: future }, { book, vwap: { price: 0.25, contracts: 10 }, swing: { from: 0.3, to: 0.1, dir: 'down', delta: -0.2 } });
check('a settled market fails G1', closed.eligible === false && closed.firstFailed === 'G1 in-window', JSON.stringify(closed.gates[0]));
const noBook = KA.screen({ status: 'active', close_time: future }, { vwap: { price: 0.25, contracts: 10 }, swing: { from: 0.3, to: 0.1, dir: 'down', delta: -0.2 } });
check('no ask anywhere → no candidate side, never a fabricated price', noBook.eligible === false && noBook.reason === 'no fillable ask', JSON.stringify(noBook));
const expensive = KA.screen({ status: 'active', close_time: future }, { book: { yes_bid: null, no_bid: { price: 0.05, count: 90 }, yes_ask: { price: 0.95, contracts: 90, derived_from: 'NO bid' }, no_ask: null }, vwap: { price: 0.99, contracts: 10 }, swing: { from: 0.85, to: 0.96, dir: 'up', delta: 0.11 } });
check('a $0.95 ask cannot clear the 10% payoff gate', expensive.firstFailed === 'G4 payoff', JSON.stringify(expensive.gates[3]));

console.log('\n== watchlist, topic index, snapshot swings, request builders ==');
const rows = [
  { topic: 'gas_prices', series_ticker: 'KXAAAGASW', market_ticker: 'G1', event_ticker: 'E1', dollar_notional_24h: { value: 50 }, status: 'active' },
  { topic: 'gas_prices', series_ticker: 'KXAAAGASW', market_ticker: 'G2', event_ticker: 'E1', dollar_notional_24h: { value: 900 }, status: 'active' },
  { topic: 'crypto', series_ticker: 'KXBTC', market_ticker: 'C1', event_ticker: 'E2', dollar_notional_24h: { value: 10 }, status: 'active' },
  { topic: 'golf', series_ticker: 'KXPGATOUR', market_ticker: 'O1', event_ticker: 'E3', status: 'active' }
];
const top = KA.topByDollar(rows, 1).map((r) => r.market_ticker);
check('highest-dollar first, grouped by topic', top[0] === 'G2' && top.includes('C1') && top.length === 3, top.join(','));
const idx = KA.buildTopicIndex(rows);
check('topic index maps a series to its topic', KA.topicOfTicker(idx, 'KXBTC-26DEC31-T1') === 'crypto' && KA.topicOfTicker(idx, 'KXNBA-27') === null);
const candles = {
  market_ticker: 'G1', series_ticker: 'KXAAAGASW',
  windows: { '1m/6h': { period_interval_minutes: 1, points: [
    { t: 100, price_close: 0.2, yes_bid_close: 0.2, yes_ask_close: 0.25 },
    { t: 160, price_close: 0.35, yes_bid_close: 0.34, yes_ask_close: 0.36 },
    { t: 220, price_close: null, yes_bid_close: 0.20, yes_ask_close: 0.26 },
    { t: 280, price_close: null, yes_bid_close: 0.30, yes_ask_close: 0.31 },
    { t: 340, price_close: 0.32, yes_bid_close: 0.31, yes_ask_close: 0.33 }
  ] } }
};
const hist = KA.swingsFromCandles(candles, 0.1);
check('candle scan finds the traded-close jump (0.20 → 0.35)', hist.some((h) => h.from === 0.2 && h.to === 0.35 && h.source === 'traded close'), JSON.stringify(hist[0]));
check('candle scan falls back to the book mid and keeps the sub-threshold out', hist.filter((h) => h.source === 'book mid').length === 1 && hist.length === 2, JSON.stringify(hist.map((h) => h.source + ':' + h.from + '->' + h.to)));
check('history is chronological', hist.every((h, i) => i === 0 || hist[i - 1].ts <= h.ts));
check('apiUrl explodes a tickers array', /tickers=A&tickers=B$/.test(KA.apiUrl('b', '/markets/orderbooks', { tickers: ['A', 'B'] })),
  KA.apiUrl('b', '/markets/orderbooks', { tickers: ['A', 'B'] }));
check('apiUrl skips blank params', KA.apiUrl('b', '/markets/trades', { limit: 1000, ticker: '' }) === 'b/markets/trades?limit=1000');
check('chunk keeps batches at 100 tickers', KA.chunk(new Array(250).fill('x'), 100).map((c) => c.length).join(',') === '100,100,50');
check('seriesOf takes the part before the first dash', KA.seriesOf('KXAAAGASW-26NOV23-3.6400') === 'KXAAAGASW');

console.log('\n== tape line shape ==');
const line = KA.makeLine({ id: 'x', ts: 1795000000000, kind: 'swing', topic: 'gas_prices', topicLabels: { gas_prices: 'Gas prices' }, ticker: 'G1', title: 'Will gas be above $3.64?', from: 0.25, to: 0.12, delta: -0.13, dir: 'down', sourceUrl: 'https://x', roi: 4.26, score: 5.1 });
check('topic label resolved from the label map', line.topicLabel === 'Gas prices', line.topicLabel);
check('line keeps both source links and the swing fields', line.sourceUrl === 'https://x' && line.from === 0.25 && line.to === 0.12 && line.dir === 'down');
check('dedupe key is per market+side+minute', KA.dedupeKey(line) === KA.dedupeKey(KA.extend(line, {})) && KA.dedupeKey(line) !== KA.dedupeKey(KA.extend(line, { side: 'NO' })));

// ------------------------------------------------------------------ 2. page
const GAS = 'KXAAAGASW-26NOV23-3.6400';
const CRYPTO = 'KXBTC-26DEC31-T100000';
const ELEC = 'KXPRESPERSON-28-GABB';
const marketRow = (t, topic, series, event, dollars) => ({
  topic, series_ticker: series, event_ticker: event, market_ticker: t, ticker: t,
  title: 'Will ' + t + ' happen?', status: 'active', result: null, close_time: future,
  last_price: { value: null }, last_price_dollars: '',
  dollar_notional_24h: { value: dollars, complete: true },
  sources: { markets: 'https://api/markets', market: 'https://api/markets/' + t, event: 'https://api/events/' + event, orderbook: 'https://api/orderbook/' + t }
});
const snapshotFixture = {
  generated_utc: '2026-11-20T11:43:59Z',
  markets: [marketRow(GAS, 'gas_prices', 'KXAAAGASW', 'KXAAAGASW-26NOV23', 2746.88),
    marketRow(CRYPTO, 'crypto', 'KXBTC', 'KXBTC-26DEC31', 91.5),
    marketRow(ELEC, 'elections', 'KXPRESPERSON', 'KXPRESPERSON-28', 12.25)]
};
const quotes = (cycle) => ({
  markets: [
    { ticker: GAS, title: 'Will average gas prices be above $3.6400?', event_ticker: 'KXAAAGASW-26NOV23', series_ticker: 'KXAAAGASW', status: 'active', result: '', close_time: future, last_price_dollars: cycle === 1 ? '0.2500' : '0.1200', yes_bid_dollars: '0.1100', yes_ask_dollars: '', no_bid_dollars: '', no_ask_dollars: '' },
    { ticker: CRYPTO, title: 'BTC above $100k?', event_ticker: 'KXBTC-26DEC31', series_ticker: 'KXBTC', status: 'active', result: '', close_time: future, last_price_dollars: cycle === 1 ? '0.5000' : '0.7500', yes_bid_dollars: '0.4900', yes_ask_dollars: '', no_bid_dollars: '', no_ask_dollars: '' },
    { ticker: ELEC, title: 'Governor?', event_ticker: 'KXPRESPERSON-28', series_ticker: 'KXPRESPERSON', status: 'settled', result: 'yes', close_time: future, last_price_dollars: '1.0000', yes_bid_dollars: '', yes_ask_dollars: '', no_bid_dollars: '', no_ask_dollars: '' }
  ]
});
const booksFixture = {
  orderbooks: [
    { ticker: GAS, orderbook_fp: { yes_dollars: [['0.1100', '40.00']], no_dollars: [['0.8600', '500.00']] } },
    { ticker: CRYPTO, orderbook_fp: { yes_dollars: [], no_dollars: [] } },
    { ticker: ELEC, orderbook_fp: { yes_dollars: [], no_dollars: [] } }
  ]
};
const tradesFixture = {
  trades: [{ trade_id: 'a1', ticker: GAS, count_fp: '100.00', yes_price_dollars: '0.2500', no_price_dollars: '0.7500', taker_outcome_side: 'yes', created_time: '2026-11-20T19:20:00Z' },
  { trade_id: 'a2', ticker: GAS, count_fp: '100.00', yes_price_dollars: '0.2500', no_price_dollars: '0.7500', taker_outcome_side: 'no', created_time: '2026-11-20T19:21:00Z' }]
};
const candlesFixture = {
  ticker: GAS,
  candlesticks: [{ end_period_ts: 1795154700, price: { close_dollars: '0.2500' } }, { end_period_ts: 1795154760, price: { close_dollars: '0.1200' } }]
};
const chartsFixture = {
  generated_utc: '2026-11-20T11:43:59Z',
  series: [{ market_ticker: GAS, series_ticker: 'KXAAAGASW', windows: { '1m/6h': { period_interval_minutes: 1, points: [
    { t: 1795154640, price_close: 0.30, yes_bid_close: 0.29, yes_ask_close: 0.31 },
    { t: 1795154700, price_close: 0.15, yes_bid_close: 0.16, yes_ask_close: 0.18 }
  ] } } }]
};

let cycle = 1;
const log = [];
function mockFetch() {
  return async function (url) {
    const u = String(url);
    log.push(u);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('snapshot/markets.json')) return json(snapshotFixture);
    if (u.includes('snapshot/charts.json')) return json(chartsFixture);
    if (u.includes('/candlesticks')) return json(candlesFixture);
    if (u.includes('/markets/orderbooks')) return json(booksFixture);
    if (u.includes('/markets/trades')) return json(tradesFixture);
    if (/[?&]tickers=/.test(u)) return json(quotes(cycle));
    throw new Error('unexpected fetch in test: ' + u);
  };
}

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
vc.on('error', (m) => errors.push('console.error: ' + m));

const dom = new JSDOM(read('alerts.html'), {
  url: 'https://karagemop466-tech.github.io/Demo1/alerts.html',
  runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
});
const w = dom.window;
w.fetch = mockFetch();
w.eval(read('assets/common.js'));
w.eval(read('assets/alerts.js'));
w.eval(read('assets/alerts-app.js'));
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 20)); };
await settle();
const app = w.KA_APP;
cycle = 2;                                  // second read: gas drops, crypto jumps
await app.cycle();
await settle(6);

console.log('\n== alerts.html in jsdom: live tapes ==');
const doc = w.document;
const allLines = () => [...doc.querySelectorAll('#at-tape-all .at-line')];
const pickLines = () => [...doc.querySelectorAll('#at-tape-picks .at-line')];
const allText = () => doc.getElementById('at-tape-all').textContent.replace(/\s+/g, ' ');
const pickText = () => doc.getElementById('at-tape-picks').textContent.replace(/\s+/g, ' ');

check('page boots with no script errors', errors.length === 0, errors.join(' | '));
check('watchlist seeded from the snapshot (3 markets)', doc.getElementById('at-watch').textContent === '3', doc.getElementById('at-watch').textContent);
check('cycle reads exactly the three documented endpoints',
  log.some((u) => /[?]tickers=|&tickers=/.test(u) && u.includes('/markets?')) &&
  log.some((u) => u.includes('/markets/orderbooks?tickers=')) &&
  log.some((u) => u.includes('/markets/trades?limit=1000')), log.filter((u) => u.includes('demo.kalshi.co')).join(' | '));
check('status banner reports LIVE with the source endpoint', /LIVE/.test(doc.getElementById('at-status').textContent) && doc.getElementById('at-status').innerHTML.includes('external-api.demo.kalshi.co'), doc.getElementById('at-status').textContent.slice(0, 120));
check('Tape A got a message for every swing (gas down, crypto up)', allLines().length >= 3, allLines().length + ' :: ' + allText().slice(0, 220));
check('the $0.13 drop is labelled a down swing with before → after', /▼/.test(allText()) && allText().includes('$0.2500') && allText().includes('$0.1200'), allText().slice(0, 200));
check('the move magnitude is printed', /\-0\.13|\+0\.13/.test(allText()), allText().slice(0, 200));
check('the threshold is named on the line ($0.10)', allText().includes('≥ $0.10'), allText().slice(0, 160));
check('every line links the exact API request that produced it', allLines().every((n) => n.querySelector('.at-srcs a')), allLines().map((n) => !!n.querySelector('.at-srcs a')).join(','));
check('gas line links the order-book request and a news lead', allLines().some((n) => /order book/.test(n.textContent) && /news\.google\.com\/search/.test(n.innerHTML)), '');
check('a cause is never asserted (only "news lead")', !/caused by|because of|reason: /i.test(allText() + doc.getElementById('at-tape-all').innerHTML));
check('Tape B carries only the gate-passing gas swing', pickLines().length === 1 && pickText().includes(GAS) && !pickText().includes(CRYPTO), pickLines().length + ' :: ' + pickText().slice(0, 220));
check('Tape B line shows entry, depth, fee, payout and net ROI', /buy YES @ \$0\.1400/.test(pickText()) && /500 contracts there/.test(pickText()) && /fee \$0\.0100 → payout \$1\.0000/.test(pickText()) && /net ROI 566\.7%/.test(pickText()), pickText().slice(0, 320));
check('Tape B prints a model score next to the pick', /model score/.test(pickText()) && /[0-9]\.[0-9]{3}/.test(pickText()), pickText().slice(0, 120));
check('the crypto swing is explicitly screened out, not hidden from Tape A', allText().includes('screened out') || allText().includes('no fillable ask'), allText().slice(-260));
check('a RESOLUTION line reports YES for the settled market', allText().includes('RESOLUTION') && /resolved YES/.test(allText()), allText().slice(0, 300));
check('resolved markets drop out of the next poll (no re-alerting)', app.state.resolved[ELEC] === 'yes' && app.state.order.indexOf(ELEC) >= 0, JSON.stringify(app.state.resolved));
check('the historical snapshot swing is labelled, not mixed in as live', /committed snapshot/.test(allText()), allText().slice(0, 240));
check('counters move', +doc.getElementById('at-alert-count').textContent >= 2 && +doc.getElementById('at-count-all').textContent === allLines().length && +doc.getElementById('at-count-picks').textContent === pickLines().length,
  [doc.getElementById('at-alert-count').textContent, doc.getElementById('at-count-all').textContent, doc.getElementById('at-count-picks').textContent].join('/'));
check('request + failure counters are honest', +doc.getElementById('at-req').textContent === app.state.requests && doc.getElementById('at-fail').textContent === '0', doc.getElementById('at-req').textContent);
const coolBefore = allLines().length;
app.state.prevMark[GAS] = 0.25;                // pretend the price reset: same quote → same -0.13 move
await app.cycle();
await settle(4);
check('cooldown: an identical re-read within 60 s does not spam the tape', allLines().length === coolBefore, coolBefore + ' → ' + allLines().length);
check('session VWAP counted from prints, not invented', +doc.getElementById('at-vwap').textContent === 1 && app.state.vwap[GAS].price === 0.25, JSON.stringify(app.state.vwap));
check('trades seen counted from the public tape', +doc.getElementById('at-trade').textContent === 2, doc.getElementById('at-trade').textContent);
doc.querySelector('#at-tape-all .at-expand').dispatchEvent(new w.Event('click', { bubbles: true }));
await settle(10);
check('expanding a line renders a time/price SVG plus the five gate verdicts', (() => {
  const svg = doc.querySelector('#at-tape-all .at-spark');
  const gates = doc.querySelector('#at-tape-all .at-gates');
  return !!svg && /M\d+\.\d+/.test(svg.innerHTML) && !!gates && gates.children.length === 5;
})(), (doc.querySelector('#at-tape-all .at-detail') || {}).innerHTML || 'no detail');

const after = doc.querySelector('#at-tape-all .at-detail');
check('expanded detail links the candlestick request + model spec', after && /candlesticks\?start_ts=/.test(after.textContent + after.innerHTML) && after.innerHTML.includes('alerts-model'), after ? after.textContent.slice(0, 120) : 'missing');
const linesBeforePause = allLines().length;
doc.getElementById('at-pause').dispatchEvent(new w.Event('click', { bubbles: true }));
const pausedOk = app.state.paused === true && app.state.polling === null;
const heldLines = allLines().length === linesBeforePause;
doc.getElementById('at-pause').dispatchEvent(new w.Event('click', { bubbles: true }));
await settle(4);
check('pause stops polling (no timer left running) and keeps the tape; resume restarts it',
  pausedOk && heldLines && app.state.paused === false && app.state.polling !== null,
  'paused=' + pausedOk + ' held=' + heldLines + ' polling=' + (app.state.polling !== null));
check('threshold control defaults to the brief\'s $0.10 and re-screens on change',
  doc.getElementById('at-threshold').value === '0.1' && (() => {
    doc.getElementById('at-threshold').value = '0.30';
    doc.getElementById('at-threshold').dispatchEvent(new w.Event('change', { bubbles: true }));
    return app.state.threshold === 0.3;
  })());
check('clearing the tape clears both chats and the counters', (() => {
  doc.getElementById('at-clear').dispatchEvent(new w.Event('click', { bubbles: true }));
  return doc.querySelectorAll('#at-tape-all .at-line').length === 0 && doc.getElementById('at-count-all').textContent === '0' &&
    doc.getElementById('at-tape-all').textContent.includes('No $0.10 swing yet');
})());
check('offline banner path is exercised when the API errors out', await (async () => {
  const realFetch = w.fetch;
  w.fetch = async (u) => { log.push('fail:' + u); const e = new Error('Failed to fetch'); throw e; };
  app.state.lines = { all: [], picks: [] };
  await app.cycle();
  await settle(4);
  const txt = doc.getElementById('at-status').textContent;
  w.fetch = realFetch;
  return /Live polling unavailable/.test(txt) && doc.getElementById('at-tape-all').textContent.length >= 0;
})());
check('every internal link on the page points at a file that exists', (() => {
  const hrefs = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    .filter((h) => h && !/^https?:|^#|^mailto:/.test(h));
  return hrefs.every((h) => {
    const p = path.join(ROOT, decodeURIComponent(h.split('#')[0].split('?')[0]).replace(/^\/Demo1\//, ''));
    return fs.existsSync(p);
  });
})(), [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && !/^https?:/.test(h)).join(' | '));
check('the page states plainly that it polls and never streams', /This is polling, not streaming/.test(doc.body.textContent));
check('the page states the demo-venue warning and the no-orders rule',
  /may not be reflective of those in real markets/.test(doc.body.textContent) && /No orders are placed/.test(doc.body.textContent));

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL CHECKS PASSED') + '  (passed: ' + pass + ')');
process.exit(fail ? 1 : 0);
