/* Live alert chat — Kalshi demo.
 *
 * Two scrolling chats:
 *   left  : every move of at least the selected threshold
 *   right : the same feed filtered by the published QLM model score
 *
 * The committed feed (alerts/data/feed.json) is the fallback and the baseline.
 * When "poll the live API" is on, the page asks the official demo API for the
 * 1-minute candles of the scanned markets and reports only moves that are
 * newer than the committed snapshot. If the browser cannot reach the API the
 * page says so and keeps working from the committed feed.
 *
 * No external dependencies.
 */
(function () {
  "use strict";

  var FEED_URL = "data/feed.json";
  var PAGE = 60;

  var state = {
    feed: null,
    threshold: 0.10,
    window: "1m/6h",
    topic: "all",
    live: false,
    liveRows: [],
    shown: PAGE,
    lastClose: {},
    timer: null,
    pollErrors: []
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(v, dp) {
    if (v === null || v === undefined || v === "") return "—";
    var n = Number(v);
    if (isNaN(n)) return "—";
    return "$" + n.toFixed(dp === undefined ? 4 : dp);
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return "—";
    var n = Number(v);
    if (isNaN(n)) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function shortTime(utc) {
    if (!utc) return "—";
    return String(utc).replace("T", " ").replace("Z", " UTC");
  }

  function topicLabel(t) {
    return ({
      gas_prices: "Gas prices",
      elections: "Elections",
      culture: "Culture",
      crypto: "Crypto",
      golf: "Golf"
    })[t] || t || "—";
  }

  function status(cls, text) {
    var el = $("status");
    el.className = "status " + cls;
    el.innerHTML = '<span class="dot"></span>' + esc(text);
  }

  function matchesWindow(row) {
    if (state.window === "all") return true;
    return row.window === state.window;
  }

  function matchesTopic(row) {
    if (state.topic === "all") return true;
    return row.topic === state.topic;
  }

  function matchesThreshold(row) {
    var d = Math.abs(Number(row.delta) || 0);
    return d >= state.threshold - 1e-9;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                            */
  /* ------------------------------------------------------------------ */

  function alertHtml(row) {
    var dir = row.direction === "up" ? "up" : "down";
    var sign = Number(row.delta) >= 0 ? "+" : "";
    var basis = row.price_basis === "traded" ? "traded close" : "book mid";
    var liveTag = row.live ? '<span class="tag live-tag">LIVE</span> ' : "";
    var html = '<div class="msg ' + dir + (row.live ? " live" : "") + '">';
    html += '<div class="row1">' + liveTag;
    html += '<span class="mono">' + esc(shortTime(row.time_utc)) + "</span>";
    html += '<span class="tag topic">' + esc(topicLabel(row.topic)) + "</span>";
    html += '<span class="tag">' + esc(row.window || "1m") + "</span>";
    html += '<span class="tag">' + esc(basis) + "</span>";
    if (row.gap_seconds && row.gap_seconds > 120) {
      html += '<span class="tag">gap ' + Math.round(row.gap_seconds / 60) + " min</span>";
    }
    html += "</div>";
    html += '<div class="title"><a href="' + esc(row.market_page) + '" target="_blank" rel="noopener">' +
      esc(row.title || row.market_ticker) + "</a></div>";
    html += '<div class="facts">';
    html += "<span>from <b>" + esc(money(row.from)) + "</b></span>";
    html += "<span>to <b>" + esc(money(row.to)) + "</b></span>";
    html += '<span class="delta ' + dir + '">' + sign + Number(row.delta).toFixed(4) + "</span>";
    if (row.candle_volume !== undefined && row.candle_volume !== null) {
      html += "<span>volume <b>" + esc(num(row.candle_volume)) + "</b></span>";
    }
    html += "</div>";
    html += '<div class="links">';
    if (row.source_url) {
      html += '<a href="' + esc(row.source_url) + '" target="_blank" rel="noopener">candlesticks request ↗</a>';
    }
    if (row.market_page) {
      html += '<a href="' + esc(row.market_page) + '" target="_blank" rel="noopener">market ↗</a>';
    }
    if (row.news_search_url) {
      html += '<a href="' + esc(row.news_search_url) + '" target="_blank" rel="noopener">news search (cause unverified) ↗</a>';
    }
    html += "</div>";
    html += "</div>";
    return html;
  }

  function modelHtml(row) {
    var c = row.components || {};
    var move = row.move || {};
    var cur = row.current || {};
    var res = row.resolution || {};
    var dir = move.direction === "up" ? "up" : "down";
    var html = '<div class="msg ' + dir + '">';
    html += '<div class="row1">';
    html += "<span>#" + esc(row.rank) + "</span>";
    html += '<span class="score">QLM ' + esc(row.score === null ? "—" : row.score) + "</span>";
    html += '<span class="tag topic">' + esc(topicLabel(row.topic)) + "</span>";
    html += '<span class="tag">' + esc(move.window || "") + "</span>";
    html += '<span class="tag">' + esc(move.price_basis === "traded" ? "traded close" : "book mid") + "</span>";
    html += "</div>";
    html += '<div class="title"><a href="' + esc(row.market_page) + '" target="_blank" rel="noopener">' +
      esc(row.title || row.market_ticker) + "</a></div>";
    html += '<div class="facts">';
    html += "<span>move <b>" + esc(money(move.from)) + " → " + esc(money(move.to)) + "</b></span>";
    html += '<span class="delta ' + dir + '">' + (Number(move.delta) >= 0 ? "+" : "") + Number(move.delta).toFixed(4) + "</span>";
    html += "<span>age <b>" + esc(row.move_age_text || "—") + "</b></span>";
    html += "<span>ask <b>" + esc(money(cur.yes_ask_implied, 4)) + "</b></span>";
    html += "<span>bid <b>" + esc(money(cur.yes_bid, 4)) + "</b></span>";
    html += "<span>depth <b>" + esc(num(c.depth && c.depth.value)) + "</b></span>";
    html += "<span>24 h $ <b>" + esc(num(c.money_behind && c.money_behind.value)) + "</b></span>";
    html += "<span>close in <b>" + esc(c.horizon && c.horizon.value !== null ?
      Math.round(c.horizon.value) + " h" : "—") + "</b></span>";
    html += "<span>status <b>" + esc(res.status || "—") + "</b></span>";
    html += "<span>result <b>" + esc(res.result === null || res.result === undefined ? "not resolved" : res.result) + "</b></span>";
    html += "</div>";
    if (row.reasons && row.reasons.length) {
      html += '<div class="facts"><span>why: ' + esc(row.reasons.join(" · ")) + "</span></div>";
    }
    if (row.excluded_inputs && row.excluded_inputs.length) {
      html += '<div class="facts"><span>dropped inputs: ' + esc(row.excluded_inputs.join("; ")) + "</span></div>";
    }
    html += '<div class="links">';
    if (row.sources && row.sources.candlesticks) {
      html += '<a href="' + esc(row.sources.candlesticks) + '" target="_blank" rel="noopener">candlesticks request ↗</a>';
    }
    if (row.sources && row.sources.orderbook) {
      html += '<a href="' + esc(row.sources.orderbook) + '" target="_blank" rel="noopener">order book ↗</a>';
    }
    if (row.sources && row.sources.trades) {
      html += '<a href="' + esc(row.sources.trades) + '" target="_blank" rel="noopener">trades request ↗</a>';
    }
    if (row.sources && row.sources.market) {
      html += '<a href="' + esc(row.sources.market) + '" target="_blank" rel="noopener">market request ↗</a>';
    }
    html += '<a href="' + esc(row.market_page) + '" target="_blank" rel="noopener">market ↗</a>';
    html += "</div>";
    html += "</div>";
    return html;
  }

  function ageText(hours) {
    if (hours === null || hours === undefined) return "—";
    if (hours < 0) return "just now";
    if (hours < 1) return Math.round(hours * 60) + " min";
    if (hours < 48) return Math.round(hours) + " h";
    return Math.round(hours / 24) + " d";
  }

  function render() {
    if (!state.feed) return;
    var feed = state.feed;

    var rows = feed.jumps.concat(state.liveRows);
    rows = rows.filter(function (r) {
      return matchesThreshold(r) && matchesWindow(r) && matchesTopic(r);
    });
    rows.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });

    var shown = rows.slice(0, state.shown);
    $("all-stream").innerHTML = shown.length
      ? shown.map(alertHtml).join("")
      : '<p class="empty">No alert of $' + state.threshold.toFixed(2) +
        " or more matches this filter in the committed feed. Widen the window or lower the threshold.</p>";
    $("all-count").textContent = rows.length + (state.liveRows.length ? " (" + state.liveRows.length + " live)" : "");
    $("all-more").hidden = rows.length <= state.shown;
    $("all-more").textContent = "Show " + Math.min(PAGE, rows.length - state.shown) + " older alerts";

    // The window filter describes the candle interval of the *alert* chat.
    // The shortlist already carries each candidate's own most recent qualifying
    // move (and states its window on the row), so only the threshold and the
    // topic filter apply here.
    var shortlist = (feed.shortlist || []).filter(function (r) {
      return matchesThreshold(r.move || {}) && matchesTopic(r);
    });
    $("model-stream").innerHTML = shortlist.length
      ? shortlist.map(modelHtml).join("")
      : '<p class="empty">No shortlisted market matches this filter.</p>';
    $("model-count").textContent = shortlist.length + " of " + (feed.shortlist || []).length;

    $("asof").textContent = "committed feed " + (feed.generated_utc || "—") +
      " · snapshot " + ((feed.inputs && feed.inputs.markets && feed.inputs.markets.generated_utc) || "—");
  }

  function renderTables() {
    var feed = state.feed;
    var model = feed.model || {};
    var weights = model.weights || {};
    var comps = model.components || {};
    var srcs = model.field_sources || {};
    var labels = {
      move_size: "Move size",
      fee_efficiency: "Fee efficiency",
      depth: "Resting depth",
      money_behind: "Money behind it",
      horizon: "Time to close",
      recency: "Freshness"
    };
    var tbody = $("model-table").querySelector("tbody");
    tbody.innerHTML = Object.keys(weights).map(function (k) {
      var src = srcs[k];
      return "<tr><td><b>" + esc(labels[k] || k) + "</b> <code>" + esc(k) + "</code></td><td class=\"num\">" + esc(weights[k]) +
        "</td><td>" + esc(comps[k] || "") + "</td><td>" +
        (src ? '<a class="src" href="' + esc(src) + '" target="_blank" rel="noopener">↗ source</a>' : "—") +
        "</td></tr>";
    }).join("") +
      '<tr><td><b>Total</b></td><td class="num"><b>' +
      esc(Object.keys(weights).reduce(function (a, k) { return a + weights[k]; }, 0).toFixed(2)) +
      "</b></td><td>" + esc(model.formula || "") + "</td><td>—</td></tr>";

    $("limits-table").querySelector("tbody").innerHTML = (model.limits || []).map(function (l) {
      return "<tr><td>" + esc(l) + "</td><td>—</td></tr>";
    }).join("");

    var cov = feed.coverage || {};
    var rows = [
      ["Markets with official candles in the committed snapshot", cov.markets_with_candles,
        "Candles are collected for the top market of each tracked topic, not for every market."],
      ["Candles scanned", cov.candles_scanned, "Across all three published candle windows."],
      ["Alerts published (all topics, all windows)", cov.alerts_published,
        "Moves of at least $" + (feed.threshold_dollars || 0.10).toFixed(2) + " between adjacent closes."],
      ["Alerts by window", JSON.stringify(cov.alerts_by_window || {}),
        "1-minute windows are the sudden moves; 1-day windows are close-to-close changes."],
      ["Alerts by topic", JSON.stringify(cov.alerts_by_topic || {}),
        "A topic with no entry produced no qualifying move in the scanned windows."],
      ["Markets with no qualifying move", (cov.markets_without_an_alert || []).length,
        (cov.markets_without_an_alert || []).map(function (m) {
          return esc(m.market_ticker) + " (" + esc(m.topic) + ")";
        }).join(", ") || "—"],
      ["Shortlisted markets", cov.shortlisted_markets,
        "One candidate per market with a qualifying move; ranked by the QLM score."],
      ["Live polling", state.live ? "on" : "off",
        state.live ? "The page asks the demo API for 1-minute candles every 30 seconds." :
          "Switch on “Poll the live API every 30 s” to add moves that are newer than the committed feed."]
    ];
    $("coverage-table").querySelector("tbody").innerHTML = rows.map(function (r) {
      return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>";
    }).join("");
  }

  /* ------------------------------------------------------------------ */
  /* live polling                                                         */
  /* ------------------------------------------------------------------ */

  function closeOf(c) {
    if (!c) return null;
    if (c.price && c.price.close_dollars !== null && c.price.close_dollars !== undefined) {
      return { close: Number(c.price.close_dollars), basis: "traded" };
    }
    var bid = c.yes_bid && c.yes_bid.close_dollars;
    var ask = c.yes_ask && c.yes_ask.close_dollars;
    if (bid !== null && bid !== undefined && ask !== null && ask !== undefined) {
      return { close: (Number(bid) + Number(ask)) / 2, basis: "book_mid" };
    }
    return null;
  }

  function pollOnce() {
    var feed = state.feed;
    if (!feed) return Promise.resolve();
    var base = feed.base;
    var now = Math.floor(Date.now() / 1000);
    var scan = feed.scan_list || [];
    var jobs = scan.map(function (s) {
      var seed = state.lastClose[s.market_ticker];
      var startTs = seed && seed.t ? seed.t : now - 3600;
      var url = base + "/series/" + encodeURIComponent(s.series_ticker) +
        "/markets/" + encodeURIComponent(s.market_ticker) + "/candlesticks" +
        "?start_ts=" + startTs + "&end_ts=" + now + "&period_interval=1";
      return fetch(url, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          var cs = (d.candlesticks || []).slice().sort(function (a, b) {
            return a.end_period_ts - b.end_period_ts;
          });
          var prev = seed ? seed.close : null;
          var prevT = seed ? seed.t : null;
          var fresh = [];
          cs.forEach(function (c) {
            var co = closeOf(c);
            if (!co) return;
            if (prev !== null && Math.abs(co.close - prev) >= state.threshold - 1e-9) {
              fresh.push({
                t: c.end_period_ts,
                time_utc: new Date(c.end_period_ts * 1000).toISOString().replace(".000", ""),
                topic: s.topic,
                market_ticker: s.market_ticker,
                series_ticker: s.series_ticker,
                title: s.title,
                event_title: s.event_title,
                from: prev,
                to: co.close,
                delta: co.close - prev,
                direction: co.close >= prev ? "up" : "down",
                window: "1m/6h",
                price_basis: co.basis,
                live: true,
                source_url: url,
                market_page: "https://kalshi.com/markets/" + s.market_ticker,
                news_search_url: "https://news.google.com/search?q=" +
                  encodeURIComponent((s.event_title || s.title || s.market_ticker) + " Kalshi")
              });
            }
            prev = co.close;
            prevT = c.end_period_ts;
          });
          if (prev !== null) state.lastClose[s.market_ticker] = { close: prev, t: prevT };
          return fresh;
        })
        .catch(function (e) {
          state.pollErrors.push(url + " — " + e.message);
          return [];
        });
    });

    return Promise.all(jobs).then(function (sets) {
      var fresh = [];
      sets.forEach(function (s) { fresh = fresh.concat(s); });
      if (fresh.length) {
        state.liveRows = state.liveRows.concat(fresh);
        state.liveRows.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
        render();
      }
      if (state.pollErrors.length) {
        status("err", "live polling blocked on " + state.pollErrors.length +
          " request(s) — showing the committed feed");
      } else {
        status("live", "live · " + scan.length + " markets polled · " +
          new Date().toISOString().slice(11, 19) + " UTC");
      }
    });
  }

  function toggleLive(on) {
    state.live = on;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (!on) {
      status("snap", "committed feed only · snapshot " +
        ((state.feed.inputs && state.feed.inputs.markets &&
          state.feed.inputs.markets.generated_utc) || "—"));
      return;
    }
    status("snap", "connecting to the official demo API…");
    pollOnce().then(function () {
      state.timer = setInterval(pollOnce, 30000);
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                 */
  /* ------------------------------------------------------------------ */

  function boot() {
    fetch(FEED_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + FEED_URL);
        return r.json();
      })
      .then(function (feed) {
        state.feed = feed;
        (feed.scan_list || []).forEach(function (s) {
          state.lastClose[s.market_ticker] = { close: s.seed_close, t: s.seed_t };
        });
        (feed.shortlist || []).forEach(function (r) {
          r.move_age_text = ageText(r.move ? r.move.age_hours_at_snapshot : null);
        });
        renderTables();
        render();
        status("snap", "committed feed · snapshot " +
          ((feed.inputs && feed.inputs.markets && feed.inputs.markets.generated_utc) || "—") +
          " · live polling off");
      })
      .catch(function (e) {
        $("all-stream").innerHTML = '<p class="empty">Could not load the committed feed (' +
          esc(FEED_URL) + "): " + esc(e.message) +
          ". The file ships with this repository; if you are running the site from a fork, check that " +
          "<code>alerts/data/feed.json</code> exists.</p>";
        status("err", "committed feed failed to load");
      });

    $("threshold").addEventListener("change", function (e) {
      state.threshold = Number(e.target.value);
      state.shown = PAGE;
      render();
    });
    $("window").addEventListener("change", function (e) {
      state.window = e.target.value;
      state.shown = PAGE;
      render();
    });
    $("topic").addEventListener("change", function (e) {
      state.topic = e.target.value;
      state.shown = PAGE;
      render();
    });
    $("all-more").addEventListener("click", function () {
      state.shown += PAGE;
      render();
    });
    $("live-toggle").addEventListener("change", function (e) {
      toggleLive(e.target.checked);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
