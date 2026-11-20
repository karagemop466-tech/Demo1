/*
 * tape-desk/test_boot.mjs — offline tests for the live tape desk.
 *
 * Part 1 exercises tape-desk/core.js directly (threshold, basis isolation, dedupe, the pick
 * rule, fee math, settlement, stats) with hand-computed numbers.
 * Part 2 boots tape-desk/index.html + app.js in jsdom twice: with documented-shaped live API
 * answers, and with every request failing (the snapshot-degradation path).
 * No test touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const DESK = HERE;

let pass = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { pass++; return true; }
  fails.push(label + (detail === undefined ? '' : ' — got ' + JSON.stringify(detail)));
  return false;
}

const Core = (await import(path.join(DESK, 'core.js'))).default !== undefined
  ? (await import(path.join(DESK, 'core.js'))).default
  : (await import(path.join(DESK, 'core.js')));
const core = globalThis.TapeDeskCore || Core;

const watchlist = JSON.parse(fs.readFileSync(path.join(DESK, 'data', 'watchlist.json'), 'utf8'));
const meta = Object.assign({}, watchlist.meta, { watchlist: watchlist.watchlist });

/* ---------------------------------------------------------------- 1. core rules */
{
  // official taker fee: round up(M x 0.07 x C x P x (1-P)), M = C = 1
  ok('fee at $0.20 = 2c', core.takerFeeCent(0.20) === 2, core.takerFeeCent(0.20));
  ok('fee at $0.50 = 2c', core.takerFeeCent(0.50) === 2, core.takerFeeCent(0.50));
  ok('fee at $0.01 = 1c', core.takerFeeCent(0.01) === 1, core.takerFeeCent(0.01));
  ok('fee at $0.97 = 1c', core.takerFeeCent(0.97) === 1, core.takerFeeCent(0.97));
  ok('fee at $1.00 = 0c on the symmetric formula P(1−P)', core.takerFeeCent(1.00) === 0, core.takerFeeCent(1.00));

  const asks = core.impliedYesAsks([['0.0100', '168.35'], ['0.0300', '168.89'], ['0.0200', '170.06']]);
  ok('a NO bid at $0.03 is a YES ask at $0.97', asks[0][0] === 0.97 && asks[0][1] === 168.89, asks[0]);
  ok('implied asks sort ascending', asks[0][0] < asks[1][0] && asks[1][0] < asks[2][0], asks);
  ok('object-shaped levels also parse',
    core.impliedYesAsks([{ price: '0.0200', contracts: '5' }])[0][1] === 5);

  const bandsLiquid = meta.model.bands_liquid, bandsAll = meta.model.bands_all, minN = meta.model.min_band_n;
  ok('a band under the sample floor yields no band',
    core.bandFor(0.85, bandsLiquid, bandsAll, minN) === null, core.bandFor(0.85, bandsLiquid, bandsAll, minN));
  const b0 = core.bandFor(0.02, bandsLiquid, bandsAll, minN);
  ok('sub-10c price uses the liquid_only band', b0 && b0.label === '$0.00-$0.09' && b0.n === 380 && b0.source === 'liquid_only', b0);
  const roiYes = core.roiFor(0.05, 'yes', { p_yes: 0.05, n: 380 });
  ok('fee-aware ROI at 5c with p=0.05 is (0.05 - 0.06)/0.06', Math.abs(roiYes - (-1 / 6)) < 1e-9, roiYes);
  ok('ROI returns null for a null band', core.roiFor(0.5, 'yes', null) === null);
}

