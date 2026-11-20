/* Markets page — poll open markets per topic until they resolve; record yes/no outcomes. */
(function () {
  const K = window.KALSHI, CFG = K.CFG;
  const TOPICS = Object.keys(CFG.topics);
  const WATCH_KEY = "kd_resolution_watch";

  const S = { topic: "elections", view: "open", seriesByTopic: null, cache: {}, timer: null };

  const $ = id => document.getElementById(id);
  const base = () => CFG.demoRest;

  function banner() {
    const el = $("conn-banner"); if (!el) return;
    const st = K.state;
    if (st.transport === "direct") { el.className = "banner ok"; el.hidden = false; el.innerHTML = "<b>LIVE</b> — official demo API · last success " + K.ago(st.lastOk); }
    else if (st.transport === "relay") { el.className = "banner"; el.hidden = false; el.innerHTML = "<b>LIVE via flagged relay</b> — see <a href='flagged.html'>UNVERIFIED-01/03</a>"; }
    else if (st.transport === "unavailable") { el.className = "banner err"; el.hidden = false; el.innerHTML = "<b>BLOCKED</b> — values stay blank, see <a href='flagged.html'>UNVERIFIED-01</a>"; }
    else el.hidden = true;
  }
  K.onStatus(banner);

  function readWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch (e) { return []; } }
  function writeWatch(list) { localStorage.setItem(WATCH_KEY, JSON.stringify(list.slice(-500))); }
  function observeResolution(m, e) {
    if (!m.result || m.result === "") return;
    const list = readWatch();
    if (list.some(x => x.ticker === m.ticker && x.result === m.result)) return;
    list.push({ ticker: m.ticker, result: m.result, event: e.title || "", sub: m.yes_sub_title || "", at: new Date().toISOString(), topic: S.topic, src: base() + "/markets/" + m.ticker });
    writeWatch(list);
  }

  function renderTopicSeg() {
    $("topic-seg").innerHTML = TOPICS.map(t =>
      '<button data-t="' + t + '"' + (t === S.topic ? ' class="on"' : "") + ">" + CFG.topics[t].label + "</button>").join("");
  }

  async function loadSeries() {
    const all = await K.getPaged("/series", { include_volume: "true" }, "series", 3);
    const by = {}; TOPICS.forEach(t => by[t] = []);
    all.forEach(s => { const t = K.topicOf(s); if (t) by[t].push(s); });
    TOPICS.forEach(t => by[t].sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0)));
    S.seriesByTopic = by;
  }

  async function loadTopic(status) {
    const series = (S.seriesByTopic || {})[S.topic] || [];
    const top = series.slice(0, 6);
    const events = [];
    for (const s of top) {
      try {
        const d = await K.get("/events", { series_ticker: s.ticker, status, with_nested_markets: "true", limit: status === "settled" ? 50 : 200 });
        (d.events || []).forEach(e => events.push(e));
      } catch (e) {}
    }
    S.cache[S.topic + ":" + status] = { ts: Date.now(), events, series };
    return S.cache[S.topic + ":" + status];
  }

  function flatten(c) {
    const out = [];
    c.events.forEach(e => (e.markets || []).forEach(m => out.push({ m, e })));
    return out;
  }

  function row(x) {
    const m = x.m, e = x.e;
    const api = base() + "/markets/" + encodeURIComponent(m.ticker);
    const close = m.close_time ? new Date(m.close_time).toISOString().replace("T", " ").slice(0, 19) : "";
    const watch = readWatch().filter(w => w.ticker === m.ticker).pop();
    const observed = watch
      ? '<span class="badge ' + (watch.result === "yes" ? "yes" : "no") + '">' + watch.result.toUpperCase() + "</span> " + K.ago(watch.at)
      : (m.result ? '<span class="badge ' + (m.result === "yes" ? "yes" : "no") + '">' + K.esc(m.result.toUpperCase()) + "</span> pending log" : "—");
    return "<tr>" +
      "<td><b>" + K.esc(e.title || "") + "</b><br><span class='meta'>" + K.esc(m.yes_sub_title || "") + "</span></td>" +
      '<td class="mono">' + K.esc(m.ticker) + "</td>" +
      "<td>" + K.statusBadge(m.status) + "</td>" +
      "<td>" + K.resultMap(m.result) + "</td>" +
      '<td class="num">' + (K.price(m.last_price_dollars) || K.price(m.yes_bid_dollars) || "—") + "</td>" +
      '<td class="num">' + (K.qty(m.volume_24h_fp) || "—") + "</td>" +
      '<td class="num">' + (K.qty(m.volume_fp) || "—") + "</td>" +
      '<td class="nowrap">' + (close || "—") + "</td>" +
      "<td>" + observed + "</td>" +
      '<td class="src"><a href="' + K.esc(api) + '" target="_blank" rel="noopener">API</a> · ' +
      '<a href="' + CFG.sources.markets + '" target="_blank" rel="noopener">schema</a></td></tr>';
  }

  async function render() {
    const tb = $("m-table").querySelector("tbody");
    tb.innerHTML = '<tr><td colspan="10" class="empty">Loading…</td></tr>';
    $("series-list").textContent = "Topic series used (highest official volume first): " +
      (((S.seriesByTopic || {})[S.topic] || []).slice(0, 6).map(s => s.ticker + " — " + s.title).join(" · ") || "…");
    try {
      if (S.view === "watch") {
        const list = readWatch().slice().reverse();
        if (!list.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">No resolutions observed yet in this browser. Open events are re-polled every 60s; when <span class="mono">result</span> becomes <span class="mono">yes</span>/<span class="mono">no</span> the row is logged here.</td></tr>'; return; }
        tb.innerHTML = list.map(w =>
          "<tr><td>" + K.esc(w.event) + "<br><span class='meta'>" + K.esc(w.sub) + "</span></td>" +
          '<td class="mono">' + K.esc(w.ticker) + "</td>" +
          "<td><span class='badge settled'>observed</span></td>" +
          '<td><span class="badge ' + (w.result === "yes" ? "yes" : "no") + '">' + w.result.toUpperCase() + "</span></td>" +
          '<td colspan="4" class="meta">observed at ' + K.esc(w.at) + " · topic " + K.esc(CFG.topics[w.topic] ? CFG.topics[w.topic].label : w.topic) + "</td>" +
          '<td class="src"><a href="' + K.esc(w.src) + '" target="_blank" rel="noopener">API</a></td></tr>').join("");
        return;
      }
      const status = S.view === "open" ? "open" : "settled";
      let c = S.cache[S.topic + ":" + status];
      if (!c || Date.now() - c.ts > 60000) c = await loadTopic(status);
      let rows = flatten(c);
      if (S.view === "open") rows = rows.filter(x => ["initialized", "inactive", "active"].indexOf(x.m.status) !== -1);
      // record any resolutions we witness while polling open markets
      if (S.view === "open") flatten(c).forEach(x => observeResolution(x.m, x.e));
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="10" class="empty">No ' + (S.view === "open" ? "open" : "settled") +
          " markets found for this topic (or API unreachable — see banner). Classifier: <a href='flagged.html'>UNVERIFIED-06</a>.</td></tr>";
        return;
      }
      rows.sort((a, b) => (K.num(b.m.volume_24h_fp) || 0) - (K.num(a.m.volume_24h_fp) || 0));
      tb.innerHTML = rows.map(row).join("");
      $("asof").textContent = "fetched " + K.ago(new Date(c.ts).toISOString());
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="10" class="empty">Could not load data — see banner / <a href="flagged.html">Flagged</a>.</td></tr>';
    }
  }

  function wire() {
    $("topic-seg").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; S.topic = b.dataset.t; renderTopicSeg(); render(); });
    $("view-seg").addEventListener("click", e => {
      const b = e.target.closest("button[data-view]"); if (!b) return;
      S.view = b.dataset.view;
      $("view-seg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      render();
    });
    $("btn-refresh").addEventListener("click", render);
  }

  async function init() {
    renderTopicSeg(); wire(); banner();
    try { await loadSeries(); } catch (e) {}
    await render();
    S.timer = setInterval(render, 60000);
    setInterval(banner, 5000);
  }
  init();
})();
