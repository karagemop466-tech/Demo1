/* Flagged-for-Review renderer — flags come from js/config.js (single source of truth). */
(function () {
  const K = window.KALSHI, CFG = K.CFG;
  const $ = id => document.getElementById(id);

  function renderFlags() {
    $("flag-list").innerHTML = CFG.flags.map(f =>
      '<div class="flag"><h4>' + K.esc(f.id) + " — " + K.esc(f.title) + "</h4>" +
      '<div class="meta">' + K.esc(f.detail) + "</div>" +
      '<div class="meta" style="margin-top:6px"><b>How to verify:</b> ' + K.esc(f.check) + "</div>" +
      '<div class="meta" style="margin-top:4px"><b>Official source:</b> <a href="' + f.src + '" target="_blank" rel="noopener">' + f.src + "</a></div>" +
      "</div>").join("");
  }

  async function probe() {
    const el = $("live-state");
    try {
      const d = await K.get("/exchange/status");
      el.innerHTML = '<span class="badge open">reachable</span> — official demo API answered (HTTP 200). Transport: <b>' +
        K.esc(K.state.transport || "?") + "</b>.";
    } catch (e) {
      // exchange/status may be path-different; fall back to a public market read
      try {
        const m = await K.get("/markets", { limit: 1 });
        el.innerHTML = '<span class="badge open">reachable</span> — official demo API answered (public market read). Transport: <b>' +
          K.esc(K.state.transport || "?") + "</b>.";
      } catch (e2) {
        el.innerHTML = '<span class="badge no">blocked</span> — official API not reachable from this browser (' +
          K.esc(K.state.lastError || "unknown error") + '). See UNVERIFIED-01.';
      }
    }
  }

  renderFlags(); probe();
  setInterval(() => { renderFlags(); }, 15000);
})();
