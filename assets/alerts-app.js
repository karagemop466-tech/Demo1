/*
 * Kalshi demo — alert tapes: the page logic behind alerts-live.html.
 * The root alerts.html belongs to session d973ced5 (snapshot-driven) and is not touched here.
 *
 * Auto-starts with no user input. Every ~15 s it spends three unauthenticated
 * requests on the official demo Trade API (documented at docs.kalshi.com) and appends
 * chat lines to two tapes:
 *   Tape A — every >= $0.10 swing across the five tracked topics;
 *   Tape B — only swings on markets that pass the high-ROI screen (see docs/alerts-model.html).
 * Read-only: no keys, no orders. If the API cannot be reached from this context the page
 * says so and falls back to the committed snapshot, clearly labelled.
 */
(function () {
  "use strict";
  var KA = window.KA;
  var DOC = KA.DOC, D = KA.DEFAULTS;
  var $ = function (id) { return document.getElementById(id); };
  var esc = window.KD && window.KD.esc ? window.KD.esc : function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var TOPIC_LABEL = {
    gas_prices: "Gas prices", elections: "Elections", culture: "Culture", crypto: "Crypto", golf: "Golf"
  };

  var cfg = KA.extend(D, {});
  var state = {
    env: "demo", base: DOC.demoRest,
    markets: {}, order: [], index: null,
    prevMark: {}, lastTradePrice: {}, lastAlertAt: {}, seenTradeIds: {}, resolved: {},
    lines: { all: [], picks: [] },
    trades: [], vwap: {},
    polling: null, pollMs: cfg.pollMs, paused: false, offline: false,
    requests: 0, failures: 0, lastCycle: null, lastOk: null, backoff: 0,
    topicsOn: {}, watchN: cfg.watchPerTopic, threshold: cfg.threshold,
    autoScroll: true, pending: 0, expanded: null
  };

  // ------------------------------------------------------------ query overrides
  (function readQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get("threshold")) { var t = KA.num(q.get("threshold")); if (t !== null && t > 0) state.threshold = t; }
    if (q.get("poll")) { var p = KA.num(q.get("poll")); if (p !== null && p >= 5) state.pollMs = Math.max(5000, p * 1000); }
    if (q.get("watch")) { var w = KA.num(q.get("watch")); if (w !== null && w > 0) state.watchN = Math.min(40, w); }
    if (q.get("topics")) {
      String(q.get("topics")).split(",").forEach(function (t) { if (TOPIC_LABEL[t]) state.topicsOn[t] = true; });
    }
    if (q.get("env") === "production-demo-docs") state.env = "production";
  })();
  Object.keys(TOPIC_LABEL).forEach(function (t) { if (!(t in state.topicsOn)) state.topicsOn[t] = true; });

  // ------------------------------------------------------------ tiny DOM helpers
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function link(url, label, cls) {
    if (!url) return '<span class="at-blank">no source link</span>';
    var external = /^https?:/i.test(url);
    return '<a class="' + (cls || "at-src") + '" href="' + esc(url) + '"' +
      (external ? ' target="_blank" rel="noopener"' : "") + ">" + esc(label) + " ↗</a>";
  }
  function setStatus(kind, html) {
    var b = $("at-status");
    b.className = "at-status " + (kind || "");
    b.innerHTML = html;
  }

  // ------------------------------------------------------------ seed: committed snapshot
  function seedUrl(file) { return new URL(file, document.baseURI).href; }

  function loadSnapshot() {
    return fetch(seedUrl("snapshot/markets.json"), { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("snapshot/markets.json HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var markets = j.markets || [];
        state.index = KA.buildTopicIndex(markets);
        var watch = KA.topByDollar(markets.filter(function (m) { return state.topicsOn[m.topic]; }), state.watchN);
        state.order = watch.map(function (m) { return m.market_ticker; });
        watch.forEach(function (m) { state.markets[m.market_ticker] = m; });
        $("at-seedinfo").innerHTML =
          "Watchlist seeded from <code>snapshot/markets.json</code> (collected " + esc(j.generated_utc || "?") +
          " from the official demo API) — <b>" + state.order.length + "</b> highest-" +
          "dollar open markets across " + Object.keys(TOPIC_LABEL).length + " topics. " +
          link(seedUrl("snapshot/markets.json"), "snapshot file") + " " +
          link(DOC.markets, "GET /markets docs");
        return markets;
      });
  }

  function loadOfflineTape() {
    return fetch(seedUrl("snapshot/charts.json"), { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var n = 0, generated = j.generated_utc || "?";
        (j.series || []).forEach(function (entry) {
          var market = state.markets[entry.market_ticker];
          KA.swingsFromCandles(entry, state.threshold).forEach(function (s) {
            n++;
            push({
              ts: s.ts * 1000, kind: "swing", topic: market ? market.topic : "", ticker: entry.market_ticker,
              eventTicker: market ? market.event_ticker : "", title: market ? market.title : entry.market_ticker,
              from: s.from, to: s.to, delta: s.delta, dir: s.dir, markKind: s.source,
              sourceUrl: seedUrl("snapshot/charts.json"), bookUrl: "", eventUrl: "",
              searchQuery: "", note: "from the committed snapshot (" + generated + "), 1-minute candles — historical, not live"
            });
          });
        });
        if (n) $("at-offline-note").textContent =
          "Showing " + n + " swing" + (n === 1 ? "" : "s") + " detected in the committed candle snapshot.";
        return n;
      })
      .catch(function () { return 0; });
  }

  // ------------------------------------------------------------ tape rendering
  function lineHtml(line) {
    var dir = line.dir === "up" ? "up" : line.dir === "down" ? "down" : "";
    var head = '<div class="at-line-head">' +
      '<span class="at-time">' + esc(KA.clock(line.ts)) + '</span>' +
      '<span class="at-topic t-' + esc(line.topic || "other") + '">' + esc(line.topicLabel || TOPIC_LABEL[line.topic] || "other") + '</span>' +
      '<span class="at-kind k-' + esc(line.kind) + '">' + esc(kindLabel(line)) + '</span>' +
      "</div>";
    var body = '<div class="at-line-body"><b class="at-ticker">' + esc(line.ticker) + "</b> " +
      esc(line.title || "") + "</div>";
    var price = "";
    if (line.kind === "swing") {
      price = '<div class="at-price ' + dir + '">' +
        '<span>' + esc(KA.money(line.from)) + '</span><span class="at-arrow">' + (dir === "up" ? "▲" : "▼") + "</span>" +
        "<span>" + esc(KA.money(line.to)) + "</span>" +
        '<span class="at-delta">' + (line.delta > 0 ? "+" : "") + line.delta.toFixed(2) + "</span>" +
        (line.markKind ? '<span class="at-mark">' + esc(line.markKind) + "</span>" : "") + "</div>";
    }
    if (line.kind === "resolved") {
      price = '<div class="at-resolved r-' + esc((line.result || "").toLowerCase()) + '">resolved <b>' + esc(line.result || "no result returned") + "</b></div>";
    }
    var model = "";
    if (line.model) {
      model = '<div class="at-model">' +
        '<span class="at-score">model score <b>' + (line.score === null ? "—" : line.score.toFixed(3)) + "</b></span>" +
        '<span>buy <b>' + esc(line.model.side) + "</b> @ " + esc(KA.money(line.model.entry)) +
        " · " + esc(KA.fmtCount(line.model.contracts_available)) + " contracts there" +
        " · fee " + esc(KA.money(line.model.fee)) + " → payout " + esc(KA.money(line.model.payout)) +
        " · net ROI <b>" + esc(KA.pct(line.model.roi)) + "</b></span></div>";
    }
    var srcs = '<div class="at-srcs">' +
      (line.sourceUrl ? link(line.sourceUrl, line.sourceLabel || "API request") : "") +
      (line.bookUrl ? link(line.bookUrl, "order book") : "") +
      (line.eventUrl ? link(line.eventUrl, "event record") : "") +
      (line.venueUrl ? link(line.venueUrl, "venue site") : "") +
      (line.searchQuery ? link("https://news.google.com/search?q=" + encodeURIComponent(line.searchQuery), "news lead") : "") +
      "</div>";
    var note = line.note ? '<div class="at-note">' + esc(line.note) + "</div>" : "";
    return '<div class="at-line ' + (line.kind === "alert" ? "is-alert " : "") + dir + '" data-ticker="' + esc(line.ticker) + '">' +
      '<div class="at-avatar">' + avatar(line) + "</div>" +
      '<div class="at-msg">' + head + price + body + model + srcs + note +
      '<button class="at-expand" type="button" data-ticker="' + esc(line.ticker) + '">price chart + gates</button>' +
      '<div class="at-detail" hidden></div></div></div>';
  }
  function kindLabel(l) {
    if (l.kind === "resolved") return "RESOLUTION";
    if (l.kind === "info") return "desk";
    return (l.dir === "up" ? "SWING UP" : "SWING DOWN") + " ≥ $" + state.threshold.toFixed(2);
  }
  function avatar(l) {
    var t = l.topic || "other";
    return { gas_prices: "⛽", elections: "🗳", culture: "🎬", crypto: "₿", golf: "⛳" }[t] || "•";
  }

  function push(line) {
    line.topicLabel = TOPIC_LABEL[line.topic] || "other";
    line.id = "l" + (state.lines.all.length + 1) + "-" + line.ts;
    var full = KA.makeLine(KA.extend(line, { topicLabels: TOPIC_LABEL }));
    Object.keys(full).forEach(function (k) { line[k] = full[k]; });
    state.lines.all.push(line);
    if (state.lines.all.length > cfg.maxTapeLines) state.lines.all.shift();
    render("at-tape-all", state.lines.all, "all");
    if (line.eligiblePick) {
      state.lines.picks.push(line);
      if (state.lines.picks.length > cfg.maxTapeLines) state.lines.picks.shift();
      render("at-tape-picks", state.lines.picks, "picks");
    }
    $("at-count-all").textContent = String(state.lines.all.length);
    $("at-count-picks").textContent = String(state.lines.picks.length);
    if (line.kind === "swing") {
      $("at-alert-count").textContent = String(+$("at-alert-count").textContent + 1);
      if (!state.autoScroll) { state.pending++; renderPending(); }
      flash();
    }
  }
  function renderPending() {
    var p = $("at-newpill");
    if (state.pending > 0) { p.hidden = false; p.textContent = state.pending + " new below ↓"; }
    else p.hidden = true;
  }
  var flashTimer = null;
  function flash() {
    var f = $("at-flash");
    if (!f) return;
    f.classList.add("on");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.classList.remove("on"); }, 900);
  }

  function render(id, lines, which) {
    var box = $(id);
    if (!box) return;
    var html = lines.map(lineHtml).join("");
    if (!lines.length) {
      html = '<div class="at-empty">' + (which === "picks"
        ? "No swing has cleared the five ROI gates yet. Lines appear here the moment one does."
        : "No $0.10 swing yet. The tape fills as prices move.") + "</div>";
    }
    box.innerHTML = html;
    if (state.autoScroll) box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ live polling
  function getJson(url) {
    state.requests++;
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (r.status === 429) { state.backoff = Math.min(5, (state.backoff || 1) + 1); scheduleBackoff(); }
      if (!r.ok) { state.failures++; throw new Error("HTTP " + r.status + " from " + url.split("?")[0]); }
      state.lastOk = new Date().toISOString();
      return r.json();
    }, function (err) { state.failures++; throw err; });
  }
  function scheduleBackoff() {
    var wait = state.pollMs * Math.pow(2, state.backoff);
    setStatus("warn", "Rate-limited (429). Backing off " + Math.round(wait / 1000) + "s, as recommended by " +
      link(DOC.rateLimits, "Kalshi rate limits") + ".");
    stop(); start(wait);
  }

  function chunked(urls, run) {
    return urls.reduce(function (p, u) { return p.then(function () { return run(u); }); }, Promise.resolve());
  }

  function cycle() {
    if (state.paused || !state.order.length) return Promise.resolve();
    var tickers = state.order.filter(function (t) { return !state.resolved[t]; });
    if (!tickers.length) { setStatus("ok", "Every watched market has resolved — polling stopped. Refresh to re-arm."); stop(); return Promise.resolve(); }
    var t0 = Date.now();
    var cycleErrors = [];
    var quotes = {}, books = {}, trades = [];

    var steps = [
      function () {
        return chunked(KA.chunk(tickers, 100).map(function (list) {
          return KA.apiUrl(state.base, "/markets", { tickers: list });
        }), function (u) {
          return getJson(u).then(function (j) { (j.markets || []).forEach(function (m) { quotes[m.ticker] = m; }); });
        });
      },
      function () {
        return chunked(KA.chunk(tickers, 100).map(function (list) {
          return KA.apiUrl(state.base, "/markets/orderbooks", { tickers: list });
        }), function (u) {
          return getJson(u).then(function (j) {
            (j.orderbooks || []).forEach(function (ob) { books[ob.ticker] = KA.bookSides(ob); });
          });
        });
      },
      function () {
        return getJson(KA.apiUrl(state.base, "/markets/trades", { limit: 1000 })).then(function (j) {
          trades = j.trades || [];
        });
      }
    ];

    return steps.reduce(function (p, f) {
      return p.then(function () { return f().catch(function (e) { cycleErrors.push(String(e.message || e)); }); });
    }, Promise.resolve()).then(function () {
      ingestTrades(trades);
      tickers.forEach(function (tk) { if (quotes[tk]) handleQuote(tk, quotes[tk], books[tk]); });
      state.lastCycle = { at: new Date().toISOString(), ms: Date.now() - t0, markets: tickers.length, errors: cycleErrors };
      if (cycleErrors.length === steps.length) {
        state.offline = true;
        setStatus("bad", "Live polling unavailable from this context (" + esc(cycleErrors[0]) +
          "). The tapes above are the committed snapshot, labelled per line. " + link(DOC.environments, "endpoint docs"));
      } else if (cycleErrors.length) {
        setStatus("warn", "Partial cycle: " + esc(cycleErrors.join("; ")) + ". Continuing.");
      } else if (state.offline || state.env !== "demo") {
        state.offline = false;
        setStatus("ok", liveBanner());
      } else {
        setStatus("ok", liveBanner());
      }
      renderCounters();
      save();
    });
  }

  function liveBanner() {
    var c = state.lastCycle || {};
    return 'LIVE · ' + (c.markets || 0) + " watched markets in " + ((c.ms || 0) / 1000).toFixed(1) + "s · " +
      state.pollMs / 1000 + "s cycle · threshold $" + state.threshold.toFixed(2) +
      ' · source ' + link(state.base, "demo Trade API") + " · read-only, no orders";
  }

  function handleQuote(tk, m, book) {
    state.markets[tk] = KA.extend(state.markets[tk] || {}, {
      market_ticker: tk, ticker: tk, title: m.title, event_ticker: m.event_ticker,
      series_ticker: m.series_ticker || KA.seriesOf(tk), status: m.status, result: m.result,
      close_time: m.close_time, last_price_dollars: m.last_price_dollars,
      yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
      no_bid_dollars: m.no_bid_dollars, no_ask_dollars: m.no_ask_dollars,
      yes_ask_size_fp: m.yes_ask_size_fp, no_ask_size_fp: m.no_ask_size_fp,
      volume_24h_contracts: m.volume_24h_fp, topic: state.index ? state.index.seriesTopic[KA.seriesOf(tk)] : ""
    });
    var market = state.markets[tk];

    // Resolution tracking: keep following the market until the API returns a result.
    var res = String(m.result || "").toLowerCase();
    if ((res === "yes" || res === "no" || res === "scalar") && !state.resolved[tk]) {
      state.resolved[tk] = res;
      push({
        ts: Date.now(), kind: "resolved", topic: market.topic, ticker: tk, eventTicker: market.event_ticker,
        title: market.title, result: res.toUpperCase(), markKind: "",
        sourceUrl: KA.apiUrl(state.base, "/markets/" + encodeURIComponent(tk)),
        eventUrl: KA.apiUrl(state.base, "/events/" + encodeURIComponent(market.event_ticker || "")),
        venueUrl: DOC.demoSite,
        note: "settlement returned by the API: a winning contract pays $1.00 (" + (res === "scalar" ? "scalar settlement, not yes/no" : "yes/no determination") + ")"
      });
      return;
    }

    var mk = KA.markOf(market, book);
    if (mk.value === null) return;
    var prev = state.prevMark[tk];
    var s = KA.swing(prev, mk.value, state.threshold);
    state.prevMark[tk] = mk.value;
    if (!s) return;
    var cooldownKey = tk + "|" + s.dir;
    if (state.lastAlertAt[cooldownKey] && Date.now() - state.lastAlertAt[cooldownKey] < cfg.cooldownMs) return;
    state.lastAlertAt[cooldownKey] = Date.now();

    var screenRes = KA.screen(market, {
      book: book, vwap: state.vwap[tk], swing: s, nowSec: KA.nowSec(),
      cfg: { threshold: state.threshold, minContractsAtAsk: cfg.minContractsAtAsk, minRoi: cfg.minRoi }
    });
    push({
      ts: Date.now(), kind: "swing", topic: market.topic, ticker: tk, eventTicker: market.event_ticker,
      title: market.title, side: screenRes.side || "", from: s.from, to: s.to, delta: s.delta, dir: s.dir,
      markKind: mk.kind, sourceLabel: "GET /markets",
      sourceUrl: KA.apiUrl(state.base, "/markets/" + encodeURIComponent(tk)),
      bookUrl: book ? KA.apiUrl(state.base, "/markets/orderbooks", { tickers: [tk] }) : "",
      eventUrl: market.event_ticker ? KA.apiUrl(state.base, "/events/" + encodeURIComponent(market.event_ticker)) : "",
      searchQuery: (m.title || "").replace(/\*\*/g, ""),
      roi: screenRes.roi, score: screenRes.score, model: screenRes.eligible ? screenRes : null,
      eligiblePick: screenRes.eligible,
      note: screenRes.eligible ? "model pick — " + screenRes.reason : "screened out: " + screenRes.reason
    });
  }

  function ingestTrades(trades) {
    if (!trades || !trades.length) return;
    var byMarket = {};
    trades.forEach(function (t) {
      if (state.seenTradeIds[t.trade_id]) return;
      state.seenTradeIds[t.trade_id] = 1;
      var tk = t.ticker;
      if (!state.markets[tk] && state.index) {
        var topic = KA.topicOfTicker(state.index, tk);
        if (!topic) return;                       // outside the five tracked topics
        state.markets[tk] = { market_ticker: tk, ticker: tk, title: tk, topic: topic, status: "active" };
      }
      if (!state.markets[tk]) return;
      (byMarket[tk] = byMarket[tk] || []).push(t);
      state.trades.push({ id: t.trade_id, ts: t.created_time, ticker: tk, price: KA.num(t.yes_price_dollars), count: KA.num(t.count_fp) });
      if (state.trades.length > 4000) state.trades.splice(0, 2000);
    });
    Object.keys(byMarket).forEach(function (tk) {
      var list = byMarket[tk].sort(function (a, b) { return String(a.created_time).localeCompare(String(b.created_time)); });
      var pool = (state.vwapPool = state.vwapPool || {});
      pool[tk] = (pool[tk] || []).concat(list).slice(-200);
      var v = KA.vwap(pool[tk]);
      if (v) state.vwap[tk] = { price: Math.round(v.price * 1e4) / 1e4, contracts: v.contracts };
      list.forEach(function (t) {
        var p = KA.num(t.yes_price_dollars);
        if (p === null) return;
        var prev = state.lastTradePrice[tk];
        state.lastTradePrice[tk] = p;
        if (prev === undefined) return;
        var s = KA.swing(prev, p, state.threshold);
        if (!s) return;
        var key = tk + "|trade|" + s.dir;
        if (state.lastAlertAt[key] && Date.now() - state.lastAlertAt[key] < cfg.cooldownMs) return;
        state.lastAlertAt[key] = Date.now();
        var m = state.markets[tk];
        push({
          ts: Date.now(), kind: "swing", topic: m.topic, ticker: tk, eventTicker: m.event_ticker || "",
          title: m.title || tk, from: prev, to: p, delta: s.delta, dir: s.dir, markKind: "printed trade",
          sourceLabel: "GET /markets/trades",
          sourceUrl: KA.apiUrl(state.base, "/markets/trades", { ticker: tk, limit: 5 }),
          searchQuery: (m.title || tk).replace(/\*\*/g, ""),
          note: "public trade print — the tape crossed at this price"
        });
      });
    });
    renderCounters();
  }

  // ------------------------------------------------------------ detail: mini chart + gates
  function bindDetail() {
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest(".at-expand") : null;
      if (!btn) return;
      var holder = btn.parentNode.querySelector(".at-detail");
      if (!holder) return;
      if (!holder.hidden) { holder.hidden = true; btn.textContent = "price chart + gates"; return; }
      holder.hidden = false;
      btn.textContent = "hide";
      var tk = btn.getAttribute("data-ticker");
      holder.innerHTML = '<div class="at-note">loading 1-minute candles…</div>';
      detailFor(tk).then(function (html) { holder.innerHTML = html; }, function (e) {
        holder.innerHTML = '<div class="at-note">candles unavailable here: ' + esc(String(e.message || e)) + "</div>";
      });
    });
    ["at-tape-all", "at-tape-picks"].forEach(function (id) {
      var box = $(id);
      box.addEventListener("scroll", function () {
        var near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        state.autoScroll = near;
        if (near) { state.pending = 0; renderPending(); }
      });
    });
  }

  function detailFor(tk) {
    var m = state.markets[tk] || {};
    var series = m.series_ticker || KA.seriesOf(tk);
    var end = KA.nowSec(), start = end - 6 * 3600;
    var url = state.base + "/series/" + encodeURIComponent(series) + "/markets/" + encodeURIComponent(tk) +
      "/candlesticks?start_ts=" + start + "&end_ts=" + end + "&period_interval=1";
    return getJson(url).then(function (j) {
      var pts = (j.candlesticks || []).map(function (c) {
        return { t: c.end_period_ts, v: KA.num(c.price && c.price.close_dollars) !== null ? KA.num(c.price.close_dollars) : KA.midOf({ yes_bid_close: c.yes_bid && c.yes_bid.close_dollars, yes_ask_close: c.yes_ask && c.yes_ask.close_dollars }) };
      }).filter(function (p) { return p.v !== null && p.v !== undefined; });
      var chart = spark(pts, state.threshold);
      var market = state.markets[tk] || {};
      var scr = KA.screen(market, { book: null, vwap: state.vwap[tk], nowSec: KA.nowSec() });
      var gates = (scr.gates || []).map(function (g) {
        return '<li class="' + (g.pass ? "pass" : "no") + '"><b>' + esc(g.name) + "</b> " + (g.pass ? "PASS" : "fail") + " — " + esc(g.detail) + "</li>";
      }).join("");
      return chart +
        '<ul class="at-gates">' + gates + "</ul>" +
        '<div class="at-srcs">' + link(url, "candlestick request") + " " +
        link(DOC.candles, "candlesticks docs") + " " + link(DOC.feePdf, "fee schedule") +
        " · model spec " + link(seedUrl("docs/alerts-model.html"), "docs/alerts-model.html") + "</div>";
    });
  }

  // Minimal SVG line chart: X = time, Y = contract price in dollars.
  function spark(pts, threshold) {
    if (pts.length < 2) return '<div class="at-note">no candlestick points returned for this window</div>';
    var W = 520, H = 120, P = 6;
    var lo = Math.min.apply(null, pts.map(function (p) { return p.v; }));
    var hi = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (hi - lo < 0.02) { hi += 0.01; lo -= 0.01; }
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var xs = function (t) { return P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P); };
    var ys = function (v) { return H - P - ((v - lo) / (hi - lo)) * (H - 2 * P); };
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + xs(p.t).toFixed(1) + " " + ys(p.v).toFixed(1); }).join(" ");
    var marks = "";
    for (var i = 1; i < pts.length; i++) {
      var s = KA.swing(pts[i - 1].v, pts[i].v, threshold);
      if (s) marks += '<circle cx="' + xs(pts[i].t).toFixed(1) + '" cy="' + ys(pts[i].v).toFixed(1) +
        '" r="3.2" class="at-jump ' + s.dir + '"><title>' + KA.money(s.from) + " → " + KA.money(s.to) + " at " + KA.iso(pts[i].t) + "</title></circle>";
    }
    return '<svg class="at-spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="YES contract price over the last 6 hours, 1-minute candles">' +
      '<text x="' + P + '" y="12" class="at-ax">' + KA.money(hi, 2) + " · " + new Date(t1 * 1000).toLocaleTimeString() + "</text>" +
      '<text x="' + P + '" y="' + (H - 2) + '" class="at-ax">' + KA.money(lo, 2) + " · " + new Date(t0 * 1000).toLocaleTimeString() + "</text>" +
      '<path d="' + d + '" class="at-line-path"/>' + marks + "</svg>";
  }

  // ------------------------------------------------------------ controls
  function bindControls() {
    $("at-pause").addEventListener("click", function () {
      state.paused = !state.paused;
      $("at-pause").textContent = state.paused ? "Resume live polling" : "Pause live polling";
      if (state.paused) { stop(); } else { cycle().then(function () { start(); }); }
      setStatus(state.paused ? "warn" : "ok", state.paused ? "Paused — the tapes keep what they collected, and no request is sent." : liveBanner());
    });
    $("at-clear").addEventListener("click", function () {
      state.lines = { all: [], picks: [] };
      render("at-tape-all", [], "all"); render("at-tape-picks", [], "picks");
      $("at-count-all").textContent = "0"; $("at-count-picks").textContent = "0";
      try { localStorage.removeItem("ka-tape-v1"); } catch (e) { }
    });
    $("at-follow").addEventListener("click", function () {
      state.autoScroll = !state.autoScroll;
      $("at-follow").textContent = state.autoScroll ? "Auto-scroll: on" : "Auto-scroll: off";
      if (state.autoScroll) { state.pending = 0; renderPending(); ["at-tape-all", "at-tape-picks"].forEach(function (id) { var b = $(id); b.scrollTop = b.scrollHeight; }); }
    });
    $("at-newpill").addEventListener("click", function () {
      state.autoScroll = true; state.pending = 0; renderPending();
      ["at-tape-all", "at-tape-picks"].forEach(function (id) { var b = $(id); b.scrollTop = b.scrollHeight; });
    });
    $("at-threshold").addEventListener("change", function () {
      var v = KA.num($("at-threshold").value);
      if (v === null || v <= 0) { $("at-threshold").value = state.threshold; return; }
      state.threshold = v;
      $("at-threshold-note").textContent = "Threshold $" + v.toFixed(2) + " — the brief's default is $0.10.";
      save();
    });
    $("at-interval").addEventListener("change", function () {
      var v = KA.num($("at-interval").value);
      if (v === null || v < 5) { $("at-interval").value = Math.round(state.pollMs / 1000); return; }
      state.pollMs = v * 1000;
      stop(); start();
      $("at-interval-note").textContent = Math.round(state.pollMs / 1000) + "s between cycles; each cycle costs up to 3 requests.";
    });
    Object.keys(TOPIC_LABEL).forEach(function (t) {
      var cb = $("at-topic-" + t);
      if (!cb) return;
      cb.checked = !!state.topicsOn[t];
      cb.addEventListener("change", function () {
        state.topicsOn[t] = cb.checked;
        rebuildWatchlist();
      });
    });
    $("at-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), base: state.base, threshold: state.threshold, lines: state.lines.all }, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "kalshi-alert-tape.json"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  function rebuildWatchlist() {
    return loadSnapshot().then(function () {
      state.prevMark = {}; state.lastTradePrice = {}; state.resolved = {};
      renderCounters();
    });
  }

  function renderCounters() {
    $("at-req").textContent = String(state.requests);
    $("at-fail").textContent = String(state.failures);
    $("at-latency").textContent = state.lastCycle ? ((state.lastCycle.ms / 1000).toFixed(1) + "s") : "—";
    $("at-cycled").textContent = state.lastCycle ? KA.clock(Date.parse(state.lastCycle.at)) : "—";
    $("at-watch").textContent = String(state.order.length);
    $("at-trade").textContent = String(state.trades.length);
    $("at-vwap").textContent = String(Object.keys(state.vwap).length);
  }

  // ------------------------------------------------------------ persistence
  function save() {
    try {
      var keep = state.lines.all.slice(-80).map(function (l) {
        return { ts: l.ts, kind: l.kind, topic: l.topic, ticker: l.ticker, title: l.title, from: l.from, to: l.to, delta: l.delta, dir: l.dir, result: l.result, eligiblePick: l.eligiblePick, score: l.score, roi: l.roi, sourceUrl: l.sourceUrl, note: l.note };
      });
      localStorage.setItem("ka-tape-v1", JSON.stringify({ at: Date.now(), lines: keep, threshold: state.threshold }));
    } catch (e) { /* private mode: skip persistence */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem("ka-tape-v1");
      if (!raw) return 0;
      var j = JSON.parse(raw);
      if (!j || !j.lines || Date.now() - j.at > 6 * 3600 * 1000) return 0;
      j.lines.forEach(function (l) {
        l.restored = true;
        l.note = (l.note ? l.note + " · " : "") + "restored from this browser's tape (session storage only, not a server archive)";
        state.lines.all.push(l);
        if (l.eligiblePick) state.lines.picks.push(l);
      });
      return j.lines.length;
    } catch (e) { return 0; }
  }

  // ------------------------------------------------------------ lifecycle
  function start(ms) {
    stop();
    state.polling = setTimeout(function tick() {
      cycle().then(function () {
        state.backoff = Math.max(0, (state.backoff || 0) - 1);
        state.polling = setTimeout(tick, state.pollMs);
      });
    }, ms === undefined ? state.pollMs : ms);
  }
  function stop() { if (state.polling) { clearTimeout(state.polling); state.polling = null; } }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else if (!state.paused) { cycle().then(function () { start(); }); }
  });

  // ------------------------------------------------------------ boot
  function boot() {
    bindControls(); bindDetail();
    $("at-threshold").value = state.threshold;
    $("at-interval").value = Math.round(state.pollMs / 1000);
    $("at-threshold-note").textContent = "Threshold $" + state.threshold.toFixed(2) + " — the brief's default is $0.10.";
    $("at-interval-note").textContent = Math.round(state.pollMs / 1000) + "s between cycles; each cycle costs up to 3 requests.";
    var restored = restore();
    setStatus("info", "Loading the verified snapshot watchlist…");
    loadSnapshot().then(function () {
      if (!restored) return loadOfflineTape();
    }).then(function () {
      renderCounters();
      if (!state.order.length) { setStatus("warn", "No watchlist could be built from the snapshot."); return; }
      setStatus("info", "Watchlist ready (" + state.order.length + " markets). First live cycle starting…");
      cycle().then(function () { start(); });
    }, function (e) {
      setStatus("bad", "Could not read the committed snapshot: " + esc(String(e.message || e)) + ". Live polling needs it for topic membership.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // exposed for the headless test harness
  window.KA_APP = { state: state, cfg: cfg, cycle: cycle, push: push, handleQuote: handleQuote, ingestTrades: ingestTrades, spark: spark, lineHtml: lineHtml, TOPIC_LABEL: TOPIC_LABEL };
})();
