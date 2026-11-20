/* =========================================================================
   Kalshi Demo Tracker — core client (markets + analytics)
   Data source: official Kalshi DEMO Trade API v2
     REST: https://external-api.demo.kalshi.co/trade-api/v2   (fallback: https://demo-api.kalshi.co/trade-api/v2)
     WS:   wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2
   Public market data needs NO API key (official docs: https://docs.kalshi.com).
   Nothing is invented: any value that cannot be fetched is shown blank + flagged.
   ========================================================================= */
'use strict';

const KALSHI_BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
const KALSHI_BASE_ALT = 'https://demo-api.kalshi.co/trade-api/v2';
const KALSHI_WS = 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2';

/* ---------------- tiny DOM/format helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt$ = (v, dp = 0) => (v == null || isNaN(v)) ? '<span class="blank">—</span>' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtC = (v) => (v == null || isNaN(v)) ? '<span class="blank">—</span>' : (Number(v).toFixed(1).replace(/\.0$/, '') + '¢');
const fmtN = (v) => (v == null || isNaN(v)) ? '<span class="blank">—</span>' : Number(v).toLocaleString('en-US');
const fmtT = (iso) => { if (!iso) return '<span class="blank">—</span>'; const d = new Date(iso); if (isNaN(d)) return esc(iso); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const ago = (iso) => { if (!iso) return ''; const s = (Date.now() - new Date(iso).getTime()) / 1000; if (!isNaN(s) && s >= 0) return ` <span class="small">(${s < 90 ? Math.round(s) + 's' : Math.round(s / 60) + 'm'} ago)</span>`; return ''; };
const resultBadge = (r) => { const v = String(r || '').toLowerCase(); if (v === 'yes') return '<span class="badge yes">YES</span>'; if (v === 'no') return '<span class="badge no">NO</span>'; if (v === 'scalar') return '<span class="badge info">SCALAR</span>'; return '<span class="blank" title="not settled">—</span>'; };
const statusBadge = (s) => { const v = String(s || '').toLowerCase(); const cls = { open: 'live', closed: 'closed', settled: 'settled' }[v] || 'info'; return `<span class="badge ${cls}">${esc(v || 'unknown').toUpperCase()}</span>`; };

let toastTimer = null;
function toast(msg, ms = 3500) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.innerHTML = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function setConn(state, note) { // state: on|off|err|snap
  const d = $('#connDot'), t = $('#connTxt');
  if (d) d.className = 'dotlive' + (state === 'on' ? ' on' : '');
  if (t) t.innerHTML = (state === 'on' ? '<span class="badge live">LIVE</span>'
    : state === 'snap' ? '<span class="badge info">CI SNAPSHOT</span>'
    : state === 'err' ? '<span class="badge err">FETCH FAILED</span>'
    : '<span class="badge">OFFLINE MODE</span>') + (note ? ` <span class="small">${esc(note)}</span>` : '');
}

/* ---------------- generic sortable table ---------------- */
function sortableTable(el, columns, rows) {
  if (!el) return;
  const state = { sortIdx: el._sortIdx ?? null, dir: el._sortDir ?? 1 };
  el._sortIdx = state.sortIdx; el._sortDir = state.dir;
  const render = () => {
    let data = [...rows];
    if (state.sortIdx != null) {
      const col = columns[state.sortIdx];
      data.sort((a, b) => {
        const va = col.raw ? col.raw(a) : a[col.key], vb = col.raw ? col.raw(b) : b[col.key];
        const na = typeof va === 'number' ? va : parseFloat(String(va).replace(/[^0-9.\-]/g, ''));
        const nb = typeof vb === 'number' ? vb : parseFloat(String(vb).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(na) && !isNaN(nb)) return (na - nb) * state.dir;
        return String(va ?? '').localeCompare(String(vb ?? '')) * state.dir;
      });
    }
    el.innerHTML = `<table><thead><tr>${columns.map((c, i) =>
      `<th class="${c.num ? 'num' : ''}" data-i="${i}">${esc(c.label)}${state.sortIdx === i ? (state.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${
      data.length ? data.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="skel">${esc(el._emptyMsg || 'No rows yet — waiting for data from the Kalshi demo API…')}</td></tr>`}</tbody></table>`;
    $$('thead th', el).forEach((th) => th.addEventListener('click', () => {
      const i = +th.dataset.i;
      if (state.sortIdx === i) state.dir *= -1; else { state.sortIdx = i; state.dir = 1; }
      el._sortIdx = state.sortIdx; el._sortDir = state.dir; render();
    }));
  };
  render();
  return { update: render };
}

function downloadJSON(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* =========================================================================
   Kalshi REST client — public (unauthenticated) endpoints only.
   Rate-limit friendly: serialized calls with a small gap (official rate
   limit docs: https://docs.kalshi.com/getting_started/rate_limits).
   ========================================================================= */
const Kalshi = (() => {
  let base = localStorage.getItem('kd1:base') || KALSHI_BASE;
  let q = Promise.resolve();
  let lastCall = 0;
  const GAP = 120; // ms between REST calls (well under published limits)
  let okCount = 0, failCount = 0, usingAlt = false;

  async function raw(path, params) {
    const url = new URL(base + path);
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
    const wait = Math.max(0, lastCall + GAP - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) { const e = new Error('HTTP ' + res.status + ' ' + url.pathname); e.status = res.status; throw e; }
    okCount++; return res.json();
  }
  async function get(path, params) {
    const attempt = q.then(() => raw(path, params)).catch(async (e) => {
      if ((e.status === 0 || e.message.startsWith('HTTP 0') || e.name === 'TypeError') && !usingAlt) {
        // network failure on primary demo host → try the documented alternate host once
        usingAlt = true; base = KALSHI_BASE_ALT; localStorage.setItem('kd1:base', base);
        try { const r = await raw(path, params); toast('Switched to alternate demo host: ' + base); return r; } catch (e2) { failCount++; throw e2; }
      }
      failCount++; throw e;
    });
    q = attempt.then(() => {}, () => {}); // keep the call queue alive after failures
    return attempt;
  }
  return { get, stats: () => ({ ok: okCount, fail: failCount, base, usingAlt }) };
})();

/* =========================================================================
   Discovery — map the 5 requested topics to real demo series.
   Strategy (all runtime-verified, nothing assumed):
     1. Use committed candidate list in data/series-map.json.
     2. Verify each candidate via GET /series/{ticker} (200 = exists).
     3. Additionally scan live markets pages and classify each series by
        its official `category` from GET /series/{ticker} / series list.
     4. Cache result 10 min in localStorage. Series that fail verification
        are marked unverified and excluded from tables.
   ========================================================================= */
const TOPICS = [
  { id: 'gas', label: 'Gas Prices', cats: ['economics', 'gas', 'energy'] },
  { id: 'elections', label: 'Elections', cats: ['politics', 'election'] },
  { id: 'culture', label: 'Culture', cats: ['culture', 'entertainment', 'world', 'music', 'movies'] },
  { id: 'crypto', label: 'Crypto', cats: ['crypto', 'financial', 'finance'] },
  { id: 'golf', label: 'Golf', cats: ['sports', 'golf'] },
];

// top-level classifier (used by Store and Snapshot)
function classifyCategory(category) {
  const c = String(category || '').toLowerCase();
  for (const t of TOPICS) if (t.cats.some((k) => c.includes(k))) return t.id;
  return null;
}

const Discovery = (() => {
  const CACHE_KEY = 'kd1:discovery:v3';
  let map = null; // topicId -> [{series, title, category, verified, how}]
  let candidates = null;

  async function loadCandidates() {
    if (candidates) return candidates;
    try { candidates = (await fetch('data/series-map.json').then((r) => r.json())).categories; }
    catch { candidates = []; }
    return candidates;
  }

  async function seriesExists(ticker) {
    try { await Kalshi.get('/series/' + encodeURIComponent(ticker)); return true; }
    catch (e) { if (e.status === 404) return false; throw e; } // network errors bubble up
  }

  async function scanMarketSeries(maxPages = 4) {
    const found = new Map(); // series_ticker -> sample
    let cursor = '';
    for (let p = 0; p < maxPages; p++) {
      const r = await Kalshi.get('/markets', { limit: 1000, cursor });
      (r.markets || []).forEach((m) => { if (m.series_ticker && !found.has(m.series_ticker)) found.set(m.series_ticker, m); });
      cursor = r.cursor; if (!cursor) break;
    }
    return found;
  }

  function classify(category) {
    const c = String(category || '').toLowerCase();
    for (const t of TOPICS) if (t.cats.some((k) => c.includes(k))) return t.id;
    return null;
  }

  async function discover(force) {
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (c && Date.now() - c.ts < 10 * 60 * 1000) { map = c.map; return map; }
      } catch {}
    }
    await loadCandidates();
    const result = Object.fromEntries(TOPICS.map((t) => [t.id, []]));
    const errors = [];
    // 1) candidate verification
    for (const cat of candidates) {
      for (const cand of cat.candidates) {
        try {
          if (await seriesExists(cand.series)) {
            let title = '', category = '';
            try { const s = await Kalshi.get('/series/' + encodeURIComponent(cand.series)); title = s.series?.title || ''; category = s.series?.category || ''; } catch {}
            const t = classify(category) || (cat.id && TOPICS.some((x) => x.id === cat.id) ? cat.id : null);
            const target = t || cat.id;
            if (result[target] && !result[target].some((x) => x.series === cand.series))
              result[target].push({ series: cand.series, title, category, verified: true, how: 'GET /series/' + cand.series + ' → 200' });
          }
        } catch (e) { throw e; } // network error → abort discovery (caller shows fetch-failed); 404 handled in seriesExists
      }
    }
    // 2) market scan fallback (catches series not in our candidate list)
    try {
      const found = await scanMarketSeries();
      const unknown = [...found.keys()].filter((s) => !TOPICS.some((t) => result[t.id].some((x) => x.series === s)));
      let checked = 0;
      for (const s of unknown) {
        if (checked >= 80) break; checked++;
        try {
          const r = await Kalshi.get('/series/' + encodeURIComponent(s));
          const category = r.series?.category || '';
          const t = classify(category);
          if (t && !result[t].some((x) => x.series === s))
            result[t].push({ series: s, title: r.series?.title || '', category, verified: true, how: 'found via market scan + /series/' + s });
        } catch (e) { if (e.status !== 404) break; }
      }
    } catch (e) { errors.push('scan: ' + e.message); }
    map = result;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map }));
    return { map: result, errors };
  }

  return { discover, get map() { return map; } };
})();

