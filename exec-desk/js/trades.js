/* Trades page — execution ticket, open positions, log, categorization & strategies.
   Paper fills: SIMULATED at live official quotes (always labeled).
   Real fills: POST /portfolio/events/orders (official V2 spec, S17).
   NO-side real orders are sent as `ask` at (1 − no_price) because a YES ask at p is
   economically a NO bid at 1−p (official orderbook equivalence, S9). */
(function () {
  const K = window.KALSHI, X = window.KALSHI_EXEC, CFG = K.CFG;
  const TOPICS = Object.keys(CFG.topics);
  const SDEFS = "kd_strategy_defs";
  const S = { topic: null, series: null, markets: [], selected: null, quote: null, timer: null };

  const $ = id => document.getElementById(id);
  const base = () => CFG.demoRest;

  function banner() {
    const el = $("conn-banner"); if (!el) return;
    const st = K.state;
    if (st.transport === "direct") { el.className = "banner ok"; el.hidden = false; el.innerHTML = "<b>LIVE</b> — official demo API · last success " + K.ago(st.lastOk); }
    else if (st.transport === "relay") { el.className = "banner"; el.hidden = false; el.innerHTML = "<b>LIVE via flagged relay</b> — <a href='flagged.html'>UNVERIFIED-01/03</a>"; }
    else if (st.transport === "unavailable") { el.className = "banner err"; el.hidden = false; el.innerHTML = "<b>BLOCKED</b> — official API unreachable (<a href='flagged.html'>UNVERIFIED-01</a>)"; }
    else el.hidden = true;
  }
  K.onStatus(banner);

  function strats() { try { return JSON.parse(localStorage.getItem(SDEFS) || "[]"); } catch (e) { return []; } }
  function saveStrats(a) { localStorage.setItem(SDEFS, JSON.stringify(a)); }

  /* ---------- market discovery (same official endpoints as dashboard) ---------- */
  async function loadSeries() {
    const all = await K.getPaged("/series", { include_volume: "true" }, "series", 3);
    const by = {}; TOPICS.forEach(t => by[t] = []);
    all.forEach(s => { const t = K.topicOf(s); if (t) by[t].push(s); });
    TOPICS.forEach(t => by[t].sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0)));
    return by;
  }
  async function loadMarkets(topic, seriesByTopic) {
    const top = (seriesByTopic[topic] || []).slice(0, 6);
    const out = [];
    for (const s of top) {
      try {
        const d = await K.get("/events", { series_ticker: s.ticker, status: "open", with_nested_markets: "true", limit: 200 });
        (d.events || []).forEach(e => (e.markets || []).forEach(m => out.push({
          m, e, seriesTicker: e.series_ticker, topic
        })));
      } catch (err) {}
    }
    out.sort((a, b) => (K.num(b.m.volume_24h_fp) || 0) - (K.num(a.m.volume_24h_fp) || 0));
    return out;
  }

  function fillMarketSelect() {
    const sel = $("ex-market");
    sel.innerHTML = S.markets.map(r =>
      '<option value="' + K.esc(r.m.ticker) + '">' + K.esc((r.e.title || "").slice(0, 70)) + " — " + K.esc(r.m.yes_sub_title || r.m.ticker) + "</option>").join("")
      || '<option value="">(no open markets found)</option>';
    onMarketChange();
  }

  async function onMarketChange() {
    const t = $("ex-market").value;
    S.selected = S.markets.find(r => r.m.ticker === t) || null;
    await pollQuote(true);
  }

  async function pollQuote(force) {
    if (!S.selected) { $("ex-quote").textContent = "—"; return; }
    try {
      const d = await K.get("/markets/" + encodeURIComponent(S.selected.m.ticker));
      const m = d.market; if (!m) return;
      S.selected.m = m;
      S.quote = m;
      const bid = K.num(m.yes_bid_dollars), ask = K.num(m.yes_ask_dollars);
      $("ex-quote").innerHTML = "YES bid <b>" + (bid !== null ? "$" + bid.toFixed(2) : "—") +
        "</b> · ask <b>" + (ask !== null ? "$" + ask.toFixed(2) : "—") + "</b> · last <b>" +
        (K.price(m.last_price_dollars) || "—") + "</b> · " + K.statusBadge(m.status) +
        " · fetched " + K.ago(K.state.lastOk);
      if ($("ex-auto").value !== "manual" || force) applyAutoPrice();
    } catch (e) {}
  }
  function applyAutoPrice() {
    if (!S.quote) return;
    const side = $("ex-side").value;
    const bid = K.num(S.quote.yes_bid_dollars), ask = K.num(S.quote.yes_ask_dollars);
    const noBid = K.num(S.quote.no_bid_dollars), noAsk = K.num(S.quote.no_ask_dollars);
    let p = null;
    if ($("ex-auto").value === "manual") return;
    if (side === "yes") p = $("ex-auto").value === "ask" ? ask : bid;
    else p = $("ex-auto").value === "ask" ? noAsk : noBid;
    if (p === null && bid !== null && ask !== null) p = (bid + ask) / 2;
    if (p !== null) $("ex-price").value = p.toFixed(2);
  }

  /* ---------- execution ---------- */
  async function execute() {
    const st = $("ex-status");
    if (!S.selected) { st.textContent = "Pick a market first."; return; }
    const side = $("ex-side").value;
    const count = Math.max(1, Math.round(Number($("ex-count").value)));
    const price = Number($("ex-price").value);
    if (!(price > 0 && price < 1)) { st.textContent = "Price must be between $0.01 and $0.99."; return; }
    const mode = $("ex-mode").value;
    const m = S.selected.m;
    const strat = $("ex-strategy").value;
    const common = {
      ticker: m.ticker, eventTitle: S.selected.e.title, topic: S.selected.topic,
      side, count, price
    };
    try {
      if (mode === "paper") {
        const bid = K.num(m.yes_bid_dollars), ask = K.num(m.yes_ask_dollars);
        const mark = side === "yes" ? (bid !== null && ask !== null ? ((bid + ask) / 2).toFixed(2) : null) : null;
        const t = X.openPaper(Object.assign({}, common, {
          fillNote: "auto:" + $("ex-auto").value + (mark ? " mid " + mark : "")
        }));
        if (strat) X.setStrategy(t.id, strat);
        st.innerHTML = "<span class='badge sim'>SIMULATED</span> filled " + count + " @" + price.toFixed(2) +
          " — ledger id " + K.esc(t.id) + " (not an exchange order).";
      } else {
        if (!X.hasCreds()) { st.innerHTML = "REAL mode needs a demo API key — see Settings / <a href='flagged.html'>UNVERIFIED-02</a>."; return; }
        // buy YES → bid @ price; buy NO → ask @ (1 − noPrice) — official equivalence S9
        const bookSide = side === "yes" ? "bid" : "ask";
        const px = side === "yes" ? price : +(1 - price).toFixed(4);
        const resp = await X.placeRealOrder({ ticker: m.ticker, bookSide, count, price: px, tif: "good_till_canceled" });
        st.innerHTML = "<span class='badge open'>REAL DEMO</span> order accepted: id <span class='mono'>" +
          K.esc(resp.order_id || "") + "</span> · filled " + K.esc(resp.fill_count || "0") +
          " · resting " + K.esc(resp.remaining_count || "0") +
          " — a 201 means accepted, not resting (official docs).";
        // mirror into local log for categorization continuity
        const t = X.openPaper(Object.assign({}, common, { fillNote: "REAL order " + (resp.order_id || "") }));
        t.mode = "real"; t.realOrderId = resp.order_id || ""; X.writeLedger(X.readLedger().map(x => x.id === t.id ? t : x));
        if (strat) X.setStrategy(t.id, strat);
      }
      renderAll();
    } catch (e) {
      st.innerHTML = "<span class='badge no'>failed</span> " + K.esc(e.message) +
        (e.status === 401 ? " — key invalid? (UNVERIFIED-02)" : "");
    }
  }

  /* ---------- open positions ---------- */
  async function renderOpen() {
    const open = X.readLedger().filter(t => t.status === "open");
    const tb = $("open-table").querySelector("tbody");
    if (!open.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">No open paper positions.</td></tr>'; return; }
    const tickers = open.map(t => t.ticker).join(",");
    let quotes = {};
    try {
      const d = await K.get("/markets", { tickers, limit: 100 });
      (d.markets || []).forEach(m => quotes[m.ticker] = m);
    } catch (e) {}
    tb.innerHTML = open.map(t => {
      const q = quotes[t.ticker] || {};
      const mid = K.midPrice(q);
      const mark = t.side === "yes" ? mid : (mid !== null ? 1 - mid : null);
      const unreal = mark !== null ? +(t.count * (mark - t.price)).toFixed(2) : null;
      const resolved = q.result === "yes" || q.result === "no";
      return "<tr><td class='meta'>" + K.ago(t.ts) + "</td>" +
        "<td class='mono'>" + K.esc(t.ticker) + "<br><span class='meta'>" + K.esc((t.eventTitle || "").slice(0, 60)) + "</span></td>" +
        "<td><span class='badge " + (t.side === "yes" ? "yes" : "no") + '">' + t.side.toUpperCase() + "</span></td>" +
        "<td class='num'>" + t.count + "</td><td class='num'>$" + t.price.toFixed(2) + "</td>" +
        "<td class='num'>$" + t.cost.toFixed(2) + "</td>" +
        "<td class='num'>" + (mark !== null ? "$" + mark.toFixed(2) : "—") + "</td>" +
        "<td class='num'>" + (unreal !== null ? (unreal >= 0 ? "+$" : "-$") + Math.abs(unreal).toFixed(2) : "—") + "</td>" +
        "<td class='meta'>" + K.esc(t.category || "") + "</td>" +
        "<td class='nowrap'>" +
          (resolved
            ? "<button class='btn sm' data-settle='" + K.esc(t.ticker) + "' data-res='" + q.result + "'>Settle " + q.result.toUpperCase() + "</button> "
            : "") +
          "<button class='btn sub sm' data-close='" + K.esc(t.id) + "' data-mark='" + (mark !== null ? mark.toFixed(4) : "") + "'>Close at mark</button>" +
        "</td></tr>";
    }).join("");
    tb.querySelectorAll("button[data-close]").forEach(b => b.addEventListener("click", () => {
      const mark = b.dataset.mark === "" ? null : Number(b.dataset.mark);
      if (mark === null) { alert("No live mark available yet — try Refresh."); return; }
      X.closePaper(b.dataset.close, mark); renderAll();
    }));
    tb.querySelectorAll("button[data-settle]").forEach(b => b.addEventListener("click", () => {
      const tkr = b.dataset.settle, res = b.dataset.res;
      X.readLedger().filter(t => t.ticker === tkr && t.status === "open").forEach(t => X.settlePaper(t.id, res));
      renderAll();
    }));
  }

  /* ---------- log ---------- */
  function renderLog() {
    const trades = X.readLedger().slice().reverse();
    const defs = strats();
    const tb = $("log-table").querySelector("tbody");
    if (!trades.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">No trades yet.</td></tr>'; return; }
    tb.innerHTML = trades.map(t => {
      const tagged = X.readStrats()[t.id] || "";
      const opts = ['<option value="">— none —</option>'].concat(defs.map(d =>
        '<option value="' + K.esc(d) + '"' + (d === tagged ? " selected" : "") + ">" + K.esc(d) + "</option>")).join("");
      const statusBadge = t.status === "open" ? '<span class="badge open">open</span>'
        : t.status === "settled" ? '<span class="badge settled">settled ' + K.esc((t.result || "").toUpperCase()) + "</span>"
        : '<span class="badge">closed</span>';
      return "<tr><td class='meta nowrap'>" + K.ago(t.ts) + "</td>" +
        "<td class='mono'>" + K.esc(t.ticker) + "</td>" +
        "<td><span class='badge " + (t.side === "yes" ? "yes" : "no") + "'>" + t.side.toUpperCase() + "</span></td>" +
        "<td class='num'>" + t.count + "</td><td class='num'>$" + t.price.toFixed(2) + "</td>" +
        "<td>" + statusBadge + "</td>" +
        "<td class='num'>" + (t.pnl === undefined ? "—" : (t.pnl >= 0 ? "+$" : "-$") + Math.abs(t.pnl).toFixed(2)) + "</td>" +
        "<td class='meta'>" + K.esc(t.category || "") + "</td>" +
        "<td><select data-tag='" + K.esc(t.id) + "'>" + opts + "</select></td>" +
        "<td>" + (t.mode === "real" ? '<span class="badge open">REAL DEMO</span>' : '<span class="badge sim">SIMULATED</span>') + "</td></tr>";
    }).join("");
    tb.querySelectorAll("select[data-tag]").forEach(s => s.addEventListener("change", () => {
      X.setStrategy(s.dataset.tag, s.value); renderLog();
    }));
  }

  function renderStrats() {
    const defs = strats();
    $("strat-list").innerHTML = defs.length
      ? defs.map(d => '<span class="badge topic">' + K.esc(d) + '</span>').join("")
      : '<span class="meta">No strategies defined yet.</span>';
    const sel = $("ex-strategy");
    const cur = sel.value;
    sel.innerHTML = '<option value="">— none —</option>' + defs.map(d =>
      '<option value="' + K.esc(d) + '"' + (d === cur ? " selected" : "") + ">" + K.esc(d) + "</option>").join("");
  }

  function renderAll() { renderOpen(); renderLog(); renderStrats(); }

  /* ---------- settings ---------- */
  function renderKeyState() {
    $("key-state").innerHTML = X.hasCreds()
      ? '<span class="badge open">key configured</span> (localStorage only)'
      : '<span class="badge unv">no key</span> — REAL mode disabled, official portfolio stays blank (UNVERIFIED-02)';
    $("key-id").value = X.creds().keyId || "";
    $("key-pem").value = X.creds().priv || "";
    $("relay-toggle").checked = K.settings().allowRelay;
    $("ex-mode").disabled = !X.hasCreds() && false;
  }

  async function init() {
    banner();
    renderKeyState();
    // topics
    $("ex-topic").innerHTML = TOPICS.map(t => '<option value="' + t + '">' + CFG.topics[t].label + "</option>").join("");
    S.topic = TOPICS[0];
    let by = {};
    try { by = await loadSeries(); } catch (e) {}
    try { S.markets = await loadMarkets(S.topic, by); } catch (e) {}
    fillMarketSelect();
    S.seriesByTopic = by;

    $("ex-topic").addEventListener("change", async e => {
      S.topic = e.target.value;
      $("ex-market").innerHTML = '<option>Loading…</option>';
      try { S.markets = await loadMarkets(S.topic, S.seriesByTopic); } catch (err) { S.markets = []; }
      fillMarketSelect();
    });
    $("ex-market").addEventListener("change", onMarketChange);
    $("ex-side").addEventListener("change", applyAutoPrice);
    $("ex-auto").addEventListener("change", applyAutoPrice);
    $("btn-execute").addEventListener("click", execute);
    $("btn-save-key").addEventListener("click", () => { X.setCreds($("key-id").value.trim(), $("key-pem").value.trim()); renderKeyState(); });
    $("btn-clear-key").addEventListener("click", () => { X.setCreds("", ""); renderKeyState(); });
    $("relay-toggle").addEventListener("change", e => K.setSetting(K.LS.relay, e.target.checked ? "1" : "0"));
    $("btn-add-strat").addEventListener("click", () => {
      const v = $("strat-name").value.trim(); if (!v) return;
      const defs = strats(); if (defs.indexOf(v) === -1) defs.push(v);
      saveStrats(defs); $("strat-name").value = ""; renderStrats(); renderLog();
    });

    renderAll();
    S.timer = setInterval(async () => { await pollQuote(false); await renderOpen(); }, 8000);
    setInterval(banner, 5000);
  }
  init();
})();
