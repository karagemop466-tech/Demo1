// Shared navigation + helpers for all pages. No external dependencies.
(function () {
  var pages = [
    ["index.html", "Home"],
    ["alerts.html", "Price swing alerts"],
    ["site/gas-prices.html", "Gas prices"],
    ["site/elections.html", "Elections"],
    ["site/culture.html", "Culture"],
    ["site/crypto.html", "Crypto"],
    ["site/golf.html", "Golf"],
    ["site/index.html", "Topic snapshots"],
    ["exec-desk/dashboard.html", "Live desk"],
    ["desk/index.html", "Consolidated desk"],
    ["exec-desk/jumps.html", "Price jumps"],
    ["exec-desk/markets.html", "Resolutions"],
    ["pages/paper-trading.html", "Paper strategies"],
    ["integration/executive-summary.html", "Executive summary"],
    ["exec-desk/sources.html", "Sources"],
    ["integration/flagged-review.html", "Flagged for Review"],
    ["pages/price-jumps.html", "Earlier jump scan"],
    ["executive-summary.html", "Earlier summary"],
    ["markets.html", "Earlier markets"],
    ["dashboard.html", "Earlier dashboard"],
    ["portfolio.html", "Earlier portfolio"],
    ["analysis.html", "Analysis"],
    ["questions.html", "Questions & gaps"],
    ["suggestions.html", "Suggestions"],
    ["alerts-snapshot.html", "Snapshot alert feed"],
    ["sim-desk/index.html", "Sim strategies"],
    ["engine/index.html", "Strategy engine"],
    ["flagged.html", "Earlier review"],
    ["sources.html", "Earlier sources"],
    ["monitor/index.html", "Monitor (single page)"],
    ["pages/landing-executive-summary.html", "Multi-page site"]
  ];
  var script = document.currentScript;
  var siteRoot = new URL("../", script && script.src ? script.src : location.href);
  var path = location.pathname || "";
  if (siteRoot.pathname.length > 1 && path === siteRoot.pathname.slice(0, -1)) {
    path = siteRoot.pathname;
  }
  var here = path.indexOf(siteRoot.pathname) === 0
    ? path.slice(siteRoot.pathname.length)
    : path.replace(/^\/+/, "");
  if (!here || here.slice(-1) === "/") here += "index.html";
  var nav = document.getElementById("site-nav");
  if (nav) {
    var html = '<header class="top"><a class="brand" href="' + siteRoot.href + '">Kalshi Demo Desk</a>' +
      '<nav aria-label="Main navigation" style="display:flex;flex-wrap:wrap;gap:12px">';
    pages.forEach(function (p) {
      var href = new URL(p[0], siteRoot).href;
      html += '<a href="' + href + '"' + (p[0] === here ? ' class="active" aria-current="page"' : "") + ">" + p[1] + "</a>";
    });
    html += "</nav></header>";
    nav.outerHTML = html;
  }
})();

window.KD = {
  esc: function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  },
  fmtPrice: function (v) {
    if (v === "" || v == null) return '<span class="blank">blank</span>';
    var n = Number(v);
    return "$" + n.toFixed(4) + " <span class='note'>(" + (n * 100).toFixed(1) + "¢)</span>";
  },
  fmtNum: function (v) {
    if (v === "" || v == null) return '<span class="blank">blank</span>';
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  },
  verTag: function (v) {
    if (v === "verified") return '<span class="tag t-ver">Verified</span>';
    return '<span class="tag t-unv">Unverified</span>';
  }
};
