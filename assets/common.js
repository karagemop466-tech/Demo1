// Shared navigation + helpers for all pages. No external dependencies.
(function () {
  var pages = [
    ["index.html", "Home"],
    ["executive-summary.html", "Executive summary"],
    ["markets.html", "Markets by category"],
    ["dashboard.html", "Live dashboard"],
    ["portfolio.html", "Portfolio & trades"],
    ["analysis.html", "Analysis"],
    ["questions.html", "Questions & gaps"],
    ["suggestions.html", "Suggestions"],
    ["flagged.html", "Flagged for Review"],
    ["sources.html", "Sources"],
    ["monitor/index.html", "Monitor (single page)"],
    ["pages/landing-executive-summary.html", "Multi-page site"],
    ["pages/price-jumps.html", "Sharp moves (≥$0.10)"]
  ];
  var here = (location.pathname.split("/").pop() || "index.html");
  var nav = document.getElementById("site-nav");
  if (nav) {
    var html = '<header class="top"><span class="brand">Kalshi Demo Dashboard</span>';
    pages.forEach(function (p) {
      html += '<a href="' + p[0] + '"' + (p[0] === here ? ' class="active"' : "") + ">" + p[1] + "</a>";
    });
    html += "</header>";
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
