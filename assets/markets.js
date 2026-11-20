/* Markets page — live event tracking across the 5 requested topics.
   Sorts by estimated dollar volume; tracks resolution (YES/NO) for settled events. */
'use strict';

(function () {
  let live = true;
  let timer = null;
  let topicFilter = 'all';
  let tables = {};
  let discInfo = null;

  const topicLabel = (id) => ({ gas: 'Gas', elections: 'Elections', culture: 'Culture', crypto: 'Crypto', golf: 'Golf', other: 'Other' }[id] || id);
  const apiSrc = (path, params) => {
    const u = new URL(Kalshi.stats().base + path);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  };

  function kpis(evs) {
    const open = evs.filter((e) => e.status === 'open');
    const settled = evs.filter((e) => e.status === 'settled' || e.result);
    const yes = settled.filter((e) => String(e.result).toLowerCase() === 'yes').length;
    const no = settled.filter((e) => String(e.result).toLowerCase() === 'no').length;
    const setK = (id, val) => { const el = $('#' + id); if (el) el.innerHTML = val; };
    setK('kpiLive', open.length ? fmtN(open.length) : '<span class="blank">—</span>');
    setK('kpiVol', fmt$(open.reduce((a, e) => a + e.dollarVolume, 0), 0));
    setK('kpiContracts', fmtN(open.reduce((a, e) => a + e.volume, 0)));
    setK('kpiSettled', `${yes} <span class="badge yes">YES</span> · ${no} <span class="badge no">NO</span>`);
    const st = Kalshi.stats();
    const el = $('#apiNote'); if (el) el.innerHTML = `<span class="mono">${esc(st.base)}</span> · calls ok ${st.ok} / failed ${st.fail}`;
  }

  function renderDiscovery() {
    const el = $('#discInfo'); if (!el || !discInfo) return;
    const map = discInfo.map || {};
    const parts = [];
    for (const [topic, list] of Object.entries(map)) {
      if (!list.length) { parts.push(`<span class="pill" title="No series verified for this topic — see Flagged for Review">${topicLabel(topic)}: <span class="flag">unverified</span></span>`); continue; }
      parts.push(`<span class="pill" title="${esc(list.map((s) => s.series + ' (' + (s.category || 'category n/a') + ' — ' + esc(s.how)).join(', '))}">${topicLabel(topic)}: ${list.map((s) => `<span class="mono">${esc(s.series)}</span>`).join(', ')}</span>`);
    }
    el.innerHTML = parts.join(' ');
  }

  function updateTables() {
    let evs = Store.events;
    if (topicFilter !== 'all') evs = evs.filter((e) => e.categoryTopic === topicFilter);
    kpis(Store.events);
    const open = evs.filter((e) => e.status === 'open').sort((a, b) => b.dollarVolume - a.dollarVolume);
    const resolved = evs.filter((e) => e.status === 'settled' || e.status === 'closed' || e.result)
      .sort((a, b) => String(b.close_time || '').localeCompare(String(a.close_time || '')));

    const openCols = [
      { label: 'Event', render: (e) => `<span class="ttag">${esc(e.event_ticker)}</span><br><span class="small">${esc(e.title || '(title not returned by API)')}</span>` },
      { label: 'Topic', render: (e) => `<span class="badge info">${topicLabel(e.categoryTopic)}</span>` },
      { label: 'Series', render: (e) => `<span class="mono small">${esc(e.series)}</span>` },
      { label: 'Volume (contracts)', num: true, key: 'volume', render: (e) => fmtN(e.volume) },
      { label: 'Vol 24h', num: true, key: 'volume24h', render: (e) => fmtN(e.volume24h) },
      { label: 'Est. $ volume', num: true, key: 'dollarVolume', render: (e) => fmt$(e.dollarVolume, 0), raw: (e) => e.dollarVolume },
      { label: 'Liquidity (API field)', num: true, key: 'liquidity', render: (e) => e.liquidity ? fmtN(e.liquidity) : '<span class="blank">—</span>' },
      { label: 'Closes', render: (e) => fmtT(e.close_time) },
      { label: 'Analyze', render: (e) => e.markets.length ? `<a href="analytics.html?market=${encodeURIComponent(e.markets[0].ticker)}"><button class="small">Chart ▸</button></a>` : '—' },
      { label: 'Source (official API)', render: (e) => `<span class="src"><a href="${apiSrc('/markets', { event_ticker: e.event_ticker, limit: 1000 })}" target="_blank" rel="noopener">GET /markets?event_ticker=… ↗</a></span>` },
    ];
    tables.open = sortableTable($('#tblOpen'), openCols, open);
    if ($('#tblOpen')) $('#tblOpen')._emptyMsg = 'No open markets found for this filter yet (waiting for API data, or no live markets in this topic right now).';

    const resCols = [
      { label: 'Event', render: (e) => `<span class="ttag">${esc(e.event_ticker)}</span><br><span class="small">${esc(e.title || '')}</span>` },
      { label: 'Topic', render: (e) => `<span class="badge info">${topicLabel(e.categoryTopic)}</span>` },
      { label: 'Markets', num: true, render: (e) => fmtN(e.markets.length) },
      { label: 'Resolved', render: (e) => e.markets.map((m) => `${esc(m.ticker.replace(e.event_ticker + '-', ''))} ${resultBadge(m.result || m.market_result)}`).join(' <br> ') || resultBadge(e.result) },
      { label: 'Event result', render: (e) => resultBadge(e.result) },
      { label: 'Closed', render: (e) => fmtT(e.close_time) },
      { label: 'Volume (contracts)', num: true, render: (e) => fmtN(e.volume) },
      { label: 'Source (official API)', render: (e) => `<span class="src"><a href="${apiSrc('/markets', { event_ticker: e.event_ticker, limit: 1000 })}" target="_blank" rel="noopener">GET /markets?event_ticker=… ↗</a></span>` },
    ];
    tables.res = sortableTable($('#tblResolved'), resCols, resolved);
    if ($('#tblResolved')) $('#tblResolved')._emptyMsg = 'No resolved (closed/settled) markets in this topic yet. Markets appear here once the demo API reports status closed/settled with a result field.';
    $('#stamp').innerHTML = Store.lastFetch ? `Data refreshed <b>${fmtT(Store.lastFetch)}</b>${ago(Store.lastFetch)} · polling every 20s${Store.lastError ? ` · <span class="flag">partial errors: ${esc(Store.lastError)}</span>` : ''}` : '';
  }

  async function cycle(force) {
    try {
      if (force || !Discovery.map) {
        const d = await Discovery.discover(force);
        discInfo = typeof d === 'object' && d.map ? d : { map: Discovery.map, errors: [] };
        renderDiscovery();
      }
      const r = await Store.refresh();
      updateTables();
      setConn('on', Store.lastFetch ? new Date(Store.lastFetch).toLocaleTimeString() : '');
      if (r.lastError) setConn('err', 'partial — some series failed, see stamp');
    } catch (e) {
      setConn('err', e.message);
      const el = $('#fetchErr'); if (el) el.innerHTML = `<div class="note-box warn"><b>Live fetch failed:</b> ${esc(e.message)}.<br>
      This static site fetches the Kalshi demo REST API directly from your browser. If your network blocks it (CORS or firewall), the tables cannot populate — no values are invented in the meantime.
      Try the alternate host toggle below, or run a local proxy. Official endpoints are listed on the <a href="sources.html">Sources</a> page.</div>`;
      if (force) toast('Fetch failed: ' + esc(e.message));
    }
  }

  function startStop() {
    clearInterval(timer);
    if (live) timer = setInterval(() => cycle(false), 20000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#btnRefresh').addEventListener('click', () => cycle(true));
    $('#btnReverify').addEventListener('click', async () => { toast('Re-verifying series mapping against GET /series …'); localStorage.removeItem('kd1:discovery:v3'); discInfo = null; await cycle(true); });
    $('#btnExport').addEventListener('click', () => downloadJSON('kalshi-demo-events.json', { generated: new Date().toISOString(), base: Kalshi.stats().base, events: Store.events }));
    $('#btnAlt').addEventListener('click', () => { localStorage.setItem('kd1:base', Kalshi.stats().base === KALSHI_BASE ? KALSHI_BASE_ALT : KALSHI_BASE); location.reload(); });
    $('#chkLive').addEventListener('change', (e) => { live = e.target.checked; startStop(); $('#liveLbl').textContent = live ? 'Live (20s poll)' : 'Paused'; });
    $$('.seg [data-topic]').forEach((b) => b.addEventListener('click', () => {
      $$('.seg [data-topic]').forEach((x) => x.classList.remove('active')); b.classList.add('active');
      topicFilter = b.dataset.topic; updateTables();
    }));
    setConn('off', 'connecting…');
    await cycle(true);
    startStop();
  });
})();
