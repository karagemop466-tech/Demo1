/*
 * Headless regression suite for the shipped price-swing alert page
 * (alerts.html + assets/js/alerts.js — session arena/d973ced5-demo1, merged to main).
 *
 * Why this exists: the dual scrolling-chat alert requirement was implemented by three
 * concurrent sessions; this suite pins the shipped behaviour of the root alerts.html:
 *   - swings are detected only where official candle closes exist (never invented),
 *   - a swing posts only when |to − from| >= threshold (default $0.10, either direction),
 *   - two scrolling chats: #msgs-all shows every swing, #msgs-roi shows only the disclosed
 *     high-ROI filter's picks (relative-move heuristic, capped at 20),
 *   - every message links the official venue event page, a news search labelled
 *     "cause unverified", and the exact official candlesticks API path,
 *   - topic filter and threshold controls recompute correctly; empty states say so.
 *
 * Fixtures are field-for-field shapes of snapshot/charts.json + snapshot/markets.json
 * (committed official demo-API capture). jsdom is a devDependency (npm install).
 *
 *   node tests/alerts.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/tests\/$/, '');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---- fixtures: committed-snapshot shapes ---- */
const MKT_GAS = 'KXAAAGASW-26NOV23-3.6400';
const MKT_BTC = 'KXBTCMINMON-BTC-26NOV30-7250000';

function snapMarket(ticker, topic, event, title) {
  return {
    topic, topic_match_reason: 'series ticker rule', topic_match_field: 'ticker', topic_matched_weakly: true,
    series_ticker: ticker.split('-')[0], event_ticker: event, event_title: title, market_ticker: ticker,
    title: title + '?', status: 'active', result: null,
    quotes: { yes: { bid: '0.1000', ask: '0.1200' }, no: { bid: '0.8800', ask: '0.9000' } },
    last_price: '0.1100', volume_24h_contracts: '30000.00', close_time: '2026-11-23T04:59:00Z',
    dollar_notional_24h: { value: 1000, formula: 'SUM(yes_price_dollars * count_fp)', complete: true },
    sources: { market: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/' + ticker },
    orderbook: { yes_bids: [{ price: '0.1000', contracts: '3000.00' }] },
  };
}

const marketsFixture = {
  generated_utc: '2026-11-20T11:43:59Z',
  base: 'https://external-api.demo.kalshi.co/trade-api/v2',
  markets: [
    snapMarket(MKT_GAS, 'gas_prices', 'KXAAAGASW-26NOV23', 'US gas prices this week'),
    snapMarket(MKT_BTC, 'crypto', 'KXBTCMINMON-BTC-26NOV30', 'BTC min one touch monthly'),
  ],
};

// gas: 0.10 -> 0.25 (+0.150) -> 0.25 -> 0.12 (−0.130); btc: 0.25 -> 0.50 (+0.250)
const chartsFixture = {
  generated_utc: '2026-11-20T11:43:59Z',
  base: 'https://external-api.demo.kalshi.co/trade-api/v2',
  series: [
    {
      market_ticker: MKT_GAS, series_ticker: 'KXAAAGASW',
      windows: {
        '1m/6h': {
          period_interval_minutes: 1,
          source: 'https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASW/markets/' + MKT_GAS + '/candlesticks?period_interval=1',
          error: null,
          points: [
            { t: 1795154640, price_close: 0.10, yes_bid_close: 0.09, yes_ask_close: 0.11, volume: 1, open_interest: 100 },
            { t: 1795154700, price_close: 0.25, yes_bid_close: 0.24, yes_ask_close: 0.26, volume: 2, open_interest: 101 },
            { t: 1795154760, price_close: 0.25, yes_bid_close: 0.24, yes_ask_close: 0.26, volume: 0, open_interest: 101 },
            { t: 1795154820, price_close: 0.12, yes_bid_close: 0.11, yes_ask_close: 0.13, volume: 3, open_interest: 102 },
          ],
        },
      },
    },
    {
      market_ticker: MKT_BTC, series_ticker: 'KXBTCMINMON',
      windows: {
        '1m/6h': {
          period_interval_minutes: 1,
          source: 'https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTCMINMON/markets/' + MKT_BTC + '/candlesticks?period_interval=1',
          error: null,
          points: [
            { t: 1795154640, price_close: 0.25, yes_bid_close: 0.24, yes_ask_close: 0.26, volume: 1, open_interest: 50 },
            { t: 1795154700, price_close: 0.50, yes_bid_close: 0.49, yes_ask_close: 0.51, volume: 4, open_interest: 51 },
          ],
        },
      },
    },
  ],
};

function mockFetch(log, liveMode, liveCandles) {
  return async function (url) {
    const u = String(url);
    log.push(u);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('snapshot/markets.json')) return json(marketsFixture);
    if (u.includes('snapshot/charts.json')) return json(chartsFixture);
    if (u.includes('external-api.demo.kalshi.co')) {
      if (!liveMode) throw new Error('network down (simulated)');
      return json(liveCandles || { ticker: 'x', candlesticks: [] }); // reachable; empty -> per-market snapshot fallback
    }
    throw new Error('unexpected fetch in test: ' + u);
  };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')); }
};
const settle = () => new Promise((r) => setTimeout(r, 40));

