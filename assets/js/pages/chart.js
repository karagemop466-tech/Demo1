/* Price chart page.
 *
 * Two data paths, both from official endpoints:
 *  - candles : GET /series/{series}/markets/{ticker}/candlesticks (1 / 60 / 1440 minute periods)
 *  - ticks   : GET /markets/{ticker} sampled in the browser at the chosen cadence
 */

import { DOC } from '../config.js';
import { $, esc, num, fmtClock, fmtDateTime, setConn, toast } from '../util.js';
import { getUniverse, getSelectedTicker, setSelectedTicker, quotes } from '../universe.js';
import { drawChart, formatAxisTime } from '../chart.js';
import { fetchCandles, apiGet, transportState } from '../api.js';

const depth = 1;
const state = {
  markets: [],
  ticker: '',
  gran: 'minute',
  windowSec: 3600,
  pollSec: 5,
  live: false,
  timer: null,
  livePoints: [],
  series: [],
  source: '',
  seriesTicker: '',
};

function candlePoints(candles, gran) {
  const out = [];
  for (const c of candles) {
    const t = Number(c.end_period_ts);
    const price = c.price?.close_dollars ?? c.price?.mean_dollars ?? c.price?.open_dollars;
    const v = num(price);
    if (!Number.isFinite(t) || v === null) continue;
    out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function periodInterval(gran) {
  return gran === 'hour' ? 60 : gran === 'day' ? 1440 : 1;
}

function renderChart() {
  const canvas = $('#c-canvas');
  const msg = $('#c-msg');
  const points = state.livePoints.length && state.gran === 'second' ? state.livePoints : state.series;
  if (!points.length) {
    drawChart(canvas, { series: [], emptyMessage: 'No series loaded yet.' });
    msg.classList.remove('hidden');
    msg.textContent = state.ticker
      ? 'No price points were returned for this market and window.'
      : 'Choose a market to load its price series.';
    $('#c-points').textContent = '0';
    $('#c-legend').innerHTML = '';
    return;
  }
  msg.classList.add('hidden');
  const gran = state.gran;
  const series = [{ label: 'Last price', color: '#14674a', points, width: 2 }];
  drawChart(canvas, {
    series,
    yLabel: 'Contract price (USD)',
    xGranularity: gran,
    emptyMessage: 'No data',
  });
  $('#c-points').textContent = String(points.length);
  $('#c-legend').innerHTML = `
    <span><span class="swatch" style="background:#14674a"></span>Last price</span>
    <span class="mono">x-axis: ${gran === 'second' ? 'seconds (client-sampled)' : gran}</span>
    <span class="mono">window: ${Math.round(state.windowSec / 60)} min</span>
    <span class="mono">source: ${esc(state.source)}</span>`;
}

function updateQuotePanel(m) {
  const q = quotes(m);
  $('#c-last').textContent = m.last_price_dollars === null ? '—' : `$${m.last_price_dollars.toFixed(4)}`;
  $('#c-last-time').textContent = m.updated_time ? `updated ${fmtDateTime(m.updated_time)}` : '—';
  $('#c-bid').textContent = q.yesBid === null ? '—' : `$${q.yesBid.toFixed(4)}`;
  $('#c-ask').textContent = q.yesAsk === null ? '—' : `$${q.yesAsk.toFixed(4)}`;
}

async function loadSeries() {
  if (!state.ticker) return;
  const m = state.markets.find((x) => x.ticker === state.ticker);
  if (!m) return;
  updateQuotePanel(m);
  state.livePoints = [];
  const seriesTicker = m.series_ticker || state.seriesTicker;

  if (state.gran === 'second') {
    state.source = 'live sampled quotes (browser)';
    renderChart();
    await sampleOnce();
    return;
  }

  if (!seriesTicker) {
    state.series = [];
    state.source = 'no series ticker available';
    renderChart();
    toast('This market has no series ticker in the snapshot, so the candlestick endpoint cannot be addressed for it.', 7000);
    return;
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - Math.max(state.windowSec, 60);
  try {
    const candles = await fetchCandles(seriesTicker, state.ticker, startTs, endTs, periodInterval(state.gran));
    state.series = candlePoints(candles, state.gran);
    state.source = `official candles (period_interval=${periodInterval(state.gran)} min)`;
  } catch (err) {
    state.series = [];
    state.source = 'candle request failed';
    toast(`Candlestick request failed: ${err.message}`, 7000);
  }
  renderChart();
}

/** Sample the public quote once and append a point. */
async function sampleOnce() {
  if (!state.ticker) return;
  try {
    const { data } = await apiGet(`/markets/${encodeURIComponent(state.ticker)}`);
    const m = data?.market || data;
    if (!m || !m.ticker) return;
    const price = num(m.last_price_dollars);
    const t = Math.floor(Date.now() / 1000);
    if (price !== null) {
      const last = state.livePoints[state.livePoints.length - 1];
      if (!last || last.t !== t) state.livePoints.push({ t, v: price });
      const cutoff = t - state.windowSec;
      while (state.livePoints.length && state.livePoints[0].t < cutoff) state.livePoints.shift();
    }
    const idx = state.markets.findIndex((x) => x.ticker === state.ticker);
    if (idx >= 0) {
      state.markets[idx] = { ...state.markets[idx], last_price_dollars: price, updated_time: m.updated_time, yes_bid_dollars: num(m.yes_bid_dollars), yes_ask_dollars: num(m.yes_ask_dollars), no_bid_dollars: num(m.no_bid_dollars), no_ask_dollars: num(m.no_ask_dollars) };
      updateQuotePanel(state.markets[idx]);
    }
    renderChart();
  } catch (err) {
    setConn('offline', 'offline');
    toast(`Live sampling failed: ${err.message}`, 5000);
  }
}

function startLive() {
  if (state.live) return;
  state.live = true;
  $('#c-live').textContent = '■ Stop live sampling';
  state.timer = setInterval(() => {
    if (state.gran === 'second') sampleOnce();
  }, Math.max(2, state.pollSec) * 1000);
  if (state.gran === 'second') sampleOnce();
}

function stopLive() {
  state.live = false;
  clearInterval(state.timer);
  state.timer = null;
  $('#c-live').textContent = '▶ Start live sampling';
}

function fillMarketSelect() {
  const sel = $('#c-market');
  const options = state.markets
    .slice()
    .sort((a, b) => (b.open_interest_fp ?? 0) - (a.open_interest_fp ?? 0))
    .map((m) => `<option value="${esc(m.ticker)}">${esc((m.title || m.ticker).slice(0, 70))} — ${esc(m.ticker)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">Select a market…</option>${options}`;
  if (state.ticker) sel.value = state.ticker;
}

async function boot() {
  const universe = await getUniverse({ depth });
  state.markets = universe.markets.filter((m) => m.status !== 'finalized' || true);
  state.seriesTicker = universe.markets.find((m) => m.series_ticker)?.series_ticker || '';
  fillMarketSelect();

  const preferred = new URLSearchParams(location.search).get('ticker') || getSelectedTicker();
  if (preferred && state.markets.some((m) => m.ticker === preferred)) {
    state.ticker = preferred;
    $('#c-market').value = preferred;
    setSelectedTicker(preferred);
  }

  setConn(universe.source === 'live' ? 'live' : universe.markets.length ? 'snapshot' : 'offline',
    universe.source === 'live' ? `live · ${transportState.active}` : universe.markets.length ? 'snapshot' : 'no data');

  $('#c-market').addEventListener('change', (e) => {
    state.ticker = e.target.value;
    setSelectedTicker(state.ticker);
    loadSeries();
  });
  $('#c-gran').addEventListener('change', (e) => {
    state.gran = e.target.value;
    $('#c-poll-wrap').style.display = state.gran === 'second' ? '' : 'none';
    loadSeries();
  });
  $('#c-window').addEventListener('change', (e) => {
    state.windowSec = Number(e.target.value);
    loadSeries();
  });
  $('#c-poll').addEventListener('change', (e) => {
    state.pollSec = Number(e.target.value);
    if (state.live) {
      stopLive();
      startLive();
    }
  });
  $('#c-refresh').addEventListener('click', () => loadSeries());
  $('#c-live').addEventListener('click', () => (state.live ? stopLive() : startLive()));

  $('#c-poll-wrap').style.display = state.gran === 'second' ? '' : 'none';
  if (state.ticker) loadSeries();
  else renderChart();
}

boot();
