/* Trade execution + API signing + paper ledger.
   Real orders: POST /portfolio/events/orders (V2) — official spec:
   https://docs.kalshi.com/api-reference/orders/create-order-v2 (S17).
   Signing: timestamp + METHOD + path (no query string), RSA-PSS/SHA-256 or Ed25519 —
   https://docs.kalshi.com/getting_started/api_keys (S18).
   No credentials are stored anywhere except this browser's localStorage (UNVERIFIED-02).
   Paper ("SIMULATED") mode fills against live official quotes and is always labeled as simulated. */
(function () {
  const K = window.KALSHI, CFG = K.CFG;
  const LS = K.LS;
  const LEDGER = "kd_paper_ledger";
  const STRATS = "kd_strategies";

  /* ---------------- credential storage ---------------- */
  function creds() {
    return { keyId: localStorage.getItem(LS.keyId) || "", priv: localStorage.getItem(LS.privKey) || "" };
  }
  function setCreds(keyId, priv) {
    if (keyId) localStorage.setItem(LS.keyId, keyId); else localStorage.removeItem(LS.keyId);
    if (priv) localStorage.setItem(LS.privKey, priv); else localStorage.removeItem(LS.privKey);
  }
  function hasCreds() { const c = creds(); return !!(c.keyId && c.priv); }

  function pemToBuf(pem) {
    const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  /* Sign one request. Returns headers or throws (never fabricates a signature).
     saltMode: 32 = digest-length PSS (default), 'max' = MAX_LENGTH PSS (retry on 401). */
  async function signedHeaders(method, path, saltMode) {
    const c = creds();
    if (!c.keyId || !c.priv) throw new Error("no API key configured (UNVERIFIED-02)");
    const ts = String(Date.now());
    const msg = ts + method.toUpperCase() + path.split("?")[0];
    const buf = pemToBuf(c.priv);
    let sig = null;
    try {
      const key = await crypto.subtle.importKey("pkcs8", buf, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
      // digest-length salt (32) by default; 'max' uses modulus-derived maximum salt
      // (modBytes − hashLen − 2), matching PSS MAX_LENGTH padding conventions.
      let saltLength = 32;
      if (saltMode === "max" && key.algorithm && key.algorithm.modulusLength) {
        saltLength = Math.max(32, key.algorithm.modulusLength / 8 - 32 - 2);
      }
      sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength }, key, new TextEncoder().encode(msg));
    } catch (e1) {
      const key = await crypto.subtle.importKey("pkcs8", buf, { name: "Ed25519" }, false, ["sign"]);
      sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(msg));
    }
    let s = ""; const bytes = new Uint8Array(sig);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return {
      "KALSHI-ACCESS-KEY": c.keyId,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": btoa(s),
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
  }

  async function authFetch(method, path, body, params, saltMode) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const headers = await signedHeaders(method, path, saltMode);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(CFG.demoRest + path + qs, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal
    });
    clearTimeout(t);
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
    // One retry with MAX_LENGTH salt on 401 (PSS salt convention varies across examples).
    if (r.status === 401 && saltMode !== "max") {
      return await authFetch(method, path, body, params, "max");
    }
    if (!r.ok) {
      const msg = (data && (data.message || data.error || data.code)) || ("HTTP " + r.status);
      const err = new Error(msg); err.status = r.status; err.body = data; throw err;
    }
    return data;
  }

  /* ---------------- paper ledger (always labeled SIMULATED) ---------------- */
  function readLedger() { try { return JSON.parse(localStorage.getItem(LEDGER) || "[]"); } catch (e) { return []; } }
  function writeLedger(list) { localStorage.setItem(LEDGER, JSON.stringify(list)); }
  function readStrats() { try { return JSON.parse(localStorage.getItem(STRATS) || "{}"); } catch (e) { return {}; } }
  function writeStrats(o) { localStorage.setItem(STRATS, JSON.stringify(o)); }

  /* Auto category: topic + price band + side. Manual strategy tags live in readStrats()[tradeId]. */
  function categorize(t) {
    const band = t.price >= 0.65 ? "favorite" : (t.price <= 0.35 ? "longshot" : "toss-up");
    return (CFG.topics[t.topic] ? CFG.topics[t.topic].label : t.topic || "other") + " · " + t.side + " · " + band;
  }

  function openPaper(o) {
    const list = readLedger();
    const id = "P" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const t = {
      id, ts: new Date().toISOString(), ticker: o.ticker, eventTitle: o.eventTitle || "",
      topic: o.topic || "", side: o.side, count: o.count, price: o.price,
      cost: +(o.count * o.price).toFixed(2), status: "open", mode: "paper",
      fillNote: o.fillNote || "", src: "SIMULATED fill at live official quote"
    };
    t.category = categorize(t);
    list.push(t); writeLedger(list); return t;
  }

  function closePaper(id, closePrice) {
    const list = readLedger(); const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    const t = list[i];
    t.status = "closed"; t.closeTs = new Date().toISOString(); t.closePrice = closePrice;
    const gross = t.side === "yes"
      ? t.count * (1 - closePrice)   // sold YES back at closePrice
      : t.count * closePrice;        // NO position value at closePrice (NO worth 1-YES)
    t.pnl = +(gross - t.cost).toFixed(2);
    list[i] = t; writeLedger(list); return t;
  }

  function settlePaper(id, result) {
    const list = readLedger(); const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    const t = list[i]; const win = (t.side === "yes" && result === "yes") || (t.side === "no" && result === "no");
    t.status = "settled"; t.closeTs = new Date().toISOString(); t.result = result;
    t.pnl = +(win ? t.count * (1 - t.price) : -t.cost).toFixed(2);
    list[i] = t; writeLedger(list); return t;
  }

  /* ---------------- real order (V2, official) ---------------- */
  async function placeRealOrder(o) {
    // side: bid = buy YES, ask = sell YES (BookSide, S17). outcome side mapped by caller.
    const body = {
      ticker: o.ticker,
      side: o.bookSide,                       // 'bid' | 'ask'
      count: o.count.toFixed(2),
      price: o.price.toFixed(4),
      time_in_force: o.tif || "good_till_canceled",
      self_trade_prevention_type: "taker_at_cross"
    };
    return await authFetch("POST", "/portfolio/events/orders", body);
  }

  /* ---------------- performance analytics ---------------- */
  function stats(trades) {
    const closed = trades.filter(t => t.status === "closed" || t.status === "settled");
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const pnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const invested = trades.filter(t => t.status === "open").reduce((s, t) => s + (t.cost || 0), 0)
      + closed.reduce((s, t) => s + (t.cost || 0), 0);
    return {
      n: trades.length, open: trades.filter(t => t.status === "open").length, closed: closed.length,
      wins, winRate: closed.length ? wins / closed.length : null,
      pnl: +pnl.toFixed(2), invested: +invested.toFixed(2),
      roi: invested > 0 ? pnl / invested : null
    };
  }
  function byCategory(trades) {
    const map = {};
    trades.forEach(t => {
      const c = t.category || categorize(t);
      if (!map[c]) map[c] = [];
      map[c].push(t);
    });
    return Object.keys(map).sort().map(k => {
      const s = stats(map[k]);
      return { category: k, n: s.n, closed: s.closed, wins: s.wins, winRate: s.winRate, pnl: s.pnl };
    });
  }
  function byStrategy(trades) {
    const strats = readStrats();
    const map = {};
    trades.forEach(t => {
      const s = strats[t.id] || "untagged";
      if (!map[s]) map[s] = [];
      map[s].push(t);
    });
    return Object.keys(map).sort().map(k => {
      const s = stats(map[k]);
      return { strategy: k, n: s.n, closed: s.closed, wins: s.wins, winRate: s.winRate, pnl: s.pnl };
    });
  }
  function setStrategy(id, name) {
    const strats = readStrats();
    if (name) strats[id] = name; else delete strats[id];
    writeStrats(strats);
  }

  window.KALSHI_EXEC = {
    creds, setCreds, hasCreds, signedHeaders, authFetch,
    readLedger, writeLedger, readStrats, categorize,
    openPaper, closePaper, settlePaper, placeRealOrder,
    stats, byCategory, byStrategy, setStrategy
  };
})();
