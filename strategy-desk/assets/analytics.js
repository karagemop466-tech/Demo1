/* Analytics page — price chart (X = time, selectable seconds/minutes/hours window;
   Y = contract price in cents), orderbook depth & liquidity, live via WS or REST polling. */
'use strict';

(function () {
  const SAMPLES_KEY = (t) => 'kd1:samples:' + t;
  let ticker = null;
  let market = null;
  let samples = [];            // [{t, p}] price samples in cents
  let windowMs = 60e3;         // default: 1 minute
  let live = true;
  let ws = null, wsState = 'off';
  let pollTimer = null, bookTimer = null;
  let lastBook = null;
  let candleInfo = '';

  /* ---------- data plumbing ---------- */
  function loadSamples() {
    try { samples = JSON.parse(localStorage.getItem(SAMPLES_KEY(ticker)) || '[]'); } catch { samples = []; }
    const cutoff = Date.now() - 26 * 3600e3;
    samples = samples.filter((s) => s.t >= cutoff);
  }
  function saveSamples() {
    try { localStorage.setItem(SAMPLES_KEY(ticker), JSON.stringify(samples.slice(-3000))); } catch {}
  }
  function addSample(p) {
    if (p == null || isNaN(p)) return;
    const t = Date.now();
    if (samples.length && t - samples[samples.length - 1].t < 900) { samples[samples.length - 1] = { t, p }; }
    else samples.push({ t, p });
    if (samples.length > 4000) samples = samples.slice(-3000);
    saveSamples(); draw();
  }

  function priceFrom(m) {
    // prefer last traded price (cents); fall back to mid of yes bid/ask; else blank
    const lp = Number(m?.last_price);
    if (!isNaN(lp) && lp > 0) return lp;
    const b = Number(m?.yes_bid), a = Number(m?.yes_ask);
    if (!isNaN(b) && !isNaN(a) && b > 0 && a > 0) return (b + a) / 2;
    if (!isNaN(a) && a > 0) return a;
    return null;
  }

  async function fetchMarket() {
    const r = await Kalshi.get('/markets', { tickers: ticker });
    const m = (r.markets || []).find((x) => x.ticker === ticker) || null;
    if (m) {
      market = m;
      const p = priceFrom(m);
      if (p != null) addSample(p);
      renderDetails();
    }
    return m;
  }

  async function fetchBook() {
    const r = await Kalshi.get('/markets/' + encodeURIComponent(ticker) + '/orderbook');
    lastBook = r;
    renderBook();
  }

  async function fetchCandles() {
    // Official endpoint: GET /markets/{ticker}/candlesticks?start_ts&end_ts&period_interval(1|60|1440 minutes)
    if (windowMs < 10 * 60e3) { candleInfo = ''; draw(); return; }
    const intervalMin = windowMs > 24 * 3600e3 ? 1440 : windowMs > 6 * 3600e3 ? 60 : 1;
    const end = Math.floor(Date.now() / 1000);
    const start = end - Math.floor(windowMs / 1000);
    try {
      const r = await Kalshi.get('/markets/' + encodeURIComponent(ticker) + '/candlesticks', { start_ts: start, end_ts: end, period_interval: intervalMin });
      const cs = r.candlesticks || [];
      const pts = cs.map((c) => {
        const closeRaw = c.price?.close;
        let v = typeof closeRaw === 'object' && closeRaw ? parseFP(closeRaw) : parseFloat(closeRaw);
        if (v == null || isNaN(v)) return null;
        if (v <= 1) v = v * 100;           // dollars → cents
        return { t: (Number(c.period_interval_ts) || 0) * 1000, p: v };
      }).filter(Boolean).sort((a, b) => a.t - b.t);
      if (pts.length >= 2) {
        candleInfo = `history: ${pts.length} official ${intervalMin}-min candlestick${intervalMin > 1 ? 's' : ''} from GET /markets/${esc(ticker)}/candlesticks`;
        samples = samples.filter((s) => s.t > pts[pts.length - 1].t);
        const merged = [...pts, ...samples.filter((s) => s.t > pts[pts.length - 1].t)];
        samples = merged.slice(-4000); saveSamples();
      } else { candleInfo = 'candlesticks endpoint returned no usable points (marked unverified — see Flagged page)'; }
    } catch (e) {
      candleInfo = 'candlesticks unavailable (' + esc(e.message) + ') — showing in-page samples only';
    }
    draw();
  }

  /* ---------- websocket (official demo WS) with REST fallback ---------- */
  function wsConnect() {
    if (!window.WebSocket || !ticker) return;
    try { ws && ws.close(); } catch {}
    try {
      ws = new WebSocket(KALSHI_WS);
      wsState = 'connecting';
      const t = setTimeout(() => { if (ws && ws.readyState !== 1) { try { ws.close(); } catch {} } }, 6000);
      ws.onopen = () => { clearTimeout(t); wsState = 'on'; ws.send(JSON.stringify({ type: 'subscribe', msg: {} })); renderConn(); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        const msg = m.msg || m;
        if ((m.type || msg.type) === 'ticker' && (msg.market_ticker === ticker || msg.ticker === ticker)) {
          const p = parseFloat(msg.yes ?? msg.last ?? msg.price);
          if (!isNaN(p) && p > 0) { addSample(p); fetchBookSilent(); }
        }
      };
      ws.onerror = () => { wsState = 'err'; renderConn(); };
      ws.onclose = () => { wsState = wsState === 'err' ? 'err' : 'off'; renderConn(); };
    } catch { wsState = 'off'; }
    renderConn();
  }
  let bookBusy = false;
  async function fetchBookSilent() { if (bookBusy) return; bookBusy = true; try { await fetchBook(); } catch {} bookBusy = false; }

  /* ---------- rendering ---------- */
  function renderConn() {
    const el = $('#transport'); if (!el) return;
    const s = Kalshi.stats();
    el.innerHTML = wsState === 'on'
      ? '<span class="badge live">WS LIVE</span> <span class="mono small">' + esc(KALSHI_WS) + '</span>'
      : `<span class="badge ${wsState === 'err' ? 'err' : 'info'}">REST POLLING (3s)</span> <span class="mono small">${esc(s.base)}</span>`;
  }

  function renderDetails() {
    const el = $('#mktDetail'); if (!el || !market) return;
    const m = market;
    el.innerHTML = `
      <div class="grid kpi">
        <div class="card kpi"><div class="label">Last price (YES)</div><div class="value">${Number(m.last_price) ? fmtC(m.last_price) : '<span class="blank">—</span>'}</div><div class="note">field: last_price (cents)</div></div>
        <div class="card kpi"><div class="label">Yes bid / ask</div><div class="value">${m.yes_bid ? fmtC(m.yes_bid) : '—'} / ${m.yes_ask ? fmtC(m.yes_ask) : '—'}</div><div class="note">spread ${m.yes_bid && m.yes_ask ? (m.yes_ask - m.yes_bid) + '¢' : '—'}</div></div>
        <div class="card kpi"><div class="label">Volume (contracts)</div><div class="value">${fmtN(m.volume)}</div><div class="note">vol 24h: ${m.volume_24h ? fmtN(m.volume_24h) : '—'}</div></div>
        <div class="card kpi"><div class="label">Open interest</div><div class="value">${m.open_interest ? fmtN(m.open_interest) : '<span class="blank">—</span>'}</div><div class="note">field: open_interest</div></div>
        <div class="card kpi"><div class="label">Liquidity (API field)</div><div class="value">${m.liquidity ? fmt$(m.liquidity, 0) : '<span class="blank">—</span>'}</div><div class="note">field: liquidity</div></div>
        <div class="card kpi"><div class="label">Status</div><div class="value">${statusBadge(m.status)}</div><div class="note">result: ${resultBadge(m.result || m.market_result)}</div></div>
      </div>
      <div class="small" style="margin-top:8px">
        <span class="pill mono">${esc(m.ticker)}</span><span class="pill">${esc(m.title || '')}</span>
        <span class="pill">series ${esc(m.series_ticker || '—')}</span><span class="pill">event ${esc(m.event_ticker || '—')}</span>
        ${m.close_time ? `<span class="pill">closes ${fmtT(m.close_time)}</span>` : ''}
        ${m.open_time ? `<span class="pill">opened ${fmtT(m.open_time)}</span>` : ''}
        <span class="pill">cap ${m.cap ? fmt$(m.cap, 0) : '—'} · floor ${m.floor ? fmt$(m.floor, 0) : '—'}</span>
      </div>
      <div class="small" style="margin-top:6px">Source: <span class="src"><a href="${esc(Kalshi.stats().base)}/markets?tickers=${encodeURIComponent(ticker)}" target="_blank" rel="noopener">GET /markets?tickers=${esc(ticker)} ↗</a></span></div>`;
  }

  function renderBook() {
    const ob = lastBook && (lastBook.orderbook_fp ? lastBook : (lastBook[ticker] || lastBook));
    renderOrderbook($('#obYes'), $('#obNo'), ob);
    const k = $('#bookStats');
    if (!k) return;
    let yesLiq = 0, noLiq = 0, bestYes = null, bestNo = null;
    ((ob?.orderbook_fp || {}).yes_dollars || []).map(levelToCentsQty).filter(Boolean).forEach((l) => { yesLiq += l.qty; if (bestYes == null) bestYes = l.cents; });
    ((ob?.orderbook_fp || {}).no_dollars || []).map(levelToCentsQty).filter(Boolean).forEach((l) => { noLiq += l.qty; if (bestNo == null) bestNo = l.cents; });
    k.innerHTML = `
      <div class="grid kpi">
        <div class="card kpi"><div class="label">Resting YES bids</div><div class="value">${fmtN(yesLiq)}</div><div class="note">contracts · Σ of book depth</div></div>
        <div class="card kpi"><div class="label">Resting NO bids</div><div class="value">${fmtN(noLiq)}</div><div class="note">contracts · Σ of book depth</div></div>
        <div class="card kpi"><div class="label">Best YES bid</div><div class="value">${bestYes != null ? fmtC(bestYes) : '<span class="blank">—</span>'}</div><div class="note">NO equivalent: ${bestYes != null ? fmtC(100 - bestYes) : '—'}</div></div>
        <div class="card kpi"><div class="label">Mid-point</div><div class="value">${bestYes != null ? fmtC((bestYes + (100 - bestNo != null && bestNo != null ? (100 - bestNo) : bestYes)) / 2) : '<span class="blank">—</span>'}</div><div class="note">(best YES bid + implied NO ask)/2</div></div>
      </div>
      <div class="small" style="margin-top:6px">Binary book convention (official docs): a YES bid at p¢ equals a NO ask at (100−p)¢ — the book returns bids for both sides only. Source: <span class="src"><a href="${esc(Kalshi.stats().base)}/markets/${encodeURIComponent(ticker)}/orderbook" target="_blank" rel="noopener">GET /markets/${esc(ticker)}/orderbook ↗</a></span></div>`;
  }

  function draw() {
    const svg = $('#chart');
    const wsel = $('#windowSel');
    renderLineChart(svg, samples, { windowMs, fill: true, height: svg ? svg.clientHeight || 380 : 380 });
    const el = $('#chartNote');
    if (el) el.innerHTML = `${candleInfo ? candleInfo + ' · ' : ''}in-page live samples: ${samples.length} ${candleInfo ? '(used only after last candle)' : ''} · window: ${wsel ? wsel.value : ''}`;
  }

  /* ---------- loops ---------- */
  function start() {
    stop();
    pollTimer = setInterval(async () => { if (wsState !== 'on') { try { await fetchMarket(); } catch {} } }, 3000);
    bookTimer = setInterval(() => { if (wsState !== 'on') fetchBookSilent(); }, 5000);
  }
  function stop() { clearInterval(pollTimer); clearInterval(bookTimer); }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    const url = new URL(location.href);
    ticker = url.searchParams.get('market') || '';
    $('#mktInput').value = ticker;
    $('#windowSel').addEventListener('change', (e) => {
      windowMs = parseInt(e.target.value, 10); draw(); fetchCandles();
    });
    $$('#winSeg button').forEach((b) => b.addEventListener('click', () => {
      $$('#winSeg button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
      windowMs = parseInt(b.dataset.ms, 10); $('#windowSel').value = String(windowMs); draw(); fetchCandles();
    }));
    $('#btnLoad').addEventListener('click', () => { const v = $('#mktInput').value.trim(); if (v) location.href = 'analytics.html?market=' + encodeURIComponent(v); });
    $('#chkLive').addEventListener('change', (e) => { live = e.target.checked; if (live) { start(); wsConnect(); } else { stop(); try { ws && ws.close(); } catch {} } $('#liveLbl').textContent = live ? 'Live' : 'Paused'; });
    $('#chkFill').addEventListener('change', (e) => { draw(); });

    // market picker from live store (grouped by topic)
    try {
      await Discovery.discover();
      await Store.refresh();
      const sel = $('#mktPick');
      const groups = {};
      Store.events.filter((e) => e.status === 'open').forEach((e) => e.markets.forEach((m) => {
        (groups[e.categoryTopic] = groups[e.categoryTopic] || []).push([m.ticker, (e.title || m.title || m.ticker)]);
      }));
      const labels = { gas: 'Gas prices', elections: 'Elections', culture: 'Culture', crypto: 'Crypto', golf: 'Golf', other: 'Other' };
      sel.innerHTML = Object.entries(groups).map(([g, arr]) => `<optgroup label="${esc(labels[g] || g)}">${arr.slice(0, 40).map(([t, l]) => `<option value="${esc(t)}"${t === ticker ? ' selected' : ''}>${esc(t)} — ${esc(l.slice(0, 60))}</option>`).join('')}</optgroup>`).join('') || '<option value="">(no open markets found)</option>';
      sel.addEventListener('change', () => { if (sel.value) location.href = 'analytics.html?market=' + encodeURIComponent(sel.value); });
    } catch (e) { $('#discErr').innerHTML = `<span class="flag">market picker unavailable: ${esc(e.message)}</span>`; }

    if (!ticker) {
      $('#chart').innerHTML = '<text x="450" y="190" fill="#5f7495" font-size="14" text-anchor="middle">Pick a market above, or add ?market=TICKER to the URL</text>';
      $('#mktDetail').innerHTML = '<div class="skel">No market selected.</div>';
      setConn('off', 'no market selected');
      return;
    }
    loadSamples(); draw();
    setConn('off', 'loading…');
    try { await fetchMarket(); setConn('on'); } catch (e) { setConn('err', e.message); }
    try { await fetchBook(); } catch (e) { $('#bookStats').innerHTML = `<span class="flag">orderbook fetch failed: ${esc(e.message)}</span>`; }
    fetchCandles();
    wsConnect(); start(); renderConn();
    setInterval(draw, 2000);
  });
})();
