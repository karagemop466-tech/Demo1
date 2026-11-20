(() => {
  'use strict';
  const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
  const DOC_MARKETS = 'https://docs.kalshi.com/api-reference/market/get-markets';
  const DOC_BOOK = 'https://docs.kalshi.com/getting_started/orderbook_responses';
  const topics = {
    gas: {label: 'Gas prices', re: /\b(natural gas|henry hub|gasoline|gas prices?|fuel prices?|crude oil|petrol)\b/i},
    elections: {label: 'Elections', re: /\b(election|president|presidential|senate|congress|governor|primary|ballot|vote|political)\b/i},
    culture: {label: 'Culture', re: /\b(culture|entertainment|music|film|movie|tv|television|award|celebrity|box office|artist)\b/i},
    crypto: {label: 'Crypto', re: /\b(crypto|bitcoin|btc|ethereum|ether|solana|dogecoin|token)\b/i},
    golf: {label: 'Golf', re: /\b(golf|pga|lpga|masters|open championship|ryder cup)\b/i}
  };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => v === null || v === undefined || v === '' ? '—' : `$${Number(v).toFixed(2)}`;
  const count = v => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
  const marketSource = m => `${API}/markets/${encodeURIComponent(m.ticker)}`;
  let markets = [], selected = null, timer = null;
  const points = new Map();
  const tracked = new Map();
  const $ = id => document.getElementById(id);
  const topicLabel = (m) => {
    const text = `${m.title || ''} ${m.subtitle || ''} ${m.yes_sub_title || ''} ${m.ticker || ''} ${m.event_ticker || ''}`;
    for (const value of Object.values(topics)) if (value.re.test(text)) return value.label;
    return '';
  };
  function setStatus(text, cls='') {
    const node = $('connection-state');
    if (node) { node.textContent = text; node.className = cls; }
  }
  async function get(path) {
    const response = await fetch(`${API}${path}`, {headers:{Accept:'application/json'}, cache:'no-store'});
    if (!response.ok) throw new Error(`Kalshi demo API returned HTTP ${response.status}`);
    return response.json();
  }
  async function loadMarkets() {
    setStatus('Refreshing official demo data…');
    const gathered = [];
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({status:'open',limit:'1000'});
      if (cursor) q.set('cursor', cursor);
      const data = await get(`/markets?${q.toString()}`);
      if (Array.isArray(data.markets)) gathered.push(...data.markets);
      cursor = data.cursor || '';
      if (!cursor || !data.markets?.length) break;
    }
    const notice = $('market-note');
    if (notice) notice.textContent = `${gathered.length.toLocaleString()} open-market records scanned from the official demo API${cursor ? ' (stopped at the five-page safety cap; coverage is partial)' : ''}. 24-hour volume is contracts, not dollars; blanks indicate unavailable data.`;
    markets = gathered.filter(m => topicLabel(m));
    render();
    const stamp = new Date();
    if ($('last-refresh')) $('last-refresh').textContent = stamp.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    setStatus('Connected · REST snapshot');
    if (selected) {
      const fresh = markets.find(m => m.ticker === selected.ticker);
      if (fresh) { selected = fresh; sample(); loadBook(); }
    }
    await refreshTracked();
  }
  function filteredMarkets() {
    const topic = $('topic')?.value || new URLSearchParams(location.search).get('topic') || 'all';
    const query = ($('search')?.value || '').trim().toLowerCase();
    return markets.filter(m => {
      const label = topicLabel(m);
      const topicMatch = topic === 'all' || topics[topic]?.label === label;
      const text = `${m.title || ''} ${m.ticker || ''} ${m.event_ticker || ''}`.toLowerCase();
      return topicMatch && (!query || text.includes(query));
    }).sort((a,b) => (Number(b.volume_24h_fp)||0) - (Number(a.volume_24h_fp)||0));
  }
  function render() {
    const tbody = $('market-rows');
    if (!tbody) return;
    const rows = filteredMarkets();
    if ($('stat-markets')) $('stat-markets').textContent = rows.length.toLocaleString();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">${markets.length ? 'No open markets matched these topic keywords.' : 'No qualifying markets were returned by the demo API.'} <a href="${DOC_MARKETS}" target="_blank" rel="noreferrer">Official source ↗</a></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(m => {
      const result = m.result === 'yes' || m.result === 'no' ? m.result.toUpperCase() : 'Not resolved';
      const status = m.status ? String(m.status) : '—';
      const href = marketSource(m);
      return `<tr data-ticker="${esc(m.ticker)}"><td><div class="market-name">${esc(m.title || 'Untitled market')}</div><div class="ticker">${esc(m.ticker || '')}${m.event_ticker ? ` · Event ${esc(m.event_ticker)}` : ''}</div></td><td><span class="tag">${esc(topicLabel(m))}</span></td><td class="value">${money(m.yes_bid_dollars)}</td><td class="value">${count(m.volume_24h_fp)} <span class="smallprint">contracts</span></td><td class="value">${money(m.last_price_dollars)}</td><td><span class="tag ${result==='Not resolved'?'unknown':''}">${esc(status)} · ${esc(result)}</span></td><td><a class="table-action" href="#" data-select="${esc(m.ticker)}">Track ↗</a> · <a class="table-action" href="${esc(href)}" target="_blank" rel="noreferrer">API ↗</a></td></tr>`;
    }).join('');
    tbody.querySelectorAll('tr[data-ticker]').forEach(row => row.addEventListener('click', e => {
      const track = e.target.closest('[data-select]');
      if (track) { e.preventDefault(); selectMarket(track.dataset.select); return; }
      if (e.target.closest('a')) return;
      selectMarket(row.dataset.ticker);
    }));
  }
  async function refreshTracked() {
    if (!tracked.size) return;
    await Promise.all([...tracked.keys()].map(async ticker => {
      try {
        const data = await get(`/markets/${encodeURIComponent(ticker)}`);
        const market = data.market || data;
        if (market && market.ticker) tracked.set(ticker, {...tracked.get(ticker), title:market.title || tracked.get(ticker).title, status:market.status || '', result:market.result || '', checkedAt:Date.now()});
      } catch (_) { /* keep last verified snapshot; the status is marked stale below */ }
    }));
    renderTracked();
  }
  function renderTracked() {
    const body = $('resolved-rows'); if (!body) return;
    const rows = [...tracked.values()];
    if ($('tracked-count')) $('tracked-count').textContent = rows.length.toLocaleString();
    if (!rows.length) { body.innerHTML='<tr><td colspan="5" class="empty">Select a market above to begin tracking it through resolution. <a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noreferrer">Official source ↗</a></td></tr>'; return; }
    body.innerHTML = rows.map(m => `<tr><td>${esc(m.title)}<div class="ticker">${esc(m.ticker)}</div></td><td>${esc(m.status || '—')}</td><td>${m.result==='yes'||m.result==='no'?esc(m.result.toUpperCase()):'Not resolved / not returned'}</td><td>${m.checkedAt?new Date(m.checkedAt).toLocaleTimeString(): 'Not checked'}</td><td><a class="table-action" href="${esc(marketSource(m))}" target="_blank" rel="noreferrer">Official API ↗</a></td></tr>`).join('');
  }
  function selectMarket(ticker) {
    selected = markets.find(m => m.ticker === ticker);
    if (!selected) return;
    if (!tracked.has(ticker)) tracked.set(ticker, {ticker, title:selected.title || ticker, status:selected.status || '', result:selected.result || '', checkedAt:null});
    if ($('tracked-count')) $('tracked-count').textContent = tracked.size.toLocaleString();
    renderTracked();
    refreshTracked();
    if ($('chart-title')) $('chart-title').textContent = selected.title || selected.ticker;
    if ($('book-title')) $('book-title').textContent = `${selected.ticker} · ${selected.title || ''}`;
    sample(); loadBook(); drawChart();
  }
  function sample() {
    if (!selected) return;
    const value = selected.yes_bid_dollars;
    if (value === null || value === undefined || value === '') return;
    if (!points.has(selected.ticker)) points.set(selected.ticker, []);
    const list = points.get(selected.ticker);
    list.push({t:Date.now(), p:Number(value)});
    const max = 24*60*60*1000;
    while (list.length && Date.now()-list[0].t > max) list.shift();
    drawChart();
  }
  async function loadBook() {
    if (!selected) return;
    const ticker = selected.ticker;
    try {
      const data = await get(`/markets/${encodeURIComponent(ticker)}/orderbook`);
      if (selected?.ticker !== ticker) return;
      const ob = data.orderbook_fp || data.orderbook || {};
      renderBook('yes-book', ob.yes_dollars || ob.yes || []);
      renderBook('no-book', ob.no_dollars || ob.no || []);
      const a = $('book-source'); if (a) { a.href = DOC_BOOK; }
    } catch (err) {
      renderBook('yes-book', []); renderBook('no-book', []);
      setStatus('Market list connected · orderbook unavailable');
    }
  }
  function renderBook(id, levels) {
    const node = $(id); if (!node) return;
    const best = levels.slice(-6).reverse();
    node.innerHTML = best.length ? best.map(level => `<tr><td>${money(level[0])}</td><td>${count(level[1])}</td><td><a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noreferrer">Official ↗</a></td></tr>`).join('') : '<tr><td colspan="3">No bids returned · <a href="https://docs.kalshi.com/getting_started/orderbook_responses">Official source ↗</a></td></tr>';
  }
  function drawChart() {
    const canvas = $('price-chart'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1,Math.floor(rect.width*ratio)); canvas.height = Math.max(1,Math.floor(rect.height*ratio));
    ctx.scale(ratio,ratio);
    const w=rect.width,h=rect.height, pad={l:48,r:14,t:14,b:30};
    ctx.clearRect(0,0,w,h);
    const range=Number($('chart-window')?.value||300)*1000, now=Date.now(), since=now-range;
    const list=(selected && points.get(selected.ticker)||[]).filter(x=>x.t>=since);
    const empty=$('chart-empty'); if (empty) empty.style.display=list.length?'none':'grid';
    const vals=list.map(x=>x.p); const min=vals.length?Math.max(0,Math.min(...vals)-.03):0; const max=vals.length?Math.min(1,Math.max(...vals)+.03):1;
    const x=t=>pad.l+(t-since)/range*(w-pad.l-pad.r), y=p=>h-pad.b-(p-min)/(max-min||1)*(h-pad.t-pad.b);
    ctx.font='10px DM Mono, monospace'; ctx.strokeStyle='#20343f';ctx.fillStyle='#80949d';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){const yy=pad.t+i*(h-pad.t-pad.b)/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.fillText(money(max-i*(max-min)/4),4,yy+3)}
    for(let i=0;i<=4;i++){const xx=pad.l+i*(w-pad.l-pad.r)/4;ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,h-pad.b);ctx.stroke();const d=new Date(since+i*range/4);ctx.fillText(d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:range<=900000?'2-digit':undefined}),Math.max(0,xx-23),h-8)}
    if(list.length){ctx.beginPath();list.forEach((p,i)=>i?ctx.lineTo(x(p.t),y(p.p)):ctx.moveTo(x(p.t),y(p.p)));ctx.strokeStyle='#b9f27c';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#b9f27c';for(const p of list){ctx.beginPath();ctx.arc(x(p.t),y(p.p),2.5,0,Math.PI*2);ctx.fill()}}
  }
  $('topic')?.addEventListener('change',render);
  $('search')?.addEventListener('input',render);
  $('refresh')?.addEventListener('click',()=>loadMarkets().catch(e=>setStatus(e.message)));
  $('chart-window')?.addEventListener('change',drawChart);
  window.addEventListener('resize',drawChart);
  const topicSelect=$('topic');
  if(topicSelect){const queryTopic=new URLSearchParams(location.search).get('topic');if(queryTopic&&topics[queryTopic])topicSelect.value=queryTopic;}
  if($('market-rows')){
    loadMarkets().catch(err=>{setStatus(err.message);const body=$('market-rows');if(body)body.innerHTML='<tr><td colspan="7" class="empty">Live market data could not be loaded. Confirm browser connectivity/CORS or try again. No values are fabricated. <a href="https://docs.kalshi.com/getting_started/quick_start_market_data" target="_blank" rel="noreferrer">Official source ↗</a></td></tr>';});
    timer=setInterval(()=>loadMarkets().catch(err=>setStatus(err.message)),15000);
  }
  // Public category subpages reuse the same live display without enabling trade actions.
  if($('category-rows')){
    const key=new URLSearchParams(location.search).get('topic')||'gas';
    const topic=topics[key]||topics.gas;
    const title=$('category-title'); if(title)title.textContent=topic.label;
    const body=$('category-rows');
    get('/markets?'+new URLSearchParams({status:'open',limit:'1000'})).then(data=>{
      const rows=(data.markets||[]).filter(m=>topicLabel(m)===topic.label).sort((a,b)=>(Number(b.volume_24h_fp)||0)-(Number(a.volume_24h_fp)||0));
      body.innerHTML=rows.length?rows.map(m=>`<tr><td><strong>${esc(m.title||'Untitled')}</strong><div class="ticker">${esc(m.ticker||'')}</div></td><td>${money(m.yes_bid_dollars)}</td><td>${count(m.volume_24h_fp)} contracts</td><td>${esc(m.status||'—')} · ${m.result==='yes'||m.result==='no'?esc(m.result.toUpperCase()):'Not resolved'}</td><td><a class="table-action" href="${esc(marketSource(m))}" target="_blank" rel="noreferrer">Official API ↗</a></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No open markets matched the page’s topic keywords in this API response. <a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noreferrer">Official source ↗</a></td></tr>';
    }).catch(()=>{body.innerHTML='<tr><td colspan="5" class="empty">Official demo API unavailable; no sample data shown.</td></tr>';});
  }
})();
