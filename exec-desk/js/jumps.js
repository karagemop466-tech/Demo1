/* Sharp-jump scanner: consecutive 1-min candle closes differing by >= threshold.
   Official endpoint: GET /series/{series}/markets/{ticker}/candlesticks?period_interval=1
   https://docs.kalshi.com/api-reference/market/get-market-candlesticks */
(function () {
  const K = window.KALSHI, CFG = K.CFG;
  const TOPICS = Object.keys(CFG.topics);
  const S = { threshold: 0.10, windowSec: 3600, scanning: false };
  const $ = id => document.getElementById(id);

  function banner() {
    const b = $("conn-banner");
    if (K.state.transport === "direct") { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = K.state.transport === "relay"
      ? "Direct API blocked by browser — using flagged third-party relay (UNVERIFIED-03)."
      : "Kalshi demo API unreachable from this browser. See <a href='flagged.html'>Flagged for Review</a>.";
  }
  K.onStatus(banner); banner();

  function closeOf(c) {
    const p = K.num(c.price && c.price.close_dollars);
    if (p !== null) return p;
    const b = K.num(c.yes_bid && c.yes_bid.close_dollars), a = K.num(c.yes_ask && c.yes_ask.close_dollars);
    return (b !== null && a !== null) ? (b + a) / 2 : null;
  }

  async function scan() {
    if (S.scanning) return; S.scanning = true;
    $("scan-note").textContent = "Scanning…";
    const tb = $("jump-table").querySelector("tbody");
    tb.innerHTML = '<tr><td colspan="9" class="empty">Scanning top markets…</td></tr>';
    try {
      const allSeries = await K.getPaged("/series", { include_volume: "true" }, "series", 3);
      const byTopic = {}; TOPICS.forEach(t => byTopic[t] = []);
      allSeries.forEach(s => { const t = K.topicOf(s); if (t) byTopic[t].push(s); });
      const candidates = [];
      await Promise.all(TOPICS.map(async topic => {
        const top = (byTopic[topic] || []).sort((a, b) => (K.num(b.volume_fp) || 0) - (K.num(a.volume_fp) || 0)).slice(0, 4);
        const res = await Promise.all(top.map(s =>
          K.get("/events", { series_ticker: s.ticker, status: "open", with_nested_markets: "true", limit: 200 }).catch(() => null)));
        res.forEach(d => {
          if (!d) return;
          (d.events || []).forEach(e => {
            (e.markets || []).forEach(m => candidates.push({ m, e, topic, seriesTicker: e.series_ticker }));
          });
        });
      }));
      candidates.sort((a, b) => (K.dollarVolume24h(b.m) || 0) - (K.dollarVolume24h(a.m) || 0));
      const top = candidates.slice(0, 30); // cap requests; noted on page
      const jumps = [];
      await Promise.all(top.map(async c => {
        try {
          const now = Math.floor(Date.now() / 1000);
          const d = await K.get("/series/" + encodeURIComponent(c.seriesTicker) + "/markets/" + encodeURIComponent(c.m.ticker) + "/candlesticks",
            { start_ts: now - S.windowSec, end_ts: now, period_interval: 1 });
          const cs = (d.candlesticks || []).map(x => ({ t: x.end_period_ts, p: closeOf(x) }))
            .filter(x => x.p !== null).sort((a, b) => a.t - b.t);
          for (let i = 1; i < cs.length; i++) {
            const delta = cs[i].p - cs[i - 1].p;
            if (Math.abs(delta) >= S.threshold) jumps.push({ ...c, t: cs[i].t, from: cs[i - 1].p, to: cs[i].p, delta });
          }
        } catch (e) { /* skip market; banner reflects transport */ }
      }));
      jumps.sort((a, b) => b.t - a.t);
      $("asof").textContent = "Scanned " + top.length + " markets · " + new Date().toISOString().slice(11, 19) + " UTC";
      $("scan-note").textContent = jumps.length
        ? jumps.length + " jump(s) ≥ $" + S.threshold.toFixed(2) + " in window. News links are searches — cause unverified."
        : "No jumps ≥ $" + S.threshold.toFixed(2) + " in the scanned window. Widen the window or lower the threshold.";
      if (!jumps.length) { tb.innerHTML = '<tr><td colspan="9" class="empty">No qualifying jumps found.</td></tr>'; return; }
      tb.innerHTML = jumps.map(j => {
        const title = (j.e.title || j.m.ticker) + " — " + (j.m.yes_sub_title || j.m.ticker);
        const newsQ = encodeURIComponent((j.e.title || j.m.ticker) + " Kalshi");
        return "<tr><td class='mono'>" + new Date(j.t * 1000).toISOString().replace("T", " ").slice(0, 19) + "</td>" +
          "<td>" + K.esc(CFG.topics[j.topic].label) + "</td>" +
          "<td>" + K.esc(title) + "</td>" +
          "<td class='mono'>" + K.esc(j.m.ticker) + "</td>" +
          "<td class='num'>" + j.from.toFixed(2) + "</td><td class='num'>" + j.to.toFixed(2) + "</td>" +
          "<td class='num'>" + (j.delta >= 0 ? "+" : "") + j.delta.toFixed(2) + "</td>" +
          "<td><a href='https://kalshi.com/markets/" + encodeURIComponent(j.m.ticker) + "' target='_blank' rel='noopener'>Kalshi ↗</a></td>" +
          "<td><a href='https://news.google.com/search?q=" + newsQ + "' target='_blank' rel='noopener'>Search news ↗</a></td></tr>";
      }).join("");
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="9" class="empty">Scan failed — API unreachable (see banner).</td></tr>';
    }
    S.scanning = false;
  }

  $("th-seg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$("th-seg").children].forEach(x => x.classList.toggle("on", x === b));
    S.threshold = Number(b.dataset.th); scan();
  });
  $("win-seg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$("win-seg").children].forEach(x => x.classList.toggle("on", x === b));
    S.windowSec = Number(b.dataset.win); scan();
  });
  $("btn-refresh").addEventListener("click", scan);
  scan();
})();
