/* trade-desk/assets/dashboard.js — controller for index.html.
 *
 * Loop, every poll:
 *   1. one page of open markets (1000, all topics, MVE excluded)
 *   2. the official trades tape since the previous poll (limit 1000)
 *   3. quotes for the markets that just jumped (one batched request)
 *   4. order books for the strongest jumps only (bounded, for the depth panel)
 *   5. jump detection, scoring, and both alert feeds
 *
 * Everything rendered is either an API value or a count of API rows. Failures
 * render as failures; the previous rows stay visible and are labelled stale.
 */
(function () {
  "use strict";
  var TD = window.TD, Api = window.Api, Engine = window.Engine, TDChart = window.TDChart;

  var state = {
    seriesMap: null,
    events: {},          /* event_ticker → event record (settlement_sources) */
    markets: [],         /* open markets in the five topics */
    byTicker: {},
    book: {},            /* ticker → orderbook response */
    lastTradesTs: 0,     /* seconds; cursor for the trades tape */
    jumps: [],           /* merged jump rows, newest first */
    alertsA: [],
    alertsB: [],
    seenA: {},
    seenB: {},
    selected: null,      /* ticker under inspection */
    samples: [],         /* chart samples {ts, price, source} */
    candleNote: null,
    pollTimer: null,
    pollCount: 0,
    lastPollAt: null,
    windowMs: 15 * 60 * 1000,
    chartWindow: "15m",
    zoomTo: null,
    statusOk: false,
    errors: [],
    paused: false
  };

  var MAX_FEED = 250;
  var MAX_JUMPS = 400;
  var BOOK_LIMIT = 12;

  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }

  /* ------------------------------------------------------------------ boot */
  TD.onReady(function () {
    Api.configure({ onEvent: function (e) {
      if (e.kind === "error" || e.kind === "retry") {
        if (state.errors.length < 20) state.errors.push(e);
      }
    } });

    loadSeriesMap().then(function () { poll(true); });

    $("poll-now").addEventListener("click", function () { poll(true); });
    $("autopoll").addEventListener("change", schedule);
    $("poll-interval").addEventListener("change", schedule);
    $("feed-a-topic").addEventListener("change", function () {
      var v = $("feed-a-topic").value;
      Array.prototype.forEach.call(document.querySelectorAll("#feed-a .msg"), function (row) {
        row.hidden = v !== "all" && row.getAttribute("data-topic") !== v;
      });
    });
    $("feed-a-pause").addEventListener("change", function (e) { e.target.setAttribute("aria-checked", e.target.checked); });
    $("feed-b-pause").addEventListener("change", function (e) { e.target.setAttribute("aria-checked", e.target.checked); });
    $("topic-filter").addEventListener("change", renderWatchTable);
    $("search").addEventListener("input", renderWatchTable);
    buildChartControls();
    window.addEventListener("resize", function () { drawChart(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "r" && (e.metaKey || e.ctrlKey)) return;
      if (e.key === "p" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { poll(true); }
    });
    schedule();
  });

  function loadSeriesMap() {
    return fetch("data/series-map.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (json && json.map) {
          state.seriesMap = json.map;
          state.seriesMeta = json;
          setText("watch-count", "0");
          var note = $("book-meta");
          if (note) note.setAttribute("data-map", "loaded " + json.total + " official series");
        }
        return json;
      })
      .catch(function () {
        state.seriesMap = null;
        var b = $("api-banner");
        if (b) {
          b.hidden = false;
          b.innerHTML = "<p><b>Series map missing.</b> Topic assignment falls back to ticker patterns and every row is marked " +
            "<i>fallback</i>. Rebuild it with <span class='mono'>node trade-desk/tools/build_series_map.mjs</span>.</p>";
        }
        return null;
      });
  }

  function schedule() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    if (!$("autopoll").checked) { setText("next-poll", "paused"); return; }
    var ms = Number($("poll-interval").value) || 8000;
    setText("next-poll", Math.round(ms / 1000) + "s");
    state.pollTimer = setTimeout(function () {
      poll(false).then(function () { schedule(); });
    }, ms);
  }

  /* ------------------------------------------------------------------ poll */
  function poll(manual) {
    if (state.polling) return Promise.resolve();
    state.polling = true;
    var started = Date.now();
    setText("api-state", "polling the official demo API…");

    return Api.status().then(function (st) {
      state.statusOk = !!(st.ok && st.data && st.data.trading_active);
      if (!st.ok) {
        state.statusOk = false;
        banner((st.unreachable ? "Cannot reach " + new URL(st.url).host + ". " : "Exchange status request failed. ") +
          st.error + " Nothing on this page is estimated; rows either come from the API or they are absent.");
      }
      return Api.markets({ limit: 1000 });
    }).then(function (res) {
      if (!res.ok) {
        banner((res.unreachable ? "Cannot reach the official demo API. " : "Open-markets request failed. ") +
          res.error + (state.markets.length
            ? " The tables below are from the previous successful poll and are not estimated."
            : " No market data has loaded yet, so the tables stay empty rather than showing guesses.") +
          ' Retrying automatically. <a href="' + TD.attr(res.url) + '" target="_blank" rel="noopener">request</a>');
        finishPoll(started, res.error);
        return null;
      }
      var raw = (res.data && res.data.markets) || [];
      state.markets = raw.map(enrich).filter(function (m) { return m.topic; });
      state.byTicker = {};
      state.markets.forEach(function (m) { state.byTicker[m.ticker] = m; });

      /* trades cursor: one second of overlap so a boundary trade is never lost */
      var nowSec = Math.floor(Date.now() / 1000);
      var since = state.lastTradesTs ? state.lastTradesTs - 1 : nowSec - 15 * 60;
      return Api.trades({ limit: 1000, min_ts: since }).then(function (tr) {
        if (!tr.ok) {
          banner("Trades request failed: " + tr.error + ". Jump detection is paused, not simulated — an empty feed here means the feed is down, not that the market is quiet.");
          finishPoll(started, tr.error);
          return null;
        }
        var trades = (tr.data && tr.data.trades) || [];
        state.lastTradesTs = nowSec;
        var newest = trades.reduce(function (mx, t) {
          var s = Math.floor(new Date(t.created_time).getTime() / 1000);
          return s > mx ? s : mx;
        }, 0);
        if (newest > state.lastTradesTs - 1) state.lastTradesTs = newest;

        var relevant = trades.filter(function (t) { return state.byTicker[t.ticker]; });
        var jumps = Engine.scanTrades(relevant, { now: Date.now(), windowMs: state.windowMs });
        mergeJumps(jumps);
        renderWatchTable();
        renderTopTable();
        renderMovers();
        runAlerts(jumps);
        finishPoll(started);
        return refreshSelected();
      });
    }).catch(function (err) {
      banner("Polling error: " + (err && err.message ? err.message : err));
      finishPoll(started);
    });
  }

  function finishPoll(started, error) {
    state.polling = false;
    state.pollCount += 1;
    state.lastPollAt = new Date();
    setText("last-poll", TD.clock(state.lastPollAt));
    setText("api-calls", String(Api.stats().calls));
    setText("api-errors", String(Api.stats().errors));
    var dot = $("dot-api");
    if (dot) dot.className = "dot " + (state.statusOk && Api.stats().consecutiveErrors === 0 ? "live" : "err");
    setText("api-state", state.statusOk
      ? "connected · trading active · " + Math.round((Date.now() - started) / 100) / 10 + "s"
      : "not connected" + (error ? " · " + error.slice(0, 70) : " · retrying"));
    setText("watch-count", String(state.markets.length));
    setText("window-label", state.windowMs / 60000 + "m");
  }

  function banner(html) {
    var b = $("api-banner");
    if (!b) return;
    b.hidden = false;
    b.innerHTML = "<p>" + TD.esc(html) + "</p>";
  }

  /* Attach official series metadata + classification to a market record. */
  function enrich(m) {
    var ev = m.event_ticker ? state.events[m.event_ticker] : null;
    var seriesTicker = ev ? ev.series_ticker : (m.series_ticker || guessSeries(m.ticker));
    var seriesRow = state.seriesMap && seriesTicker ? state.seriesMap[seriesTicker] : null;
    var hit;
    if (seriesRow) {
      hit = TD.classifyBySeries({
        ticker: seriesTicker,
        title: seriesRow[2],
        category: seriesRow[1],
        tags: seriesRow[3] ? seriesRow[3].split("|") : []
      });
    }
    var fallback = false;
    if (!hit) {
      hit = TD.classifyByTicker(m.ticker, m.title);
      fallback = !!hit;
    }
    return {
      raw: m,
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      title: m.title || m.yes_sub_title || m.ticker,
      yes_sub_title: m.yes_sub_title,
      topic: hit ? hit.id : null,
      topic_rule: hit ? hit.rule : "",
      topic_fallback: fallback,
      series_ticker: seriesTicker,
      yes_bid: TD.num(m.yes_bid_dollars),
      yes_ask: TD.num(m.yes_ask_dollars),
      last: TD.num(m.last_price_dollars),
      volume_24h: TD.num(m.volume_24h_fp),
      volume: TD.num(m.volume_fp),
      open_interest: TD.num(m.open_interest_fp),
      close_time: m.close_time,
      status: m.status,
      result: m.result
    };
  }

  /* Official GET /events/{ticker} carries series_ticker and settlement_sources.
   * Both are needed: series_ticker chooses the topic, and settlement_sources are
   * the venue's own list of sources that determine the market — the only honest
   * "why did this move" link the API itself provides. Fetched once per event and
   * cached by api.js for 10 minutes. */
  function hydrateEvents() {
    var wanted = {};
    state.markets.forEach(function (m) { if (m.event_ticker) wanted[m.event_ticker] = true; });
    Object.keys(wanted).forEach(function (ev) {
      if (state.events[ev]) return;
      state.events[ev] = null; /* mark as requested */
      Api.event(ev).then(function (res) {
        if (res.ok && res.data && res.data.event) {
          state.events[ev] = res.data.event;
          reclassify(ev);
        } else {
          delete state.events[ev];
        }
      });
    });
  }

  function reclassify(eventTicker) {
    var changed = false;
    state.markets.forEach(function (m) {
      if (m.event_ticker !== eventTicker) return;
      var before = m.topic;
      var fresh = enrich(m.raw);
      if (fresh.topic !== before) {
        m.topic = fresh.topic;
        m.topic_rule = fresh.topic_rule;
        m.topic_fallback = fresh.topic_fallback;
        m.series_ticker = fresh.series_ticker;
        changed = true;
      }
    });
    if (changed) { renderWatchTable(); renderTopTable(); }
  }

  function guessSeries(ticker) {
    /* KXPRESNOMR-28-EKIR → KXPRESNOMR. Used only to look up the official series
     * record; if the lookup misses, the ticker fallback classifier runs. */
    var parts = String(ticker || "").split("-");
    return parts[0] || "";
  }

  /* -------------------------------------------------------------- jumps */
  function mergeJumps(jumps) {
    var at = Date.now();
    jumps.forEach(function (j) {
      var m = state.byTicker[j.ticker];
      if (m) { j.topic = m.topic; j.title = m.title; }
      var dup = state.jumps.some(function (old) {
        return old.ticker === j.ticker && Math.abs(old.last_ts - j.last_ts) < 2000;
      });
      if (!dup) state.jumps.unshift(j);
    });
    state.jumps = state.jumps.filter(function (j) { return at - j.last_ts < 6 * 60 * 60 * 1000; });
    if (state.jumps.length > MAX_JUMPS) state.jumps.length = MAX_JUMPS;
  }

  function runAlerts(jumps) {
    var fresh = jumps.filter(function (j) { return Date.now() - j.last_ts < 10 * 60 * 1000; });
    if (!fresh.length) {
      if (!state.alertsA.length) {
        emptyFeed("feed-a-empty", state.statusOk
          ? "no move of $0.10 or more has printed in the last " + state.windowMs / 60000 + " minutes on the five topics. A quiet tape is a result, not a missing one."
          : "the trade feed is not connected, so there is nothing to show. This is not a quiet market — it is a missing connection.");
        emptyFeed("feed-b-empty", state.statusOk
          ? "nothing has cleared the screen yet in this window."
          : "the trade feed is not connected, so no market has been screened.");
      }
      return;
    }

    /* one batched quote request for the markets that just jumped */
    var tickers = fresh.map(function (j) { return j.ticker; }).slice(0, 40);
    Api.marketsByTicker(tickers).then(function (res) {
      var quotes = {};
      if (res.ok && res.data && res.data.markets) {
        res.data.markets.forEach(function (q) { quotes[q.ticker] = q; });
      }
      var booksWanted = fresh.slice(0, BOOK_LIMIT);

      /* Settlement sources come from the event record. If an event has not
       * resolved yet, wait for it before building the alert row so the row is
       * never published missing its official source links. */
      var eventWanted = {};
      fresh.forEach(function (j) {
        var m = state.byTicker[j.ticker];
        if (m && m.event_ticker && !state.events[m.event_ticker]) eventWanted[m.event_ticker] = true;
      });
      var eventWaits = Object.keys(eventWanted).slice(0, 8).map(function (ev) {
        return Api.event(ev).then(function (r) {
          if (r.ok && r.data && r.data.event) { state.events[ev] = r.data.event; return true; }
          return false;
        });
      });

      return Promise.all(eventWaits).then(function () {
      return Promise.all(booksWanted.map(function (j) {
        return Api.orderbook(j.ticker, 12).then(function (b) { return { ticker: j.ticker, res: b }; });
      })).then(function (bookResults) {
        bookResults.forEach(function (r) {
          if (r.res.ok) state.book[r.ticker] = r.res.data;
        });
        fresh.forEach(function (j) {
          var m = state.byTicker[j.ticker];
          if (!m) return;
          var q = quotes[j.ticker] || m.raw;
          var ctx = {
            jump: j,
            book: state.book[j.ticker] || null,
            ask: TD.num(q.yes_ask_dollars),
            bid: TD.num(q.yes_bid_dollars),
            settlementLinks: settlementLinks(m),
            now: Date.now()
          };
          pushAlert("A", Engine.jumpAlert(j, m.raw, m.topic, ctx));
          var scored = Engine.score(q, ctx);
          if (Engine.isHighRoi(scored)) {
            pushAlert("B", Engine.selectedAlert(j, m.raw, m.topic, scored, ctx));
            autoTrade(j, m, scored);
          }
        });
        renderConfidence();
      });
      });
    });
  }

  function settlementLinks(m) {
    var ev = state.events[m.event_ticker];
    return TD.settlementLinks(ev);
  }

  function pushAlert(feed, row) {
    var seen = feed === "A" ? state.seenA : state.seenB;
    if (seen[row.id]) return;
    seen[row.id] = true;
    var list = feed === "A" ? state.alertsA : state.alertsB;
    list.unshift(row);
    if (list.length > MAX_FEED) list.length = MAX_FEED;
    if (feed === "A" && $("feed-a-pause").checked) { bumpCount(feed); return; }
    if (feed === "B" && $("feed-b-pause").checked) { bumpCount(feed); return; }
    var node = renderAlert(row, feed);
    var box = $("feed-" + feed.toLowerCase());
    var empty = $("feed-" + feed.toLowerCase() + "-empty");
    if (empty) empty.remove();
    box.insertBefore(node, box.firstChild);
    while (box.children.length > MAX_FEED) box.removeChild(box.lastChild);
    bumpCount(feed);
    flashTitle(row);
  }

  function bumpCount(feed) {
    if (feed === "A") setText("feed-a-count", state.alertsA.length + " alerts · " + state.jumps.length + " jumps kept");
    else setText("feed-b-count", state.alertsB.length + " selected");
  }

  function flashTitle(row) {
    if (document.hidden || row.kind === "info") return;
    var base = "Kalshi Live Trade Desk";
    var msg = row.kind === "resolve" ? "RESOLVED " + row.ticker : TD.signedCents(row.move) + " " + row.ticker;
    document.title = "● " + msg + " · " + base;
    clearTimeout(flashTitle.t);
    flashTitle.t = setTimeout(function () { document.title = base; }, 3000);
  }

  function emptyFeed(id, text) {
    var box = $(id);
    if (box && !box.querySelector(".feed-empty")) {
      var d = document.createElement("div");
      d.className = "feed-empty";
      d.textContent = text;
      box.appendChild(d);
    }
  }

  function renderAlert(row, feed) {
    var el = document.createElement("div");
    el.className = "msg " + row.kind;
    el.setAttribute("data-topic", row.topic || "");
    el.setAttribute("data-id", row.id);

    var time = document.createElement("time");
    time.dateTime = row.at;
    time.textContent = TD.clock(row.at);
    time.title = TD.ago(row.at);
    el.appendChild(time);

    var text = document.createElement("div");
    text.className = "text";
    var topicChip = '<span class="chip ' + TD.attr(row.topic || "") + '">' + TD.esc(topicLabel(row.topic)) + "</span>";

    if (row.kind === "jump" || row.kind === "selected") {
      var dir = row.move >= 0 ? "up" : "down";
      text.innerHTML =
        '<div><span class="move-' + dir + '">' + (row.move >= 0 ? "▲ " : "▼ ") + TD.esc(TD.signedCents(row.move)) + "</span> " +
        '<span class="muted">' + TD.esc(TD.cents(row.from, 1)) + " → " + TD.esc(TD.cents(row.to, 1)) + "</span> " +
        topicChip + (row.score ? ' <span class="chip score">score ' + Math.round(row.score) + "</span>" : "") +
        (row.roi !== undefined && row.roi !== null ? ' <span class="chip">net ROI ' + TD.esc(TD.pct(row.roi, 0)) + "</span>" : "") +
        "</div>" +
        '<div class="line2">' + TD.esc(row.title) + " · <span class='mono'>" + TD.esc(row.ticker) + "</span></div>";
    } else if (row.kind === "resolve") {
      var res = row.resolved === "yes" ? '<span class="up">YES</span>' : row.resolved === "no" ? '<span class="down">NO</span>' : TD.esc(row.resolved);
      text.innerHTML =
        "<div>RESOLVED " + res + " " + topicChip + "</div>" +
        '<div class="line2">' + TD.esc(row.title) + " · <span class='mono'>" + TD.esc(row.ticker) + "</span></div>";
    } else {
      text.innerHTML = "<div>" + TD.esc(row.message) + "</div>";
    }

    var links = document.createElement("div");
    links.className = "links";
    if (row.evidence) links.innerHTML += '<a href="' + TD.attr(row.evidence) + '" target="_blank" rel="noopener">API evidence ↗</a>';
    if (row.venue) links.innerHTML += '<a href="' + TD.attr(row.venue) + '" target="_blank" rel="noopener">venue ↗</a>';
    if (row.news) links.innerHTML += '<a href="' + TD.attr(row.news) + '" target="_blank" rel="noopener">news search ↗</a>';
    (row.sources || []).slice(0, 3).forEach(function (s) {
      links.innerHTML += '<a href="' + TD.attr(s.url) + '" target="_blank" rel="noopener">' + TD.esc(s.name) + " ↗</a>";
    });
    if (row.kind !== "resolve") links.innerHTML += '<button type="button" class="ghost paper" data-ticker="' + TD.attr(row.ticker) + '">paper trade</button>';
    text.appendChild(links);

    if (row.terms && row.terms.length) {
      var det = document.createElement("details");
      det.innerHTML = "<summary>why this scored " + Math.round(row.score) + "</summary>" +
        "<table><thead><tr><th>term</th><th class='num'>value</th><th class='num'>points</th></tr></thead><tbody>" +
        row.terms.map(function (t) {
          return "<tr><td>" + TD.esc(t.name) + " <span class='muted'>(" + TD.esc(t.why) + ")</span></td><td class='num'>" +
            TD.esc(String(t.value)) + "</td><td class='num'>" + t.pts.toFixed(1) + "/" + t.weight + "</td></tr>";
        }).join("") + "</tbody></table>" +
        (row.flags && row.flags.length ? "<p class='small'>flags: " + TD.esc(row.flags.join(", ")) + "</p>" : "");
      text.appendChild(det);
    }

    el.appendChild(text);

    var right = document.createElement("div");
    right.className = "right";
    if (row.kind === "selected") {
      right.innerHTML = "<div class='mono'>" + TD.esc(TD.cents(row.entryAsk, 1)) + "</div><div class='small'>ask</div>";
    } else if (row.kind === "jump") {
      right.innerHTML = "<div class='mono'>" + (row.sources && row.sources.length ? row.sources.length + " src" : "") + "</div>";
    }
    el.appendChild(right);

    el.querySelectorAll("button.paper").forEach(function (btn) {
      btn.addEventListener("click", function () { openPaper(row); });
    });
    return el;
  }

  function topicLabel(id) {
    var t = TD.topicById(id);
    return t ? t.label : (id || "other");
  }

  /* ---------------------------------------------------------------- tables */
  function renderWatchTable() {
    var tbody = document.querySelector("#watch-table tbody");
    if (!tbody) return;
    var topic = $("topic-filter").value;
    var q = ($("search").value || "").toLowerCase().trim();
    var rows = state.markets.filter(function (m) {
      if (topic !== "all" && m.topic !== topic) return false;
      if (q && (m.ticker + " " + m.title).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return dollarEst(b) - dollarEst(a); }).slice(0, 400);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="blank">no open market in the five topics matched this filter</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (m) {
      var spread = (m.yes_ask !== null && m.yes_bid !== null && m.yes_ask > 0) ? m.yes_ask - m.yes_bid : null;
      return "<tr" + (state.selected === m.ticker ? ' style="background:#eff6ff"' : "") + ">" +
        '<td><span class="chip ' + TD.attr(m.topic) + '">' + TD.esc(topicLabel(m.topic)) + "</span>" +
        (m.topic_fallback ? ' <span class="chip warn">fallback</span>' : "") + "</td>" +
        '<td><a href="#" class="pick" data-ticker="' + TD.attr(m.ticker) + '">' + TD.esc(m.title) + "</a>" +
        '<div class="mono muted">' + TD.esc(m.event_ticker) + "</div></td>" +
        '<td class="num">' + (m.yes_bid ? TD.cents(m.yes_bid, 1) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (m.yes_ask && m.yes_ask < 1 ? TD.cents(m.yes_ask, 1) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (spread !== null ? TD.cents(spread, 1) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (m.last ? TD.cents(m.last, 1) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (m.volume_24h !== null && m.last ? TD.money(m.volume_24h * m.last) : "—") + "</td>" +
        "<td>" + TD.esc(TD.countdown(m.close_time)) + "</td>" +
        '<td><a href="' + TD.attr(TD.apiUrl("/markets?tickers=" + encodeURIComponent(m.ticker))) + '" target="_blank" rel="noopener">GET /markets</a></td>' +
        "</tr>";
    }).join("");

    tbody.querySelectorAll("a.pick").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        selectMarket(a.getAttribute("data-ticker"));
      });
    });
  }

  /* Computed notional: contracts × last traded price. There is no official USD
   * volume field in the market object, so this is labelled an estimate on the
   * page and the ranking page explains it. */
  function dollarEst(m) {
    if (m.last === null || m.volume_24h === null) return -1;
    return m.volume_24h * m.last;
  }

  function renderTopTable() {
    var tbody = document.querySelector("#top-table tbody");
    if (!tbody) return;
    var rows = state.markets.slice().sort(function (a, b) { return dollarEst(b) - dollarEst(a); }).slice(0, 40);
    tbody.innerHTML = rows.map(function (m, i) {
      var spread = (m.yes_ask !== null && m.yes_bid !== null && m.yes_ask > 0) ? m.yes_ask - m.yes_bid : null;
      return "<tr>" +
        "<td class='num'>" + (i + 1) + "</td>" +
        '<td><span class="chip ' + TD.attr(m.topic) + '">' + TD.esc(topicLabel(m.topic)) + "</span></td>" +
        '<td><a href="#" class="pick" data-ticker="' + TD.attr(m.ticker) + '">' + TD.esc(m.title) + "</a>" +
        '<div class="mono muted">' + TD.esc(m.ticker) + "</div></td>" +
        '<td class="num">' + (m.last ? TD.cents(m.last, 1) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (dollarEst(m) >= 0 ? TD.money(dollarEst(m), 0) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="num">' + (spread !== null ? TD.cents(spread, 1) : '<span class="blank">blank</span>') + "</td>" +
        "<td>" + TD.esc(TD.countdown(m.close_time)) + "</td>" +
        '<td class="no-wrap"><a href="' + TD.attr(TD.apiUrl("/markets?tickers=" + encodeURIComponent(m.ticker))) + '" target="_blank" rel="noopener">API</a> · ' +
        '<a href="' + TD.attr(TD.marketUrl(m.ticker, m.event_ticker)) + '" target="_blank" rel="noopener">venue</a></td>' +
        "</tr>";
    }).join("");
    tbody.querySelectorAll("a.pick").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); selectMarket(a.getAttribute("data-ticker")); });
    });
  }

  function renderMovers() {
    var tbody = document.querySelector("#movers-table tbody");
    if (!tbody) return;
    var rows = state.jumps.filter(function (j) { return Date.now() - j.last_ts < state.windowMs; }).slice(0, 80);
    setText("movers-count", rows.length + (rows.length === 1 ? " market" : " markets"));
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="blank">no contract moved $0.10 or more in this window — a quiet tape is a result, not a missing one</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (j) {
      var cls = j.move >= 0 ? "up" : "down";
      return "<tr>" +
        '<td><span class="chip ' + TD.attr(j.topic || "") + '">' + TD.esc(topicLabel(j.topic)) + "</span></td>" +
        '<td><a href="#" class="pick" data-ticker="' + TD.attr(j.ticker) + '">' + TD.esc(j.title || j.ticker) + "</a>" +
        '<div class="mono muted">' + TD.esc(j.ticker) + "</div></td>" +
        '<td class="num"><span class="' + cls + '">' + TD.esc(TD.signedCents(j.move)) + "</span></td>" +
        '<td class="num">' + TD.esc(TD.cents(j.from, 1)) + " → " + TD.esc(TD.cents(j.to, 1)) + "</td>" +
        '<td class="num">' + j.trades + "</td>" +
        "<td>" + TD.esc(TD.clock(j.last_time)) + "</td>" +
        '<td><a href="' + TD.attr(j.source) + '" target="_blank" rel="noopener">GET /markets/trades</a></td>' +
        "</tr>";
    }).join("");
    tbody.querySelectorAll("a.pick").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); selectMarket(a.getAttribute("data-ticker")); });
    });
  }

  /* ------------------------------------------------------------ selection */
  function selectMarket(ticker) {
    state.selected = ticker;
    if (!state.samplesByTicker) state.samplesByTicker = {};
    state.samples = state.samplesByTicker[ticker] || [];
    state.zoomTo = null;
    var m = state.byTicker[ticker];
    setText("chart-title", m ? m.title : ticker);
    setText("book-title", (m ? m.title + " · " : "") + ticker);
    /* clear the previous market's ladder immediately so a slow request can never
     * leave another market's book on screen next to this market's name */
    $("ladder").innerHTML = '<div class="side asks"><h4>YES asks (implied)</h4><div class="blank">loading…</div></div>' +
      '<div class="mid">—</div><div class="side bids"><h4>YES bids</h4><div class="blank">loading…</div></div>';
    $("book-meta").textContent = "loading " + ticker + " from the official order-book endpoint…";
    renderWatchTable();
    refreshSelected(true);
  }

  function refreshSelected(force) {
    var t = state.selected;
    if (!t) {
      /* default: the biggest market by estimated dollars */
      var top = state.markets.slice().sort(function (a, b) { return dollarEst(b) - dollarEst(a); })[0];
      if (top) selectMarket(top.ticker);
      return Promise.resolve();
    }
    var row = state.byTicker[t];
    if (row) {
      setText("book-title", row.title + " · " + t);
      setText("chart-title", row.title);
    }
    var tasks = [Api.orderbook(t, 14), fetchSamples(t)];
    return Promise.all(tasks).then(function (out) {
      if (state.selected !== t) return;  /* the user moved on; drop this response */
      var book = out[0];
      if (book.ok) { state.book[t] = book.data; renderLadder(t, book.data, book.url); }
      else renderLadderError(t, book.error, book.url);
      drawChart();
    });
  }

  /* Chart samples: official 1-minute candles for the long windows, the trades
   * tape for the seconds windows. Candle requests are attempted once per market
   * and the result (including "empty") is recorded and disclosed. */
  function fetchSamples(ticker) {
    var m = state.byTicker[ticker];
    if (!m) return Promise.resolve();
    var now = Date.now();
    var wantedMs = Math.max(TDChart.windowById(state.chartWindow).ms, 60 * 60 * 1000);
    var have = state.samples.length && state.samples[0].ticker === ticker
      ? state.samples : [];
    var fresh = have.filter(function (s) { return now - s.ts < wantedMs + 60000; });

    var fromTrades = Api.trades({ ticker: ticker, limit: 1000 }).then(function (res) {
      var rows = [];
      if (res.ok && res.data && res.data.trades) {
        res.data.trades.forEach(function (tr) {
          var price = TD.num(tr.yes_price_dollars);
          var ts = new Date(tr.created_time).getTime();
          if (price !== null && isFinite(ts)) rows.push({ ticker: ticker, ts: ts, price: price, source: res.url, kind: "trade" });
        });
      }
      return rows;
    });

    var fromCandles = Promise.resolve([]);
    if (!state.candleNote || state.candleNote.ticker !== ticker) {
      var series = m.series_ticker || guessSeries(ticker);
      var end = Math.floor(now / 1000);
      var start = end - 60 * 60 * 6; /* 360 one-minute candles, well under the 5,000 cap */
      fromCandles = Api.candles(series, ticker, start, end, 1).then(function (res) {
        if (!res.ok) {
          state.candleNote = { ticker: ticker, text: "1-minute candles unavailable: " + res.error, url: res.url };
          return [];
        }
        var cs = (res.data && res.data.candlesticks) || [];
        if (!cs.length) {
          state.candleNote = { ticker: ticker, text: "the official 1-minute candlestick endpoint returned an empty array for this market, so the chart is drawn from the trades tape only.", url: res.url };
          return [];
        }
        state.candleNote = { ticker: ticker, text: cs.length + " official 1-minute candles.", url: res.url };
        return cs.map(function (c) {
          var p = TD.num(c.price && c.price.close_dollars);
          if (p === null) p = TD.num(c.yes_ask && c.yes_ask.close_dollars);
          return p === null ? null : { ticker: ticker, ts: c.end_period_ts * 1000, price: p, source: res.url, kind: "candle" };
        }).filter(Boolean);
      });
    }

    return Promise.all([fromTrades, fromCandles]).then(function (parts) {
      var all = fresh.concat(parts[0], parts[1]);
      var seen = {};
      state.samples = all.filter(function (s) {
        var k = s.ts + ":" + s.price + ":" + s.kind;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      }).sort(function (a, b) { return a.ts - b.ts; });
      if (!state.samplesByTicker) state.samplesByTicker = {};
      state.samplesByTicker[ticker] = state.samples;
    });
  }

  function buildChartControls() {
    var box = $("chart-controls");
    if (!box) return;
    var groups = { seconds: [], minutes: [], hours: [] };
    TDChart.WINDOWS.forEach(function (w) { groups[w.unit].push(w); });
    box.innerHTML = Object.keys(groups).map(function (unit) {
      return '<span class="group" role="group" aria-label="' + unit + '">' +
        groups[unit].map(function (w) {
          return '<button type="button" data-window="' + w.id + '" aria-pressed="' + (w.id === state.chartWindow) + '">' + w.id + "</button>";
        }).join("") + "</span>";
    }).join("");
    box.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.chartWindow = b.getAttribute("data-window");
        state.zoomTo = null;
        box.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        if (state.selected) fetchSamples(state.selected).then(drawChart);
        else drawChart();
      });
    });
  }

  function drawChart() {
    var svg = $("live-chart");
    if (!svg) return;
    var win = TDChart.windowById(state.chartWindow);
    var now = state.zoomTo || Date.now();
    var t0 = now - win.ms;
    var jumps = state.jumps.filter(function (j) { return j.ticker === state.selected; }).map(function (j) {
      return { ts: j.last_ts, price: j.to, move: j.move, ticker: j.ticker };
    });
    TDChart.render(svg, {
      samples: state.samples.filter(function (s) { return s.ticker === state.selected; }),
      now: now,
      windowId: state.chartWindow,
      jumps: jumps,
      color: "#1d4ed8",
      title: state.selected || "price",
      readoutEl: $("chart-readout"),
      emptyText: "no official print for " + (state.selected || "this market") + " in " + win.label,
      onZoom: function (ts) {
        state.zoomTo = Math.min(Date.now(), ts + win.ms / 2);
        drawChart();
        setText("chart-readout", "centred on " + TD.clock(state.zoomTo) + " — pick a window again to return to now");
      }
    });
    var note = $("chart-note");
    if (note && state.candleNote && state.candleNote.ticker === state.selected) {
      note.innerHTML = 'x axis: time · y axis: YES price. ' + TD.esc(state.candleNote.text) +
        ' <a href="' + TD.attr(state.candleNote.url) + '" target="_blank" rel="noopener">candle request ↗</a>' +
        ' · <a href="' + TD.attr(TD.apiUrl("/markets/trades?ticker=" + encodeURIComponent(state.selected || ""))) + '" target="_blank" rel="noopener">trades request ↗</a>';
    }
    void t0;
  }

  /* --------------------------------------------------------------- ladder */
  function renderLadder(ticker, book, url) {
    var lad = TD.ladder(book);
    var asks = TD.depth(lad.yesAsks, 8);
    var bids = TD.depth(lad.yesBids, 8);
    var maxSize = Math.max(1, asks.rows.concat(bids.rows).reduce(function (mx, r) { return Math.max(mx, r.size); }, 1));

    var asksHtml = asks.rows.map(function (r) {
      return '<div class="bar-row"><span class="px">' + TD.cents(r.price, 1) + "</span>" +
        '<span class="bar" style="width:' + Math.max(1, (r.size / maxSize) * 100) + 'px"></span>' +
        '<span class="mono">' + TD.contracts(r.size) + "</span></div>";
    }).join("") || '<div class="blank">no resting NO bids → no implied YES asks</div>';

    var bidsHtml = bids.rows.map(function (r) {
      return '<div class="bar-row"><span class="px">' + TD.cents(r.price, 1) + "</span>" +
        '<span class="bar" style="width:' + Math.max(1, (r.size / maxSize) * 100) + 'px"></span>' +
        '<span class="mono">' + TD.contracts(r.size) + "</span></div>";
    }).join("") || '<div class="blank">no resting YES bids</div>';

    var spread = (lad.bestYesAsk !== null && lad.bestYesBid !== null) ? lad.bestYesAsk - lad.bestYesBid : null;
    $("ladder").innerHTML =
      '<div class="side asks"><h4>YES asks (implied) · contracts</h4>' + asksHtml + "</div>" +
      '<div class="mid"><div class="spread">' + (spread !== null ? "spread " + TD.cents(spread, 1) : "no two-sided quote") +
      '</div><div class="mono small">' + (lad.bestYesBid !== null ? "bid " + TD.cents(lad.bestYesBid, 1) : "") + "<br>" +
      (lad.bestYesAsk !== null ? "ask " + TD.cents(lad.bestYesAsk, 1) : "") + "</div></div>" +
      '<div class="side bids"><h4>YES bids · contracts</h4>' + bidsHtml + "</div>";

    $("book-meta").innerHTML = "total resting: " + TD.contracts(asks.total) + " contracts on the ask side, " +
      TD.contracts(bids.total) + " on the bid side, within the returned depth. " +
      '<a href="' + TD.attr(url) + '" target="_blank" rel="noopener">order-book request ↗</a> · ' +
      '<a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">how bids imply asks ↗</a>';
  }

  function renderLadderError(ticker, error, url) {
    $("ladder").innerHTML = '<div class="side asks"><h4>YES asks</h4></div><div class="mid">—</div><div class="side bids"><h4>YES bids</h4></div>';
    $("book-meta").innerHTML = '<span class="down">order book for ' + TD.esc(ticker) + " unavailable: " + TD.esc(error) + "</span>" +
      ' · <a href="' + TD.attr(url) + '" target="_blank" rel="noopener">request ↗</a>';
  }

  /* ---------------------------------------------------------- paper trading */
  var autoEnabled = false;
  function autoTrade(jump, market, scored) {
    if (!autoEnabled) return;
    var ledger = Engine.loadLedger();
    var open = Object.keys(ledger.positions).length;
    if (open >= 6) return;
    if (ledger.positions[jump.ticker]) return;
    var size = 10;
    var r = Engine.openPosition(ledger, {
      ticker: jump.ticker, event_ticker: market.event_ticker, title: market.title,
      topic: market.topic, strategy: "balanced", ask: scored.entryAsk, contracts: size,
      max_roi: scored.maxRoi, score: scored.score, evidence: jump.source
    }, { now: new Date().toISOString() });
    if (r.ok) { Engine.recordMark(ledger); Engine.saveLedger(ledger); }
  }

  function openPaper(row) {
    var ledger = Engine.loadLedger();
    var ask = row.entryAsk;
    if (ask === undefined || ask === null) {
      var m = state.byTicker[row.ticker];
      ask = m ? m.yes_ask : null;
    }
    if (!ask || ask <= 0 || ask >= 1) {
      alert("No tradable YES ask for this market right now, so no paper fill was created. The API returned an empty or one-sided quote.");
      return;
    }
    var size = 10;
    var r = Engine.openPosition(ledger, {
      ticker: row.ticker, event_ticker: row.event_ticker, title: row.title,
      topic: row.topic, strategy: "manual", ask: ask, contracts: size,
      score: row.score || null, max_roi: row.roi ? null : null, evidence: row.evidence
    }, { now: new Date().toISOString() });
    if (!r.ok) { alert("Paper fill not created: " + r.error); return; }
    Engine.recordMark(ledger);
    Engine.saveLedger(ledger);
    alert("Paper fill: " + size + " contracts of " + row.ticker + " at " + TD.cents(ask, 1) +
      ", fee " + TD.money(r.position.entry_fee) + ". It will settle at $1 or $0 when the official API reports the result. See Paper trades.");
  }

  function renderConfidence() {
    var el = $("api-banner");
    if (!el || state.errors.length === 0) return;
    var last = state.errors[state.errors.length - 1];
    if (el.hidden) {
      el.hidden = false;
      el.innerHTML = "<p><b>Some requests failed and were retried with backoff.</b> Rows above remain from the last successful poll and are not estimated. Latest: <span class='mono'>" +
        TD.esc(String(last.detail && (last.detail.url || last.detail.message) || "")) + "</span></p>";
    }
  }

  /* expose a couple of hooks for the DOM tests */
  window.__tradeDesk = {
    state: state,
    poll: poll,
    renderAlert: renderAlert,
    enrich: enrich,
    dollarEst: dollarEst,
    selectMarket: selectMarket,
    runAlerts: runAlerts
  };
})();