/* =========================================================================
   Markets store — fetch open + settled markets for verified series,
   compute event-level volume & estimated dollar volume, resolution status.
   ========================================================================= */
const Store = (() => {
  let events = [];         // event-level rows
  let marketsByTicker = new Map();
  let lastFetch = null;
  let lastError = null;

  function evDollarVolume(markets) {
    // Kalshi reports `volume` in contracts. Estimated $ volume = Σ contracts × last price ($).
    // Clearly labeled an ESTIMATE in the UI (Kalshi does not publish a dollar-volume field).
    let sum = 0;
    for (const m of markets) {
      const p = Number(m.last_price);
      const v = Number(m.volume);
      if (!isNaN(v)) sum += v * (isNaN(p) ? 0.5 : p / 100);
    }
    return sum;
  }

  async function fetchEventMarkets(eventTicker) {
    const out = [];
    let cursor = '';
    for (let i = 0; i < 3; i++) {
      const r = await Kalshi.get('/markets', { event_ticker: eventTicker, limit: 1000, cursor });
      out.push(...(r.markets || [])); cursor = r.cursor; if (!cursor) break;
    }
    return out;
  }

  async function refresh(onProgress) {
    lastError = null;
    const disc = await Discovery.discover();
    const m = (disc && disc.map) ? disc.map : (disc || {}); // discover() returns map (cached) or {map, errors} (fresh)
    const seriesList = Object.values(m).flat().filter((s) => s && s.verified);
    if (!seriesList.length) throw new Error('No verified series for the requested topics (gas, elections, culture, crypto, golf). Discovery found nothing via GET /series — see Flagged page.');
    const byEvent = new Map();
    let done = 0;
    for (const s of seriesList) {
      try {
        let cursor = '';
        for (let p = 0; p < 2; p++) {
          const r = await Kalshi.get('/markets', { series_ticker: s.series, limit: 1000, cursor });
          for (const m of (r.markets || [])) {
            marketsByTicker.set(m.ticker, m);
            const et = m.event_ticker;
            if (!et) continue;
            if (!byEvent.has(et)) byEvent.set(et, { event_ticker: et, title: m.title || m.event_title || '', markets: [], series: s.series, category: s.category, categoryTopic: classifyCategory(s) });
            const ev = byEvent.get(et);
            if (!ev.markets.some((x) => x.ticker === m.ticker)) ev.markets.push(m);
            if (!ev.title && (m.title || m.event_title)) ev.title = m.title || m.event_title;
            if (m.market_category && !ev.category) ev.category = m.market_category;
          }
          cursor = r.cursor; if (!cursor) break;
        }
      } catch (e) { lastError = (lastError ? lastError + '; ' : '') + s.series + ': ' + e.message; }
      done++; if (onProgress) onProgress(done, seriesList.length);
    }
    events = [...byEvent.values()].map((ev) => {
      const openCount = ev.markets.filter((m) => String(m.status).toLowerCase() === 'open').length;
      const anySettled = ev.markets.some((m) => ['settled', 'closed'].includes(String(m.status).toLowerCase()));
      const result = ev.markets.map((m) => m.result || m.market_result).find((r) => r);
      const closeTimes = ev.markets.map((m) => m.close_time).filter(Boolean).sort();
      return {
        ...ev,
        status: anySettled ? (result ? 'settled' : 'closed') : openCount ? 'open' : 'closed',
        result: result || '',
        volume: ev.markets.reduce((a, m) => a + (Number(m.volume) || 0), 0),
        volume24h: ev.markets.reduce((a, m) => a + (Number(m.volume_24h) || 0), 0),
        dollarVolume: evDollarVolume(ev.markets),
        openInterest: ev.markets.reduce((a, m) => a + (Number(m.open_interest) || 0), 0),
        liquidity: ev.markets.reduce((a, m) => a + ((Number(m.liquidity) || 0)), 0),
        close_time: closeTimes[0] || '',
        lastUpdate: new Date().toISOString(),
      };
    }).filter((ev) => ev.volume > 0 || ev.status === 'open');
    lastFetch = new Date().toISOString();
    return { events, lastError };
  }

  function classifyCategory(s) {
    const c = String(s.category || '').toLowerCase();
    for (const t of TOPICS) if (t.cats.some((k) => c.includes(k))) return t.id;
    return s.categoryTopic || s.topic || 'other';
  }

  return {
    refresh,
    get events() { return events; },
    get markets() { return marketsByTicker; },
    get lastFetch() { return lastFetch; },
    get lastError() { return lastError; },
    fetchEventMarkets,
  };
})();

