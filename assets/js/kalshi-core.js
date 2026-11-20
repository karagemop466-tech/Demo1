/*
 * Kalshi demo data engine (public market data only — no credentials, no orders).
 *
 * Every value rendered by this engine comes from a live response of the official
 * Kalshi demo Trade API, or is left blank. Nothing is inferred, padded or simulated.
 *
 * Verified official sources (fetched 2026-11-20):
 *  - REST demo base URL .......... https://docs.kalshi.com/getting_started/api_environments.md
 *  - Market fields .............. https://docs.kalshi.com/api-reference/market/get-markets.md
 *  - Order book shape ........... https://docs.kalshi.com/getting_started/orderbook_responses.md
 *  - Candlestick intervals ...... https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md
 *  - Event fields ............... https://docs.kalshi.com/api-reference/events/get-events.md
 *  - WebSocket (signed) ......... https://docs.kalshi.com/getting_started/quick_start_websockets.md
 */
(function (global) {
  'use strict';

  const HOSTS = {
    recommended: 'https://external-api.demo.kalshi.co/trade-api/v2',
    alt: 'https://demo-api.kalshi.co/trade-api/v2'
  };
  const WS_URLS = {
    recommended: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    alt: 'wss://demo-api.kalshi.co/trade-api/ws/v2'
  };

  /* Topic scope -> official series taxonomy (category / tag values returned by the demo API
   * itself from GET /search/tags_by_categories, captured 2026-11-20T11:2xZ).
   * `keywords` is an explicitly-labelled heuristic fallback, used only when a series is not
   * present in the taxonomy response. */
  const TOPICS = {
    gas: {
      label: 'Gas prices',
      seriesQueries: [
        { category: 'Commodities', tags: 'Oil & Gas' },
        { category: 'Economics', tags: 'Oil and energy' }
      ],
      keywords: ['gas price', 'gasoline', 'gallon', 'crude oil', 'oil price', 'natural gas', 'diesel', 'sp500 energy']
    },
    elections: {
      label: 'Elections',
      seriesQueries: [{ category: 'Elections' }, { category: 'Politics', tags: 'US Elections' }],
      keywords: ['election', 'president', 'senate', 'governor', 'house', 'mayor', 'nominee', 'nomination', 'ballot', 'primar']
    },
    culture: {
      label: 'Culture',
      seriesQueries: [{ category: 'Entertainment' }],
      keywords: ['oscar', 'grammy', 'box office', 'album', 'movie', 'film', 'tv', 'streaming', 'celebrity', 'entertainment', 'music', 'video game', 'emmy']
    },
    crypto: {
      label: 'Crypto',
      seriesQueries: [{ category: 'Crypto' }],
      keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'doge', 'crypto', 'xrp']
    },
    golf: {
      label: 'Golf',
      seriesQueries: [{ category: 'Sports', tags: 'Golf' }],
      keywords: ['golf', 'pga', 'lpga', 'masters', 'us open golf', 'tour championship', 'ryder cup']
    }
  };
  const TOPIC_KEYS = Object.keys(TOPICS);

  /* ------------------------------------------------------------------ helpers */
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  /** money with 2 decimals, blank when unknown */
  const usd = (v, dp) => {
    const n = num(v);
    return n === null ? '' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp === undefined ? 2 : dp, maximumFractionDigits: dp === undefined ? 2 : dp });
  };
  const compact = (v) => {
    const n = num(v);
    if (n === null) return '';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  };
  const cnt = (v) => {
    const n = num(v);
    return n === null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour12: false }) : '');
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { hour12: false }) : '');
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------- client */
  const state = {
    host: localStorage.getItem('kd.host') || HOSTS.recommended,
    requests: [],
    errors: [],
    blocked: false
  };

  function logRequest(entry) {
    state.requests.unshift(entry);
    if (state.requests.length > 120) state.requests.pop();
    if (global.dispatchEvent) global.dispatchEvent(new CustomEvent('kd:request', { detail: entry }));
  }

  async function api(pathAndQuery, opts) {
    const url = state.host + pathAndQuery;
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (opts && opts.timeoutMs) || 20000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      const ms = Date.now() - started;
      if (!res.ok) {
        let body = '';
        try { body = (await res.text()).slice(0, 300); } catch (e) { /* unreadable error body */ }
        logRequest({ url, status: res.status, ms, ok: false, note: body });
        throw new Error('HTTP ' + res.status + ' ' + pathAndQuery.split('?')[0] + (body ? ' · ' + body : ''));
      }
      const json = await res.json();
      logRequest({ url, status: res.status, ms, ok: true, records: countRecords(json) });
      state.blocked = false;
      return json;
    } catch (err) {
      const ms = Date.now() - started;
      const aborted = err && err.name === 'AbortError';
      logRequest({ url, status: 0, ms, ok: false, note: aborted ? 'timeout' : String(err && err.message || err) });
      const e = new Error(aborted ? 'Request timed out: ' + pathAndQuery.split('?')[0] : (String(err && err.message || err) + ' — network or CORS blocked'));
      e.transport = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  function countRecords(json) {
    if (!json || typeof json !== 'object') return 0;
    for (const k of ['markets', 'events', 'trades', 'candlesticks', 'series']) if (Array.isArray(json[k])) return json[k].length;
    if (json.orderbook_fp) return (json.orderbook_fp.yes_dollars || []).length + (json.orderbook_fp.no_dollars || []).length;
    return 1;
  }

  /* ---------------------------------------------------------------- taxonomy */
  /* GET /series?category=…[&tags=…] — official discovery endpoint. Result cached in
   * localStorage for 6h so repeat page loads do not re-download the taxonomy. */
  const TAX_TTL = 6 * 60 * 60 * 1000;
  async function taxonomy(force) {
    const raw = localStorage.getItem('kd.taxonomy');
    if (!force && raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.at < TAX_TTL) return cached.map;
    }
    const map = {};
    for (const topicKey of TOPIC_KEYS) {
      for (const q of TOPICS[topicKey].seriesQueries) {
        const qs = 'category=' + encodeURIComponent(q.category) + (q.tags ? '&tags=' + encodeURIComponent(q.tags) : '');
        let data;
        try {
          data = await api('/series?include_volume=true&' + qs);
        } catch (err) {
          state.errors.push({ where: 'taxonomy ' + topicKey + ' (' + q.category + (q.tags ? '/' + q.tags : '') + ')', message: err.message });
          continue;
        }
        for (const s of (data.series || [])) {
          map[s.ticker] = map[s.ticker] || { ticker: s.ticker, title: s.title, category: s.category, categories: s.categories || [], tags: s.tags || [], volume_fp: s.volume_fp, topics: [] };
          if (map[s.ticker].topics.indexOf(topicKey) === -1) map[s.ticker].topics.push(topicKey);
        }
      }
    }
    localStorage.setItem('kd.taxonomy', JSON.stringify({ at: Date.now(), map }));
    return map;
  }

  function classifyTopic(event, tax) {
    const series = event.series_ticker || '';
    const hit = tax[series];
    if (hit && hit.topics && hit.topics.length) return hit.topics.slice();
    const hay = ((event.title || '') + ' ' + (event.sub_title || '') + ' ' + series + ' ' + (event.category || '')).toLowerCase();
    const out = [];
    for (const k of TOPIC_KEYS) if (TOPICS[k].keywords.some((w) => hay.indexOf(w) !== -1)) out.push(k);
    return out.length ? out : [];
  }

  /* --------------------------------------------------------------- collection */
  /* Dollar definitions (field semantics verified in the official Market schema):
   *   traded notional  = volume_fp (contracts) x notional_value_dollars ($ per contract at settlement)
   *   24h notional     = volume_24h_fp x notional_value_dollars
   *   open exposure    = open_interest_fp x notional_value_dollars
   *   trade dollars    = count_fp x price of the side the taker traded (documented convention) */
  function marketDollars(m) {
    const notional = num(m.notional_value_dollars);
    const vol = num(m.volume_fp);
    const vol24 = num(m.volume_24h_fp);
    const oi = num(m.open_interest_fp);
    return {
      traded: vol === null || notional === null ? null : vol * notional,
      traded24h: vol24 === null || notional === null ? null : vol24 * notional,
      exposure: oi === null || notional === null ? null : oi * notional
    };
  }

  async function recentTrades(minutes) {
    const end = Math.floor(Date.now() / 1000);
    const start = end - Math.round(minutes * 60);
    let cursor = '';
    const trades = [];
    for (let page = 0; page < 10; page++) {
      const data = await api('/markets/trades?limit=1000&after_ts=' + start + '&before_ts=' + end + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      trades.push.apply(trades, data.trades || []);
      cursor = data.cursor || '';
      if (!cursor) break;
    }
    return trades.filter((t) => {
      const ts = Date.parse(t.created_time) / 1000;
      return ts >= start && ts <= end;
    });
  }

  async function hydrateMarkets(tickers) {
    const out = {};
    const list = Object.keys(tickers);
    for (let i = 0; i < list.length; i += 60) {
      const chunk = list.slice(i, i + 60);
      const data = await api('/markets?limit=1000&tickers=' + chunk.map(encodeURIComponent).join(','));
      for (const m of data.markets || []) out[m.ticker] = m;
    }
    return out;
  }

  async function hydrateEvents(eventTickers) {
    const out = {};
    const list = Object.keys(eventTickers);
    for (let i = 0; i < list.length; i += 60) {
      const chunk = list.slice(i, i + 60);
      const data = await api('/events?limit=200&tickers=' + chunk.map(encodeURIComponent).join(','));
      for (const e of data.events || []) out[e.event_ticker] = e;
    }
    return out;
  }

  /** Live scan: recent fills -> markets -> events -> topic taxonomy. */
  async function scanLive(opts) {
    const o = Object.assign({ minutes: 60, topic: 'all' }, opts || {});
    const notes = [];
    const trades = await recentTrades(o.minutes);
    const byTicker = {};
    for (const t of trades) {
      const price = t.taker_outcome_side === 'no' ? num(t.no_price_dollars) : num(t.yes_price_dollars);
      const count = num(t.count_fp);
      const rec = byTicker[t.ticker] || (byTicker[t.ticker] = { ticker: t.ticker, fills: 0, contracts: 0, dollars: 0, lastTs: '', lastPrice: null });
      rec.fills++;
      if (count !== null) rec.contracts += count;
      if (count !== null && price !== null) rec.dollars += count * price;
      if (t.created_time > rec.lastTs) { rec.lastTs = t.created_time; rec.lastPrice = price; }
    }
    let markets = {};
    if (Object.keys(byTicker).length) {
      try { markets = await hydrateMarkets(byTicker); } catch (err) { notes.push('Market hydration incomplete: ' + err.message); }
    }
    const evIdx = {};
    for (const m of Object.values(markets)) if (m.event_ticker) evIdx[m.event_ticker] = 1;
    let events = {};
    if (Object.keys(evIdx).length) {
      try { events = await hydrateEvents(evIdx); } catch (err) { notes.push('Event hydration incomplete: ' + err.message); }
    }
    let tax = {};
    try { tax = await taxonomy(false); } catch (err) { notes.push('Taxonomy unavailable: ' + err.message); }

    const agg = {};
    for (const m of Object.values(markets)) {
      const ev = events[m.event_ticker] || {};
      const topics = classifyTopic({ series_ticker: ev.series_ticker || seriesOf(m), title: ev.title || m.title, category: ev.category }, tax);
      if (o.topic !== 'all' && topics.indexOf(o.topic) === -1) continue;
      const d = marketDollars(m);
      const flow = byTicker[m.ticker] || {};
      const a = agg[m.event_ticker] || (agg[m.event_ticker] = {
        event_ticker: m.event_ticker, series_ticker: ev.series_ticker || seriesOf(m), title: ev.title || '', category: ev.category || '',
        topics: topics, markets: [], traded: 0, traded24h: 0, exposure: 0, fills: 0, flowContracts: 0, flowDollars: 0,
        resolvedCount: 0, yesCount: 0, noCount: 0, openCount: 0, anyActive: false, bestPrice: null, bestTicker: ''
      });
      a.markets.push(m);
      if (d.traded !== null) a.traded += d.traded;
      if (d.traded24h !== null) a.traded24h += d.traded24h;
      if (d.exposure !== null) a.exposure += d.exposure;
      a.fills += flow.fills || 0;
      a.flowContracts += flow.contracts || 0;
      a.flowDollars += flow.dollars || 0;
      if (m.status === 'active') a.anyActive = true;
      if (m.result === 'yes') { a.resolvedCount++; a.yesCount++; }
      else if (m.result === 'no') { a.resolvedCount++; a.noCount++; }
      if (!m.result) a.openCount++;
      const lp = num(m.last_price_dollars);
      if (lp !== null && (a.bestPrice === null || lp > a.bestPrice)) { a.bestPrice = lp; a.bestTicker = m.ticker; }
    }
    const rows = Object.values(agg).sort((x, y) => (y.traded - x.traded) || (y.flowDollars - x.flowDollars));
    return { rows: rows, trades: trades, markets: markets, events: events, taxonomy: tax, notes: notes, windowMinutes: o.minutes };
  }

  /** Fallback only: Kalshi tickers are `<SERIES>-<EVENT>-<MARKET>` shaped; the preferred source is
   *  the official EventData.series_ticker field returned by GET /events. */
  function seriesOf(market) {
    const ev = market.event_ticker || '';
    if (ev.indexOf('KXMVE') === 0) return 'KXMVE' + (ev.split('-')[0] || '').slice(5);
    return ev.split('-')[0] || (market.ticker || '').split('-')[0];
  }

  /* --------------------------------------------------------------- order book */
  async function orderbook(ticker, depth) {
    const data = await api('/markets/' + encodeURIComponent(ticker) + '/orderbook' + (depth ? '?depth=' + depth : ''));
    const ob = data.orderbook_fp || {};
    const yes = (ob.yes_dollars || []).map((l) => level(l, 'yes'));
    const no = (ob.no_dollars || []).map((l) => level(l, 'no'));
    const bestYesBid = yes.length ? yes[yes.length - 1] : null;
    const bestNoBid = no.length ? no[no.length - 1] : null;
    const yesAsk = bestNoBid ? 1 - bestNoBid.price : null;   /* reciprocal relationship, see orderbook_responses doc */
    const noAsk = bestYesBid ? 1 - bestYesBid.price : null;
    return {
      ticker: ticker, yes: yes, no: no,
      bestYesBid: bestYesBid, bestNoBid: bestNoBid,
      yesAsk: yesAsk === null ? null : +yesAsk.toFixed(4), noAsk: noAsk === null ? null : +noAsk.toFixed(4),
      spread: (bestYesBid && yesAsk !== null) ? +(yesAsk - bestYesBid.price).toFixed(4) : null,
      yesDollars: yes.reduce((s, l) => s + (l.dollars || 0), 0),
      noDollars: no.reduce((s, l) => s + (l.dollars || 0), 0),
      yesContracts: yes.reduce((s, l) => s + (l.count || 0), 0),
      noContracts: no.reduce((s, l) => s + (l.count || 0), 0),
      empty: !yes.length && !no.length,
      requestedUrl: state.host + '/markets/' + encodeURIComponent(ticker) + '/orderbook' + (depth ? '?depth=' + depth : '')
    };
  }
  function level(pair, side) {
    const price = num(pair[0]);
    const count = num(pair[1]);
    return { side: side, price: price, count: count, dollars: price === null || count === null ? null : (side === 'yes' ? price * count : price * count) };
  }

  /* ------------------------------------------------------------------ history */
  const INTERVALS = { '1m': 1, '1h': 60, '1d': 1440 };
  async function candles(seriesTicker, marketTicker, interval, windowSeconds) {
    const iv = INTERVALS[interval];
    if (!iv) throw new Error('Unsupported interval "' + interval + '". The endpoint only accepts period_interval 1, 60 or 1440 minutes.');
    const end = Math.floor(Date.now() / 1000);
    const span = Math.min(windowSeconds || 3 * 3600, iv * 60 * 5000);   /* 5,000 periods max per request */
    const start = end - span;
    const path = '/series/' + encodeURIComponent(seriesTicker) + '/markets/' + encodeURIComponent(marketTicker)
      + '/candlesticks?start_ts=' + start + '&end_ts=' + end + '&period_interval=' + iv;
    const data = await api(path);
    return (data.candlesticks || []).map((c) => ({
      ts: c.end_period_ts,
      open: num(c.price && c.price.open_dollars), high: num(c.price && c.price.high_dollars),
      low: num(c.price && c.price.low_dollars), close: num(c.price && c.price.close_dollars),
      mean: num(c.price && c.price.mean_dollars), previous: num(c.price && c.price.previous_dollars),
      yesBidClose: num(c.yes_bid && c.yes_bid.close_dollars), yesAskClose: num(c.yes_ask && c.yes_ask.close_dollars),
      volume: num(c.volume_fp), openInterest: num(c.open_interest_fp)
    })).sort((a, b) => a.ts - b.ts);
  }
  /** Seconds-resolution ticks: candlesticks are minute-granular at best, so sub-minute
   *  resolution is built from individual trades (GET /markets/trades). */
  async function ticks(marketTicker, seconds) {
    const end = Math.floor(Date.now() / 1000);
    const path = '/markets/trades?limit=1000&market_ticker=' + encodeURIComponent(marketTicker)
      + '&after_ts=' + (end - Math.min(seconds || 300, 3 * 3600)) + '&before_ts=' + end;
    const data = await api(path);
    return (data.trades || []).map((t) => ({
      ts: Math.floor(Date.parse(t.created_time) / 1000),
      ms: Date.parse(t.created_time),
      close: t.taker_outcome_side === 'no' ? num(t.no_price_dollars) : num(t.yes_price_dollars),
      yes: num(t.yes_price_dollars), no: num(t.no_price_dollars),
      volume: num(t.count_fp), side: t.taker_outcome_side || '', bookSide: t.taker_book_side || ''
    })).sort((a, b) => a.ms - b.ms);
  }

  /* ---------------------------------------------------- resolution watch list */
  const WL_KEY = 'kd.watchlist';
  const RS_KEY = 'kd.resolutions';
  const watchList = () => JSON.parse(localStorage.getItem(WL_KEY) || '{}');
  const saveWatch = (w) => localStorage.setItem(WL_KEY, JSON.stringify(w));
  const resolutions = () => JSON.parse(localStorage.getItem(RS_KEY) || '{}');
  const saveResolutions = (r) => localStorage.setItem(RS_KEY, JSON.stringify(r));

  function watch(eventTicker, meta) {
    const w = watchList();
    w[eventTicker] = Object.assign({ firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() }, w[eventTicker] || {}, meta || {}, { event_ticker: eventTicker });
    saveWatch(w);
    return w;
  }
  function unwatch(eventTicker) { const w = watchList(); delete w[eventTicker]; saveWatch(w); return w; }

  /** Poll each watched event and persist the first observed yes/no resolution. */
  async function trackResolutions(onEach) {
    const w = watchList();
    const done = resolutions();
    const updates = [];
    for (const eventTicker of Object.keys(w)) {
      let data;
      try { data = await api('/markets?limit=1000&event_ticker=' + encodeURIComponent(eventTicker)); }
      catch (err) { updates.push({ event_ticker: eventTicker, error: err.message }); continue; }
      const markets = data.markets || [];
      const resolved = markets.filter((m) => m.result === 'yes' || m.result === 'no');
      const rec = {
        event_ticker: eventTicker, title: w[eventTicker].title || '', at: new Date().toISOString(),
        markets: markets.length, resolved: resolved.length, open: markets.length - resolved.length,
        yes: resolved.filter((m) => m.result === 'yes').map((m) => m.ticker),
        no: resolved.filter((m) => m.result === 'no').map((m) => m.ticker),
        allResolved: markets.length > 0 && resolved.length === markets.length,
        detail: markets.map((m) => ({ ticker: m.ticker, title: m.title, result: m.result || '', status: m.status, last: m.last_price_dollars, settlement_ts: m.settlement_ts || '', settlement_value_dollars: m.settlement_value_dollars || '', close_time: m.close_time })),
        source: state.host + '/markets?limit=1000&event_ticker=' + encodeURIComponent(eventTicker)
      };
      const prev = done[eventTicker] || {};
      done[eventTicker] = Object.assign({ firstResolvedAt: prev.firstResolvedAt || (rec.resolved ? new Date().toISOString() : '') }, rec);
      for (const m of rec.detail) {
        if (m.result && !(prev.yes || []).concat(prev.no || []).includes(m.ticker)) {
          done['m:' + m.ticker] = { market_ticker: m.ticker, event_ticker: eventTicker, result: m.result, seenAt: new Date().toISOString(), status: m.status, settlement_ts: m.settlement_ts, settlement_value_dollars: m.settlement_value_dollars, source: rec.source };
          const reg = (done['m:' + m.ticker]);
          updates.push(reg);
        }
      }
      saveResolutions(done);
      if (onEach) onEach(rec);
      updates.push(rec);
    }
    return updates;
  }

  /* ------------------------------------------------------------------ journal */
  const JOURNAL_KEY = 'kd.journal';
  const journal = () => JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
  const saveJournal = (rows) => localStorage.setItem(JOURNAL_KEY, JSON.stringify(rows.slice(-2000)));
  function addJournalRow(row) { const rows = journal(); rows.push(row); saveJournal(rows); return rows; }
  function clearJournal() { localStorage.removeItem(JOURNAL_KEY); }

  /* Strategies are user-declared tags; classification is rule based so it is auditable. */
  const STRATEGY_RULES = [
    { id: 'longshot-buy', name: 'Longshot buy', test: (t) => t.side === 'buy' && t.price <= 0.10, note: 'Buy at <= $0.10: cheap tail, binary payoff 10x+.' },
    { id: 'favorite-buy', name: 'Favorite buy', test: (t) => t.side === 'buy' && t.price >= 0.90, note: 'Buy at >= $0.90: near-certain, small edge per contract.' },
    { id: 'midrange-spread', name: 'Mid-range directional', test: (t) => t.side === 'buy' && t.price > 0.10 && t.price < 0.90, note: 'Directional entry away from the tails.' },
    { id: 'sell-side', name: 'Sell / make liquidity', test: (t) => t.side === 'sell', note: 'Selling contracts, earning on spread rather than direction.' },
    { id: 'event-hedge', name: 'Same-event hedge', test: (t) => !!t.hedge, note: 'Offsetting YES/NO exposure inside one event.' }
  ];
  function categorize(trade) {
    const hits = STRATEGY_RULES.filter((r) => { try { return r.test(trade); } catch (e) { return false; } }).map((r) => r.id);
    return hits.length ? hits : ['unclassified'];
  }

  /** Realised outcome for a fill, once the market has a yes/no result.
   *  A contract on outcome X pays $1 when the market result equals X, else $0
   *  (notional_value_dollars is the per-contract settlement value; $1.0000 on the
   *  binary markets observed in the demo API). Buyers pay price, sellers receive it. */
  function settle(trade, forcedResult) {
    const result = forcedResult !== undefined ? forcedResult : trade.result;
    if (!result) return null;
    const outcome = trade.outcome || 'yes';
    const payoff = result === outcome ? 1 : 0;
    const perContract = (trade.side === 'buy' ? payoff - trade.price : trade.price - payoff) * (num(trade.notional) === null ? 1 : num(trade.notional));
    const total = perContract * (trade.count || 0);
    const fee = num(trade.fee) || 0;
    return { won: payoff === (trade.side === 'buy' ? 1 : 0), payoff: payoff, perContract: perContract, total: total, fee: fee, net: total - fee };
  }

  function performance(rows) {
    const settled = rows.filter((r) => r.result === 'yes' || r.result === 'no');
    const stats = {};
    for (const r of settled) {
      for (const s of (r.strategies && r.strategies.length ? r.strategies : ['unclassified'])) {
        const b = stats[s] || (stats[s] = { strategy: s, trades: 0, wins: 0, staked: 0, net: 0, fees: 0, worst: null, best: null });
        const st = settle(r, r.result);
        b.trades++;
        b.wins += st.won ? 1 : 0;
        b.staked += r.price * r.count;
        b.net += st.net;
        b.fees += r.fee || 0;
        b.worst = b.worst === null ? st.net : Math.min(b.worst, st.net);
        b.best = b.best === null ? st.net : Math.max(b.best, st.net);
      }
    }
    Object.values(stats).forEach((b) => {
      b.hitRate = b.trades ? b.wins / b.trades : null;
      b.roi = b.staked ? b.net / b.staked : null;
    });
    return { open: rows.length - settled.length, settled: settled.length, byStrategy: Object.values(stats).sort((a, b) => b.net - a.net) };
  }

  global.KalshiDemo = {
    HOSTS: HOSTS, WS_URLS: WS_URLS, TOPICS: TOPICS, TOPIC_KEYS: TOPIC_KEYS, STRATEGY_RULES: STRATEGY_RULES,
    state: state, api: api, usd: usd, compact: compact, cnt: cnt, num: num, esc: esc, clock: clock, stamp: stamp,
    taxonomy: taxonomy, classifyTopic: classifyTopic, marketDollars: marketDollars, seriesOf: seriesOf,
    recentTrades: recentTrades, scanLive: scanLive, orderbook: orderbook, candles: candles, ticks: ticks,
    watchList: watchList, watch: watch, unwatch: unwatch, trackResolutions: trackResolutions,
    resolutions: resolutions, journal: journal, saveJournal: saveJournal, addJournalRow: addJournalRow, clearJournal: clearJournal,
    categorize: categorize, settle: settle, performance: performance
  };
})(window);
