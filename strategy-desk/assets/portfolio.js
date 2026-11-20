/* Portfolio page — SIMULATED demo-account portfolio.
   IMPORTANT (flagged): placing real Kalshi demo orders requires authenticated
   endpoints (KALSHI-ACCESS-KEY / SIGNATURE / TIMESTAMP with Ed25519 or RSA
   request signing — see https://docs.kalshi.com/getting_started/quick_start_authenticated_requests).
   A static GitHub Pages site cannot hold private keys safely, so this module
   SIMULATES execution against live demo-market prices. Nothing here is a real
   Kalshi order; every simulated value is labeled SIM. No values are invented:
   live prices come from the public demo REST API when reachable.
*/
'use strict';

(function () {
  const PKEY = 'kd1:portfolio:v1';
  const STRATEGIES = ['Momentum', 'Mean-revert', 'Event-catalyst', 'Hedge', 'Arbitrage', 'Learning/other'];
  let state = { cash: 1000000, startCash: 1000000, positions: [], closed: [], seq: 1 };
  // NOTE: cash is in CENTS (sim). $1,000,000 default starting capital — user-configurable, clearly SIM.

  const feeCents = (contracts, priceCents) => {
    // Official Kalshi general taker fee: fee = ceil(0.07 × C × P × (1−P)) to the next cent,
    // P in dollars. Docs: https://docs.kalshi.com (fees / fee rounding).
    const p = Math.min(0.99, Math.max(0.01, priceCents / 100));
    return Math.ceil(0.07 * contracts * p * (1 - p) * 100);
  };

  function load() { try { const s = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (s && s.positions) state = s; } catch {} }
  function save() { try { localStorage.setItem(PKEY, JSON.stringify(state)); } catch {} }

  const sim = document.body.dataset.sim === '1';

  async function quote(ticker) {
    try {
      const r = await Kalshi.get('/markets', { tickers: ticker });
      const m = (r.markets || []).find((x) => x.ticker === ticker);
      if (!m) return null;
      const yesBid = Number(m.yes_bid) || null, yesAsk = Number(m.yes_ask) || null;
      const last = Number(m.last_price) || null;
      const yes = yesAsk || last || yesBid;
      const no = (Number(m.no_ask) || (yes != null ? 100 - yes : null));
      const mid = yesBid && yesAsk ? (yesBid + yesAsk) / 2 : last;
      return { yes, no, mid, m };
    } catch { return null; }
  }

  async function refreshPositions() {
    for (const p of state.positions) {
      const q = await quote(p.ticker);
      if (!q) { p.last = null; p.unverified = true; continue; }
      p.unverified = false;
      p.sidePrice = p.side === 'yes' ? q.yes : q.no;
      p.mid = p.side === 'yes' ? q.mid : (q.mid != null ? 100 - q.mid : null);
      p.result = q.m.result || q.m.market_result || '';
      p.status = q.m.status || '';
    }
    save(); render();
  }

  function positionValue(p) {
    const price = p.sidePrice != null ? p.sidePrice : (p.mid != null ? p.mid : null);
    if (price == null) return null;
    return (price / 100) * p.qty; // $ value
  }

  async function placeOrder(o) {
    // o: {ticker, side, type, qty, limitCents, strategy, category}
    const q = await quote(o.ticker);
    if (!q) { toast('Cannot quote market right now — order NOT filled (nothing invented).'); return; }
    let fillCents;
    if (o.type === 'market') fillCents = o.side === 'yes' ? q.yes : q.no;
    else {
      fillCents = o.limitCents;
      // limit crosses the book? if better price available, fill at better price
      const best = o.side === 'yes' ? q.yes : q.no;
      if (best != null && ((o.side === 'yes' && best <= o.limitCents) || (o.side === 'no' && best <= o.limitCents))) fillCents = best;
    }
    if (fillCents == null || isNaN(fillCents)) { toast('No fill price available (blank). Order rejected.'); return; }
    const fee = feeCents(o.qty, fillCents);
    const costCents = Math.round(o.qty * fillCents) + fee;
    if (costCents > state.cash) { toast(`Insufficient SIM cash: need $${(costCents / 100).toFixed(2)}, have $${(state.cash / 100).toFixed(2)}`); return; }
    state.cash -= costCents;
    const ex = state.positions.find((p) => p.ticker === o.ticker && p.side === o.side && p.strategy === o.strategy && p.category === o.category);
    if (ex) {
      const totQty = ex.qty + o.qty;
      ex.avgCents = (ex.avgCents * ex.qty + fillCents * o.qty) / totQty;
      ex.feesCents += fee; ex.qty = totQty;
    } else {
      state.positions.push({ id: state.seq++, ticker: o.ticker, side: o.side, qty: o.qty, avgCents: fillCents, feesCents: fee, opened: new Date().toISOString(), strategy: o.strategy, category: o.category, title: q.m?.title || o.title || '', event: q.m?.event_ticker || '' });
    }
    save(); toast(`SIM fill: ${o.qty} ${o.side.toUpperCase()} @ ${fillCents}¢ · fee $${(fee / 100).toFixed(2)}`);
    refreshPositions();
  }

  async function closePosition(id, how) {
    const p = state.positions.find((x) => x.id === id); if (!p) return;
    let exitCents = null, note = '';
    if (how === 'settle') {
      const r = String(p.result || '').toLowerCase();
      if (!r) { toast('Not settled yet — cannot settle (result field blank; not guessing).'); return; }
      exitCents = (p.side === 'yes') ? (r === 'yes' ? 100 : 0) : (r === 'no' ? 100 : 0);
      note = 'settled';
    } else {
      const q = await quote(p.ticker); if (!q) { toast('No live quote — sell not executed.'); return; }
      exitCents = p.side === 'yes' ? (Number(q.m.yes_bid) || q.yes) : (Number(q.m.no_bid) || q.no);
      note = 'sold at bid';
    }
    if (exitCents == null) { toast('Exit price blank — not guessing.'); return; }
    const fee = feeCents(p.qty, Math.max(1, Math.min(99, exitCents)));
    const proceeds = Math.round(p.qty * exitCents) - fee;
    state.cash += proceeds;
    const pnl = proceeds - Math.round(p.qty * p.avgCents) - p.feesCents;
    state.closed.push({ ...p, closed: new Date().toISOString(), exitCents, exitFee: fee, pnlCents: pnl, how: note });
    state.positions = state.positions.filter((x) => x.id !== id);
    save(); toast(`SIM closed ${p.ticker}: P&L $${(pnl / 100).toFixed(2)}`);
    refreshPositions();
  }

  function resetSim() {
    state = { cash: state.startCash, startCash: state.startCash, positions: [], closed: [], seq: 1 };
    save(); render(); toast('SIM portfolio reset (simulated positions cleared).');
  }

  /* ---------------- rendering ---------------- */
  let byCat = null, byStrat = null;

  function equityNow() {
    let eq = state.cash;
    for (const p of state.positions) { const v = positionValue(p); if (v != null) eq += v * 100; }
    return eq; // cents
  }

  function pnlSummary() {
    const realized = state.closed.reduce((a, c) => a + c.pnlCents, 0);
    let unreal = 0, marked = 0;
    for (const p of state.positions) {
      const v = positionValue(p);
      if (v == null) { continue; }
      unreal += v * 100 - p.qty * p.avgCents - p.feesCents; marked++;
    }
    const wins = state.closed.filter((c) => c.pnlCents > 0).length;
    const losses = state.closed.filter((c) => c.pnlCents <= 0).length;
    const fees = state.closed.reduce((a, c) => a + c.feesCents + (c.exitFee || 0), 0) + state.positions.reduce((a, p) => a + p.feesCents, 0);
    return { realized, unreal, wins, losses, fees, marked, unmarked: state.positions.length - marked };
  }

  function render() {
    const eq = equityNow(), s = pnlSummary();
    const setK = (id, val) => { const el = $('#' + id); if (el) el.innerHTML = val; };
    setK('kpiEquity', `$${(eq / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    setK('kpiCash', `$${(state.cash / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    const totPnl = s.realized + s.unreal;
    setK('kpiPnl', `<span class="${totPnl >= 0 ? 'pos' : 'neg'}">${totPnl >= 0 ? '+' : ''}$${((totPnl) / 100).toFixed(2)}</span>`);
    setK('kpiRealized', `<span class="${s.realized >= 0 ? 'pos' : 'neg'}">${s.realized >= 0 ? '+' : ''}$${(s.realized / 100).toFixed(2)}</span>`);
    setK('kpiUnreal', `${s.unreal >= 0 ? '+' : ''}$${(s.unreal / 100).toFixed(2)} <span class="small">(${s.marked} marked / ${s.unmarked} unpriced)</span>`);
    setK('kpiWin', state.closed.length ? `${s.wins}W / ${s.losses}L (${Math.round((s.wins / Math.max(1, state.closed.length)) * 100)}%)` : '<span class="blank">—</span>');
    setK('kpiFees', `$${(s.fees / 100).toFixed(2)}`);

    // open positions
    const posCols = [
      { label: 'Ticker', render: (p) => `<span class="ttag">${esc(p.ticker)}</span><br><span class="small">${esc(p.title || '')}</span>` },
      { label: 'Side', render: (p) => p.side === 'yes' ? '<span class="badge yes">YES</span>' : '<span class="badge no">NO</span>' },
      { label: 'Qty', num: true, key: 'qty' },
      { label: 'Avg ¢', num: true, render: (p) => fmtC(p.avgCents) },
      { label: 'Mark ¢', num: true, render: (p) => p.sidePrice != null ? fmtC(p.sidePrice) : (p.mid != null ? fmtC(p.mid) + ' (mid)' : '<span class="blank">—</span>' + (p.unverified ? ' <span class="flag">unpriced</span>' : '')) },
      { label: 'Value $', num: true, render: (p) => { const v = positionValue(p); return v == null ? '<span class="blank">—</span>' : fmt$(v, 2); } },
      { label: 'Open P&L $', num: true, render: (p) => { const v = positionValue(p); if (v == null) return '<span class="blank">—</span>'; const pnl = v - (p.qty * p.avgCents + p.feesCents) / 100; return `<span class="${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>`; } },
      { label: 'Category', render: (p) => `<span class="badge info">${esc(p.category || '—')}</span>` },
      { label: 'Strategy', render: (p) => `<span class="pill">${esc(p.strategy || '—')}</span>` },
      { label: 'Opened', render: (p) => fmtT(p.opened) },
      { label: 'Actions', render: (p) => `<button class="small" data-sell="${p.id}">Sell</button> <button class="small" data-settle="${p.id}">Settle</button>` },
    ];
    sortableTable($('#tblPos'), posCols, state.positions);
    $$('#tblPos [data-sell]').forEach((b) => b.addEventListener('click', () => closePosition(+b.dataset.sell, 'sell')));
    $$('#tblPos [data-settle]').forEach((b) => b.addEventListener('click', () => closePosition(+b.dataset.settle, 'settle')));

    // closed trades
    const clsCols = [
      { label: 'Ticker', render: (c) => `<span class="ttag">${esc(c.ticker)}</span>` },
      { label: 'Side', render: (c) => c.side === 'yes' ? '<span class="badge yes">YES</span>' : '<span class="badge no">NO</span>' },
      { label: 'Qty', num: true, key: 'qty' },
      { label: 'Entry ¢', num: true, render: (c) => fmtC(c.avgCents) },
      { label: 'Exit ¢', num: true, render: (c) => fmtC(c.exitCents) },
      { label: 'How', render: (c) => esc(c.how) },
      { label: 'Result', render: (c) => resultBadge(c.result) },
      { label: 'Realized P&L $', num: true, key: 'pnlCents', render: (c) => `<span class="${c.pnlCents >= 0 ? 'pos' : 'neg'}">${c.pnlCents >= 0 ? '+' : ''}$${(c.pnlCents / 100).toFixed(2)}</span>` },
      { label: 'Category', render: (c) => `<span class="badge info">${esc(c.category || '—')}</span>` },
      { label: 'Strategy', render: (c) => `<span class="pill">${esc(c.strategy || '—')}</span>` },
      { label: 'Closed', render: (c) => fmtT(c.closed) },
    ];
    sortableTable($('#tblClosed'), clsCols, [...state.closed].sort((a, b) => String(b.closed).localeCompare(String(a.closed))));
    renderAnalyzer();
  }

  function renderAnalyzer() {
    const cat = {}, strat = {};
    const acc = (map, key, c) => {
      const k = key || '—';
      map[k] = map[k] || { n: 0, wins: 0, pnl: 0, fees: 0 };
      map[k].n++; if (c.pnlCents > 0) map[k].wins++; map[k].pnl += c.pnlCents; map[k].fees += c.feesCents + (c.exitFee || 0);
    };
    state.closed.forEach((c) => { acc(cat, c.category, c); acc(strat, c.strategy, c); });
    state.positions.forEach((p) => {
      const v = positionValue(p);
      const key = 'OPEN: ' + (p.category || '—');
      cat[key] = cat[key] || { n: 0, wins: 0, pnl: 0, fees: 0 };
      cat[key].n++; cat[key].fees += p.feesCents;
      if (v != null) cat[key].pnl += v * 100 - p.qty * p.avgCents - p.feesCents;
    });
    byCat = cat; byStrat = strat;
    const rows = Object.entries(cat).map(([k, v]) => ({ k, ...v, winPct: v.n ? Math.round((v.wins / v.n) * 100) : null }));
    sortableTable($('#tblByCat'), [
      { label: 'Category', render: (r) => `<span class="badge info">${esc(r.k)}</span>` },
      { label: 'Trades', num: true, key: 'n' },
      { label: 'Win rate', num: true, render: (r) => r.winPct == null ? '<span class="blank">—</span>' : r.winPct + '%' },
      { label: 'P&L $', num: true, render: (r) => `<span class="${r.pnl >= 0 ? 'pos' : 'neg'}">${r.pnl >= 0 ? '+' : ''}$${(r.pnl / 100).toFixed(2)}</span>` },
      { label: 'Fees $', num: true, render: (r) => fmt$(r.fees / 100, 2) },
    ], rows);
    const srows = Object.entries(strat).map(([k, v]) => ({ k, ...v, winPct: v.n ? Math.round((v.wins / v.n) * 100) : null }));
    sortableTable($('#tblByStrat'), [
      { label: 'Strategy', render: (r) => `<span class="pill">${esc(r.k)}</span>` },
      { label: 'Trades', num: true, key: 'n' },
      { label: 'Win rate', num: true, render: (r) => r.winPct == null ? '<span class="blank">—</span>' : r.winPct + '%' },
      { label: 'P&L $', num: true, render: (r) => `<span class="${r.pnl >= 0 ? 'pos' : 'neg'}">${r.pnl >= 0 ? '+' : ''}$${(r.pnl / 100).toFixed(2)}</span>` },
      { label: 'Fees $', num: true, render: (r) => fmt$(r.fees / 100, 2) },
    ], srows);
    const el = $('#strategyText');
    if (el) {
      if (!state.closed.length && !state.positions.length) { el.textContent = 'No trades yet — place a SIM trade above (prices live from the demo API when reachable); the analyzer fills in as trades close.'; return; }
      const best = srows.filter((r) => r.n >= 1).sort((a, b) => b.pnl - a.pnl)[0];
      const worst = srows.filter((r) => r.n >= 1).sort((a, b) => a.pnl - b.pnl)[0];
      const s = pnlSummary();
      el.innerHTML = `SIM trades closed: ${state.closed.length} · realized $${(s.realized / 100).toFixed(2)} · fees paid $${(s.fees / 100).toFixed(2)}.` +
        (best && best !== worst ? ` Best-performing strategy so far: <b>${esc(best.k)}</b> (${best.n} trades, $${(best.pnl / 100).toFixed(2)}). Weakest: <b>${esc(worst.k)}</b> ($${(worst.pnl / 100).toFixed(2)}). ` : '') +
        ` Interpretation caution: sample sizes are small; win-rate differences are not statistically significant (see Suggestions page → “small-sample trap”).`;
    }
  }

  function renderSimBars() {
    const svg = $('#pnlChart');
    if (!svg) return;
    const data = Object.entries(byStrat || {}).map(([k, v]) => ({ k, pnl: v.pnl / 100 }));
    if (!data.length) { svg.innerHTML = '<text x="420" y="150" fill="#5f7495" font-size="14" text-anchor="middle">SIM P&L by strategy will appear here after trades close</text>'; return; }
    const W = 840, H = 300, padL = 60, padB = 60;
    const max = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));
    const bw = Math.min(90, (W - padL - 20) / data.length - 12);
    const zero = H / 2;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<line x1="${padL}" x2="${W - 10}" y1="${zero}" y2="${zero}" stroke="#24344e"/>` + data.map((d, i) => {
      const h = (Math.abs(d.pnl) / max) * (H / 2 - 30);
      const x = padL + i * ((W - padL - 20) / data.length) + 8;
      const y = d.pnl >= 0 ? zero - h : zero;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(2, h)}" rx="4" fill="${d.pnl >= 0 ? '#22c55e' : '#ef4444'}" opacity="0.85"/>
        <text x="${x + bw / 2}" y="${d.pnl >= 0 ? y - 6 : y + h + 14}" fill="#8ba0bd" font-size="12" text-anchor="middle">$${d.pnl.toFixed(0)}</text>
        <text x="${x + bw / 2}" y="${H - 34}" fill="#8ba0bd" font-size="11" text-anchor="middle">${esc(d.k.slice(0, 14))}</text>`;
    }).join('');
  }

  /* ---------------- order ticket ---------------- */
  function initTicket() {
    const sel = $('#ordTicker');
    (async () => {
      try {
        await Discovery.discover(); await Store.refresh();
        const opts = [];
        Store.events.filter((e) => e.status === 'open').forEach((e) => e.markets.forEach((m) => opts.push([m.ticker, (e.title || m.title || m.ticker), e.categoryTopic])));
        const labels = { gas: 'Gas', elections: 'Elections', culture: 'Culture', crypto: 'Crypto', golf: 'Golf', other: 'Other' };
        const groups = {};
        opts.forEach(([t, l, c]) => (groups[c] = groups[c] || []).push([t, l]));
        sel.innerHTML = Object.entries(groups).map(([g, arr]) => `<optgroup label="${esc(labels[g] || g)}">${arr.slice(0, 30).map(([t, l]) => `<option value="${esc(t)}">${esc(t)} — ${esc(l.slice(0, 60))}</option>`).join('')}</optgroup>`).join('') || '<option value="">(no open markets — API unreachable?)</option>';
        sel.addEventListener('change', () => { $('#ordCat').value = ({ gas: 'gas', elections: 'elections', culture: 'culture', crypto: 'crypto', golf: 'golf' })[sel.selectedOptions[0]?.parentElement?.label?.toLowerCase()] || 'other'; });
      } catch (e) { sel.innerHTML = `<option value="">(market list unavailable: ${esc(e.message)})</option>`; }
    })();
    $('#btnOrder').addEventListener('click', () => {
      const t = sel.value; if (!t) { toast('Pick a market first.'); return; }
      placeOrder({ ticker: t, side: $('#ordSide').value, type: $('#ordType').value, qty: Math.max(1, parseInt($('#ordQty').value, 10) || 1), limitCents: parseFloat($('#ordLimit').value) || null, strategy: $('#ordStrat').value, category: $('#ordCat').value });
    });
    $('#btnReset').addEventListener('click', resetSim);
    $('#btnExport').addEventListener('click', () => downloadJSON('kalshi-sim-portfolio.json', { exported: new Date().toISOString(), simulated: true, ...state }));
    $('#startCash').value = (state.startCash / 100).toFixed(0);
    $('#btnStart').addEventListener('click', () => { const v = Math.max(1, parseFloat($('#startCash').value) || 1000000); state.startCash = Math.round(v * 100); resetSim(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load(); initTicket(); render(); renderSimBars();
    setInterval(() => { refreshPositions(); }, 10000);
    setInterval(renderSimBars, 15000);
    refreshPositions();
    $('#simWarn').innerHTML = `<div class="note-box warn"><b>SIMULATED PORTFOLIO — not real Kalshi orders.</b>
      Kalshi demo order execution requires signed, authenticated requests (KALSHI-ACCESS-* headers, Ed25519/RSA private key — official docs:
      <a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests" target="_blank" rel="noopener">docs.kalshi.com → Authenticated Requests</a>).
      A static site cannot store your private key safely, so this page <i>simulates</i> fills against <i>live demo market prices</i> fetched from the public API.
      All fills, fees (official formula: 0.07 × C × P × (1−P), rounded up per docs), and balances are SIM. Real order execution needs a small server-side proxy holding demo credentials — listed on the Suggestions page as a required next step.</div>`;
  });
})();
