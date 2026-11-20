/* Kalshi demo dashboard — shared application logic.
 *
 * Dependency-free vanilla JS for GitHub Pages. All market data is read live
 * from the official Kalshi demo Trade API (no credentials). Authenticated
 * portfolio/order endpoints are referenced but never called from this static
 * site: browser-only Pages must not hold API private keys, and no demo
 * credentials were supplied.
 *
 * Verified against official docs.kalshi.com pages (source links listed in
 * COORDINATION.md and on every data page):
 *   Demo env/endpoints ...... https://docs.kalshi.com/getting_started/demo_env
 *   Quick start market data . . https://docs.kalshi.com/getting_started/quick_start_market_data
 *   Get Markets ............. https://docs.kalshi.com/api-reference/market/get-markets
 *   Get Market Orderbook .... https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *   Get Market Candlesticks . https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *   Historical data ......... https://docs.kalshi.com/getting_started/historical_data
 *   Market settlement ....... https://docs.kalshi.com/getting_started/market_settlement
 *   Get Balance/Positions/Fills (authenticated) . docs.kalshi.com/api-reference/portfolio/*
 *   WebSockets .............. https://docs.kalshi.com/getting_started/quick_start_websockets
 */

(function(){
'use strict';

const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
const DOCS = {
  demo:    'https://docs.kalshi.com/getting_started/demo_env',
  quick:   'https://docs.kalshi.com/getting_started/quick_start_market_data',
  markets: 'https://docs.kalshi.com/api-reference/market/get-markets',
  book:    'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
  candles: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
  settle:  'https://docs.kalshi.com/getting_started/market_settlement',
  balance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
  positions:'https://docs.kalshi.com/api-reference/portfolio/get-positions',
  fills:   'https://docs.kalshi.com/api-reference/portfolio/get-fills',
  orders:  'https://docs.kalshi.com/getting_started/quick_start_create_order',
  ws:      'https://docs.kalshi.com/getting_started/quick_start_websockets',
  kalshi:  'https://kalshi.com/',
};

const TOPICS = {
  gas:    ['gas','gasoline','fuel','crude oil','natural gas','heating oil'],
  elections:['election','president','senate','governor','congress','vote','electoral'],
  culture:['culture','film','movie','music','celebrity','tv','television','entertainment','award','oscar','grammy'],
  crypto: ['bitcoin','ethereum','crypto','solana','btc','eth'],
  golf:   ['golf','pga','masters','lpga','pga tour']
};
const TOPIC_LABEL = {gas:'Gas prices',elections:'Elections',culture:'Culture',crypto:'Crypto',golf:'Golf'};

let markets = [];
const api = { ok:false, error:null, updated:null, source: API };

/* ---------- small helpers ---------- */
function esc(s){return s==null?'':String(s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" }[c]))}
function num(v){ if(v==null||v==='') return ''; const n=Number(v); return Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:2}):''; }
function money(v){ if(v==null||v==='') return ''; const n=Number(v); return Number.isFinite(n)?'$'+n.toFixed(2):''; }
function topicOf(m){
  const s = ((m.title||'')+' '+(m.ticker||'')+' '+(m.event_ticker||'')+' '+(m.category||'')).toLowerCase();
  for(const [k,terms] of Object.entries(TOPICS)) if(terms.some(t=>s.includes(t))) return k;
  return '';
}
function topicLabel(k){ return k?TOPIC_LABEL[k]:'—'; }
function marketLink(m){ return 'https://kalshi.com/markets/'+encodeURIComponent(m.event_ticker||m.ticker||''); }
function dollarRank(m){ const n=Number(m.notional_value_dollars); return Number.isFinite(n)?n:-1; }

function on(name,el,cb){ if(el) el.addEventListener(name,cb); }
function $html(id,html){ const el=document.getElementById(id); if(el) el.innerHTML=html; }

function setStatus(kind,msg){
  const el=document.getElementById('connection'); const dot=document.getElementById('status-dot');
  const time=document.getElementById('last-updated');
  if(kind==='connecting'){ if(el)el.textContent=msg||'Connecting to demo API…'; if(dot){dot.className='';dot.classList.add('bad');} }
  if(kind==='connected'){ if(el)el.textContent='Demo API connected'; if(dot){dot.className='';dot.classList.add('ok');} if(time)time.textContent='Updated '+(api.updated?new Date(api.updated).toLocaleTimeString():'—'); }
  if(kind==='error'){ if(el)el.textContent='Demo API unavailable'; if(dot){dot.className='';dot.classList.add('bad');} if(time)time.textContent='No verified response'; }
}

/* ---------- market data ---------- */
async function loadMarkets(){
  setStatus('connecting');
  try{
    const res = await fetch(API + '/markets?status=open&limit=1000', { cache:'no-store' });
    if(!res.ok) throw new Error('API response '+res.status);
    const data = await res.json();
    markets = Array.isArray(data.markets) ? data.markets : [];
    api.ok = true; api.error = null; api.updated = new Date().toISOString();
    setStatus('connected');
  } catch(e){
    api.ok = false; api.error = e.message; markets = [];
    setStatus('error');
  }
  document.dispatchEvent(new CustomEvent('markets-loaded'));
}

function filteredMarkets(topic, q){
  const query = (q||'').toLowerCase();
  return markets.filter(m => {
    const tMatch = topic==='all' || topicOf(m)===topic;
    const s = `${m.title||''} ${m.ticker||''} ${m.event_ticker||''}`.toLowerCase();
    const qMatch = !query || s.includes(query);
    return tMatch && qMatch;
  }).sort((a,b) => dollarRank(b)-dollarRank(a) || (Number(b.volume_24h_fp??b.volume_fp??0) - Number(a.volume_24h_fp??a.volume_fp??0)));
}

function statusCell(m){
  const status = esc(m.status||'');
  const result = String(m.result||'').trim();
  let resHtml = '';
  if(result==='yes') resHtml = '<span class="okv">· resolved: YES</span>';
  else if(result==='no') resHtml = '<span class="bad">· resolved: NO</span>';
  else if(result) resHtml = '· '+esc(result);
  else resHtml = '<span class="blank">· pending</span>';
  return `<span class="${result==='yes'?'okv':(result==='no'?'bad':'blank')}">${status}</span>${resHtml}`;
}

function renderMarketTable(selector, topic, q){
  const rows = filteredMarkets(topic,q);
  const table = document.querySelector(selector+' table tbody');
  const countEl = document.querySelector(selector+' .row-count');
  if(countEl) countEl.textContent = rows.length;
  if(!table) return;
  if(!rows.length){
    table.innerHTML = '<tr><td colspan="9" class="empty">No matching demo markets returned for this topic.<br>Values stay blank rather than fabricated. Topic matching is keyword-based (heuristic) — see the Review page.</td></tr>';
    return;
  }
  table.innerHTML = rows.map(m => {
    const t = topicOf(m);
    const link = marketLink(m);
    const bookId = 'book-'+esc(m.ticker);
    return `<tr>
      <td><div class="mkt"><div class="t">${esc(m.title||m.ticker||'—')}</div><div class="tk">${esc(m.ticker||'')}${m.event_ticker?' · event '+esc(m.event_ticker):''}</div></div></td>
      <td><span class="topic">${topicLabel(t)}</span></td>
      <td>${money(m.yes_bid_dollars)} / ${money(m.yes_ask_dollars)}<div class="tk" style="margin-top:2px">${money(m.last_price_dollars)!==''?'last '+money(m.last_price_dollars):'—'}</div></td>
      <td>${num(m.volume_24h_fp??m.volume_fp)}<div class="tk" style="margin-top:2px">contracts · 24h</div></td>
      <td>${money(m.notional_value_dollars)}<div class="tk" style="margin-top:2px">notional (API field)</div></td>
      <td>${num(m.open_interest_fp)}<div class="tk" style="margin-top:2px">open interest</div></td>
      <td>${statusCell(m)}</td>
      <td><button class="chip" data-book="${esc(m.ticker)}" data-event="${esc(m.event_ticker||'')}" style="padding:6px 10px;font-size:11px">Book</button><div id="book-${esc(m.ticker)}"></div></td>
      <td><a href="${link}" target="_blank" rel="noreferrer" class="source-link">Official market ↗</a> <a href="${DOCS.markets}" target="_blank" rel="noreferrer" style="font-size:10px">API docs ↗</a></td>
    </tr>`;
  }).join('');
  table.querySelectorAll('[data-book]').forEach(btn=>{
    btn.onclick=function(){
      const ticker=this.getAttribute('data-book'), event=this.getAttribute('data-event');
      const target = document.getElementById(bookId);
      if(target && target.style.display!=='none'){ target.style.display='none'; return; }
      loadOrderbookInto(ticker, bookId, event);
    };
  });
}

async function loadOrderbookInto(ticker, containerId, eventTicker){
  const target = document.getElementById(containerId);
  if(!target) return;
  target.style.display='block';
  target.innerHTML = '<div class="empty">Loading official order book…</div>';
  try{
    const res = await fetch(`${API}/markets/${encodeURIComponent(ticker)}/orderbook`, { cache:'no-store' });
    if(!res.ok) throw new Error('Order book response '+res.status);
    const data = await res.json();
    const ob = data.orderbook_fp || {};
    const yes = Array.isArray(ob.yes_dollars)?ob.yes_dollars.slice():[];
    const no  = Array.isArray(ob.no_dollars)?ob.no_dollars.slice():[];
    yes.sort((a,b)=>Number(b[0])-Number(a[0])); // highest YES bid first
    no.sort((a,b)=>Number(b[0])-Number(a[0]));   // highest NO bid first
    const level=(arr,side,cls)=>arr.slice(0,10).map(v=>`<tr><td class="${cls}">${side}</td><td>${esc(v[0])}</td><td class="numc">${esc(v[1])}</td></tr>`).join('');
    const has = yes.length||no.length;
    target.innerHTML = `<div class="drawer"><h4>Order book · ${esc(ticker)}${eventTicker?' · '+esc(eventTicker):''}</h4><p style="font-size:11px;color:var(--muted);margin:0 0 10px">Price in USD per contract; count = contracts available at that price (official order-book endpoint). Arrays are returned sorted ascending by price and re-sorted highest-first here for readability. Not a guarantee of execution.</p><div class="table-wrap"><table><thead><tr><th>Side</th><th>Price</th><th>Contracts</th></tr></thead><tbody>${level(yes,'YES bid','side-yes')}${level(no,'NO bid','side-no')}</tbody></table></div>${has?'':'<p class="empty">No order-book levels returned for this market.</p>'}<a href="${DOCS.book}" target="_blank" rel="noreferrer" class="source-link">Official order-book API ↗</a> <a href="${marketLink({event_ticker,ticker})}" target="_blank" rel="noreferrer" class="source-link">Official market page ↗</a></div>`;
  }catch(e){
    target.innerHTML = `<div class="drawer"><h4>Order book · ${esc(ticker)}</h4><p class="empty">Order book unavailable: ${esc(e.message)}. No values substituted.</p><a href="${DOCS.book}" target="_blank" rel="noreferrer" class="source-link">Official order-book API ↗</a></div>`;
  }
}

/* ---------- chart ---------- */
const INTERVAL_MIN = { '1m':1, '60':60, '1h':60, '1440':1440, '1d':1440 };
let chartCtx=null, chartAnim=null;

function initChart(){
  const marketSel=document.getElementById('chart-market'); const intervalSel=document.getElementById('interval'); const winSel=document.getElementById('window');
  if(!marketSel) return;
  document.addEventListener('markets-loaded',()=>{
    marketSel.innerHTML='<option value="">Select a market</option>'+markets.map(m=>`<option value="${esc(m.ticker)}" data-event="${esc(m.event_ticker||'')}">${esc(m.title||m.ticker)}</option>`).join('');
  });
  function run(){
    const ticker=marketSel.value; const eventTicker=marketSel.options[marketSel.selectedIndex]?.getAttribute('data-event')||'';
    const panel=document.getElementById('chart-panel'); const empty=document.getElementById('chart-empty');
    const canvas=document.getElementById('price-canvas');
    if(!ticker){ if(empty)empty.textContent='Choose a market. Price points appear only when returned by the official API.'; if(canvas)canvas.style.display='none'; if(panel)panel.style.display='none'; return; }
    if(empty)empty.textContent='Loading event series + candlesticks from official API…';
    if(canvas)canvas.style.display='none'; if(panel)panel.style.display='block';
    Promise.all([
      fetch(`${API}/events/${encodeURIComponent(eventTicker||ticker)}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Events response '+r.status);return r.json();}),
      new Promise(res=>setTimeout(res,120))
    ]).then(async ([ev])=>{
      const series = ev.event && ev.event.series_ticker ? ev.event.series_ticker : null;
      if(!series){ if(empty)empty.textContent='Event returned no series_ticker; candlesticks require series_ticker (official API). See Review page.'; if(canvas)canvas.style.display='none'; return; }
      const end = Math.floor(Date.now()/1000);
      const span = Number(document.getElementById('window').value||'86400');
      const start = end - span;
      const period = INTERVAL_MIN[document.getElementById('interval').value] || 60;
      const url = `${API}/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`;
      const res = await fetch(url,{cache:'no-store'});
      if(!res.ok) throw new Error('Candlesticks response '+res.status);
      const data = await res.json();
      const cs = Array.isArray(data.candlesticks)?data.candlesticks:[];
      if(empty){
        if(cs.length) empty.textContent = cs.length+' candlestick(s) returned · official Get Market Candlesticks endpoint.';
        else empty.textContent = 'No candlesticks returned for this market/window. History not available yet.';
      }
      drawChart(cs, period);
    }).catch(e=>{
      if(empty)empty.textContent='Chart data unavailable: '+esc(e.message)+'. No points fabricated.';
      if(canvas)canvas.style.display='none';
    });
  }
  marketSel.onchange=run; intervalSel.onchange=run; winSel.onchange=run;
}

function drawChart(cs, period){
  const canvas=document.getElementById('price-canvas'); if(!canvas) return;
  const box=canvas.parentElement; const dpr=Math.max(1,window.devicePixelRatio||1);
  const w=box.clientWidth||560, h=box.clientHeight||300;
  canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.width=w+'px'; canvas.style.height=h+'px';
  const c=canvas.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
  const pad={l:56,r:16,t:14,b:26};
  const innerW=w-pad.l-pad.r, innerH=h-pad.t-pad.b;
  const pts = cs.map(x=>{ const p=x.price||{}; return { t:Number(x.end_period_ts), o:Number(p.open_dollars||0), hi:Number(p.high_dollars||0), lo:Number(p.low_dollars||0), cl:Number(p.close_dollars||0), v:Number(p.volume_fp||0) }; }).filter(x=>Number.isFinite(x.cl));
  if(!pts.length){ c.clearRect(0,0,w,h); canvas.style.display='none'; return; }
  canvas.style.display='block';
  c.clearRect(0,0,w,h);
  const xs=pts.map(p=>p.t); const ys=pts.flatMap(p=>[p.hi,p.lo,p.cl]);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  const padY = (maxY-minY)||1;
  const y0 = minY - padY*0.12, y1 = maxY + padY*0.12;
  const t0=xs[0], t1=xs[xs.length-1]||t0+1;
  const X=p=>pad.l+(p.t-t0)/(t1-t0)*innerW;
  const Y=p=>pad.b+innerH-(p-y0)/(y1-y0)*innerH;
  // grid + axes
  c.strokeStyle='#e7ece8'; c.lineWidth=1;
  for(let i=0;i<=4;i++){ const yy=pad.b+innerH*(i/4); c.beginPath();c.moveTo(pad.l,yy);c.lineTo(w-pad.r,yy);c.stroke(); }
  c.fillStyle='#77827d'; c.font='10px DM Mono'; c.textAlign='right'; c.textBaseline='middle';
  for(let i=0;i<=4;i++){ const val=y0+(y1-y0)*(i/4); c.fillText(val.toFixed(2),pad.l-6,pad.b+innerH*(1-i/4)+1); }
  // time axis labels
  const nticks = Math.min(5,pts.length); const step=Math.max(1,Math.floor((pts.length-1)/(nticks-1||1)));
  c.textAlign='center'; c.textBaseline='top';
  for(let i=0;i<pts.length;i+=step){ const p=pts[i]; const xx=X(p); const d=new Date(p.t*1000); c.fillText(d.toLocaleTimeString([{hour:'2-digit',minute:'2-digit'}]),xx,h-pad.b+5); }
  // polyline of close prices
  c.strokeStyle='#176b4d'; c.lineWidth=1.6; c.lineJoin='round'; c.beginPath();
  pts.forEach((p,i)=>{ i===0?c.moveTo(X(p),Y(p.cl)):c.lineTo(X(p),Y(p.cl)); });
  c.stroke();
  // dots
  c.fillStyle='#176b4d'; pts.forEach(p=>{ c.beginPath();c.arc(X(p),Y(p.cl),3,0,Math.PI*2);c.fill(); });
  // latest label
  const last=pts[pts.length-1]; c.fillStyle='#17231f'; c.font='bold 11px DM Sans'; c.textAlign='left'; c.fillText('$'+last.cl.toFixed(2),X(last)+8,Y(last.cl)-6);
  c.fillStyle='#77827d'; c.font='10px DM Mono'; c.fillText('period = '+period+' min · close price',pad.l,pad.t+10);
}

/* ---------- page bootstrap ---------- */
function pageInit(){
  const docEl=document.documentElement; const body=document.body;
  const dot=document.getElementById('status-dot'); if(dot) dot.className='';
  const page = body.dataset.page||'';
  loadMarkets();
  if(page==='markets' || page==='topic'){
    const topic = body.dataset.topic||'all';
    const doRender=()=>renderMarketTable('#markets-wrap', topic, document.getElementById('search')?.value||'');
    document.getElementById('refresh') && (document.getElementById('refresh').onclick=()=>{loadMarkets();});
    const sel = document.querySelectorAll('.chip[data-topic]'); sel.forEach(b=>{ b.onclick=function(){ sel.forEach(x=>x.classList.remove('active')); b.classList.add('active'); doRender(); }; });
    const search = document.getElementById('search'); if(search) search.oninput=doRender;
    document.addEventListener('markets-loaded', doRender);
    doRender();
  }
  if(page==='chart') initChart();
  if(page==='review') renderReview();
  if(page==='suggestions') renderSuggestions();
  if(page==='questions') renderQuestions();
  document.getElementById('api-source') && (document.getElementById('api-source').href=API);
}
document.addEventListener('DOMContentLoaded', pageInit);

/* placeholder export for inline page scripts */
window.KALSHI = { API, DOCS, TOPICS, TOPIC_LABEL, loadMarkets, filteredMarkets, topicOf, esc, num, money, marketLink, setStatus };

})();