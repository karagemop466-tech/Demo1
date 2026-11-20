/* Suggestions page — review workflow (Accept/Reject/Defer) + implementation path picker.
   Curated items are proposals, not implementations. Auto items are computed live from
   official API responses and always display their input values. */
(function () {
  const K = window.KALSHI, CFG = K.CFG;
  const DEC = "kd_sug_decisions", PATH = "kd_sug_path";

  const $ = id => document.getElementById(id);

  const CURATED = [
    { id: "C1", title: "Resolve browser access (CORS) as the first task", effort: "low", risk: "low",
      why: "If the browser cannot call the official demo API directly, every live figure on the site depends on the flagged third-party relay (UNVERIFIED-03). Unblocking transport first makes all later analysis trustworthy.",
      inputs: "Current transport state is shown live on this page's banner; full detail on flagged.html (UNVERIFIED-01).",
      src: ["https://docs.kalshi.com/getting_started/quick_start_market_data", "flagged.html"] },
    { id: "C2", title: "Configure a demo API key to activate account analytics", effort: "low", risk: "medium",
      why: "Portfolio, fills and settlements stay blank without credentials (UNVERIFIED-02). A demo key (demo.kalshi.co, mock funds) enables official balance/position/fill reads and REAL demo orders. Risk: the private key then lives in this browser's localStorage — accept or reject that trade-off explicitly.",
      inputs: "Key state shown on trades.html → Settings.",
      src: ["https://docs.kalshi.com/getting_started/api_keys", "https://docs.kalshi.com/getting_started/demo_env"] },
    { id: "C3", title: "Fix the 'highest dollar amount' ranking definition", effort: "low", risk: "low",
      why: "The API publishes volume_fp, volume_24h_fp, open_interest_fp and notional_value_dollars but no dollar-volume field (UNVERIFIED-04). Choosing one official metric makes rankings reproducible and reviewable.",
      inputs: "All three candidate metrics are shown side-by-side in the dashboard ranking toggle.",
      src: ["https://docs.kalshi.com/api-reference/market/get-markets"] },
    { id: "C4", title: "Add resolution notifications from the watch log", effort: "medium", risk: "low",
      why: "Tracking events until resolution is a core requirement; the watch log already records yes/no outcomes (markets.html). Turning new log entries into an on-page notification removes the need to keep the tab in view.",
      inputs: "Resolution watch log length: shown on markets.html → 'Resolution watch log'.",
      src: ["https://docs.kalshi.com/getting_started/market_settlement"] },
    { id: "C5", title: "Upgrade to authenticated WebSocket streaming (after C2)", effort: "high", risk: "medium",
      why: "Official docs require a signed handshake even for public WS channels (S5), so the site polls REST today. With a key, ticker/orderbook_delta channels would cut latency and request volume versus polling.",
      inputs: "Requires C2 (key). WS endpoints: wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2.",
      src: ["https://docs.kalshi.com/getting_started/quick_start_websockets"] },
    { id: "C6", title: "Make strategy tags a first-class experiment framework", effort: "medium", risk: "low",
      why: "Trades are already auto-categorized (topic · side · price band) and can be tagged with strategies. Formalizing N named strategies with per-tag win rate/P&L on portfolio.html turns raw trades into comparable decisions.",
      inputs: "Current tag aggregates render live on portfolio.html.",
      src: ["https://docs.kalshi.com/api-reference/portfolio/get-fills"] },
    { id: "C7", title: "Add fee-aware P&L using the official fee schedule", effort: "medium", risk: "low",
      why: "Paper P&L currently excludes fees and says so. Applying the official quadratic fee schedule makes simulated results comparable to real demo fills.",
      inputs: "Fee schedule PDF linked from series fee_type/fee_multiplier fields (official).",
      src: ["https://kalshi.com/docs/kalshi-fee-schedule.pdf"] },
    { id: "C8", title: "Adaptive polling from official rate-limit budgets", effort: "medium", risk: "low",
      why: "Poll intervals are currently conservative constants. Reading /account/limits (with a key) would let the site spend its token budget on the markets the reviewer is actually watching.",
      inputs: "Requires C2. Current intervals: 15s markets, 5s book, 2s quote (config.js).",
      src: ["https://docs.kalshi.com/getting_started/rate_limits"] },
    { id: "C9", title: "Export trade log + resolution watch as CSV/JSON", effort: "low", risk: "low",
      why: "Analysis and review happen off-site too; a one-click export of the local ledger and watch log makes every number on this site auditable against the official API.",
      inputs: "Data exists in localStorage (kd_paper_ledger, kd_resolution_watch).",
      src: ["https://docs.kalshi.com/api-reference/portfolio/get-fills"] },
    { id: "C10", title: "Deepen topic coverage beyond the top-6 series", effort: "medium", risk: "low",
      why: "Each topic currently pulls open events for its six highest-volume series (by official volume_fp). Extending to every classified series increases coverage but multiplies request volume — a deliberate trade-off to accept or reject.",
      inputs: "Series counts per topic shown on markets.html.",
      src: ["https://docs.kalshi.com/api-reference/market/get-series-list"] }
  ];

  function readDec() { try { return JSON.parse(localStorage.getItem(DEC) || "{}"); } catch (e) { return {}; } }
  function writeDec(o) { localStorage.setItem(DEC, JSON.stringify(o)); }
  function readPath() { try { return JSON.parse(localStorage.getItem(PATH) || "[]"); } catch (e) { return []; } }
  function writePath(a) { localStorage.setItem(PATH, JSON.stringify(a)); }

  function srcLinks(s) {
    return s.src.map(u => u === "flagged.html"
      ? '<a href="flagged.html">flagged detail</a>'
      : '<a href="' + u + '" target="_blank" rel="noopener">' + u.replace(/^https?:\/\//, "").slice(0, 44) + "</a>").join(" · ");
  }

  function renderCard(s, dec) {
    const d = dec[s.id] || null;
    const decision = d
      ? '<div class="decision">Decision: <b class="' + d.decision + '">' + d.decision.toUpperCase() + "</b> at " + K.ago(d.at) +
        (d.note ? " — “" + K.esc(d.note) + "”" : "") + "</div>"
      : '<div class="decision meta">No decision yet.</div>';
    return '<div class="sug' + (d ? " decided" : "") + '" data-id="' + s.id + '">' +
      '<div class="body"><b>' + s.id + " · " + K.esc(s.title) + "</b>" +
      '<div class="meta" style="margin:4px 0">effort: ' + s.effort + " · risk: " + s.risk + "</div>" +
      '<div class="meta">' + K.esc(s.why) + "</div>" +
      '<div class="meta" style="margin-top:6px"><b>Inputs:</b> ' + K.esc(s.inputs) + "</div>" +
      '<div class="meta" style="margin-top:4px"><b>Sources:</b> ' + srcLinks(s) + "</div>" +
      decision + "</div>" +
      '<div class="actions">' +
      '<button class="btn sm" data-act="accept">Accept</button>' +
      '<button class="btn sub sm" data-act="defer">Defer</button>' +
      '<button class="btn sub sm" data-act="reject" style="color:#f85149">Reject</button>' +
      '<input type="text" data-note placeholder="review note" value="' + (d && d.note ? K.esc(d.note) : "") + '" style="font-size:12px">' +
      "</div></div>";
  }

  function renderCurated() {
    const dec = readDec();
    $("cur-list").innerHTML = CURATED.map(s => renderCard(s, dec)).join("");
    $("cur-list").querySelectorAll(".sug").forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => {
        const all = readDec();
        all[id] = { decision: b.dataset.act, at: new Date().toISOString(), note: (card.querySelector("[data-note]") || {}).value || "" };
        writeDec(all); renderAll();
      }));
      const note = card.querySelector("[data-note]");
      if (note) note.addEventListener("change", () => {
        const all = readDec();
        if (all[id]) { all[id].note = note.value; writeDec(all); }
      });
    });
  }

  function renderAuto() {
    const dec = readDec();
    const transport = K.state.transport || "unknown";
    const auto = [];
    auto.push({
      id: "A1", title: "Transport status: " + transport,
      why: K.state.transport === "direct"
        ? "Direct browser access to the official API is working — no relay needed; nothing to fix."
        : K.state.transport === "relay"
        ? "Direct access failed and the flagged relay is carrying traffic. Decide: accept the relay (UNVERIFIED-03) or pursue first-party CORS (C1)."
        : K.state.transport === "unavailable"
        ? "Neither direct nor relay reached the official API — no live values are shown. First decision must be C1."
        : "Still probing.",
      inputs: "transport=" + transport + (K.state.lastError ? "; lastError=" + K.state.lastError : "") + (K.state.lastOk ? "; lastOk=" + K.state.lastOk : ""),
      src: ["flagged.html"]
    });
    if (window.KALSHI_EXEC && !KALSHI_EXEC.hasCreds()) {
      auto.push({ id: "A2", title: "No demo API key configured", why: "Account analytics and REAL demo orders are disabled; official portfolio cells remain blank by policy.",
        inputs: "hasCreds=false", src: ["https://docs.kalshi.com/getting_started/api_keys"] });
    }
    // live micro-stats from a small official sample
    K.get("/markets", { status: "open", limit: 25 }).then(d => {
      const ms = d.markets || [];
      const spreads = ms.map(m => {
        const b = K.num(m.yes_bid_dollars), a = K.num(m.yes_ask_dollars);
        return (b !== null && a !== null) ? a - b : null;
      }).filter(x => x !== null);
      const wide = spreads.filter(x => x >= 0.05).length;
      const act = ms.slice().sort((a, b) => (K.num(b.volume_24h_fp) || 0) - (K.num(a.volume_24h_fp) || 0))[0];
      const extra = [];
      if (spreads.length) extra.push({
        id: "A3", title: wide + " of " + spreads.length + " sampled open markets have spread ≥ $0.05",
        why: wide > 0 ? "Wide spreads increase taker cost. Consider maker-side entries (auto-price = best bid) for those markets — then tag those trades to compare." : "Spreads in the sample are tight; taker entries are relatively cheap right now.",
        inputs: "sample=GET /markets?status=open&limit=25; wide=" + wide + "; n=" + spreads.length,
        src: ["https://docs.kalshi.com/api-reference/market/get-markets"]
      });
      if (act) extra.push({
        id: "A4", title: "Most active sampled market: " + act.ticker,
        why: "Highest 24h contract volume in the official sample — a natural candidate for the next paper trade or for seconds-scale chart observation.",
        inputs: "volume_24h_fp=" + (act.volume_24h_fp || "—") + "; last_price_dollars=" + (act.last_price_dollars || "—"),
        src: ["https://docs.kalshi.com/api-reference/market/get-markets"]
      });
      paintAuto(auto.concat(extra), dec);
    }).catch(() => paintAuto(auto, dec));
    paintAuto(auto, dec);
  }

  function paintAuto(list, dec) {
    autoCount = list.length;
    $("auto-list").innerHTML = list.map(s => renderCard(s, dec)).join("") ||
      '<div class="empty">No auto-suggestions.</div>';
    $("auto-list").querySelectorAll(".sug").forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => {
        const all = readDec();
        all[id] = { decision: b.dataset.act, at: new Date().toISOString(), note: (card.querySelector("[data-note]") || {}).value || "" };
        writeDec(all); renderAll();
      }));
    });
  }

  function renderPath() {
    const dec = readDec();
    const accepted = Object.keys(dec).filter(k => dec[k].decision === "accept");
    const all = CURATED.concat([]); // path covers curated; auto decisions inform them
    let path = readPath().filter(id => accepted.indexOf(id) !== -1);
    accepted.forEach(id => { if (path.indexOf(id) === -1) path.push(id); });
    const byId = {};
    CURATED.forEach(s => byId[s.id] = s);
    $("path-list").innerHTML = path.length
      ? path.map((id, i) => byId[id]
          ? '<div class="qcard"><div class="q">' + (i + 1) + ". [" + id + "] " + K.esc(byId[id].title) + '</div><div class="a meta">effort ' + byId[id].effort + " · risk " + byId[id].risk + '</div><div class="controls" style="margin-bottom:0"><button class="btn sub sm" data-up="' + id + '">↑</button><button class="btn sub sm" data-down="' + id + '">↓</button></div></div>'
          : '<div class="qcard"><div class="q">[' + K.esc(id) + '] (auto-suggestion accepted)</div></div>').join("")
      : '<div class="empty">No accepted suggestions yet — accept items above to build the path.</div>';
    $("path-list").querySelectorAll("button[data-up]").forEach(b => b.addEventListener("click", () => move(b.dataset.up, -1)));
    $("path-list").querySelectorAll("button[data-down]").forEach(b => b.addEventListener("click", () => move(b.dataset.down, +1)));
    function move(id, dir) {
      const i = path.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= path.length) return;
      const t = path[i]; path[i] = path[j]; path[j] = t; writePath(path); renderPath();
    }
    // stats
    const decisions = Object.values(dec);
    $("s-total").textContent = CURATED.length + listAutoCount();
    $("s-break").textContent = decisions.filter(d => d.decision === "accept").length + " accepted · " +
      decisions.filter(d => d.decision === "reject").length + " rejected · " +
      decisions.filter(d => d.decision === "defer").length + " deferred";
    const saved = readPath();
    $("s-path").textContent = saved.length ? saved.length + " step path saved" : (path.length ? path.length + " accepted (unsaved)" : "not chosen");
  }
  let autoCount = 0;
  function listAutoCount() { return autoCount ? " +" + autoCount + " auto" : " (auto below)"; }

  function renderAll() { renderCurated(); renderAuto(); renderPath(); }

  function wire() {
    $("btn-save-path").addEventListener("click", () => {
      const dec = readDec();
      const accepted = Object.keys(dec).filter(k => dec[k].decision === "accept");
      const visible = Array.from($("path-list").querySelectorAll(".qcard .q")).map(el => (el.textContent.match(/\[([A-Z0-9]+)\]/) || [])[1]).filter(Boolean);
      writePath(visible.length ? visible : accepted);
      renderPath();
      $("path-status").textContent = "Path saved at " + new Date().toLocaleString() + " (localStorage only).";
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("Reset all suggestion decisions and the chosen path?")) return;
      localStorage.removeItem(DEC); localStorage.removeItem(PATH);
      $("path-status").textContent = "Decisions reset.";
      renderAll();
    });
  }

  async function init() {
    wire(); renderAll();
    setInterval(bannerTick, 5000);
    function bannerTick() { renderAuto(); renderPath(); }
  }
  init();
})();
