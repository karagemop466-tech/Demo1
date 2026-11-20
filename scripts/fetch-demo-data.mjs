#!/usr/bin/env node
/**
 * Capture a live snapshot of the Kalshi DEMO environment for the static site.
 *
 * Run locally:  node scripts/fetch-demo-data.mjs
 * Run in CI:     .github/workflows/data-refresh.yml
 *
 * Everything written here comes from the official demo Trade API:
 *   https://external-api.demo.kalshi.co/trade-api/v2
 *
 * Output (data/):
 *   meta.json          capture time, endpoints used, per-section status, errors
 *   markets.json       topic-filtered market records + derived dollar metrics
 *   events.json        topic-filtered event records (incl. nested markets)
 *   orderbooks.json    public order books for the top markets by dollar exposure
 *   candles.json       official candlesticks for the top markets
 *   resolutions.json   append-only ledger of observed status/result transitions
 *
 * No value is invented: when a field is absent it is written as null.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_REST, DOC, getJSON, paginate, fp } from './kalshi-client.mjs';
import { classify, TOPICS, TOPIC_LABELS, KEYWORDS } from './topics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const MAX_PAGES = 25;
const ORDERBOOK_TOP_N = 12;
const CANDLE_TOP_N = 6;

const log = (...a) => console.log('[fetch]', ...a);

/** Try a list of candidate paths, return the first that answers with a JSON object. */
async function firstOk(base, paths, query = {}) {
  const errors = [];
  for (const p of paths) {
    try {
      const body = await getJSON(base + p + (query.q || ''), { timeoutMs: 25000 });
      return { path: p, body };
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  throw new Error(`no usable path (${paths.join(', ')}) — ${errors.join(' | ')}`);
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, value && value.length < 50 ? 2 : 0) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ */
/* Derived metrics                                                     */
/* ------------------------------------------------------------------ */

/**
 * Dollar metrics for a market.
 *
 * notional_value_dollars : the dollar notional of one contract (Get Markets schema)
 * open_interest_fp       : open contracts outstanding (Get Markets schema)
 * volume_fp / volume_24h_fp : contracts traded, lifetime / last 24h
 *
 * A binary contract pays $1 on a winning outcome
 * (https://docs.kalshi.com/getting_started/market_settlement), so:
 *   open interest notional = open_interest_fp * notional_value_dollars
 *   24h traded notional     = volume_24h_fp   * notional_value_dollars
 * Both are stated explicitly so a reviewer can recompute them; they are NOT a
 * single "official" dollar ranking because Kalshi does not publish one.
 */
function deriveMetrics(m) {
  const notional = fp(m.notional_value_dollars);
  const oi = fp(m.open_interest_fp);
  const v24 = fp(m.volume_24h_fp);
  const vol = fp(m.volume_fp);
  return {
    open_interest_notional_usd: oi === null || notional === null ? null : round2(oi * notional),
    volume_24h_notional_usd: v24 === null || notional === null ? null : round2(v24 * notional),
    volume_lifetime_notional_usd: vol === null || notional === null ? null : round2(vol * notional),
    notional_value_dollars: notional,
    open_interest_fp: oi,
    volume_fp: vol,
    volume_24h_fp: v24,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Trim a market to the fields the site needs, keeping every field source-linked. */
function slimMarket(m, classification) {
  const yesBid = fp(m.yes_bid_dollars);
  const yesAsk = fp(m.yes_ask_dollars);
  const noBid = fp(m.no_bid_dollars);
  const noAsk = fp(m.no_ask_dollars);
  return {
    ticker: m.ticker ?? null,
    event_ticker: m.event_ticker ?? null,
    series_ticker: m.series_ticker ?? null,
    market_type: m.market_type ?? null,
    title: m.title ?? m.yes_sub_title ?? null,
    yes_sub_title: m.yes_sub_title ?? null,
    no_sub_title: m.no_sub_title ?? null,
    status: m.status ?? null,
    result: m.result === '' ? null : (m.result ?? null),
    close_time: m.close_time ?? null,
    open_time: m.open_time ?? null,
    expected_expiration_time: m.expected_expiration_time ?? null,
    latest_expiration_time: m.latest_expiration_time ?? null,
    settlement_ts: m.settlement_ts ?? null,
    settlement_value_dollars: fp(m.settlement_value_dollars),
    settlement_timer_seconds: m.settlement_timer_seconds ?? null,
    yes_bid_dollars: yesBid,
    yes_ask_dollars: yesAsk,
    no_bid_dollars: noBid,
    no_ask_dollars: noAsk,
    yes_bid_size_fp: fp(m.yes_bid_size_fp),
    yes_ask_size_fp: fp(m.yes_ask_size_fp),
    last_price_dollars: fp(m.last_price_dollars),
    previous_price_dollars: fp(m.previous_price_dollars),
    rules_primary: m.rules_primary || null,
    rules_secondary: m.rules_secondary || null,
    topic: classification ? classification.topic : null,
    topic_method: classification ? classification.method : null,
    topic_evidence: classification ? classification.evidence : null,
    ...deriveMetrics(m),
  };
}

/** Order-book maths: contracts resting at each price and the dollar value resting there. */
function summariseBook(book) {
  const ob = book?.orderbook_fp || book?.orderbook || {};
  const parse = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map(([price, count]) => ({ price: fp(price), count: fp(count) }))
      .filter((l) => l.price !== null && l.count !== null)
      .map((l) => ({ ...l, notional_usd: round2(l.price * l.count) }));
  const yes = parse(ob.yes_dollars || ob.yes);
  const no = parse(ob.no_dollars || ob.no);
  const best = (arr) => (arr.length ? arr[arr.length - 1].price : null);
  const bestYesBid = best(yes);
  const bestNoBid = best(no);
  return {
    yes_bids: yes,
    no_bids: no,
    best_yes_bid: bestYesBid,
    best_no_bid: bestNoBid,
    // Kalshi returns bids only; asks are derived (orderbook_responses guide).
    implied_yes_ask: bestNoBid === null ? null : round2(1 - bestNoBid),
    implied_no_ask: bestYesBid === null ? null : round2(1 - bestYesBid),
    yes_bid_depth_contracts: round2(yes.reduce((s, l) => s + l.count, 0)),
    no_bid_depth_contracts: round2(no.reduce((s, l) => s + l.count, 0)),
    yes_bid_depth_notional_usd: round2(yes.reduce((s, l) => s + l.notional_usd, 0)),
    no_bid_depth_notional_usd: round2(no.reduce((s, l) => s + l.notional_usd, 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const startedAt = new Date();
  const sections = {};
  const errors = [];

  await fs.mkdir(DATA, { recursive: true });

  /* 1. Series list -> series ticker to category map ------------------------ */
  let seriesCategory = new Map();
  let seriesTitle = new Map();
  let seriesPath = null;
  try {
    const res = await firstOk(DEMO_REST, ['/series/list', '/series'], { q: '?limit=1000' });
    seriesPath = res.path;
    const rows = Array.isArray(res.body?.series) ? res.body.series : [];
    for (const s of rows) {
      if (s.ticker) {
        if (s.category) seriesCategory.set(s.ticker, s.category);
        if (s.title) seriesTitle.set(s.ticker, s.title);
      }
    }
    sections.series = { ok: true, path: res.path, count: rows.length };
    log('series', res.path, rows.length);
  } catch (e) {
    sections.series = { ok: false, error: e.message };
    errors.push(`series: ${e.message}`);
    log('series failed:', e.message);
  }

  /* 2. Events (with nested markets) -------------------------------------- */
  const events = [];
  const seriesOfEvent = new Map();
  try {
    const rows = await paginate(
      DEMO_REST,
      '/events',
      { with_nested_markets: 'true', limit: 200 },
      { maxPages: MAX_PAGES, key: 'events' },
    );
    for (const e of rows) {
      if (e.event_ticker && e.series_ticker) seriesOfEvent.set(e.event_ticker, e.series_ticker);
    }
    events.push(...rows);
    sections.events = { ok: true, count: rows.length };
    log('events', rows.length);
  } catch (e) {
    sections.events = { ok: false, error: e.message };
    errors.push(`events: ${e.message}`);
    log('events failed:', e.message);
  }

  /* 3. Markets by status ------------------------------------------------- */
  const markets = [];
  const marketSeries = new Map();
  for (const status of ['open', 'closed', 'settled']) {
    try {
      const rows = await paginate(
        DEMO_REST,
        '/markets',
        { status, limit: 1000 },
        { maxPages: MAX_PAGES, key: 'markets' },
      );
      markets.push(...rows);
      sections[`markets_${status}`] = { ok: true, count: rows.length };
      log('markets', status, rows.length);
    } catch (e) {
      sections[`markets_${status}`] = { ok: false, error: e.message };
      errors.push(`markets ${status}: ${e.message}`);
    }
  }
  for (const e of events) {
    for (const m of e.markets || []) {
      if (m.ticker && e.series_ticker) marketSeries.set(m.ticker, e.series_ticker);
    }
  }

  /* 4. Classify by topic ------------------------------------------------- */
  const allowlist = new Map();
  const allowlistFile = path.join(ROOT, 'data', 'series-allowlist.json');
  const allowlistData = await loadJson(allowlistFile, null);
  if (allowlistData && typeof allowlistData === 'object') {
    for (const [k, v] of Object.entries(allowlistData)) allowlist.set(k, v);
  }

  const ctx = { seriesAllowlist: allowlist, seriesCategory };

  const marketRows = [];
  for (const m of markets) {
    const enriched = { ...m, series_ticker: m.series_ticker || marketSeries.get(m.ticker) || null };
    const c = classify(enriched, ctx);
    if (!c) continue;
    marketRows.push(slimMarket(enriched, c));
  }
  marketRows.sort(
    (a, b) => (b.open_interest_notional_usd ?? -1) - (a.open_interest_notional_usd ?? -1),
  );

  const eventRows = [];
  for (const e of events) {
    const enriched = { ...e, series_ticker: e.series_ticker || null };
    const c = classify(enriched, ctx);
    if (!c) continue;
    eventRows.push({
      event_ticker: e.event_ticker ?? null,
      series_ticker: e.series_ticker ?? null,
      title: e.title ?? null,
      category: e.category ?? null,
      status: e.status ?? null,
      strike_date: e.strike_date ?? null,
      strike_period: e.strike_period ?? null,
      open_time: e.open_time ?? null,
      close_time: e.close_time ?? null,
      expected_expiration_time: e.expected_expiration_time ?? null,
      settlement_sources: Array.isArray(e.settlement_sources)
        ? e.settlement_sources.map((s) => (typeof s === 'string' ? s : s?.name ?? s?.url ?? null))
        : null,
      market_count: Array.isArray(e.markets) ? e.markets.length : null,
      markets: Array.isArray(e.markets)
        ? e.markets.map((m) => {
            const mm = { ...m, series_ticker: e.series_ticker || null };
            const cc = classify(mm, ctx);
            return {
              ticker: m.ticker ?? null,
              title: m.title ?? m.yes_sub_title ?? null,
              status: m.status ?? null,
              result: m.result === '' ? null : (m.result ?? null),
              close_time: m.close_time ?? null,
              settlement_ts: m.settlement_ts ?? null,
              yes_bid_dollars: fp(m.yes_bid_dollars),
              yes_ask_dollars: fp(m.yes_ask_dollars),
              last_price_dollars: fp(m.last_price_dollars),
              topic: cc ? cc.topic : null,
              ...deriveMetrics(m),
            };
          })
        : null,
      topic: c.topic,
      topic_method: c.method,
      topic_evidence: c.evidence,
    });
  }

  /* 5. Order books for the largest markets -------------------------------- */
  const orderbooks = {};
  const ranked = marketRows.filter((m) => m.status === 'active').slice(0, ORDERBOOK_TOP_N);
  for (const m of ranked) {
    try {
      const body = await getJSON(`${DEMO_REST}/markets/${encodeURIComponent(m.ticker)}/orderbook?depth=25`);
      orderbooks[m.ticker] = {
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        title: m.title,
        topic: m.topic,
        captured_at: new Date().toISOString(),
        ...summariseBook(body),
      };
    } catch (e) {
      errors.push(`orderbook ${m.ticker}: ${e.message}`);
    }
  }
  sections.orderbooks = { ok: true, count: Object.keys(orderbooks).length, requested: ranked.length };

  /* 6. Candlesticks for the largest markets -------------------------------- */
  const candles = {};
  for (const m of marketRows.filter((x) => x.status === 'active').slice(0, CANDLE_TOP_N)) {
    const series = m.series_ticker;
    if (!series) {
      errors.push(`candles ${m.ticker}: no series_ticker resolved`);
      continue;
    }
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - 7 * 24 * 3600;
    try {
      const body = await getJSON(
        `${DEMO_REST}/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(m.ticker)}` +
          `/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=1`,
      );
      candles[m.ticker] = {
        ticker: m.ticker,
        series_ticker: series,
        period_interval_minutes: 1,
        start_ts: startTs,
        end_ts: endTs,
        captured_at: new Date().toISOString(),
        candlesticks: Array.isArray(body?.candlesticks) ? body.candlesticks : [],
      };
    } catch (e) {
      errors.push(`candles ${m.ticker}: ${e.message}`);
    }
  }
  sections.candles = { ok: true, count: Object.keys(candles).length };

  /* 7. Resolution ledger (append-only observation history) ------------------ */
  const ledgerFile = path.join(DATA, 'resolutions.json');
  const previous = await loadJson(ledgerFile, { entries: [] });
  const seen = new Map((previous.entries || []).map((e) => [e.ticker, e]));
  let changed = 0;
  for (const m of marketRows) {
    const prev = seen.get(m.ticker);
    const cur = {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      title: m.title,
      topic: m.topic,
      status: m.status,
      result: m.result,
      settlement_ts: m.settlement_ts,
      settlement_value_dollars: m.settlement_value_dollars,
      close_time: m.close_time,
      observed_at: new Date().toISOString(),
    };
    const key = `${m.status}|${m.result}|${m.settlement_ts ?? ''}`;
    if (!prev || prev.key !== key) {
      cur.key = key;
      cur.first_seen_status = prev ? prev.status : m.status;
      cur.first_seen_at = prev ? prev.first_seen_at : cur.observed_at;
      cur.transition = prev ? `${prev.status} -> ${m.status}` : 'first observation';
      seen.set(m.ticker, cur);
      changed++;
    }
  }
  const ledger = {
    updated_at: new Date().toISOString(),
    note:
      'Append-only observation ledger. "transition" records what THIS capture saw change relative to the previous capture; it is an observation history, not an official Kalshi event log.',
    entries: [...seen.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))),
  };
  await writeJson(ledgerFile, ledger);

  /* 8. Write outputs ------------------------------------------------------ */
  await writeJson(path.join(DATA, 'markets.json'), marketRows);
  await writeJson(path.join(DATA, 'events.json'), eventRows);
  await writeJson(path.join(DATA, 'orderbooks.json'), orderbooks);
  await writeJson(path.join(DATA, 'candles.json'), candles);

  const byTopic = {};
  for (const t of TOPICS) {
    const rows = marketRows.filter((m) => m.topic === t);
    byTopic[t] = {
      label: TOPIC_LABELS[t],
      markets: rows.length,
      open_markets: rows.filter((m) => m.status === 'active').length,
      resolved: rows.filter((m) => m.status === 'finalized').length,
      top_open_interest_notional_usd: rows.reduce(
        (s, m) => s + (m.open_interest_notional_usd ?? 0),
        0,
      ),
      top_volume_24h_notional_usd: rows.reduce(
        (s, m) => s + (m.volume_24h_notional_usd ?? 0),
        0,
      ),
    };
  }

  const meta = {
    captured_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    environment: 'demo',
    base_url: DEMO_REST,
    base_url_alt: 'https://demo-api.kalshi.co/trade-api/v2',
    websocket_url: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    endpoints_used: [
      { path: '/markets?status=open|closed|settled', doc: DOC.getMarkets, auth: 'none' },
      { path: '/events?with_nested_markets=true', doc: DOC.getEvents, auth: 'none' },
      { path: '/markets/{ticker}/orderbook?depth=N', doc: DOC.getOrderbook, auth: 'none' },
      { path: '/series/list', doc: DOC.seriesList, auth: 'none' },
      {
        path: '/series/{series_ticker}/markets/{ticker}/candlesticks',
        doc: DOC.getCandlesticks,
        auth: 'none',
      },
    ],
    sections,
    errors,
    counts: {
      markets_scanned: markets.length,
      markets_in_topic: marketRows.length,
      events_scanned: events.length,
      events_in_topic: eventRows.length,
      orderbooks: Object.keys(orderbooks).length,
      candle_series: Object.keys(candles).length,
      resolution_entries: ledger.entries.length,
      resolution_transitions_observed: changed,
    },
    topic_summary: byTopic,
    topic_rules: {
      category_map_source: DOC.seriesList,
      keyword_rules: KEYWORDS,
      note:
        'Kalshi publishes no "gas/elections/culture/crypto/golf" taxonomy. Each row records the classification method (series-category, series-allowlist or keyword) so it can be audited.',
    },
    series_path_used: seriesPath,
  };
  await writeJson(path.join(DATA, 'meta.json'), meta);

  log('done. markets in topic:', marketRows.length, 'errors:', errors.length);
  if (errors.length) for (const e of errors.slice(0, 12)) log('  !', e);
}

main().catch((e) => {
  console.error('[fetch] fatal', e);
  process.exitCode = 1;
});
