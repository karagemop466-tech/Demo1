/* Portfolio page — official demo-account reads (when a key exists) + paper-ledger analytics. */
(function () {
  const K = window.KALSHI, X = window.KALSHI_EXEC, C = window.KALSHI_CHART, CFG = K.CFG;
  const $ = id => document.getElementById(id);

  function banner() {
    const el = $("conn-banner"); if (!el) return;
    const st = K.state;
    if (st.transport === "direct") { el.className = "banner ok"; el.hidden = false; el.innerHTML = "<b>LIVE</b> — market-data reads OK (" + K.ago(st.lastOk) + ")"; }
    else if (st.transport === "relay") { el.className = "banner"; el.hidden = false; el.innerHTML = "<b>LIVE via flagged relay</b> — <a href='flagged.html'>UNVERIFIED-01/03</a>"; }
    else if (st.transport === "unavailable") { el.className = "banner err"; el.hidden = false; el.innerHTML = "<b>BLOCKED</b> — official API unreachable from this browser (<a href='flagged.html'>UNVERIFIED-01</a>)"; }
    else el.hidden = true;
  }
  K.onStatus(banner);

  function authNote(msg, ok) {
    const el = $("auth-note"); el.hidden = false;
    el.className = "banner " + (ok ? "ok" : "");
    el.innerHTML = msg;
  }

  async function loadAccount() {
    if (!X.hasCreds()) {
      authNote("<b>No demo API key configured</b> — every official portfolio value stays blank (never inferred). See <a href='flagged.html'>UNVERIFIED-02</a>. " +
        "Add a key on the <a href='trades.html'>Trades page → Settings</a> (stored only in this browser). Paper ledger below still works.", false);
      return;
    }
    try {
      const b = await X.authFetch("GET", "/portfolio/balance");
      $("bal").textContent = b.balance_dollars !== undefined ? "$" + b.balance_dollars : (b.balance !== undefined ? K.usdCents(b.balance) : "—");
      $("pval").textContent = b.portfolio_value !== undefined ? K.usdCents(b.portfolio_value) : "—";
      $("bal-src").innerHTML = "GET /portfolio/balance · <a href='" + CFG.sources.balance + "' target='_blank' rel='noopener'>docs</a>";
      authNote("<b>Authenticated</b> — values below come from the official demo exchange with your key (never written to the server; localStorage only).", true);
    } catch (e) {
      authNote("<b>Balance read failed:</b> " + K.esc(e.message) + " — cells stay blank. See <a href='flagged.html'>UNVERIFIED-02</a>.", false);
      return;
    }
    try {
      const p = await X.authFetch("GET", "/portfolio/positions", null, { settlement_status: "all", count_filter: "position", limit: 100 });
      const rows = p.market_positions || [];
      $("npos").textContent = rows.length;
      const tb = $("pos-table").querySelector("tbody");
      if (!rows.length) tb.innerHTML = '<tr><td colspan="8" class="empty">No positions (official response: empty list).</td></tr>';
      else tb.innerHTML = rows.map(r =>
        "<tr><td class='mono'>" + K.esc(r.ticker) + "</td>" +
        "<td class='num'>" + K.qty(r.position_fp) + "</td>" +
        "<td class='num'>" + (r.market_exposure_dollars !== undefined ? "$" + r.market_exposure_dollars : "—") + "</td>" +
        "<td class='num'>" + (r.realized_pnl_dollars !== undefined ? "$" + r.realized_pnl_dollars : "—") + "</td>" +
        "<td class='num'>" + (r.fees_paid_dollars !== undefined ? "$" + r.fees_paid_dollars : "—") + "</td>" +
        "<td class='num'>" + (r.total_traded_dollars !== undefined ? "$" + r.total_traded_dollars : "—") + "</td>" +
        "<td class='meta'>" + (r.last_updated_ts ? K.ago(new Date(r.last_updated_ts * 1000).toISOString()) : "—") + "</td>" +
        "<td class='src'><a href='" + CFG.sources.positions + "' target='_blank' rel='noopener'>docs</a></td></tr>").join("");
    } catch (e) {
      $("pos-table").querySelector("tbody").innerHTML = "<tr><td colspan='8' class='empty'>Positions read failed: " + K.esc(e.message) + "</td></tr>";
    }
    try {
      const s = await X.authFetch("GET", "/portfolio/settlements", null, { limit: 50 });
      const rows = s.settlements || s.market_settlements || [];
      $("nset").textContent = rows.length;
      const tb = $("set-table").querySelector("tbody");
      if (!rows.length) tb.innerHTML = '<tr><td colspan="3" class="empty">No settlement records in the live set (official response: empty).</td></tr>';
      else tb.innerHTML = rows.slice(0, 25).map(r =>
        "<tr><td class='mono'>" + K.esc(r.ticker || r.market_ticker || "—") + "</td>" +
        "<td class='meta'>" + K.esc(JSON.stringify(r).slice(0, 220)) + "</td>" +
        "<td class='src'><a href='" + CFG.sources.settlements + "' target='_blank' rel='noopener'>docs</a></td></tr>").join("");
    } catch (e) {
      $("set-table").querySelector("tbody").innerHTML = "<tr><td colspan='3' class='empty'>Settlements read failed: " + K.esc(e.message) + "</td></tr>";
    }
  }

  function renderPaper() {
    const trades = X.readLedger();
    const s = X.stats(trades);
    $("p-n").textContent = s.n;
    $("p-open").textContent = s.open + " open · " + s.closed + " closed/settled";
    const pnl = $("p-pnl");
    pnl.textContent = (s.pnl >= 0 ? "+$" : "-$") + Math.abs(s.pnl).toFixed(2);
    pnl.className = "kpi " + (s.pnl > 0 ? "up" : s.pnl < 0 ? "down" : "flat");
    $("p-win").textContent = s.winRate === null ? "—" : Math.round(s.winRate * 100) + "%";
    $("p-wins").textContent = s.wins + " of " + s.closed + " closed won";
    $("p-roi").textContent = s.roi === null ? "—" : (s.roi >= 0 ? "+" : "") + (s.roi * 100).toFixed(1) + "%";
    $("p-inv").textContent = "$" + s.invested.toFixed(2) + " total cost basis";

    const cats = X.byCategory(trades);
    const tb = $("cat-table").querySelector("tbody");
    if (!cats.length) tb.innerHTML = '<tr><td colspan="7" class="empty">No paper trades yet — execute on the <a href="trades.html">Trades</a> page.</td></tr>';
    else tb.innerHTML = cats.map(c =>
      "<tr><td>" + K.esc(c.category) + "</td><td class='num'>" + c.n + "</td><td class='num'>" + c.closed + "</td>" +
      "<td class='num'>" + c.wins + "</td><td class='num'>" + (c.winRate === null ? "—" : Math.round(c.winRate * 100) + "%") + "</td>" +
      "<td class='num'>" + (c.pnl >= 0 ? "+$" : "-$") + Math.abs(c.pnl).toFixed(2) + "</td>" +
      "<td class='src'>ledger · <a href='" + CFG.sources.markets + "' target='_blank' rel='noopener'>price source</a></td></tr>").join("");
    C.barsH($("cat-chart"), cats.map(c => ({ label: c.category, v: c.pnl })));

    const strats = X.byStrategy(trades);
    const stb = $("strat-table").querySelector("tbody");
    if (!strats.length) stb.innerHTML = '<tr><td colspan="6" class="empty">Tag trades with strategies on the Trades page; this table aggregates them.</td></tr>';
    else stb.innerHTML = strats.map(r =>
      "<tr><td>" + K.esc(r.strategy) + "</td><td class='num'>" + r.n + "</td><td class='num'>" + r.closed + "</td>" +
      "<td class='num'>" + r.wins + "</td><td class='num'>" + (r.winRate === null ? "—" : Math.round(r.winRate * 100) + "%") + "</td>" +
      "<td class='num'>" + (r.pnl >= 0 ? "+$" : "-$") + Math.abs(r.pnl).toFixed(2) + "</td></tr>").join("");
  }

  async function init() {
    banner(); renderPaper();
    await loadAccount();
    setInterval(banner, 5000);
    setInterval(renderPaper, 10000);
    window.addEventListener("storage", renderPaper);
  }
  init();
})();
