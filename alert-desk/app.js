/*
 * alert-desk/app.js — two scrolling chat feeds of Kalshi DEMO contract-price swings >= $0.10.
 *
 * Chat 1 (ALL EVENTS): every captured move >= $0.10 in either direction —
 *   (a) historical: committed engine/jumps.json (official candlestick / book-mid captures), and
 *   (b) live: the browser polls the official public trades tape
 *       GET https://external-api.demo.kalshi.co/trade-api/v2/markets/trades (documented:
 *       https://docs.kalshi.com/api-reference/market/get-trades) and compares each new trade
 *       with the market's previously observed trade price.
 *
 * Chat 2 (MODEL PICKS · HIGH ROI): the same swings filtered to two disclosed rules —
 *   P: the automated sim-desk model holds/held a position in the market (sim-desk/data/ledger.json);
 *   B: the fee-aware settlement-study band for the jump side shows positive expected ROI
 *      (entry = post-jump price, probability = band YES-frequency from engine/strategies.json,
 *      fee = official taker formula ceil(M x 0.07 x C x P x (1-P)), M=1 — kalshi-fee-schedule.pdf;
 *      settlement $1 per winning contract — docs.kalshi.com/getting_started/market_settlement).
 *
 * No credentials, no orders, nothing inferred: absent values render as blanks with a reason.
 * Topic tags apply this repo's published keyword rules (tools/collect_kalshi.py TOPIC_RULES).
 */
