/* Price swing alerts — Kalshi demo.
   Detects contract-price swings of >= threshold between consecutive official
   candle closes and renders them as two scrolling chats.
   Data source: committed official demo-API capture (snapshot/charts.json),
   with a best-effort live fetch from the official demo Trade API. Live data is
   used per-market where reachable; snapshot is used otherwise. No values are
   invented; markets with no qualifying swing show nothing.
   The high-ROI filter is a disclosed magnitude heuristic, not a model.
*/

(function(){
  const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
  const CHARTS_URL = 'snapshot/charts.json';
  const MARKETS_URL = 'snapshot/markets.json';

  const state = {
    threshold: 0.10,
    topic: '',
    mode: 'snapshot',        // 'snapshot' | 'live'
    swings: [],
    marketByTicker: {},
    seriesTopic: {},
    seriesByMarket: {},
    liveMarkets: 0,
    unreachableMarkets: 0
  };

  const els = {
    status: document.getElementById('status-banner'),
    modeBanner: document.getElementById('mode-banner'),
    msgsAll: document.getElementById('msgs-all'),
    msgsRoi: document.getElementById('msgs-roi'),
    countAll: document.getElementById('count-all'),
    countRoi: document.getElementById('count-roi'),
    btnRefresh: document.getElementById('btn-refresh'),
    thSeg: document.getElementById('th-seg'),
    topicSeg: document.getElementById('topic-seg')
  };

  /* ---------- helpers ---------- */

  function utcTime(ts){ // unix seconds
    return new Date(ts * 1000).toISOString().replace('T',' ').replace('Z',' UTC');
  }

  function fmtPrice(p){
    return p == null ? '—' : Number(p).toFixed(3);
  }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"
    }[c]));
  }

  function topicLabel(t){
    const m = {
      gas_prices:'Gas prices', elections:'Elections', culture:'Culture',
      crypto:'Crypto', golf:'Golf'
    };
    return m[t] || t || '—';
  }

  /* ---------- data loading ---------- */

  async function loadSnapshot(){
    const [chartsRes, marketsRes] = await Promise.all([
      fetch(CHARTS_URL), fetch(MARKETS_URL)
    ]);
    if (!chartsRes.ok || !marketsRes.ok) throw new Error('snapshot not readable');
    return { charts: await chartsRes.json(), markets: await marketsRes.json() };
  }

  function buildLookups(markets){
    const marketByTicker = {};
    const seriesTopic = {};
    for (const m of (markets.markets || markets || [])){
      marketByTicker[m.market_ticker] = m;
      if (!seriesTopic[m.series_ticker]) seriesTopic[m.series_ticker] = m.topic;
    }
    return { marketByTicker, seriesTopic };
  }

  /* ---------- swing detection ---------- */

  function detectSwingsFromPoints(points, seriesTicker, marketTicker, windowName){
    const out = [];
    const pts = (points || []).filter(p => p.price_close != null);
    for (let i = 1; i < pts.length; i++){
      const prev = pts[i - 1], cur = pts[i];
      const delta = Number(cur.price_close) - Number(prev.price_close);
      if (Math.abs(delta) >= state.threshold){
        out.push({
          series_ticker: seriesTicker,
          market_ticker: marketTicker,
          window: windowName,
          from_time: prev.t,
          to_time: cur.t,
          from: Number(prev.price_close),
          to: Number(cur.price_close),
          delta: delta,
          absDelta: Math.abs(delta)
        });
      }
    }
    return out;
  }

  function detectSwingsFromSeries(series){
    const swings = [];
    for (const [wname, win] of Object.entries(series.windows || {})){
      swings.push(...detectSwingsFromPoints(win.points, series.series_ticker, series.market_ticker, wname));
    }
    return swings;
  }

  /* best-effort live candles for one market; null when unreachable */
  async function liveCandlesFor(seriesTicker, marketTicker, startTs, endTs){
    const url = `${BASE}/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(marketTicker)}/candlesticks?period_interval=60&start_ts=${startTs}&end_ts=${endTs}`;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const json = await res.json();
      const candles = extractLiveCandles(json);
      if (!candles || candles.length === 0) return null;
      return { candles, source: 'live', url };
    } catch (e){
      return null; // unreachable (CORS / network / blocked) -> snapshot
    }
  }

  function extractLiveCandles(json){
    if (!json) return null;
    if (Array.isArray(json.candlesticks)) return json.candlesticks;
    if (Array.isArray(json.markets)){
      for (const m of json.markets){
        if (Array.isArray(m.candlesticks)) return m.candlesticks;
        if (Array.isArray(m.candles)) return m.candles;
      }
    }
    return null;
  }

  function normalizeCandle(c){
    if (c == null) return null;
    // Accepts both the committed-snapshot point shape ({t, price_close}) and the official
    // Get Market Candlesticks shape ({end_period_ts, price: {close_dollars}, ...}) —
    // schema verified 2026-11-20 at https://docs.kalshi.com/api-reference/market/get-market-candlesticks
    const price = c.price || {};
    const close = c.close != null ? c.close :
                  c.price_close != null ? c.price_close :
                  c.close_dollars != null ? c.close_dollars :
                  price.close_dollars != null ? price.close_dollars : null;
    const t = c.t != null ? c.t : c.start_ts != null ? c.start_ts :
              c.end_period_ts != null ? c.end_period_ts : null;
    if (close == null || t == null) return null;
    return { t: Number(t), price_close: Number(close) };
  }

  /* ---------- high-ROI filter (disclosed heuristic) ---------- */

  function highRoiFilter(swings, limit = 20){
    return swings
      .map(s => {
        const entry = Math.max(s.from, 0.0001);
        const roiScore = Math.abs(s.delta) / entry; // relative move proxy
        return Object.assign({}, s, { roiScore });
      })
      .filter(s => s.roiScore >= 0.10)             // >= 10% move on entry price
      .sort((a, b) => b.roiScore - a.roiScore)
      .slice(0, limit);
  }

  /* ---------- market info ---------- */

  function attachMarketInfo(swings){
    for (const s of swings){
      const m = state.marketByTicker[s.market_ticker] || {};
      s.topic = m.topic || state.seriesTopic[s.series_ticker] || '';
      s.event_ticker = m.event_ticker || s.series_ticker;
      s.event_title = m.event_title || '';
      s.title = m.title || s.market_ticker;
    }
  }

  function topicPasses(s){
    if (!state.topic) return true;
    const m = state.marketByTicker[s.market_ticker] || {};
    return (m.topic || state.seriesTopic[s.series_ticker]) === state.topic;
  }

  /* ---------- rendering ---------- */

  function render(){
    let all = state.swings.filter(topicPasses);
    all.sort((a, b) => b.to_time - a.to_time); // most recent first

    const roi = highRoiFilter(all);

    els.msgsAll.innerHTML = '';
    els.msgsRoi.innerHTML = '';

    if (all.length === 0){
      els.msgsAll.innerHTML = '<div class="empty">No swings detected at this threshold for the selected topic.</div>';
    } else {
      all.forEach(s => els.msgsAll.appendChild(buildMsg(s)));
    }
    if (roi.length === 0){
      els.msgsRoi.innerHTML = '<div class="empty">No high-ROI-filter swings at this threshold/topic.</div>';
    } else {
      roi.forEach(s => els.msgsRoi.appendChild(buildMsg(s)));
    }

    els.countAll.textContent = all.length;
    els.countRoi.textContent = roi.length;

    // autoscroll both chats to the bottom (live feed feel)
    els.msgsAll.scrollTop = els.msgsAll.scrollHeight;
    els.msgsRoi.scrollTop = els.msgsRoi.scrollHeight;
  }

  function buildMsg(s){
    const up = s.delta >= 0;
    const dir = up ? '▲' : '▼';
    const topic = s.topic || state.seriesTopic[s.series_ticker] || '';
    const eventLink = `https://kalshi.com/events/${esc(s.event_ticker)}`;
    const newsQ = encodeURIComponent(`${esc(s.event_title || s.market_ticker)} price jump Kalshi`);
    const newsLink = `https://www.google.com/search?q=${newsQ}`;
    const apiUrl = `${BASE}/series/${esc(s.series_ticker)}/markets/${esc(s.market_ticker)}/candlesticks`;

    const el = document.createElement('div');
    el.className = `msg ${up ? 'up' : 'down'}`;
    el.innerHTML = `
      <div class="msg-head">
        <span class="msg-time">${utcTime(s.to_time)}</span>
        <span class="msg-window">${esc(s.window)}</span>
      </div>
      <div class="msg-body">
        <div class="msg-topic">${topicLabel(topic)}</div>
        <div class="msg-market">${esc(s.title)}</div>
        <div class="msg-ticker">${esc(s.market_ticker)}</div>
        <div class="msg-move">
          <span class="msg-from">${fmtPrice(s.from)}</span>
          <span class="msg-arrow">${dir}</span>
          <span class="msg-to">${fmtPrice(s.to)}</span>
          <span class="msg-delta">${up ? '+' : ''}${s.delta.toFixed(3)}</span>
        </div>
      </div>
      <div class="msg-links">
        <a href="${eventLink}" target="_blank" rel="noopener">Market on Kalshi</a>
        <a href="${newsLink}" target="_blank" rel="noopener">News search (cause unverified)</a>
        <a href="${apiUrl}" target="_blank" rel="noopener">Official API source</a>
      </div>
    `;
    return el;
  }

  function updateStatus(){
    const marketsSet = new Set(state.swings.map(s => s.market_ticker));
    const livePart = state.mode === 'live'
      ? ` · ${state.liveMarkets} market(s) live from official demo API${state.unreachableMarkets ? ', ' + state.unreachableMarkets + ' unreachable (snapshot)' : ''}`
      : '';
    els.status.innerHTML = `${state.swings.length} swing(s) detected at ≥$${state.threshold.toFixed(2)} across ${marketsSet.size} market(s)${livePart}.`;
  }

  function updateModeBanner(charts){
    const gen = charts && charts.generated_utc ? esc(charts.generated_utc) : '—';
    const liveNote = state.mode === 'live'
      ? `<span style="color:var(--ok);font-weight:700">LIVE</span> · official Kalshi demo API (${BASE})`
      : `<span style="color:var(--warn)">SNAPSHOT</span> · committed official demo-API capture ${gen} (${BASE})`;
    const unreachableNote = state.unreachableMarkets
      ? ` · ${state.unreachableMarkets} market(s) unreachable live, snapshot used`
      : '';
    els.modeBanner.innerHTML = `Data source: ${liveNote}${unreachableNote}. No values inferred. <a href="snapshot/charts.json" target="_blank">raw capture ↗</a>`;
  }

  /* ---------- main load ---------- */

  async function loadData(){
    els.status.textContent = 'Loading official candle data…';
    let loaded;
    try {
      loaded = await loadSnapshot();
    } catch (e){
      els.status.textContent = 'Snapshot data unavailable.';
      els.modeBanner.textContent = 'Cannot load official data.';
      return;
    }
    // loadSnapshot() returns { charts: <snapshot/charts.json>, markets: <snapshot/markets.json> }
    const charts = loaded.charts || {};
    const markets = loaded.markets || {};

    const lookups = buildLookups(markets);
    state.marketByTicker = lookups.marketByTicker;
    state.seriesTopic = lookups.seriesTopic;

    // per-market snapshot swings + series_ticker map
    const snapByMarket = new Map();
    const seriesByMarket = new Map();
    for (const series of (charts.series || [])){
      seriesByMarket.set(series.market_ticker, series.series_ticker);
      if (!snapByMarket.has(series.market_ticker)) snapByMarket.set(series.market_ticker, []);
      snapByMarket.get(series.market_ticker).push(...detectSwingsFromSeries(series));
    }
    for (const swings of snapByMarket.values()) attachMarketInfo(swings);

    // best-effort live overlay: trailing 7 days, 1-hour candles, per market
    const nowSec = Math.floor(Date.now() / 1000);
    const startTs = nowSec - 7 * 24 * 60 * 60;
    const tracked = [...snapByMarket.keys()].map(mt => ({
      series_ticker: seriesByMarket.get(mt),
      market_ticker: mt
    }));
    const liveByMarket = new Map();
    let reachable = 0, unreachable = 0;
    for (const t of tracked){
      const live = await liveCandlesFor(t.series_ticker, t.market_ticker, startTs, nowSec);
      if (live){
        reachable++;
        const pts = live.candles.map(normalizeCandle).filter(Boolean);
        const swings = detectSwingsFromPoints(pts, t.series_ticker, t.market_ticker, '1h/live');
        attachMarketInfo(swings);
        liveByMarket.set(t.market_ticker, swings);
      } else {
        unreachable++;
      }
    }

    // merge: live where reachable, snapshot otherwise
    const swings = [];
    for (const [mt, snapSwings] of snapByMarket){
      if (liveByMarket.has(mt)){
        swings.push(...liveByMarket.get(mt));
      } else {
        swings.push(...snapSwings);
      }
    }

    state.swings = swings;
    state.liveMarkets = reachable;
    state.unreachableMarkets = unreachable;
    state.mode = reachable > 0 ? 'live' : 'snapshot';

    updateStatus();
    updateModeBanner(charts);
    render();
  }

  /* ---------- wiring ---------- */

  function segClick(seg, key, value){
    Array.from(seg.querySelectorAll('button')).forEach(b => {
      b.classList.toggle('on', b.dataset[key] == value);
    });
    state[key] = value;
    render();
  }

  els.thSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.threshold = Number(b.dataset.th);
    segClick(els.thSeg, 'th', b.dataset.th);
    loadData(); // re-detect at new threshold
  });

  els.topicSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    segClick(els.topicSeg, 'topic', b.dataset.topic);
    render();
  });

  els.btnRefresh.addEventListener('click', () => {
    els.btnRefresh.textContent = 'Refreshing…';
    els.btnRefresh.disabled = true;
    setTimeout(() => {
      loadData().then(() => {
        els.btnRefresh.textContent = 'Refresh / try live';
        els.btnRefresh.disabled = false;
      });
    }, 50);
  });

  // boot
  loadData();

})();