/* engine behaviours */
function freshEngine(extraMeta) {
  const m = Object.assign({}, meta, extraMeta || {});
  return core.createEngine({ meta: m, threshold: 0.10 });
}
{
  const e = freshEngine();
  const T = 'KXAAAGASW-26NOV23-3.6200';
  ok('watchlist ticker is known to the engine', !!e.watch[T], Object.keys(e.watch).length);
  e.observe(T, 0.50, 1000, 'u', 'traded');
  ok('first observation cannot alert', e.bubbles.length === 0);
  e.observe(T, 0.59, 1010, 'u', 'traded');
  ok('a $0.09 move does not alert', e.bubbles.length === 0 && e.counters.sub_threshold === 1, e.counters);
  e.observe(T, 0.69, 1020, 'u', 'traded');
  ok('a $0.10 move alerts', e.bubbles.length === 1, e.bubbles.length);
  ok('bubble carries both prices, delta and the request URL',
    e.bubbles[0].from === 0.59 && e.bubbles[0].to === 0.69 && e.bubbles[0].delta === 0.10 &&
    e.bubbles[0].source_url === 'u' && e.bubbles[0].topic === 'gas_prices', e.bubbles[0]);
  e.observe(T, 0.59, 1030, 'u2', 'traded');
  ok('a $0.10 drop alerts in the other direction', e.bubbles.length === 2 && e.bubbles[1].direction === 'down', e.bubbles[1]);
  // the same from/to pair inside the dedupe window must not be repeated
  const e3 = freshEngine();
  const t3 = Object.keys(e3.watch)[4];
  e3.observe(t3, 0.30, 5000, 'u', 'traded');
  e3.observe(t3, 0.40, 5010, 'u', 'traded');
  e3.observe(t3, 0.30, 5020, 'u', 'traded');
  e3.observe(t3, 0.40, 5030, 'u', 'traded');
  ok('same from/to inside the dedupe window is not repeated',
    e3.bubbles.length === 2 && e3.counters.deduped === 1, [e3.bubbles.length, e3.counters]);
  // two bases are never mixed
  const e4 = freshEngine();
  const t4 = Object.keys(e4.watch)[5];
  e4.observe(t4, 0.30, 6000, 'u', 'traded');
  e4.observe(t4, 0.55, 6010, 'u', 'mid');
  ok('a first observation on another basis cannot alert', e4.bubbles.length === 0, e4.bubbles.length);
  e4.observe(t4, 0.44, 6020, 'u', 'mid');
  ok('mid-vs-mid alerts, and the basis is named on the bubble',
    e4.bubbles.length === 1 && e4.bubbles[0].basis === 'mid', e4.bubbles[0] && e4.bubbles[0].basis);

  ok('an off-topic ticker is dropped, not labelled', (() => {
    const e2 = freshEngine();
    e2.observe('KXSOMETHINGELSE-99-ZZZ', 0.5, 1000, 'u', 'traded');
    e2.observe('KXSOMETHINGELSE-99-ZZZ', 0.8, 1010, 'u', 'traded');
    return e2.bubbles.length === 0 && e2.counters.off_topic === 1;
  })());
}
{
  /* The pick rule: band (≥ min_band_n settled markets) + positive fee-adjusted ROI + an
   * executable quote. The side you take also changes what you PAY: a NO contract costs
   * $1.00 minus the YES price, which is the single place where a sloppy implementation
   * invents profit out of thin air, so it is pinned here with hand-computed numbers. */
  const e = freshEngine();
  const all = Object.keys(e.watch);
  const tA = all[0], tB = all[1], tC = all[2], tD = all[3];

  // A: down-jump into the sub-10c band — a NO here costs 98c, so the rule must refuse it
  e.observe(tA, 0.50, 2000, 'u0', 'traded');
  e.observe(tA, 0.02, 2010, 'u1', 'traded');
  const bub = e.bubbles[e.bubbles.length - 1];
  ok('a down-jump scores the NO side', bub.ticker === tA && bub.score.side === 'no', bub.score);
  const expRoiNo = (0.95 - 0.99) / 0.99;      // p_no = 1 − 0.05, entry 0.98, fee 1c
  ok('NO-side ROI prices the NO contract, not the YES price',
    Math.abs(bub.score.expected_roi - Math.round(expRoiNo * 10000) / 10000) < 1e-9,
    [bub.score.expected_roi, expRoiNo]);
  ok('a negative ROI is refused', bub.score.pass === false && /not positive/.test(bub.score.reasons[0]),
    bub.score.reasons);
  ok('refused pick never reaches chat 2', e.picks.length === 0, e.picks.length);

  // B: positive ROI but a collapsed book — no resting YES ask, so no trade
  e.ingestMarket({ ticker: tB, last_price_dollars: '0.1100', previous_price_dollars: '0.1100',
                   yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000',
                   yes_bid_size_fp: '0.00', yes_ask_size_fp: '0.00', status: 'active', result: '' }, 'uB0', 2020);
  e.observe(tB, 0.01, 2030, 'uB1', 'traded');
  e.observe(tB, 0.11, 2040, 'uB2', 'traded');   // exactly the $0.10 threshold
  const bubB = e.bubbles[e.bubbles.length - 1];
  ok('a move of exactly $0.10 alerts (the brief says “greater than or equal to”)',
    bubB.ticker === tB && bubB.from === 0.01 && bubB.to === 0.11 && bubB.delta === 0.10, bubB);
  ok('a YES-side pick is what an up-jump wants', bubB.score.side === 'yes' &&
    Math.abs(bubB.score.expected_roi - Math.round(((3 / 21) - 0.12) / 0.12 * 10000) / 10000) < 1e-9,
    bubB.score);
  ok('no resting size suppresses the pick',
    bubB.score.pass === false && /not executable/.test(bubB.score.reasons[0]), bubB.score.reasons);

  // C: same move, executable book, settles against the pick → a booked loss
  e.ingestMarket({ ticker: tC, last_price_dollars: '0.0100', previous_price_dollars: '0.0100',
                   yes_bid_dollars: '0.0100', yes_ask_dollars: '0.1100',
                   yes_bid_size_fp: '900.00', yes_ask_size_fp: '400.00', status: 'active', result: '' }, 'uC0', 2100);
  e.observe(tC, 0.01, 2110, 'uC1', 'traded');
  e.observe(tC, 0.11, 2120, 'uC2', 'traded');
  const bubC = e.bubbles[e.bubbles.length - 1];
  ok('an executable up-jump passes all three tests',
    bubC.score.pass === true && bubC.score.entry_exec === 0.11 && bubC.score.cost === 0.12, bubC.score);
  ok('it appears in chat 2 and opens one simulated position',
    e.picks.length === 1 && e.picks[0].id === bubC.id && e.trades.length === 1, [e.picks.length, e.trades.length]);
  const tr = e.trades[0];
  ok('the entry is costed with the official taker fee',
    tr.side === 'yes' && tr.entry === 0.11 && tr.fee === 0.01 && tr.cost === 0.12, tr);
  ok('one position per market: a repeat jump does not stack', (() => {
    e.observe(tC, 0.55, 2130, 'uC3', 'traded');
    e.observe(tC, 0.11, 2140, 'uC4', 'traded');
    return e.trades.length === 1 && e.bubbles.length >= 3;
  })(), e.trades.length);
  e.ingestMarket({ ticker: tC, status: 'finalized', result: 'no', settlement_value_dollars: '0.0000',
                   settlement_ts: '2026-11-20T20:00:00Z', last_price_dollars: '0.0000' }, 'uCres', 2200);
  ok('resolution is recorded from the API status, result and payout',
    e.resolutions.length === 1 && e.resolutions[0].status === 'finalized' && e.resolutions[0].result === 'no' &&
    e.resolutions[0].settlement_value === 0, e.resolutions[0]);
  ok('a losing YES entry realises 0 − cost', tr.status === 'settled' && tr.received === 0 &&
    tr.realised === -0.12, [tr.received, tr.realised]);

  // D: the same pick settling YES pays $1.00 per contract → a booked win
  e.ingestMarket({ ticker: tD, last_price_dollars: '0.0100', previous_price_dollars: '0.0100',
                   yes_bid_dollars: '0.0100', yes_ask_dollars: '0.1100',
                   yes_bid_size_fp: '900.00', yes_ask_size_fp: '400.00', status: 'active', result: '' }, 'uD0', 2300);
  e.observe(tD, 0.01, 2310, 'uD1', 'traded');
  e.observe(tD, 0.11, 2320, 'uD2', 'traded');
  const trD = e.trades[e.trades.length - 1];
  ok('a second market gets its own position', trD.ticker === tD && e.trades.length === 2, e.trades.length);
  e.ingestMarket({ ticker: tD, status: 'finalized', result: 'yes', settlement_value_dollars: '1.0000',
                   settlement_ts: '2026-11-20T20:05:00Z', last_price_dollars: '1.0000' }, 'uDres', 2400);
  ok('a winning YES entry realises $1.00 − cost', trD.received === 1 && trD.realised === 0.88,
    [trD.received, trD.realised]);
  const st = e.stats();
  ok('stats tally both sides', st.trades === 2 && st.settled === 2 && st.wins === 1 && st.losses === 1 &&
    st.net === 0.76 && st.open === 0, st);
  ok('results are categorised by topic and band for strategy analysis',
    st.by_category['swing follow-through'].n === 2 && st.by_band['$0.10-$0.19'].n === 2 &&
    Object.keys(st.by_topic).length >= 1, [st.by_category, st.by_band, st.by_topic]);
}
{
  // determined/disputed is NOT a resolution — official lifecycle semantics
  const e = freshEngine();
  const t = Object.keys(e.watch)[0];
  e.ingestMarket({ ticker: t, status: 'disputed', result: 'yes', settlement_value_dollars: '1.0000',
                   last_price_dollars: '0.0000' }, 'ud', 3000);
  ok('a disputed market is not reported as resolved', e.resolutions.length === 0, e.resolutions.length);
}
{
  // the tape path
  const e = freshEngine();
  const t = 'KXAAAGASW-26NOV23-3.6200';
  const url = 'https://external-api.demo.kalshi.co/trade-api/v2/markets/trades?limit=200';
  const n = e.ingestTrades({ trades: [
    { ticker: t, yes_price_dollars: '0.9700', count_fp: '12.00', created_time: '2026-11-20T19:50:03.000Z', taker_side: 'yes' },
    { ticker: t, yes_price_dollars: '0.8700', count_fp: '5.00', created_time: '2026-11-20T19:50:01.000Z', taker_side: 'no' },
    { ticker: 'KXUNKNOWN-1-A', yes_price_dollars: '0.1000', created_time: '2026-11-20T19:50:02.000Z' }
  ] }, url);
  ok('tape page applies the known, in-time-order trades', n === 2, n);
  ok('newest-first page still detects the $0.10 rise',
    e.bubbles.length === 1 && e.bubbles[0].from === 0.87 && e.bubbles[0].to === 0.97 &&
    e.bubbles[0].direction === 'up', e.bubbles[0]);
  const again = e.ingestTrades({ trades: [
    { ticker: t, yes_price_dollars: '0.9700', created_time: '2026-11-20T19:50:03.000Z' }
  ] }, url);
  ok('a re-sent older trade is ignored', again === 0 && e.bubbles.length === 1, [again, e.bubbles.length]);
}
{
  // exchange previous/last seeding must alert exactly once
  const e = freshEngine();
  const t = Object.keys(e.watch)[0];
  e.ingestMarket({ ticker: t, last_price_dollars: '0.9700', previous_price_dollars: '0.6500',
                   yes_bid_dollars: '0.9600', yes_ask_dollars: '0.9700', yes_bid_size_fp: '173.61',
                   yes_ask_size_fp: '168.43', status: 'active', result: '',
                   rules_primary: 'If average regular gas prices for United States are strictly greater than $3.6200 on Nov 23, 2026 according to AAA, then the market resolves to Yes.' },
    'useed', 4000);
  ok('the exchange’s own previous/last pair alerts once', e.bubbles.length === 1, e.bubbles.map(b => b.basis));
  ok('rules text is carried for the cause panel', /AAA/.test(e.markets[t].rules));
}
{
  // candles: null closes are skipped, never bridged or filled; swings come from adjacent pairs
  const pts = core.candlePoints({ candlesticks: [
    { end_period_ts: 10, price: { close_dollars: '0.5000' }, yes_bid: { close_dollars: '0.4900' }, yes_ask: { close_dollars: '0.5100' }, volume_fp: '3' },
    { end_period_ts: 20, price: { close_dollars: '0.6200' }, yes_bid: { close_dollars: '0.6000' }, yes_ask: { close_dollars: '0.6400' }, volume_fp: '9' },
    { end_period_ts: 30, price: {}, yes_bid: { close_dollars: '0.4000' }, yes_ask: { close_dollars: '0.4400' }, volume_fp: '0' },
    { end_period_ts: 40, price: { close_dollars: '0.5000' }, yes_bid: { close_dollars: '0.4900' }, yes_ask: { close_dollars: '0.5200' }, volume_fp: '1' }
  ] });
  ok('candles flatten with a null close kept as null', pts.length === 4 && pts[2].close === null, pts[2]);
  const sw = core.candleSwings(pts, 'X', 'uc');
  ok('the $0.12 rise between adjacent traded candles is flagged',
    sw.length === 1 && sw[0].from === 0.50 && sw[0].to === 0.62 && sw[0].direction === 'up', sw);
  ok('a swing is never invented across a null candle',
    !sw.some(s => s.from === null || s.to === null), sw);
}

