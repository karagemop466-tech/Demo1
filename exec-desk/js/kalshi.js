/* Kalshi Demo Dashboard — REST data layer
   Public market-data endpoints require no authentication (S4:
   https://docs.kalshi.com/getting_started/quick_start_market_data).
   Authenticated calls are handled in js/trade-exec.js with user-supplied keys (S18).
   Transport: direct fetch → (optional) flagged third-party relay (UNVERIFIED-03). */
(function () {
  const CFG = window.KALSHI_CONFIG;
  const LS = {
    relay: "kd_relay",
    keyId: "kd_key_id",
    privKey: "kd_priv_key"
  };

  const state = {
    transport: null,     // 'direct' | 'relay' | 'unavailable'
    lastError: null,
    lastOk: null,        // ISO time of last successful market-data read
    listeners: []
  };

  function settings() {
    let relay = localStorage.getItem(LS.relay);
    if (relay === null) relay = "1";
    return { allowRelay: relay === "1" };
  }
  function setSetting(k, v) { localStorage.setItem(k, v); }

  function onStatus(fn) { state.listeners.push(fn); }
  function emit() { state.listeners.forEach(fn => { try { fn(state); } catch (e) { /* noop */ } }); }

  async function tryFetch(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "Accept": "application/json" } });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { clearTimeout(t); throw e; }
  }

  /* GET against a Kalshi Trade API path (starts with /). Returns parsed JSON.
     Order: direct → relay (if allowed) → official alternate host → flagged unavailable. */
  async function get(path, params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const primary = CFG.demoRest + path + qs;
    const alt = CFG.demoRestAlt + path + qs;
    const attempts = [{ url: primary, via: "direct" }];
    if (settings().allowRelay && CFG.useRelayFallback) attempts.push({ url: CFG.relay + encodeURIComponent(primary), via: "relay" });
    attempts.push({ url: alt, via: "direct" });
    if (settings().allowRelay && CFG.useRelayFallback) attempts.push({ url: CFG.relay + encodeURIComponent(alt), via: "relay" });

    let lastErr = null;
    for (const a of attempts) {
      try {
        const data = await tryFetch(a.url);
        if (state.transport !== a.via) { state.transport = a.via; }
        state.lastError = null; state.lastOk = new Date().toISOString();
        emit();
        return data;
      } catch (e) { lastErr = e; }
    }
    state.transport = "unavailable";
    state.lastError = String(lastErr && lastErr.message || lastErr);
    emit();
    throw lastErr;
  }

  /* Follow `cursor` pagination until exhausted or maxPages (official paging: S6/S8). */
  async function getPaged(path, params, arrKey, maxPages) {
    const out = [];
    let cursor = ""; let pages = 0;
    do {
      const p = Object.assign({}, params || {});
      if (cursor) p.cursor = cursor;
      const data = await get(path, p);
      const chunk = (data && data[arrKey]) || [];
      out.push.apply(out, chunk);
      cursor = (data && data.cursor) || "";
      pages++;
    } while (cursor && pages < (maxPages || 6));
    return out;
  }

  /* ---------- formatting helpers (values are never invented: blank if absent) ---------- */
  function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  function usd(v) { const n = num(v); return n === null ? "" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function usdCents(v) { const n = num(v); return n === null ? "" : "$" + (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cents2dollar(v) { const n = num(v); return n === null ? null : n / 100; }
  function price(v) { const n = num(v); return n === null ? "" : "$" + n.toFixed(4); }
  function qty(v) { const n = num(v); return n === null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function int(v) { const n = num(v); return n === null ? "" : Math.round(n).toLocaleString("en-US"); }
  function ago(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return Math.floor(s) + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function hhmmss(tsSec) {
    const d = new Date(tsSec * 1000);
    return d.toLocaleTimeString("en-US", { hour12: false });
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* Market lifecycle status → coarse badge (official enums: S6) */
  function statusBadge(st) {
    const s = String(st || "");
    if (s === "active" || s === "initialized" || s === "inactive") return '<span class="badge open">' + esc(s) + "</span>";
    if (s === "closed") return '<span class="badge settled">' + esc(s) + "</span>";
    if (s === "determined" || s === "finalized") return '<span class="badge yes">' + esc(s) + "</span>";
    if (s === "disputed" || s === "amended") return '<span class="badge unv">' + esc(s) + "</span>";
    return '<span class="badge">' + esc(s || "—") + "</span>";
  }
  function resultMap(r) {
    if (r === "yes") return '<span class="badge yes">resolved YES</span>';
    if (r === "no") return '<span class="badge no">resolved NO</span>';
    if (r === "scalar") return '<span class="badge settled">scalar</span>';
    return '<span class="badge">pending</span>';
  }

  /* ---------- domain helpers ---------- */
  function midPrice(m) {
    const b = num(m.yes_bid_dollars), a = num(m.yes_ask_dollars);
    if (b !== null && a !== null) return (b + a) / 2;
    const l = num(m.last_price_dollars); if (l !== null) return l;
    if (b !== null) return b; if (a !== null) return a;
    return null;
  }
  /* Computed 24h dollar volume = volume_24h_fp × last_price_dollars (UNVERIFIED-04) */
  function dollarVolume24h(m) {
    const v = num(m.volume_24h_fp); const p = num(m.last_price_dollars) !== null ? num(m.last_price_dollars) : midPrice(m);
    if (v === null || p === null) return null;
    return v * p;
  }
  function openInterestDollars(m) {
    const v = num(m.open_interest_fp); const p = num(m.last_price_dollars) !== null ? num(m.last_price_dollars) : midPrice(m);
    if (v === null || p === null) return null;
    return v * p;
  }
  function topicOf(series) {
    const hay = ((series && series.title) || "") + " " + ((series && series.ticker) || "") + " " +
      ((series && series.category) || "") + " " + ((series && series.categories) || []).join(" ") + " " +
      ((series && series.tags) || []).join(" ");
    const h = hay.toLowerCase();
    for (const k in CFG.topics) {
      const t = CFG.topics[k];
      for (const w of t.kw) if (h.indexOf(w) !== -1) return k;
    }
    return null;
  }

  window.KALSHI = {
    CFG, state, settings, setSetting, LS,
    onStatus, get, getPaged,
    num, usd, usdCents, cents2dollar, price, qty, int, ago, hhmmss, esc,
    statusBadge, resultMap, midPrice, dollarVolume24h, openInterestDollars, topicOf
  };
})();
