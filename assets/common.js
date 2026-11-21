// Shared navigation + helpers for all pages. No external dependencies.
(function () {
  // Primary navigation only. The full inventory of every page (156 at the time of
  // writing) lives in integration/page-directory.html, which is generated from the
  // shipped HTML files by tools/build_directory.py, so trimming this list cannot
  // orphan a page. Root index.html carries the same primary set inline.
  var pages = [
    ["index.html", "Home"],
    ["trade-desk/index.html", "Trader desk"],
    ["trade-desk/chart.html", "Chart & depth"],
    ["trade-desk/resolutions.html", "Resolutions"],
    ["trade-desk/strategies.html", "Paper trades"],
    ["site/index.html", "Topics"],
    ["integration/page-directory.html", "All pages"],
    ["integration/executive-summary.html", "Executive summary"],
    ["integration/flagged-review.html", "Flagged for review"],
    ["site/sources.html", "Sources"]
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