{
  /* parity: every number the site publishes is re-derivable from core with the same inputs,
   * so the Python build and the browser cannot drift apart. */
  let checked = 0; const bad = [];
  Object.keys(watchlist.watchlist).forEach(topic => {
    (watchlist.watchlist[topic].events || []).forEach(ev => (ev.markets || []).forEach(m => {
      const mm = m.model; if (!mm) return;
      const price = m.snapshot.last_price;
      if (price === null || price === undefined) return;
      const band = core.bandFor(price, meta.model.bands_liquid, meta.model.bands_all, meta.model.min_band_n);
      const r4 = v => (v === null || v === undefined) ? null : Math.round(v * 10000) / 10000;
      const ry = r4(core.roiFor(price, 'yes', band)), rn = r4(core.roiFor(price, 'no', band));
      if (ry !== mm.roi_yes || rn !== mm.roi_no) bad.push([m.market_ticker, mm.roi_yes, ry, mm.roi_no, rn]);
      if (core.takerFeeCent(price) !== mm.fee_cents) bad.push(['fee', m.market_ticker]);
      if ((mm.band === null) !== (band === null)) bad.push(['band', m.market_ticker]);
      checked++;
    }));
  });
  ok('published model numbers re-derive from core on all ' + checked + ' watchlist rows',
    checked === 40 && bad.length === 0, bad.slice(0, 3));
}