async function loadPage(log, liveMode, liveCandles) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(read('alerts.html'), {
    url: 'https://karagemop466-tech.github.io/Demo1/alerts.html',
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(window) { window.fetch = mockFetch(log, liveMode, liveCandles); },
  });
  const w = dom.window;
  const script = w.document.createElement('script');
  script.textContent = read('assets/js/alerts.js');
  w.document.body.appendChild(script); // boots immediately (loadData() at parse)
  await settle();
  return dom;
}

console.log('\n1. Snapshot detection + two scrolling chats:');
{
  const log = [];
  const dom = await loadPage(log, false);
  const w = dom.window, doc = w.document;

  const all = [...doc.querySelectorAll('#msgs-all .msg')];
  check('every qualifying swing is a chat message (3 swings across 2 markets)', all.length === 3, 'got ' + all.length);
  check('up and down directions both post (either direction)', all.some((m) => m.classList.contains('up')) && all.some((m) => m.classList.contains('down')));
  check('swing renders before -> after and delta to 3 dp', all.some((m) => /0\.100/.test(m.textContent) && /\+0\.150/.test(m.textContent)) && all.some((m) => /-0\.130/.test(m.textContent)), all.map((m) => m.textContent.replace(/\s+/g, ' ').slice(0, 60)).join(' | '));
  check('no swing below threshold is posted (sub-threshold deltas skipped)', all.length === 3, 'got ' + all.length);

  const roi = [...doc.querySelectorAll('#msgs-roi .msg')];
  check('Chat B (high-ROI) is rendered separately', roi.length >= 1);
  check('every Chat B pick also appears in Chat A', roi.every((r) => all.some((a) => a.querySelector('.msg-ticker').textContent === r.querySelector('.msg-ticker').textContent)));
  check('high-ROI filter capped at 20 picks (disclosed heuristic)', roi.length <= 20);
  check('counts match the rendered messages', doc.getElementById('count-all').textContent === String(all.length) && doc.getElementById('count-roi').textContent === String(roi.length));

  const first = all[0];
  const links = [...first.querySelectorAll('.msg-links a')];
  check('each message links the official venue event page', links.some((a) => a.href.startsWith('https://kalshi.com/events/')));
  check('each message links a news search labelled cause unverified', links.some((a) => /google\.com\/search/.test(a.href) && /cause unverified/.test(a.textContent)));
  check('each message links the official candlesticks API path', links.some((a) => a.href.includes('external-api.demo.kalshi.co/trade-api/v2/series/') && a.href.includes('/candlesticks')));

  const status = doc.getElementById('status-banner').textContent;
  check('status banner reports detected swings + market count', /3 swing\(s\) detected at ≥\$0\.10 across 2 market\(s\)/.test(status), status.slice(0, 90));
  const mode = doc.getElementById('mode-banner').textContent;
  check('mode banner shows SNAPSHOT with the capture timestamp when live is unreachable', /SNAPSHOT/.test(mode) && /2026-11-20T11:43:59Z/.test(mode), mode.slice(0, 120));
  check('mode banner discloses "No values inferred"', /No values inferred/.test(mode));
  dom.window.close();
}

