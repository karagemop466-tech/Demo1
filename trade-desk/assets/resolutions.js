/* trade-desk/assets/resolutions.js — controller for resolutions.html.
 *
 * Two independent lists:
 *   1. recently settled markets in the five topics, fetched with
 *      GET /markets?status=settled&min_settled_ts=… and paginated;
 *   2. the visitor's own watch list, kept in localStorage, polled by ticker so a
 *      market is followed until the API returns result = yes / no / scalar.
 *
 * Nothing is inferred. A market with status "closed" and an empty result is
 * shown as awaiting determination; a market the API no longer returns is shown
 * as unavailable rather than dropped.
 */
(function () {
  "use strict";
  var TD = window.TD, Api = window.Api;
  var WATCH_KEY = "tradeDesk.watch.v1";
  var SETTLE_PAGES = 2;          /* 2 × 1000 markets, newest settlement first */
  var SETTLE_LOOKBACK_S = 90 * 24 * 60 * 60;

  var state = {
    seriesMap: null,
    events: {},
    settled: [],
    watched: [],
    timer: null
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }

  TD.onReady(function () {
    loadWatch();
    loadSeriesMap().then(function () {
      refresh();
      schedule();
    });
    $("refresh").addEventListener("click", function () { refresh(); });
    $("autopoll").addEventListener("change", schedule);
    $("clear-watch").addEventListener("click", function () {
      if (!confirm("Clear the local watch list? This only affects this browser.")) return;
      state.watched = [];
      saveWatch();
      renderWatch();
    });
    $("watch-visible").addEventListener("click", function () {
      /* add every market currently listed in the settled table to the watch list */
      var added = 0;
      state.settled.slice(0, 25).forEach(function (m) {
        if (addWatch(m.ticker, m.topic, m.title)) added += 1;
      });
      saveWatch();
      renderWatch();
      alert(added ? added + " market(s) added to the local watch list." : "Those markets are already on the list.");
    });
  });

  function loadSeriesMap() {
    return fetch("data/series-map.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { state.seriesMap = j && j.map ? j.map : null; return j; })
      .catch(function () { state.seriesMap = null; return null; });
  }

  function loadWatch() {
    try {
      var raw = localStorage.getItem(WATCH_KEY);
      state.watched = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.watched)) state.watched = [];
    } catch (e) { state.watched = []; }
  }
  function saveWatch() {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(state.watched.slice(0, 60))); } catch (e) { /* quota */ }
  }
  function addWatch(ticker, topic, title) {
    if (state.watched.some(function (w) { return w.ticker === ticker; })) return false;
    state.watched.unshift({ ticker: ticker, topic: topic, title: title, added_at: new Date().toISOString() });
    return true;
  }

  function schedule() {
    if (state.timer) clearTimeout(state.timer);
    if (!$("autopoll").checked) return;
    state.timer = setTimeout(function () { refresh().then(schedule); }, 30000);
  }

  function classify(market) {
    var ev = state.events[market.event_ticker];
    var seriesTicker = ev ? ev.series_ticker : String(market.ticker || "").split("-")[0];
    var srow = state.seriesMap && seriesTicker ? state.seriesMap[seriesTicker] : null;
    var hit = null;
    if (srow) {
      hit = TD.classifyBySeries({
        ticker: seriesTicker, title: srow[2], category: srow[1],
        tags: srow[3] ? srow[3].split("|") : []
      });
    }
    if (!hit) hit = TD.classifyByTicker(market.ticker, market.title);
    return hit ? hit.id : null;
  }

  /* ------------------------------------------------------------- settled list */
  function refresh() {
    setText("api-state", "loading…");
    var since = Math.floor(Date.now() / 1000) - SETTLE_LOOKBACK_S;
    var pages = [];
    var cursor = "";
    function nextPage(i) {
      if (i >= SETTLE_PAGES) return Promise.resolve(pages);
      var q = "status=settled&limit=1000&min_settled_ts=" + since + "&mve_filter=exclude" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      return Api.fetchJson("/markets?" + q, { cacheMs: 15000 }).then(function (res) {
        if (!res.ok) {
          banner("Settled-markets request failed: " + res.error);
          return pages;
        }
        pages.push({ rows: (res.data && res.data.markets) || [], url: res.url });
        cursor = (res.data && res.data.cursor) || "";
        if (!cursor) return pages;
        return nextPage(i + 1);
      }).catch(function (err) {
        banner("Settled-markets request failed: " + (err && err.message ? err.message : err));
        return pages;
      });
    }

    return nextPage(0).then(function (pageList) {
      /* collect the event tickers we need, then fetch a bounded number of them */
      var rows = [];
      pageList.forEach(function (p) {
        p.rows.forEach(function (m) { rows.push({ m: m, url: p.url }); });
      });
      var evs = {};
      rows.forEach(function (r) { if (r.m.event_ticker) evs[r.m.event_ticker] = true; });
      var evList = Object.keys(evs).slice(0, 25);
      return Promise.all(evList.map(function (ev) {
        if (state.events[ev]) return Promise.resolve();
        return Api.event(ev).then(function (res) {
          if (res.ok && res.data && res.data.event) state.events[ev] = res.data.event;
        });
      })).then(function () { return rows; });
    }).then(function (rows) {
      var out = [];
      rows.forEach(function (r) {
        var topic = classify(r.m);
        if (!topic) return;
        out.push({
          ticker: r.m.ticker,
          event_ticker: r.m.event_ticker,
          title: r.m.title || r.m.yes_sub_title || r.m.ticker,
          topic: topic,
          result: r.m.result || "",
          settlement_value: r.m.settlement_value_dollars,
          settled_at: r.m.settlement_ts,
          status: r.m.status,
          sources: TD.settlementLinks(state.events[r.m.event_ticker]),
          url: r.url
        });
      });
      out.sort(function (a, b) {
        return new Date(b.settled_at || 0) - new Date(a.settled_at || 0);
      });
      state.settled = out;
      renderSettled();
      setText("resolved-count", String(out.length));
      setText("tracked-count", String(rows.length));
      setText("api-state", "connected · " + out.length + " resolved in five topics");
      var dot = $("dot-api");
      if (dot) dot.className = "dot live";
      return refreshWatch();
    }).catch(function (err) {
      banner("Refresh error: " + (err && err.message ? err.message : err));
    });
  }

  function banner(msg) {
    var b = $("api-banner");
    if (!b) return;
    b.hidden = false;
    b.textContent = msg;
    var dot = $("dot-api");
    if (dot) dot.className = "dot err";
    setText("api-state", "not connected · retrying");
  }

  function topicChip(id) {
    var t = TD.topicById(id);
    return '<span class="chip ' + TD.attr(id || "") + '">' + TD.esc(t ? t.label : (id || "other")) + "</span>";
  }

  function resultCell(row) {
    if (row.result === "yes") return '<b class="up">YES</b>';
    if (row.result === "no") return '<b class="down">NO</b>';
    if (row.result === "scalar") return '<b>scalar</b> <span class="small">(value in next column)</span>';
    return '<span class="blank">no result yet</span>';
  }

  function renderSettled() {
    var tbody = document.querySelector("#resolution-table tbody");
    if (!tbody) return;
    if (!state.settled.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="blank">no settled market in the five topics in the last 90 days</td></tr>';
      return;
    }
    tbody.innerHTML = state.settled.slice(0, 500).map(function (r) {
      var links = '<a href="' + TD.attr(r.url) + '" target="_blank" rel="noopener">settled markets request</a>';
      links += ' · <a href="' + TD.attr(TD.marketUrl(r.ticker, r.event_ticker)) + '" target="_blank" rel="noopener">venue</a>';
      (r.sources || []).slice(0, 2).forEach(function (s) {
        links += ' · <a href="' + TD.attr(s.url) + '" target="_blank" rel="noopener">' + TD.esc(s.name) + "</a>";
      });
      links += ' · <button class="ghost watch" data-ticker="' + TD.attr(r.ticker) + '" data-topic="' + TD.attr(r.topic) + '">watch</button>';
      return "<tr>" +
        "<td>" + topicChip(r.topic) + "</td>" +
        '<td><a href="' + TD.attr(TD.marketUrl(r.ticker, r.event_ticker)) + '" target="_blank" rel="noopener">' + TD.esc(r.title) + "</a>" +
        '<div class="mono muted">' + TD.esc(r.ticker) + "</div></td>" +
        "<td>" + resultCell(r) + "</td>" +
        '<td class="num">' + (r.settlement_value ? TD.esc(TD.money(r.settlement_value, 2)) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="nowrap">' + (r.settled_at ? TD.esc(String(r.settled_at).slice(0, 19).replace("T", " ")) + "Z" : '<span class="blank">blank</span>') + "</td>" +
        "<td>" + TD.esc(r.status) + "</td>" +
        '<td class="small">' + links + "</td>" +
        "</tr>";
    }).join("");
    tbody.querySelectorAll("button.watch").forEach(function (b) {
      b.addEventListener("click", function () {
        addWatch(b.getAttribute("data-ticker"), b.getAttribute("data-topic"), "");
        saveWatch();
        renderWatch();
        refreshWatch();
      });
    });
  }

  /* --------------------------------------------------------------- watch list */
  function refreshWatch() {
    if (!state.watched.length) { renderWatch(); return Promise.resolve(); }
    var tickers = state.watched.map(function (w) { return w.ticker; });
    var chunks = [];
    for (var i = 0; i < tickers.length; i += 40) chunks.push(tickers.slice(i, i + 40));
    return Promise.all(chunks.map(function (list) {
      return Api.marketsByTicker(list);
    })).then(function (results) {
      var found = {};
      results.forEach(function (res) {
        if (res.ok && res.data && res.data.markets) {
          res.data.markets.forEach(function (m) { found[m.ticker] = m; });
        }
      });
      state.watched.forEach(function (w) {
        var m = found[w.ticker];
        if (!m) { w.unavailable = true; return; }
        w.unavailable = false;
        w.title = m.title || w.title || w.ticker;
        w.status = m.status;
        w.result = m.result || "";
        w.close_time = m.close_time;
        w.settlement_value = m.settlement_value_dollars;
        w.settled_at = m.settlement_ts;
        w.last = m.last_price_dollars;
        w.url = TD.apiUrl("/markets?tickers=" + encodeURIComponent(w.ticker));
        if (!w.topic) w.topic = classify(m);
      });
      saveWatch();
      renderWatch();
      var done = state.watched.filter(function (w) { return w.result === "yes" || w.result === "no" || w.result === "scalar"; }).length;
      setText("watched-count", state.watched.length + " (" + done + " resolved)");
    });
  }

  function renderWatch() {
    var tbody = document.querySelector("#watch-table tbody");
    if (!tbody) return;
    setText("watched-count", state.watched.length + " (" +
      state.watched.filter(function (w) { return w.result; }).length + " resolved)");
    if (!state.watched.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="blank">nothing watched yet</td></tr>';
      return;
    }
    tbody.innerHTML = state.watched.map(function (w) {
      var sources = [];
      var ev = w.event_ticker ? state.events[w.event_ticker] : null;
      TD.settlementLinks(ev).slice(0, 2).forEach(function (s) {
        sources.push('<a href="' + TD.attr(s.url) + '" target="_blank" rel="noopener">' + TD.esc(s.name) + "</a>");
      });
      sources.push('<a href="' + TD.attr(w.url || TD.apiUrl("/markets?tickers=" + encodeURIComponent(w.ticker))) + '" target="_blank" rel="noopener">API</a>');
      return "<tr>" +
        "<td>" + topicChip(w.topic) + "</td>" +
        "<td>" + TD.esc(w.title || w.ticker) + '<div class="mono muted">' + TD.esc(w.ticker) + "</div></td>" +
        '<td class="num">' + (w.last ? TD.esc(TD.cents(w.last, 1)) : '<span class="blank">blank</span>') + "</td>" +
        "<td>" + (w.unavailable ? '<span class="down">not returned by the API</span>' : TD.esc(w.status || "unknown")) + "</td>" +
        "<td>" + (w.unavailable ? '<span class="blank">blank</span>' : resultCell(w)) + "</td>" +
        "<td>" + (w.close_time ? TD.esc(TD.countdown(w.close_time)) : '<span class="blank">blank</span>') + "</td>" +
        '<td class="small">' + sources.join(" · ") + "</td>" +
        "</tr>";
    }).join("");
  }

  window.__resolutions = { state: state, refresh: refresh, classify: classify, addWatch: addWatch };
})();
