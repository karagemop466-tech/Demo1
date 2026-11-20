/* Shared navigation + connection status pill */
(function () {
  const pages = [
    ["index.html", "Home"],
    ["executive-summary.html", "Executive summary"],
    ["dashboard.html", "Dashboard"],
    ["markets.html", "Markets"],
    ["portfolio.html", "Portfolio"],
    ["trades.html", "Trades"],
    ["suggestions.html", "Suggestions"],
    ["questions.html", "Questions"],
    ["flagged.html", "Flagged"],
    ["sources.html", "Sources"]
  ];
  const here = location.pathname.split("/").pop() || "index.html";

  const header = document.createElement("header");
  header.className = "site";
  header.innerHTML =
    '<div class="wrap">' +
      '<a class="logo" href="index.html">Kalshi<span>Demo</span> Dashboard</a>' +
      '<nav class="main">' +
        pages.map(p => '<a href="' + p[0] + '"' + (p[0] === here ? ' class="active"' : "") + ">" + p[1] + "</a>").join("") +
      "</nav>" +
      '<span class="status-pill" id="conn-pill" title="Live data connection"><span class="dot"></span><span id="conn-text">connecting…</span></span>' +
    "</div>";
  document.body.prepend(header);

  const footer = document.createElement("footer");
  footer.className = "site";
  footer.innerHTML = '<div class="wrap">Data served live from the official Kalshi <b>demo</b> Trade API — ' +
    '<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo environment docs</a>. ' +
    'Demo prices may not reflect real markets. Not financial advice. ' +
    'Unverified items: <a href="flagged.html">Flagged for Review</a> · Sources: <a href="sources.html">Sources</a></div>';
  document.body.appendChild(footer);

  function render(s) {
    const pill = document.getElementById("conn-pill");
    const txt = document.getElementById("conn-text");
    if (!pill) return;
    pill.className = "status-pill";
    if (s.transport === "direct") { pill.classList.add("live"); txt.textContent = "LIVE · official API"; }
    else if (s.transport === "relay") { pill.classList.add("live"); txt.textContent = "LIVE · via flagged relay"; }
    else if (s.transport === "unavailable") { pill.classList.add("err"); txt.textContent = "BLOCKED · see Flagged"; }
    else txt.textContent = "connecting…";
  }
  if (window.KALSHI) {
    KALSHI.onStatus(render);
    render(KALSHI.state);
    // Probe once so pages that don't fetch data still show a truthful connection pill.
    if (!KALSHI.state.transport) KALSHI.get("/markets", { limit: 1 }).catch(function () {});
  }
})();