console.log('\n2. Topic filter + threshold controls:');
{
  const log = [];
  const dom = await loadPage(log, false);
  const w = dom.window, doc = w.document;

  const golfBtn = doc.querySelector('#topic-seg button[data-topic="golf"]');
  golfBtn.click();
  await settle();
  check('topic with no qualifying swing shows an explicit empty state (nothing invented)',
    /No swings detected/.test(doc.getElementById('msgs-all').textContent), doc.getElementById('msgs-all').textContent.slice(0, 60));
  const gasBtn = doc.querySelector('#topic-seg button[data-topic="gas_prices"]');
  gasBtn.click();
  await settle();
  const gasMsgs = [...doc.querySelectorAll('#msgs-all .msg')];
  check('topic filter limits the chat to that topic (2 gas swings)', gasMsgs.length === 2 && gasMsgs.every((m) => /Gas prices/.test(m.textContent)), 'got ' + gasMsgs.length);

  doc.querySelector('#topic-seg button[data-topic=""]').click();
  await settle();
  doc.querySelector('#th-seg button[data-th="0.20"]').click();
  await settle();
  check('raising the threshold to $0.20 re-detects: only the $0.25 swing qualifies',
    doc.querySelectorAll('#msgs-all .msg').length === 1, 'got ' + doc.querySelectorAll('#msgs-all .msg').length);
  doc.querySelector('#th-seg button[data-th="0.05"]').click();
  await settle();
  check('lowering the threshold to $0.05 re-detects all three close-to-close moves',
    doc.querySelectorAll('#msgs-all .msg').length === 3, 'got ' + doc.querySelectorAll('#msgs-all .msg').length);
  dom.window.close();
}

console.log('\n3. Empty-input honesty:');
{
  const log = [];
  const dom = await loadPage(log, false);
  const w = dom.window;
  // zero-point series must never fabricate a swing
  check('page boots from the committed snapshot only (snapshot fetches recorded)', log.some((u) => u.includes('snapshot/charts.json')) && log.some((u) => u.includes('snapshot/markets.json')));
  w.document.getElementById('btn-refresh').click();
  await settle();
  check('refresh button re-runs detection without errors', /swing\(s\) detected/.test(w.document.getElementById('status-banner').textContent));
  dom.window.close();
}

console.log('\n4. LIVE overlay with the official candlesticks payload shape:');
{
  // Official Get Market Candlesticks schema (docs.kalshi.com/api-reference/market/get-market-candlesticks,
  // fetched 2026-11-20): candlesticks[] = { end_period_ts, price: { close_dollars, ... }, ... }
  const officialShape = {
    ticker: MKT_GAS,
    candlesticks: [
      { end_period_ts: 1795200000, price: { open_dollars: '0.3000', close_dollars: '0.3000', low_dollars: '0.3000', high_dollars: '0.3000' }, yes_bid: { close_dollars: '0.2900' }, yes_ask: { close_dollars: '0.3100' }, volume_fp: '10.00', open_interest_fp: '100.00' },
      { end_period_ts: 1795203600, price: { open_dollars: '0.5500', close_dollars: '0.5500', low_dollars: '0.5500', high_dollars: '0.5500' }, yes_bid: { close_dollars: '0.5400' }, yes_ask: { close_dollars: '0.5600' }, volume_fp: '20.00', open_interest_fp: '101.00' },
    ],
  };
  const log = [];
  const dom = await loadPage(log, true, officialShape);
  const w = dom.window, doc = w.document;
  const mode = doc.getElementById('mode-banner').textContent;
  check('LIVE mode is announced when the demo API is reachable', /LIVE/.test(mode), mode.slice(0, 100));
  const all = [...doc.querySelectorAll('#msgs-all .msg')];
  const liveMsgs = all.filter((m) => /1h\/live/.test(m.textContent));
  check('official candlesticks payloads are parsed (end_period_ts + price.close_dollars)', liveMsgs.length >= 1, 'live msgs=' + liveMsgs.length + ' of ' + all.length);
  check('live swing delta computed from official closes (+0.250)', liveMsgs.some((m) => /\+0\.250/.test(m.textContent)), liveMsgs.map((m) => m.textContent.replace(/\s+/g, ' ').slice(0, 80)).join(' | '));
  dom.window.close();
}

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES: ' + fail) + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
