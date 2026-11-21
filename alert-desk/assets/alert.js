/* alert-desk/assets/alert.js — dual scrolling chat alert feeds.
 *
 * Transport: the official demo REST API, polled from the browser.
 *   base .......... https://external-api.demo.kalshi.co/trade-api/v2
 *                    (docs.kalshi.com/getting_started/api_environments)
 *   list .......... GET /markets?status=open&limit=1000   (Get Markets; limit max 1000)
 *   resolve watch . GET /markets/{ticker}                 (Get Market)
 *   backoff ....... on 429 / network failure, exponential to 300 s
 *                    (docs.kalshi.com/getting_started/rate_limits: back off on 429)
 * WebSocket is deliberately NOT used: the documented handshake requires signed
 * API-key headers even for public channels (quick_start_websockets), and no
 * credentials exist in this repo.
 *
 * Alert rule (the brief): |price change| >= $0.10 in either direction.
 * Two bases, each labelled on the message:
 *   day   previous_price_dollars -> last_price_dollars (official fields; the
 *         docs describe previous_price as the last traded price a day ago)
 *   live  two consecutive observations of the same series by this page
 *         (last traded price; quote mid only when no trade exists)
 *
 * High-ROI model: R1 swing + at least 3 of R2..R5 — thresholds are design
 * choices published in index.html and scored only from official GET /markets
 * fields. Not financial advice; demo data only.
 *
 * Every message carries the exact request URL that produced it, the official
 * venue event page, and a news *search* lead (never asserted as cause — the
 * API has no causal field, repo flag F-17).
 *
 * Offline path: alert-desk/data/seed.json (built by tools/build_seed.py from
 * the committed snapshot) renders the same feeds with snapshot chips.
 */