/* ---------------------------------------------------------------- 2. the page itself */
const html = fs.readFileSync(path.join(DESK, 'index.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(DESK, 'core.js'), 'utf8');
const appJs = fs.readFileSync(path.join(DESK, 'app.js'), 'utf8');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom is not installed (npm install jsdom) — skipping the DOM cases');
}

const T1 = 'KXAAAGASW-26NOV23-3.6200';
const T2 = 'KXRT-HUN-72';
function liveFetch(sink) {
  return async function fetchMock(url) {
    const u = String(url);
    sink.push(u);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.endsWith('data/watchlist.json')) return json(watchlist);
    if (u.includes('/exchange/status')) return json({ trading_active: true, exchange_active: true });
    if (u.includes('/markets/trades')) {
      return json({ trades: [
        { ticker: T2, yes_price_dollars: '0.0300', no_price_dollars: '0.9700', count_fp: '40.00',
          created_time: '2026-11-20T19:59:40.000Z', taker_side: 'yes', taker_book_side: 'ask', is_block_trade: false, trade_id: 'x1' },
        { ticker: T2, yes_price_dollars: '0.1400', no_price_dollars: '0.8600', count_fp: '25.00',
          created_time: '2026-11-20T19:59:50.000Z', taker_side: 'yes', taker_book_side: 'ask', is_block_trade: false, trade_id: 'x2' }
      ], cursor: '' });
    }
    if (/\/orderbook$/.test(u)) {
      return json({ orderbook_fp: { yes_dollars: [['0.9600', '173.61'], ['0.3900', '33.71']],
                                    no_dollars: [['0.0300', '168.89'], ['0.0100', '168.35']] } });
    }
    if (/\/candlesticks\?/.test(u)) {
      const now = 1795204800;
      return json({ candlesticks: [
        { end_period_ts: now - 120, price: { close_dollars: '0.8900' }, yes_bid: { close_dollars: '0.8800' }, yes_ask: { close_dollars: '0.9000' }, volume_fp: '12' },
        { end_period_ts: now - 60, price: { close_dollars: '0.9900' }, yes_bid: { close_dollars: '0.9800' }, yes_ask: { close_dollars: '1.0000' }, volume_fp: '31' }
      ] });
    }
    const m = /\/markets\/([^?]+)/.exec(u);
    if (m) {
      const t = decodeURIComponent(m[1]);
      if (t === T1) {
        return json({ market: { ticker: t, event_ticker: 'KXAAAGASW-26NOV23',
          title: 'Will average gas prices be above $3.6200?', last_price_dollars: '0.9700',
          previous_price_dollars: '0.9200', yes_bid_dollars: '0.9600', yes_ask_dollars: '0.9700',
          yes_bid_size_fp: '173.61', yes_ask_size_fp: '168.43', status: 'active', result: '',
          volume_24h_fp: '3611.15', volume_fp: '14958.24', open_interest_fp: '11779.61', exchange_index: 0,
          close_time: '2026-11-23T04:59:00Z',
          rules_primary: 'If average regular gas prices for United States are strictly greater than $3.6200 on Nov 23, 2026 according to AAA, then the market resolves to Yes.' } });
      }
      return json({ market: { ticker: t, title: 'The Hunger Games: Sunrise on the Reaping Rotten Tomatoes score?',
        last_price_dollars: '0.0300', previous_price_dollars: '0.0300', yes_bid_dollars: '0.0000',
        yes_ask_dollars: '1.0000', yes_bid_size_fp: '0.00', yes_ask_size_fp: '0.00', status: 'active',
        result: '', volume_24h_fp: '6676.26', volume_fp: '24736.53', open_interest_fp: '18494.94',
        exchange_index: 0, close_time: '2026-11-23T15:00:00Z' } });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function boot(fetchImpl) {
  const dom = new JSDOM(html, { url: 'https://karagemop466-tech.github.io/Demo1/tape-desk/index.html',
    runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  window.fetch = (u, o) => fetchImpl(String(u), o, calls);
  window.eval(coreJs);
  window.eval(appJs.replace('setInterval(function () { cycle(); }, state.interval)',
                            'state.interval = 20000; setTimeout(function () { cycle(); }, 0)'));
  for (let i = 0; i < 40 && !window.TapeDesk.engine; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 60));
  return { dom, window, calls };
}

if (JSDOM) {
  {
    const sink = [];
    const { window, calls } = await boot(liveFetch(sink));
    const d = window.document;
    const desk = window.TapeDesk;
    ok('page reaches LIVE once /exchange/status answers', desk.mode === 'LIVE', [desk.mode, desk.note]);
    ok('badge says LIVE', /LIVE/.test(d.getElementById('modeBadge').textContent));
    ok('watchlist board renders every market',
      d.querySelectorAll('#board tr.mkrow').length === 40, d.querySelectorAll('#board tr.mkrow').length);
    ok('board keeps events grouped (event rows present)', d.querySelectorAll('#board tr.eventrow').length >= 15,
      d.querySelectorAll('#board tr.eventrow').length);
    ok('five topic blocks, in the required topics',
      d.querySelectorAll('#board .topicblock').length === 5, d.querySelectorAll('#board .topicblock').length);
    ok('the tape’s $0.11 rise became a bubble', window.TapeDeskCore.engine ? true : desk.engine.bubbles.length >= 1,
      desk.engine.bubbles.length);
    ok('chat 1 shows bubbles', d.querySelectorAll('#feedAll article.bub').length >= 1,
      d.querySelectorAll('#feedAll article.bub').length);
    const bubble = d.querySelector('#feedAll article.bub');
    ok('every bubble links the API request that produced it',
      bubble && /external-api\.demo\.kalshi\.co/.test(bubble.innerHTML), bubble && bubble.innerHTML.slice(0, 200));
    ok('bubble labels the news link as a lead, not proof',
      bubble && /not proof of cause/.test(bubble.textContent));
    ok('a collapsed book cannot become a pick', desk.engine.picks.length === 0, desk.engine.picks.map(p => p.ticker));
    ok('chart drew an axis, a line and the price scale',
      /<svg/.test(d.getElementById('chart').innerHTML) &&
      /class="price"/.test(d.getElementById('chart').innerHTML) &&
      /\$0\.00/.test(d.getElementById('chart').innerHTML));
    ok('y-axis labels are contract prices', />\$0\.96</.test(d.getElementById('chart').innerHTML) ||
      />\$0\.00</.test(d.getElementById('chart').innerHTML));
    ok('ladder shows contracts at each price with the implied ask',
      d.querySelectorAll('#ladder table.grid tbody tr').length >= 3 && /implied by a NO bid/.test(d.getElementById('ladder').innerHTML),
      d.getElementById('ladder').innerHTML.slice(0, 240));
    ok('cause panel quotes the market’s own rule', /according to AAA/.test(d.getElementById('cause').textContent));
    ok('how-it-works cites the official pages',
      (d.getElementById('howList').innerHTML.match(/https:\/\/docs\.kalshi\.com[^"]*/g) || []).length >= 8,
      (d.getElementById('howList').innerHTML.match(/https:\/\/docs\.kalshi\.com[^"]*/g) || []).length);
    ok('the page never prints undefined or NaN', !/(undefined|NaN)/.test(d.body.textContent),
      (d.body.textContent.match(/.{40}(undefined|NaN).{40}/) || [])[0]);
    ok('requests stay inside the stated budget', calls.length <= 12, calls.length);
    ok('polling used the documented tape path',
      sink.some(c => /\/markets\/trades\?limit=200/.test(c)), sink.slice(0, 6));
  }
  {
    const dead = async (u) => {
      if (String(u).endsWith('data/watchlist.json')) {
        return { ok: true, status: 200, json: async () => watchlist };
      }
      throw new TypeError('Failed to fetch');
    };
    const { window } = await boot(dead);
    const d = window.document;
    ok('with no API the desk degrades to SNAPSHOT, not a crash', window.TapeDesk.mode === 'SNAPSHOT',
      [window.TapeDesk.mode, window.TapeDesk.note]);
    ok('the user is told plainly that values are snapshot-only',
      /SNAPSHOT ONLY/.test(d.getElementById('modeBadge').textContent) &&
      /cannot reach/.test(d.getElementById('banner').textContent));
    ok('the board still renders from committed data when offline',
      d.querySelectorAll('#board tr.mkrow').length === 40, d.querySelectorAll('#board tr.mkrow').length);
    ok('offline mode shows no invented live price',
      !/LIVE —/.test(d.getElementById('modeBadge').textContent) && d.querySelectorAll('#feedAll article.bub').length === 0);
  }
}

/* ------------------------------------------------------------------ report */
console.log(`\ntape-desk tests: ${pass}/${pass + fails.length} assertions passed`);
if (fails.length) {
  fails.forEach(f => console.log('  FAIL ' + f));
  process.exit(1);
}