(function () {
  "use strict";

  const API = "https://external-api.demo.kalshi.co/trade-api/v2";
  const THRESHOLD = 0.10;            // brief requirement: swings >= $0.10, either direction
  const MAX_BUBBLES = 500;           // per feed
  const NEWS_BASE = "https://news.google.com/search?q=";

  const S = {
    jumps: [], buckets: [], studyMeta: null,
    ledgerTickers: new Set(), ledgerRows: {},
    boardTopics: {}, jumpTopics: {}, ledgerTopics: {},
    topic: "all", dir: "both", basis: "all",
    paused: false, held: 0,
    net: "off", pollSec: 15, timer: null, backoff: 1, errors: 0,
    lastTs: null, seenIds: new Set(), lastPrice: new Map(),
    liveCount: 0, swingCount: 0, tradesSeen: 0, lastPollUtc: null,
    generatedUtc: null,
  };

  /* ------------------------------------------------------------ helpers */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (v) => (isFinite(+v) ? "$" + (+v).toFixed(2) : "");
  const signed = (j) => (+j.to) - (+j.from);
  function utcClock(isoOrSec) {
    const d = typeof isoOrSec === "number" ? new Date(isoOrSec * 1000) : new Date(isoOrSec);
    if (isNaN(d)) return null;
    return d.toISOString().slice(11, 19) + "Z";
  }
  function relAge(isoOrSec) {
    const d = typeof isoOrSec === "number" ? new Date(isoOrSec * 1000) : new Date(isoOrSec);
    if (isNaN(d)) return "";
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return (s / 3600).toFixed(1) + "h ago";
    return (s / 86400).toFixed(1) + "d ago";
  }
  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
    return r.json();
  }
  async function tryJSON(cands) {
    for (const c of cands) { try { return { data: await getJSON(c), from: c }; } catch (e) { /* next */ } }
    return null;
  }
  function setBadge(cls, text) { const b = $("badge"); b.className = "badge " + cls; b.textContent = text; }

  /* ------------------------------------------- official fee + band math */
  // Official taker fee, round up(M x 0.07 x C x P x (1-P)) to the cent, M=1, C=1.
  // Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf (verified 2026-11-20).
  function feeFor(price) {
    const p = +price;
    if (!isFinite(p) || p <= 0 || p >= 1) return 0;
    return Math.ceil(0.07 * p * (1 - p) * 100) / 100;
  }
  function bandFor(price) {
    const p = +price;
    for (const b of S.buckets) {
      const parts = String(b.bucket).replace(/\$/g, "").split("-");
      const lo = parseFloat(parts[0]), hi = parseFloat(parts[1]);
      if (isFinite(lo) && isFinite(hi) && p >= lo && (p < hi || (hi === 1 && p <= 1))) return b;
    }
    return null;
  }
  // Expected ROI of buying the jump side at the post-jump price, settled $1/$0.
  function bandROI(side, price) {
    const b = bandFor(price);
    if (!b) return null;
    const pWin = side === "yes" ? b.yes_rate_pct / 100 : 1 - b.yes_rate_pct / 100;
    const entry = +price;
    const fee = feeFor(entry);
    const cost = entry + fee;
    if (cost <= 0) return null;
    return { roi: (pWin - cost) / cost, band: b.bucket, n: b.markets, winRate: b.yes_rate_pct, entry, fee };
  }

  /* ------------------------------------- model filter (Chat 2 rules) */
  function modelHits(ticker, direction, toPrice) {
    const hits = [];
    if (S.ledgerTickers.has(ticker)) {
      const row = S.ledgerRows[ticker] || null;
      hits.push({
        rule: "P",
        label: "P · model holds a position",
        detail: row ? row.strategy + " " + String(row.side).toUpperCase() + " @" + money(row.entry_price) : "",
        href: "../sim-desk/index.html",
      });
    }
    const side = direction === "up" ? "yes" : "no";
    const price = side === "yes" ? +toPrice : 1 - (+toPrice);
    const r = bandROI(side, price);
    if (r && r.roi > 0) {
      hits.push({
        rule: "B",
        label: "B · band edge " + r.band,
        detail: side.toUpperCase() + " ev-ROI +" + (r.roi * 100).toFixed(0) + "% (win " +
          (side === "yes" ? r.winRate : (100 - r.winRate)).toFixed(1) + "% n=" + r.n + ", fee " + money(r.fee) + ")",
        href: "../engine/index.html",
      });
    }
    return hits;
  }

  /* --------------------------------------- published topic rules port */
  // Ported verbatim in intent from tools/collect_kalshi.py TOPIC_RULES (regex + why).
  const TOPIC_RULES = [
    ["gas_prices", "Gas prices", [
      [/kxaaagas/i, "series ticker is a Kalshi AAA gas-price series"],
      [/gas\s*prices?/i, "title mentions gas prices"],
      [/gasoline/i, "title mentions gasoline"],
      [/pump\s*price/i, "title mentions pump price"],
    ]],
    ["elections", "Elections", [
      [/election/i, "title mentions election"],
      [/\bnominee\b/i, "title mentions nominee"],
      [/\bgovernorship\b/i, "title mentions governorship"],
      [/\bpresiden(t|cy|tial)\b/i, "title mentions president/presidency"],
      [/\bsenate\b/i, "title mentions senate"],
      [/\bhouse\s+of\s+representatives\b/i, "title mentions House of Representatives"],
      [/\bmayoral\b/i, "title mentions mayoral"],
      [/kxpres|kxgov|kxsenate|kxhouse|kxmayor/i, "series ticker is an election series"],
    ]],
    ["culture", "Culture", [
      [/\boscar/i, "title mentions Oscar"],
      [/\bgrammy/i, "title mentions Grammy"],
      [/\bemmy/i, "title mentions Emmy"],
      [/box\s*office/i, "title mentions box office"],
      [/rotten\s*tomatoes|\bmetacritic\b/i, "title mentions a culture review score"],
      [/\bbillboard\b/i, "title mentions Billboard"],
      [/\bspotify\b/i, "title mentions Spotify"],
      [/\bnetflix\b/i, "title mentions Netflix"],
      [/\bbest\s+(picture|album|actor|actress|director)\b/i, "title mentions a culture award category"],
      [/\bsurvivor\b|\bbig\s+brother\b|\bmet\s+gala\b/i, "title mentions a named culture event"],
      [/\bmovie\b|\bfilm\b|\balbum\b/i, "title mentions movie/film/album"],
    ]],
    ["crypto", "Crypto", [
      [/\bbitcoin\b|\bbtc\b|kxbtc/i, "title mentions Bitcoin"],
      [/\bethereum\b|\beth\b|kxeth/i, "title mentions Ethereum"],
      [/\bsolana\b/i, "title mentions Solana"],
      [/\bdogecoin\b|\bdoge\b/i, "title mentions Dogecoin"],
      [/\bxrp\b|\bripple\b/i, "title mentions XRP"],
      [/\bcrypto/i, "title mentions crypto"],
    ]],
    ["golf", "Golf", [
      [/\bgolf\b/i, "title mentions golf"],
      [/\bpga\b/i, "title mentions the PGA"],
      [/\blpga\b/i, "title mentions the LPGA"],
      [/\bmasters\b/i, "title mentions the Masters"],
      [/ryder\s*cup/i, "title mentions the Ryder Cup"],
      [/open\s*championship/i, "title mentions the Open Championship"],
      [/tour\s*championship/i, "title mentions the Tour Championship"],
      [/kxpgatour|kxpgatop20|kxdpworldtour|kxpgar/i, "series ticker is a Kalshi golf series"],
    ]],
  ];
  function classifyTopic(title, ticker) {
    const hay = String(title || "") + " " + String(ticker || "");
    for (const [key, label, pats] of TOPIC_RULES) {
      for (const [re, why] of pats) {
        if (re.test(hay)) return { key, label, why };
      }
    }
    return null;
  }
  function topicFor(jump) {
    // 1) already-known topic from the committed datasets (board / ledger / jumps)
    const known = jump.topic || S.jumpTopics[jump.market_ticker] || S.boardTopics[jump.market_ticker] || S.ledgerTopics[jump.market_ticker];
    if (known) {
      const hit = TOPIC_RULES.find(([k]) => k === known);
      return { key: known, label: hit ? hit[1] : known, why: "topic from the committed dataset" };
    }
    // 2) published keyword rules on title/ticker (never guess beyond them)
    return classifyTopic(jump.title, jump.market_ticker);
  }

  /* ------------------------------------------------------ feed filter */
  function visible(j) {
    if (S.dir !== "both" && j.direction !== S.dir) return false;
    if (S.basis !== "all") {
      const pb = String(j.price_basis || (j.live ? "traded" : "")).toLowerCase();
      const want = S.basis === "traded" ? "traded" : "book";
      if (!pb.startsWith(want)) return false;
    }
    if (S.topic !== "all") {
      if (!j._topicKey) return false;             // unclassified: only visible under "all"
      if (j._topicKey !== S.topic) return false;
    }
    return true;
  }

  /* ------------------------------------------------------- rendering */
  function bubbleHTML(j) {
    const d = signed(j);
    const dirCls = j.direction === "up" ? "up" : "down";
    const arrow = j.direction === "up" ? "▲" : "▼";
    const t = topicFor(j);
    j._topicKey = t ? t.key : null;
    const topicChip = t
      ? `<span class="b-topic t-${esc(t.key)}" title="${esc(t.why)}">${esc(t.label)}</span>`
      : `<span class="b-topic miss" title="no published topic rule matched; not guessed">topic —</span>`;
    const when = utcClock(j.time_utc) || "?";
    const vol = isFinite(+j.volume) && +j.volume > 0
      ? " · vol " + (+j.volume).toLocaleString("en-US") + " on candle"
      : ' · vol <span class="miss">—</span>';
    const basis = j.price_basis ? esc(j.price_basis) : (j.live ? "traded" : "—");
    const why = (j._hits || []).map((h) =>
      `<a class="why ${h.rule === "B" ? "pos" : ""}" href="${esc(h.href)}" target="_blank" rel="noopener" title="open the evidence">` +
      `${esc(h.label)}${h.detail ? " <small>" + esc(h.detail) + "</small>" : ""}</a>`).join("");
    const newsHref = j.news_search_url ||
      (j.title ? NEWS_BASE + encodeURIComponent('"' + j.title + '"') : null);
    return `<div class="bubble${j.live ? " live" : ""}" data-ticker="${esc(j.market_ticker)}">
      <div class="b-top">
        <span class="b-time" title="${esc(j.time_utc || "")}">${esc(when)}${j.live ? " · live tape" : ""} · ${esc(relAge(j.time_utc))}</span>
        ${topicChip}
        <span class="b-dir ${dirCls}">${arrow}</span>
        <span class="b-ticker">${esc(j.market_ticker)}</span>
      </div>
      <div class="b-title">${j.title ? esc(j.title) : '<span class="miss">title not available in the captured data — not fabricated</span>'}</div>
      <div class="b-nums"><span class="from">${money(j.from)}</span> → ${money(j.to)}
        <span class="delta ${dirCls}">(${d >= 0 ? "+" : "−"}$${Math.abs(d).toFixed(2)})</span></div>
      <div class="b-meta">${vol} · basis ${basis}${j.window ? " · window " + esc(j.window) : ""}${j.status ? " · status " + esc(j.status) : ""}</div>
      ${why ? `<div class="b-why">${why}</div>` : ""}
      <div class="b-links">
        ${j.source_url ? `<a href="${esc(j.source_url)}" target="_blank" rel="noopener" title="the exact demo-API request this bubble came from">API request ↗</a>` : ""}
        ${newsHref ? `<a href="${esc(newsHref)}" target="_blank" rel="noopener" title="a search lead — not proof of cause">news search (lead) ↗</a>` : ""}
      </div>
    </div>`;
  }

  function prependBubble(feedEl, j) {
    const wrap = document.createElement("div");
    wrap.innerHTML = bubbleHTML(j);
    const node = wrap.firstElementChild;
    feedEl.insertBefore(node, feedEl.firstChild);
    while (feedEl.children.length > MAX_BUBBLES) feedEl.removeChild(feedEl.lastChild);
    return node;
  }

  function renderHistorical() {
    const feedAll = $("chatAll"), feedModel = $("chatModel");
    feedAll.innerHTML = ""; feedModel.innerHTML = "";
    // oldest first so the final prepend leaves the newest bubble on top
    const rows = S.jumps
      .filter((j) => isFinite(+j.delta) && Math.abs(+j.delta) >= THRESHOLD - 1e-9)
      .sort((a, b) => (a.t || 0) - (b.t || 0));
    let allN = 0, modelN = 0;
    for (const j of rows) {
      j.live = false;
      j._hits = modelHits(j.market_ticker, j.direction, j.to);
      if (visible(j)) { prependBubble(feedAll, j); allN++; }
      if (j._hits.length && visible(j)) { prependBubble(feedModel, j); modelN++; }
    }
    updateCounts(allN, modelN);
  }

  function updateCounts(allN, modelN) {
    $("allCount").textContent = (allN != null ? allN : $("chatAll").children.length) + " bubbles";
    $("modelCount").textContent = (modelN != null ? modelN : $("chatModel").children.length) + " bubbles";
  }

  function updateStamp() {
    const ds = S.generatedUtc ? "dataset generated " + S.generatedUtc : "dataset ?";
    const live = S.net === "live"
      ? ` · tape ${S.tradesSeen} trades seen, ${S.swingCount} swings ≥ $0.10${S.held ? ", " + S.held + " held (paused)" : ""}` +
        (S.lastPollUtc ? ", last poll " + utcClock(S.lastPollUtc) : "")
      : S.net === "off" ? " · committed snapshot only (browser could not reach the demo API)"
      : "";
    $("stamp").textContent = ds + live;
    $("counts").textContent = "threshold ≥ $" + THRESHOLD.toFixed(2) + " either direction · feed cap " + MAX_BUBBLES;
  }

  /* ------------------------------------------------------ live tape */
  function jumpFromTrade(trade, fromPrice, reqUrl) {
    const p = parseFloat(trade.yes_price_dollars);
    const up = p > fromPrice;
    return {
      live: true,
      market_ticker: trade.ticker,
      time_utc: trade.created_time,
      from: fromPrice, to: p, delta: Math.abs(p - fromPrice),
      direction: up ? "up" : "down",
      volume: parseFloat(trade.count_fp),
      price_basis: "traded",
      source_url: reqUrl,
      title: null,                       // filled from /markets/{ticker}; never fabricated
      event_ticker: null,
      topic: null,
      status: null, window: "tape",
      news_search_url: null,
    };
  }

  async function pollTape() {
    if (S.net !== "live" || !S.pollSec) return;
    const q = "?limit=200" + (S.lastTs != null ? "&min_ts=" + S.lastTs : "");
    const reqUrl = API + "/markets/trades" + q;
    try {
      const data = await getJSON(reqUrl);
      S.errors = 0; S.backoff = 1;
      S.lastPollUtc = Date.now() / 1000;
      const trades = (data && data.trades) || [];
      S.tradesSeen += trades.length;
      // process ascending so consecutive trades chain into a price path
      const asc = trades.slice().sort((a, b) =>
        new Date(a.created_time) - new Date(b.created_time));
      for (const tr of asc) {
        if (!tr || !tr.ticker || S.seenIds.has(tr.trade_id)) continue;
        S.seenIds.add(tr.trade_id);
        if (S.seenIds.size > 4000) {
          const it = S.seenIds.values(); for (let i = 0; i < 1000; i++) S.seenIds.delete(it.next().value);
        }
        const t = new Date(tr.created_time); if (isNaN(t)) continue;
        const p = parseFloat(tr.yes_price_dollars);
        if (!isFinite(p)) continue;
        const ts = Math.floor(t.getTime() / 1000);
        if (isFinite(ts) && (S.lastTs == null || ts > S.lastTs)) S.lastTs = ts;
        const prev = S.lastPrice.has(tr.ticker) ? S.lastPrice.get(tr.ticker) : null;
        S.lastPrice.set(tr.ticker, p);
        if (S.lastPrice.size > 5000) S.lastPrice.clear();   // re-seeds next poll; seeding never emits
        if (prev == null || !isFinite(prev)) continue;
        if (Math.abs(p - prev) >= THRESHOLD - 1e-9) emitSwing(jumpFromTrade(tr, prev, reqUrl));
      }
      updateStamp();
      schedulePoll();                 // keep polling at the configured interval
    } catch (e) {
      S.errors++;
      if (S.errors >= 3) { S.net = "off"; setBadge("sim", "SNAPSHOT · tape poll failed (" + S.errors + " errors)"); }
      S.timer = setTimeout(pollTape, Math.min(120000, S.pollSec * 1000 * (S.backoff *= 2)));
    }
  }

  function emitSwing(j) {
    S.swingCount++;
    // enrich: title/topic via documented market endpoint; ledger topics without a call
    enrich(j).then(() => {
      j._hits = modelHits(j.market_ticker, j.direction, j.to);
      if (S.paused) { S.held++; updateStamp(); return; }
      renderLive(j);
    });
  }

  async function enrich(j) {
    const knownTopic = S.jumpTopics[j.market_ticker] || S.boardTopics[j.market_ticker] || S.ledgerTopics[j.market_ticker];
    if (knownTopic) j.topic = knownTopic;
    if (!j.title) {
      try {
        const m = await getJSON(API + "/markets/" + encodeURIComponent(j.market_ticker));
        const mk = (m && m.market) || {};
        if (mk.title) j.title = mk.title;
        if (mk.event_ticker) j.event_ticker = mk.event_ticker;
        if (mk.status) j.status = mk.status;
      } catch (e) { /* leave blank with reason; never fabricate */ }
    }
    if (!j.topic) {
      const t = classifyTopic(j.title, j.market_ticker);
      if (t) { j.topic = t.key; j._topicWhy = t.why; }
    }
  }

  function renderLive(j) {
    const feedAll = $("chatAll"), feedModel = $("chatModel");
    let allN = null, modelN = null;
    if (visible(j)) { prependBubble(feedAll, j); allN = $("chatAll").children.length; }
    if (j._hits.length && visible(j)) { prependBubble(feedModel, j); modelN = $("chatModel").children.length; }
    S.liveCount++;
    updateCounts(allN, modelN);
    updateStamp();
  }

  async function probeLive() {
    try {
      const st = await getJSON(API + "/exchange/status");
      S.net = "live";
      const ex = (st && st.exchange && (st.exchange.status || st.exchange)) || "?";
      setBadge("live", "LIVE · demo tape · exchange " + ex);
      schedulePoll(0);
    } catch (e) {
      S.net = "off";
      setBadge("sim", "SNAPSHOT · browser could not reach the demo API (CORS/egress)");
    }
    updateStamp();
  }
  function schedulePoll(delayMs) {
    if (S.timer) clearTimeout(S.timer);
    if (!S.pollSec) return;
    S.timer = setTimeout(pollTape, delayMs != null ? delayMs : S.pollSec * 1000);
  }

  /* ------------------------------------------------------- controls */
  function buildChips() {
    const wrap = $("topicChips");
    const chips = [["all", "All topics"]].concat(TOPIC_RULES.map(([k, label]) => [k, label]));
    wrap.innerHTML = "";
    for (const [key, label] of chips) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (key === S.topic ? " on" : "");
      b.textContent = label; b.dataset.topic = key;
      b.addEventListener("click", () => {
        S.topic = key;
        wrap.querySelectorAll(".chip").forEach((el) => el.classList.toggle("on", el.dataset.topic === key));
        renderHistorical();
      });
      wrap.appendChild(b);
    }
  }

  function wireControls() {
    $("dirSel").addEventListener("change", (e) => { S.dir = e.target.value; renderHistorical(); });
    $("basisSel").addEventListener("change", (e) => { S.basis = e.target.value; renderHistorical(); });
    $("pollSel").addEventListener("change", (e) => {
      S.pollSec = +e.target.value;
      if (!S.pollSec) { if (S.timer) clearTimeout(S.timer); S.timer = null; setBadge(S.net === "live" ? "live" : "sim", S.net === "live" ? "LIVE · polling off" : "SNAPSHOT"); }
      else if (S.net === "live") schedulePoll(0);
    });
    $("pauseBtn").addEventListener("click", () => {
      S.paused = !S.paused;
      $("pauseBtn").textContent = S.paused ? "▶ resume feed" : "⏸ pause feed";
      if (!S.paused) S.held = 0;
      updateStamp();
    });
    $("clearLiveBtn").addEventListener("click", () => {
      document.querySelectorAll(".bubble.live").forEach((el) => el.remove());
      updateCounts(null, null);
    });
  }

  /* ----------------------------------------------------------- boot */
  async function boot() {
    const [jp, st, lg] = await Promise.all([
      tryJSON(["../engine/jumps.json", "jumps.json"]),
      tryJSON(["../engine/strategies.json", "strategies.json"]),
      tryJSON(["../sim-desk/data/ledger.json", "ledger.json"]),
    ]);
    if (!jp) {
      setBadge("off", "no data files");
      $("chatAll").innerHTML = '<div class="flag"><b>engine/jumps.json could not be loaded.</b> ' +
        'Open this page from the site (https://…/Demo1/alert-desk/) — the data files sit in the neighboring desks.</div>';
      updateStamp();
      return;
    }
    S.jumps = (jp.data && jp.data.jumps) || [];
    S.generatedUtc = (jp.data && jp.data.generated_utc) || null;
    for (const j of S.jumps) if (j.market_ticker && j.topic) S.jumpTopics[j.market_ticker] = j.topic;
    if (st && st.data) {
      S.buckets = (st.data.settlement_study && st.data.settlement_study.buckets) || [];
      for (const r of (st.data.board || [])) if (r.market_ticker && r.topic) S.boardTopics[r.market_ticker] = r.topic;
    }
    if (lg && lg.data) {
      for (const p of (lg.data.positions_open || [])) {
        S.ledgerTickers.add(p.ticker); S.ledgerRows[p.ticker] = p;
        if (p.topic) S.ledgerTopics[p.ticker] = p.topic;
      }
      for (const t of (lg.data.trades_settled || [])) {
        S.ledgerTickers.add(t.ticker); S.ledgerRows[t.ticker] = t;
        if (t.topic) S.ledgerTopics[t.ticker] = t.topic;
      }
    }
    buildChips();
    wireControls();
    renderHistorical();
    updateStamp();
    probeLive();
  }

  /* --------------------------------------------------- test surface */
  window.__alertDesk = {
    S, modelHits, bandROI, feeFor, bandFor, classifyTopic, topicFor,
    emitSwing, jumpFromTrade, visible, bubbleHTML, renderHistorical, boot,
    pollTape, probeLive,
  };

  document.addEventListener("DOMContentLoaded", () => { boot(); });
})();