(function () {
  "use strict";

  var API = "https://external-api.demo.kalshi.co/trade-api/v2";
  var DOCS = {
    markets: "https://docs.kalshi.com/api-reference/market/get-markets",
    market: "https://docs.kalshi.com/api-reference/market/get-market",
    lifecycle: "https://docs.kalshi.com/getting_started/market_lifecycle",
    demo: "https://docs.kalshi.com/getting_started/demo_env",
    environments: "https://docs.kalshi.com/getting_started/api_environments",
    ws: "https://docs.kalshi.com/getting_started/quick_start_websockets",
    rate: "https://docs.kalshi.com/getting_started/rate_limits",
  };
  var THRESHOLD = 0.10;
  var POLL_MS = 15000;
  var BACKOFF_MAX_MS = 300000;
  var MAX_MSGS = 250;        // per feed, oldest dropped
  var MAX_RESOLVE_CHECKS = 4; // single-market GETs per poll (rate-limit friendly)
  var RESOLVE_RETRY_MAX_MS = 300000; // per-market backoff; do not silently abandon unsettled markets
  var LIST_URL = API + "/markets?status=open&limit=1000";

  /* ---- topic rules: same published keyword patterns as desk/assets/core.js
   * (gas, elections, culture, crypto, golf) + the repo's published false-match
   * exclusion KXWTI (FL-05: crude-oil market whose title says "election"). ---- */
  var TOPICS = [
    { id: "gas_prices", label: "Gas", test: function (s) {
        s = s.toLowerCase();
        return s.indexOf("kxaaagas") === 0 || s.indexOf("gas price") >= 0; } },
    { id: "elections", label: "Elections", test: function (s) {
        return /kxpres|kxgov|kxsenate|kxhouse|kxmayor|election|nominee/.test(s.toLowerCase()); } },
    { id: "culture", label: "Culture", test: function (s) {
        return /kxoscar|kxrt|kxemmy|kxgrammy|kxalbum|kxboxoffice|kxspotify|kxbillboard|kxnetflix|rotten tomatoes|best picture|box office/.test(s.toLowerCase()); } },
    { id: "crypto", label: "Crypto", test: function (s) {
        return /kxbtc|kxeth|kxsol|kxxrp|kxdoge|bitcoin|ethereum|crypto/.test(s.toLowerCase()); } },
    { id: "golf", label: "Golf", test: function (s) {
        return /kxpgatour|kxlpgatour|kxgolf|pga tour|lpga|golf/.test(s.toLowerCase()); } },
  ];
  var EXCLUDED_SERIES = { KXWTI: true };

  var state = {
    messages: [],          // chronological; each: see makeSwing/makeResolution
    picked: {},            // ticker -> true once scored >= 4/5 (ROI resolutions)
    baseline: {},          // ticker -> {series:'last'|'mid', price:number}
    openPrev: {},          // ticker -> true if topic market was on the open list last poll
    pendingResolve: {},    // ticker -> {attempts, nextAt}; pending until API returns a result
    checkedOnce: {},       // ticker -> true only after an observed result
    seenKeys: {},          // message id -> true (dedupe)
    dayDone: false,        // day-move pass runs on first live poll only
    filter: "all",
    paused: false,
    mode: "snapshot",      // snapshot | live | retry
    fails: 0,
    timer: null,
    polls: 0,
    lastPollAt: null,
    lastStats: null,
    seedTs: null,
  };

  /* ---------------------------------------------------------------- utils */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function money(v, d) {
    var n = num(v);
    if (n === null) return "—";
    d = d === undefined ? 2 : d;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function hhmmss(iso) {
    if (!iso) return "—";
    var s = String(iso);
    return s.length >= 19 ? s.slice(11, 19) + "Z" : s;
  }
  function classify(m) {
    var series = String(m.series_ticker || (m.event_ticker || "").split("-")[0] || "");
    if (EXCLUDED_SERIES[series.toUpperCase()]) return null;
    var probe = [series, m.ticker, m.event_ticker, m.title].join(" ");
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].test(probe)) return TOPICS[i];
    return null;
  }
  function venueUrl(m) {
    var ev = m.event_ticker || (m.ticker || "").split("-").slice(0, 2).join("-");
    return ev ? "https://kalshi.com/events/" + encodeURIComponent(ev) : null;
  }
  function newsUrl(m) {
    return "https://news.google.com/search?q=" +
      encodeURIComponent((m.ticker || m.title || "kalshi") + " Kalshi");
  }

  /* ---------------------------------------------------------- model score */
  /* Returns {score, rules:{R2..R5:pass|fail}} — R1 is the caller's swing test. */
  function scoreModel(after, vol24h, spread, oi) {
    var r = {
      R2: vol24h !== null && vol24h >= 100,
      R3: spread !== null && spread > 0 && spread <= 0.05,
      R4: after !== null && after >= 0.05 && after <= 0.90,
      R5: oi !== null && oi >= 100,
    };
    var score = 1; // R1: swing already verified by caller
    for (var k in r) if (r[k]) score++;
    return { score: score, rules: r };
  }

  function marketFields(m) {
    var bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    var spread = (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid)
      ? Math.round((ask - bid) * 10000) / 10000 : null;
    return {
      vol24h: num(m.volume_24h_fp),
      oi: num(m.open_interest_fp),
      spread: spread,
      bid: bid, ask: ask,
      last: num(m.last_price_dollars),
      prev: num(m.previous_price_dollars),
    };
  }
  /* Price series for live tracking: last trade when recorded (>0), else quote
   * mid when both sides quoted, else none (we never invent a price). */
  function seriesOf(m, f) {
    if (f.last !== null && f.last > 0) return { series: "last", price: f.last };
    if (f.bid !== null && f.ask !== null && f.bid > 0 && f.ask > 0) {
      return { series: "mid", price: Math.round(((f.bid + f.ask) / 2) * 10000) / 10000 };
    }
    return null;
  }

  /* ------------------------------------------------------ message builders */
  function makeSwing(o) {
    var m = { kind: "swing", ticker: o.ticker, event_ticker: o.event_ticker,
      title: o.title, topic: o.topic, topicLabel: o.topicLabel,
      before: o.before, after: o.after,
      delta: Math.round((o.after - o.before) * 10000) / 10000,
      dir: o.after >= o.before ? "up" : "down",
      ts: o.ts, basis: o.basis, series: o.series,
      score: o.score, rules: o.rules,
      src: o.src, venue: o.venue, news: o.news,
      source: o.source };
    m.id = "s|" + m.ticker + "|" + m.basis + "|" + m.before.toFixed(4) + "|" + m.after.toFixed(4);
    return m;
  }
  function makeResolution(o) {
    var m = { kind: "resolution", ticker: o.ticker, event_ticker: o.event_ticker,
      title: o.title, topic: o.topic, topicLabel: o.topicLabel,
      result: o.result, settlement_value: o.settlement_value,
      ts: o.ts, src: o.src, venue: o.venue, news: o.news, source: o.source };
    m.id = "r|" + m.ticker + "|" + (m.ts || "");
    return m;
  }

  function passesFilter(msg) {
    return state.filter === "all" || msg.topic === state.filter;
  }
  function inRoi(msg) {
    if (msg.kind === "swing") return msg.score >= 4;
    return !!state.picked[msg.ticker]; // resolutions only for markets the model picked
  }

  function addMessage(msg, animate) {
    if (state.seenKeys[msg.id]) return false;
    state.seenKeys[msg.id] = true;
    if (msg.kind === "swing" && msg.score >= 4) state.picked[msg.ticker] = true;
    state.messages.push(msg);
    // cap history (oldest first)
    while (state.messages.length > MAX_MSGS * 2) {
      var drop = state.messages.shift();
      delete state.seenKeys[drop.id];
      if (drop.kind === "swing" && !state.picked[drop.ticker]) { /* picked is sticky on purpose */ }
    }
    appendNode(msg, animate !== false);
    trimFeed($("allFeed"));
    trimFeed($("roiFeed"));
    updateCounts();
    renderTape();
    return true;
  }

  function msgNode(msg, animate) {
    var el = document.createElement("div");
    el.className = "msg" + (msg.kind === "resolution" ? " resolution" :
      (msg.score >= 4 ? " roi-pick" : ""));
    el.setAttribute("data-id", msg.id);
    el.setAttribute("data-kind", msg.kind);
    el.setAttribute("data-topic", msg.topic || "");
    if (msg.kind === "swing") el.setAttribute("data-score", String(msg.score));
    if (!animate) el.style.animation = "none";

    var topicCls = "msg-topic " + (msg.topic || "");
    var head = '<div class="msg-head">' +
      '<span class="msg-time" title="' + esc(msg.ts || "") + '">' + esc(hhmmss(msg.ts)) + "</span>" +
      '<span class="' + topicCls + '">' + esc(msg.topicLabel || msg.topic || "?") + "</span>" +
      (msg.source === "live" ? '<span class="chip-live">live</span>'
                             : '<span class="chip-snap">snapshot</span>') +
      "</div>";

    var body;
    if (msg.kind === "swing") {
      var arrow = msg.dir === "up" ? "▲" : "▼";
      var sign = msg.delta >= 0 ? "+" : "−";
      var basisTag = msg.basis === "day" ? "day Δ (prev→last)"
                   : msg.basis === "live" ? "live Δ (poll)" : "Δ";
      body =
        '<div class="msg-head">' +
          '<span class="msg-dir ' + msg.dir + '">' + arrow + "</span>" +
          '<span class="msg-delta ' + msg.dir + '">' + sign + money(Math.abs(msg.delta)) + "</span>" +
          '<span class="fine">' + esc(basisTag) + "</span>" +
        "</div>" +
        '<a class="msg-title" href="' + esc(msg.venue || "#") + '" target="_blank" rel="noopener">' +
          esc(msg.title || msg.ticker) + "</a>" +
        '<div class="msg-px">' + esc(msg.ticker) + " · " +
          "<b>" + money(msg.before) + "</b> → <b>" + money(msg.after) + "</b>" +
          ' · series: ' + esc(msg.series === "mid" ? "quote mid (derived)" : "last trade") +
        "</div>" +
        '<div class="msg-model" title="High-ROI model rules">' +
          '<span class="score">' + msg.score + "/5</span>" +
          ruleChip("R2 vol", msg.rules.R2) +
          ruleChip("R3 spread", msg.rules.R3) +
          ruleChip("R4 band", msg.rules.R4) +
          ruleChip("R5 OI", msg.rules.R5) +
        "</div>";
    } else {
      var rc = String(msg.result || "").toLowerCase();
      body =
        '<div class="msg-head"><span class="fine">RESOLVED</span>' +
          '<span class="msg-result ' + esc(rc) + '">' + esc(String(msg.result || "?").toUpperCase()) + "</span>" +
          (msg.settlement_value !== null && msg.settlement_value !== undefined
            ? '<span class="fine">settlement ' + money(msg.settlement_value, 4) + "</span>" : "") +
        "</div>" +
        '<a class="msg-title" href="' + esc(msg.venue || "#") + '" target="_blank" rel="noopener">' +
          esc(msg.title || msg.ticker) + "</a>" +
        '<div class="msg-px">' + esc(msg.ticker) + " · exchange <code>result</code> field as returned</div>";
    }

    var links = '<div class="msg-links">' +
      '<a href="' + esc(msg.src) + '" target="_blank" rel="noopener" title="the exact official request that produced these numbers">API ↗</a>' +
      (msg.venue ? '<a href="' + esc(msg.venue) + '" target="_blank" rel="noopener">Event ↗</a>' : "") +
      '<a href="' + esc(msg.news) + '" target="_blank" rel="noopener" title="a search, not a verified cause">News lead ↗</a>' +
      "</div>";

    el.innerHTML = head + body + links;
    return el;
  }
  function ruleChip(label, pass) {
    return '<span class="rule ' + (pass ? "pass" : "fail") + '">' +
      esc(label) + " " + (pass ? "✓" : "✗") + "</span>";
  }

  function appendNode(msg, animate) {
    var all = $("allFeed");
    if (all && passesFilter(msg)) {
      if (all.querySelector(".feed-empty")) all.innerHTML = "";
      all.appendChild(msgNode(msg, animate));
      pinScroll(all);
    }
    if (inRoi(msg)) {
      var roi = $("roiFeed");
      if (roi) {
        if (roi.querySelector(".feed-empty")) roi.innerHTML = "";
        roi.appendChild(msgNode(msg, animate));
        pinScroll(roi);
      }
    }
  }
  function pinScroll(body) {
    try {
      var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
      if (nearBottom) body.scrollTop = body.scrollHeight;
    } catch (e) { /* jsdom has no layout; ignore */ }
  }
  function trimFeed(body) {
    if (!body) return;
    while (body.children.length > MAX_MSGS) body.removeChild(body.firstElementChild);
  }
  function emptyNode(text) {
    var d = document.createElement("div");
    d.className = "feed-empty";
    d.textContent = text;
    return d;
  }

  /* Full rebuild (filter change / clear). No entry animation. */
  function renderAll() {
    var all = $("allFeed"), roi = $("roiFeed");
    if (all) { all.innerHTML = ""; var anyAll = false; }
    if (roi) { roi.innerHTML = ""; var anyRoi = false; }
    state.messages.forEach(function (msg) {
      if (!passesFilter(msg)) return;
      if (all) { all.appendChild(msgNode(msg, false)); anyAll = true; }
      if (inRoi(msg) && roi) { roi.appendChild(msgNode(msg, false)); anyRoi = true; }
    });
    if (all && !anyAll) all.appendChild(emptyNode(
      state.filter === "all"
        ? "No alerts yet. The feed fills as swings ≥ $0.10 are observed."
        : "No alerts for this topic yet."));
    if (roi && !anyRoi) roi.appendChild(emptyNode(
      "No model picks yet (needs a swing scoring ≥ 4 of 5)."));
    if (all) pinScroll(all);
    if (roi) pinScroll(roi);
    updateCounts();
    renderTape();
  }

  function updateCounts() {
    var visible = state.messages.filter(passesFilter);
    var ac = $("allCount"), rc = $("roiCount");
    if (ac) ac.textContent = visible.length + " message" + (visible.length === 1 ? "" : "s");
    if (rc) {
      var n = visible.filter(inRoi).length;
      rc.textContent = n + " message" + (n === 1 ? "" : "s");
    }
  }

  /* ---------------------------------------------------------- swing tape */
  function renderTape() {
    var host = $("tape");
    if (!host) return;
    var swings = state.messages.filter(function (m) {
      return m.kind === "swing" && passesFilter(m);
    }).slice(-40);
    if (!swings.length) {
      host.innerHTML = '<div class="feed-empty">No swings to chart yet.</div>';
      return;
    }
    var W = 1080, H = 170, padL = 54, padR = 12, padT = 12, padB = 26;
    var maxAbs = 0.10;
    swings.forEach(function (s) { maxAbs = Math.max(maxAbs, Math.abs(s.delta)); });
    var mid = padT + (H - padT - padB) / 2;
    var usable = (H - padT - padB) / 2 - 4;
    var n = swings.length;
    var slot = (W - padL - padR) / n;
    var bw = Math.max(4, Math.min(26, slot * 0.62));

    var bars = swings.map(function (s, i) {
      var x = padL + slot * i + (slot - bw) / 2;
      var h = Math.max(2, (Math.abs(s.delta) / maxAbs) * usable);
      var y = s.delta >= 0 ? mid - h : mid;
      var color = s.delta >= 0 ? "#34d399" : "#f87171";
      var tip = s.ticker + " " + (s.delta >= 0 ? "+" : "−") +
        money(Math.abs(s.delta)) + " @ " + hhmmss(s.ts);
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + h.toFixed(1) + '" fill="' + color + '" rx="1.5">' +
        "<title>" + esc(tip) + "</title></rect>";
    }).join("");

    var upLabel = money(maxAbs), downLabel = "−" + money(maxAbs);
    var firstT = hhmmss(swings[0].ts), lastT = hhmmss(swings[n - 1].ts);
    var svg =
      '<svg class="tape-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H +
      '" role="img" aria-label="Bar chart of alert price changes over time">' +
      '<line x1="' + padL + '" y1="' + mid + '" x2="' + (W - padR) + '" y2="' + mid +
        '" stroke="#26344b" stroke-dasharray="4 4"/>' +
      '<text x="6" y="' + (mid - usable + 4) + '" fill="#93a4bd" font-size="11">' + upLabel + "</text>" +
      '<text x="6" y="' + (mid + 12) + '" fill="#93a4bd" font-size="11">$0.00</text>' +
      '<text x="6" y="' + (mid + usable + 4) + '" fill="#93a4bd" font-size="11">' + downLabel + "</text>" +
      '<text x="' + padL + '" y="' + (H - 6) + '" fill="#93a4bd" font-size="11">' + esc(firstT) + "</text>" +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" fill="#93a4bd" font-size="11" text-anchor="end">' +
        esc(lastT) + "</text>" +
      bars + "</svg>" +
      '<div class="tape-legend"><span><i style="background:#34d399"></i>price up ≥ $0.10</span>' +
      '<span><i style="background:#f87171"></i>price down ≥ $0.10</span>' +
      '<span>' + n + " alert(s) · hover a bar for ticker &amp; time</span></div>";
    host.innerHTML = svg;
  }

  /* ------------------------------------------------------------- banners */
  function setBanner(cls, html) {
    var b = $("banner");
    if (b) { b.className = "callout " + cls; b.innerHTML = html; }
  }
  function setMode(mode) {
    state.mode = mode;
    var b = $("modeBadge");
    if (!b) return;
    b.className = "badge " + (mode === "live" ? "live" : mode === "retry" ? "warn" : "info");
    b.textContent = mode === "live" ? "LIVE" : mode === "retry" ? "RETRY" : "SNAPSHOT";
  }
  function setPollInfo() {
    var el = $("pollInfo");
    if (!el) return;
    var bits = [];
    if (state.lastPollAt) bits.push("last poll " + hhmmss(state.lastPollAt));
    if (state.lastStats) bits.push(state.lastStats);
    bits.push(Object.keys(state.pendingResolve).length + " pending result checks");
    bits.push(state.paused ? "paused" : "every " + POLL_MS / 1000 + "s");
    el.textContent = bits.join(" · ");
  }

  /* --------------------------------------------------------- seed loading */
  function loadSeed() {
    return fetch("data/seed.json")
      .then(function (r) { if (!r.ok) throw new Error("seed HTTP " + r.status); return r.json(); })
      .then(function (seed) {
        state.seedTs = seed.generated_utc || null;
        var st = $("seedTs");
        if (st) st.textContent = seed.generated_utc || "unknown";
        // chronological: resolutions (older settlement times) first, then swings
        var res = (seed.resolutions || []).slice().sort(function (a, b) {
          return String(a.settlement_ts || "").localeCompare(String(b.settlement_ts || ""));
        });
        var sw = (seed.swings || []).slice().sort(function (a, b) {
          return String(a.ticker || "").localeCompare(String(b.ticker || ""));
        });
        res.forEach(function (r) {
          addMessage(makeResolution({
            ticker: r.ticker, event_ticker: r.event_ticker, title: r.title,
            topic: r.topic, topicLabel: topicLabel(r.topic),
            result: r.result, settlement_value: r.settlement_value,
            ts: r.settlement_ts, src: r.src, venue: r.venue,
            news: newsUrl({ ticker: r.ticker }), source: "snapshot",
          }), false);
        });
        sw.forEach(function (s) {
          addMessage(makeSwing({
            ticker: s.ticker, event_ticker: s.event_ticker, title: s.title,
            topic: s.topic, topicLabel: topicLabel(s.topic),
            before: s.before, after: s.after, ts: s.ts,
            basis: "day", series: "last",
            score: s.model_score, rules: s.model_rules,
            src: s.src, venue: s.venue,
            news: newsUrl({ ticker: s.ticker }), source: "snapshot",
          }), false);
        });
        renderAll();
        setBanner("warn",
          "<b>Snapshot feed loaded</b> — " + state.messages.length +
          " message(s) from the committed collection (" +
          esc(seed.generated_utc || "?") + "), each linking its official source. " +
          "Starting live polling of the official demo API…");
      })
      .catch(function (e) {
        renderAll();
        setBanner("bad",
          "<b>Snapshot feed unavailable</b> (" + esc(e.message) +
          "). The feeds stay empty rather than showing unverified numbers.");
      });
  }
  function topicLabel(id) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i].label;
    return id || "?";
  }

  /* ------------------------------------------------------------ live poll */
  function handleList(payload, opts) {
    var markets = (payload && payload.markets) || [];
    var topicNow = {}, added = 0, now = new Date().toISOString();

    markets.forEach(function (m) {
      var topic = classify(m);
      if (!topic) return;
      topicNow[m.ticker] = true;
      // A market may temporarily leave page one and return. Stop its single-market
      // watch while it is visible on the open list; re-queue on the next departure.
      delete state.pendingResolve[m.ticker];
      var f = marketFields(m);
      var ser = seriesOf(m, f);
      var base = state.baseline[m.ticker];

      /* first live poll: official day-move pass (previous -> last), deduped
       * against identical snapshot messages */
      if (!state.dayDone && f.last !== null && f.prev !== null &&
          f.last > 0 && f.prev > 0 &&
          Math.abs(f.last - f.prev) >= THRESHOLD - 1e-9) {
        var sc = scoreModel(f.last, f.vol24h, f.spread, f.oi);
        if (addMessage(makeSwing({
          ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
          topic: topic.id, topicLabel: topic.label,
          before: f.prev, after: f.last, ts: now,
          basis: "day", series: "last",
          score: sc.score, rules: sc.rules,
          src: LIST_URL, venue: venueUrl(m),
          news: newsUrl(m), source: "live",
        }), true)) added++;
      }

      if (!ser) { delete state.baseline[m.ticker]; return; }

      if (base && base.series === ser.series) {
        var d = Math.round((ser.price - base.price) * 10000) / 10000;
        if (Math.abs(d) >= THRESHOLD - 1e-9) {
          var sc2 = scoreModel(ser.price, f.vol24h, f.spread, f.oi);
          if (addMessage(makeSwing({
            ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
            topic: topic.id, topicLabel: topic.label,
            before: base.price, after: ser.price, ts: now,
            basis: "live", series: ser.series,
            score: sc2.score, rules: sc2.rules,
            src: LIST_URL, venue: venueUrl(m),
            news: newsUrl(m), source: "live",
          }), true)) added++;
        }
      }
      state.baseline[m.ticker] = ser; // baseline always advances (re-arm after alert)
    });

    state.dayDone = true;

    /* resolution watch: topic markets that vanished from the open list */
    if (opts.first !== true) {
      Object.keys(state.openPrev).forEach(function (t) {
        if (!topicNow[t] && !state.pendingResolve[t] && !state.checkedOnce[t]) {
          state.pendingResolve[t] = { attempts: 0, nextAt: 0 };
        }
      });
    }
    state.openPrev = topicNow;

    return { added: added, topicCount: Object.keys(topicNow).length, total: markets.length };
  }

  function checkResolutions() {
    var now = Date.now();
    var queue = Object.keys(state.pendingResolve).filter(function (t) {
      return state.pendingResolve[t].nextAt <= now;
    });
    if (!queue.length) return Promise.resolve(0);
    var slice = queue.slice(0, MAX_RESOLVE_CHECKS);
    var done = 0;
    /* Never declare a result from status alone. Keep failed/closed/active
     * off-page tickers pending, with bounded request frequency and fair rotation. */
    function retire(t) { delete state.pendingResolve[t]; state.checkedOnce[t] = true; }
    function retry(t) {
      var watch = state.pendingResolve[t];
      if (!watch) return;
      var attempts = watch.attempts + 1;
      delete state.pendingResolve[t]; // reinsert at end so later tickers are not starved
      state.pendingResolve[t] = {
        attempts: attempts,
        nextAt: Date.now() + Math.min(RESOLVE_RETRY_MAX_MS,
          POLL_MS * Math.pow(2, Math.min(attempts - 1, 5))),
      };
    }
    var chain = slice.reduce(function (p, ticker) {
      return p.then(function () {
        var url = API + "/markets/" + encodeURIComponent(ticker);
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        }).then(function (data) {
          var m = data && data.market;
          if (!m) { retry(ticker); return; }
          var res = String(m.result || "").toLowerCase();
          if (res === "yes" || res === "no" || res === "scalar") {
            retire(ticker);
            var topic = classify(m) || { id: "", label: "?" };
            if (addMessage(makeResolution({
              ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
              topic: topic.id, topicLabel: topic.label,
              result: m.result,
              settlement_value: num(m.settlement_value_dollars),
              ts: m.settlement_ts || nowIso(),
              src: url, venue: venueUrl(m),
              news: newsUrl(m), source: "live",
            }), true)) done++;
          } else {
            /* Closed awaiting settlement, or still active but off page one:
             * neither means YES or NO. Continue checking at a bounded rate. */
            retry(ticker);
          }
        }).catch(function () { retry(ticker); });
      });
    }, Promise.resolve());
    return chain.then(function () { return done; });
  }
  function nowIso() { return new Date().toISOString(); }

  function pollOnce() {
    if (state.paused) return Promise.resolve(null);
    return fetch(LIST_URL).then(function (r) {
      if (r.status === 429) throw new Error("429 rate limited");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      var res = handleList(data, { first: state.polls === 0 });
      state.polls++;
      state.fails = 0;
      state.lastPollAt = nowIso();
      state.lastStats = res.total + " open · " + res.topicCount + " five-topic · +" + res.added + " new";
      setMode("live");
      setPollInfo();
      setBanner("ok",
        "<b>LIVE</b> — polling <code>GET /markets?status=open&amp;limit=1000</code> on the official " +
        "demo API every " + POLL_MS / 1000 + "s (backing off on 429). " +
        esc(state.lastStats) + ". Alerts fire at <b>|Δ| ≥ $0.10</b> either direction; " +
        "markets that leave the open list are re-checked for a YES/NO result.");
      return checkResolutions().then(function (n) {
        if (n > 0) renderAll();
        setPollInfo();
        return res;
      });
    }).catch(function (e) {
      state.fails++;
      var wait = Math.min(BACKOFF_MAX_MS, POLL_MS * Math.pow(2, state.fails));
      setMode(state.fails >= 2 ? "retry" : state.mode);
      setPollInfo();
      if (state.fails >= 2) {
        setBanner("warn",
          "<b>Live API unreachable from this browser</b> (" + esc(e.message) +
          "). Keeping the snapshot feed; retrying in " + Math.round(wait / 1000) +
          "s. CORS for the published origin is recorded in <code>data/cors.json</code>; " +
          "this can also be a local-network or sandbox restriction.");
      }
      schedule(wait);
      return null;
    });
  }

  function schedule(ms) {
    if (state.timer) clearTimeout(state.timer);
    if (state.paused) return;
    state.timer = setTimeout(function () {
      pollOnce().then(function () { if (!state.paused && state.fails === 0) schedule(POLL_MS); });
    }, ms);
  }
  function start() {
    state.paused = false;
    setPollInfo();
    schedule(POLL_MS); // first live poll after one interval (seed shows immediately)
  }
  function pause() {
    state.paused = true;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    setPollInfo();
  }
  function resume() {
    if (!state.paused) return;
    state.paused = false;
    setPollInfo();
    pollOnce().then(function () { if (!state.paused && state.fails === 0) schedule(POLL_MS); });
  }

  /* ------------------------------------------------------------- controls */
  function wireControls() {
    var chips = $("topicChips");
    if (chips) {
      chips.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("button[data-topic]") : null;
        if (!b) return;
        state.filter = b.getAttribute("data-topic");
        Array.prototype.forEach.call(chips.querySelectorAll("button"), function (x) {
          x.classList.toggle("on", x === b);
        });
        renderAll();
      });
    }
    var pauseBtn = $("pauseBtn");
    if (pauseBtn) pauseBtn.addEventListener("click", function () {
      if (state.paused) { resume(); pauseBtn.textContent = "Pause polling"; }
      else { pause(); pauseBtn.textContent = "Resume polling"; }
    });
    var clearBtn = $("clearBtn");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      state.messages = [];
      state.seenKeys = {};
      renderAll();
    });
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    wireControls();
    setMode("snapshot");
    loadSeed().then(function () { start(); });
  }

  /* test hook — same bytes the browser runs */
  window.__alertdesk = {
    state: state, boot: boot, pollOnce: pollOnce, pause: pause, resume: resume,
    classify: classify, scoreModel: scoreModel, marketFields: marketFields,
    seriesOf: seriesOf, makeSwing: makeSwing, makeResolution: makeResolution,
    addMessage: addMessage, renderAll: renderAll, handleList: handleList,
    checkResolutions: checkResolutions,
    API: API, LIST_URL: LIST_URL, THRESHOLD: THRESHOLD, TOPICS: TOPICS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