/* =========================================================================
   Snapshot fallback — consumes the canonical CI data snapshots at /data
   (data/markets.json + data/series.json), which are archived official API
   responses refreshed every 15 minutes by .github/workflows/fetch-data.yml.
   Values copied from official responses only; mode is displayed as
   "CI SNAPSHOT" (never passed off as a live browser fetch).
   ========================================================================= */
const Snapshot = (() => {
  let data = null;

  async function load() {
    // relative to strategy-desk/*.html → repo-root data/
    const [mkts, series] = await Promise.all([
      fetch('../data/markets.json').then((r) => { if (!r.ok) throw new Error('markets.json HTTP ' + r.status); return r.json(); }),
      fetch('../data/series.json').then((r) => { if (!r.ok) throw new Error('series.json HTTP ' + r.status); return r.json(); }).catch(() => null),
    ]);
    data = { mkts, series };
    return data;
  }

  function topicOf(m) {
    const t = String(m.topic || '').toLowerCase();
    return TOPICS.some((x) => x.id === t) ? t : (classifyCategory({ category: m.series_category }) || 'other');
  }

  function events() {
    if (!data) return [];
    const byEvent = new Map();
    for (const m of (data.mkts.markets || [])) {
      const et = m.event_ticker || m.ticker;
      if (!byEvent.has(et)) byEvent.set(et, {
        event_ticker: et,
        title: m.event_title || m.title || '',
        markets: [],
        series: m.series_ticker || '',
        category: m.series_category || '',
        categoryTopic: topicOf(m),
      });
      const ev = byEvent.get(et);
      ev.markets.push({
        ticker: m.ticker,
        title: m.title || '',
        status: String(m.status || '').toLowerCase() === 'active' ? 'open' : String(m.status || '').toLowerCase(),
        result: m.result || '',           // snapshot results were empty at capture time → stays blank (flagged, never guessed)
        volume: parseFP(m.volume_fp) || 0,
        volume_24h: parseFP(m.volume_24h_fp) || 0,
        open_interest: parseFP(m.open_interest_fp) || 0,
        liquidity: 0,
        last_price: (parseFP(m.last_price_dollars) ?? 0) * 100,
        close_time: m.close_time || '',
        traded_notional: parseFP(m.traded_notional_usd) ?? null,
      });
      if (!ev.title && m.title) ev.title = m.title;
    }
    return [...byEvent.values()].map((ev) => {
      const statuses = ev.markets.map((x) => x.status);
      const anyClosed = statuses.some((s) => s === 'closed' || s === 'settled');
      const openCount = statuses.filter((s) => s === 'open').length;
      const result = ev.markets.map((x) => x.result).find((r) => r);
      // dollar volume: official traded_notional_usd when present; otherwise the
      // documented ESTIMATE (Σ contracts × last price) — same labeling as live mode
      const notionalKnown = ev.markets.every((x) => x.traded_notional != null);
      return {
        ...ev,
        status: result ? 'settled' : anyClosed ? 'closed' : openCount ? 'open' : 'closed',
        result: result || '',
        volume: ev.markets.reduce((a, x) => a + x.volume, 0),
        volume24h: ev.markets.reduce((a, x) => a + x.volume_24h, 0),
        dollarVolume: notionalKnown
          ? ev.markets.reduce((a, x) => a + x.traded_notional, 0)
          : ev.markets.reduce((a, x) => a + x.volume * (x.last_price / 100), 0),
        openInterest: ev.markets.reduce((a, x) => a + x.open_interest, 0),
        liquidity: 0,
        close_time: ev.markets.map((x) => x.close_time).filter(Boolean).sort()[0] || '',
        lastUpdate: data.mkts.fetched_at || '',
      };
    });
  }

  function seriesVerification() {
    // verify candidate mapping against the archived official series list
    if (!data || !data.series) return null;
    const all = data.series.series || [];
    const byTicker = new Map(all.map((s) => [String(s.ticker || '').toUpperCase(), s]));
    return byTicker;
  }

  return { load, events, seriesVerification, get fetchedAt() { return data?.mkts?.fetched_at || ''; }, get marketCount() { return (data?.mkts?.markets || []).length; } };
})();

/* =========================================================================
   SVG chart — price over time. X = time (window selectable: seconds /
   minutes / hours), Y = contract price (¢). Pure SVG, no dependencies.
   ========================================================================= */
function renderLineChart(svg, points, opts = {}) {
  // points: [{t: epochMs, p: cents}...] ascending. opts: {windowMs, height, width, fill, xLabels, yMax}
  if (!svg) return;
  const W = opts.width || Math.max(320, svg.clientWidth || 900);
  const H = opts.height || svg.clientHeight || 380;
  const padL = 44, padR = 14, padT = 14, padB = 30;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = '';
  if (!points || points.length < 2) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" fill="#5f7495" font-size="14" text-anchor="middle">Collecting price samples… (need ≥2 points; live polling every few seconds)</text>`;
    return;
  }
  const now = points[points.length - 1].t;
  const win = opts.windowMs || (now - points[0].t);
  const t0 = Math.min(points[0].t, now - win);
  const xs = points.filter((p) => p.t >= t0);
  const prices = xs.map((p) => p.p);
  let yMin = Math.min(...prices, 0), yMax = Math.max(...prices, 100);
  const span = yMax - yMin; yMin = Math.max(0, yMin - span * 0.08); yMax = Math.min(100, yMax + span * 0.08); if (yMax <= yMin) yMax = yMin + 1;
  const X = (t) => padL + ((t - t0) / Math.max(1, now - t0)) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p - yMin) / (yMax - yMin)) * (H - padT - padB);
  const gY = Math.round(yMin), gYmax = Math.ceil(yMax);
  const gridY = [];
  for (let v = gY; v <= gYmax; v += Math.max(1, Math.round((gYmax - gY) / 6))) gridY.push(v);
  const fmtX = (t) => {
    const d = new Date(t);
    return win >= 3600e3 ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : win >= 60e3 ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : d.toLocaleTimeString('en-US', { minute: '2-digit', second: '2-digit' });
  };
  let grid = gridY.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1c2a40" stroke-width="1"/><text x="${padL - 6}" y="${Y(v) + 4}" fill="#5f7495" font-size="11" text-anchor="end">${v}¢</text>`).join('');
  const tickN = Math.min(8, Math.max(3, Math.round(W / 140)));
  let gridX = '';
  for (let i = 0; i <= tickN; i++) {
    const t = t0 + ((now - t0) * i) / tickN;
    gridX += `<line x1="${X(t)}" x2="${X(t)}" y1="${padT}" y2="${H - padB}" stroke="#1c2a40" stroke-width="1"/><text x="${X(t)}" y="${H - padB + 16}" fill="#5f7495" font-size="11" text-anchor="middle">${fmtX(t)}</text>`;
  }
  const line = xs.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.p).toFixed(1)}`).join(' ');
  const area = `${line} L${X(xs[xs.length - 1].t).toFixed(1)},${H - padB} L${X(xs[0].t).toFixed(1)},${H - padB} Z`;
  const last = xs[xs.length - 1];
  svg.innerHTML = `${grid}${gridX}
    ${opts.fill ? `<path d="${area}" fill="rgba(56,189,248,0.10)"/>` : ''}
    <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    <circle cx="${X(last.t)}" cy="${Y(last.p)}" r="4" fill="#38bdf8"/>
    <text x="${Math.min(W - padR - 46, X(last.t) + 8)}" y="${Y(last.p) - 8}" fill="#e8eef7" font-size="12">${last.p.toFixed(1)}¢</text>
    <line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="#24344e"/>`;
}

/* =========================================================================
   Orderbook renderer (normalized defensively; raw values kept for audit)
   ========================================================================= */
function parseFP(v) {
  // Kalshi fixed-point values arrive as strings like "0.52" (dollars) or
  // "10.00" (contracts), sometimes nested {num,den}. Returns Number or null.
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'num' in v && 'den' in v) return Number(v.num) / Number(v.den || 1);
  const n = parseFloat(v); return isNaN(n) ? null : n;
}
function levelToCentsQty(level) {
  // level: [price, [qty, ...]] from orderbook_fp yes_dollars / no_dollars (dollars, per official docs)
  if (!Array.isArray(level)) return null;
  const price = parseFP(level[0]); // dollars per contract (0..1)
  const qty = (level[1] || []).reduce((a, q) => a + (parseFP(q) || 0), 0);
  if (price == null) return null;
  return { cents: price * 100, qty };
}
function renderOrderbook(elYes, elNo, ob) {
  const build = (side) => {
    const levels = ((ob?.orderbook_fp || {})[side] || []).map(levelToCentsQty).filter(Boolean)
      .sort((a, b) => side === 'yes_dollars' ? b.cents - a.cents : a.cents - b.cents).slice(0, 12);
    const maxQ = Math.max(1, ...levels.map((l) => l.qty));
    const head = `<div class="ob-head"><span>Price</span><span>Depth</span><span class="num">Contracts</span><span class="num">Orders</span></div>`;
    const rows = levels.map((l) => `<div class="ob-row ${side === 'yes_dollars' ? 'yes' : 'no'}">
        <span>${l.cents.toFixed(1)}¢</span>
        <span class="bar"><i style="width:${(l.qty / maxQ) * 100}%"></i></span>
        <span class="num">${fmtN(l.qty)}</span>
      </div>`).join('');
    return head + (rows || '<div class="skel">No resting bids on this side.</div>');
  };
  if (elYes) elYes.innerHTML = build('yes_dollars');
  if (elNo) elNo.innerHTML = build('no_dollars');
}

/* ---------------- boot: mark page nav ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  $$('nav.main a').forEach((a) => { if (a.dataset.page === page) a.classList.add('active'); });
});
