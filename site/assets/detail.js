/* Market detail page. Renders ONLY fields present in the collected snapshot. */
(function () {
  var me = document.currentScript;
  var host = document.getElementById('detail');
  if (!me || !host) return;

  var params = new URLSearchParams(location.search);
  var ticker = params.get('t');
  var base = me.getAttribute('data-explore') || 'explore-data.json';

  function n(v, suffix) {
    if (v === null || v === undefined || v === '') return "<span class='na'>\u2014</span>";
    return String(v) + (suffix || '');
  }
  function c(v) {
    if (v === null || v === undefined || v === '') return "<span class='na'>\u2014</span>";
    var f = parseFloat(v);
    return isNaN(f) ? String(v) : (f * 100).toFixed(1);
  }
  function a(url, label) {
    if (!url) return "<span class='na'>\u2014</span>";
    return "<a href='" + url + "' target='_blank' rel='noreferrer'>" + (label || 'request') + " \u2197</a>";
  }

  if (!ticker) {
    host.innerHTML = "<div class='callout'>Pick a market from the " +
      "<a href='markets.html'>live market table</a>, the <a href='resolved.html'>resolved table</a>, " +
      "or the <a href='explore.html'>data browser</a>.</div>";
    return;
  }

  fetch(base).then(function (r) { return r.json(); }).then(function (d) {
    var m = (d.records || []).filter(function (x) { return x.mt === ticker; })[0];
    if (!m) {
      host.innerHTML = "<div class='callout warn'>No record for <code>" +
        ticker.replace(/[<>&]/g, '') + "</code> in this snapshot.</div>" +
        "<p class='fine'><a href='explore.html'>Browse all collected records</a></p>";
      return;
    }
    var rows = [
      ['Ticker', "<code>" + m.mt + "</code>"],
      ['Series', "<code>" + n(m.s) + "</code>"],
      ['Topic (rule-based)', n(m.t)],
      ['Title', n(m.tt)],
      ['Status', n(m.st)],
      ['Result', m.rs ? "<b>" + m.rs.toUpperCase() + "</b>" : "<span class='na'>not resolved</span>"],
      ['Settlement value', n(m.sv)],
      ['Settled (UTC)', n(m.sts)],
      ['YES bid \u00a2', c(m.yb)],
      ['Contracts at YES bid', n(m.ybz)],
      ['YES ask \u00a2', c(m.ya)],
      ['Last price \u00a2', c(m.lp)],
      ['24h volume (contracts)', n(m.v24)],
      ['Total volume (contracts)', n(m.v)],
      ['Open interest (contracts)', n(m.oi)],
      ['Close time', n(m.ct)],
      ['Order book retrieved', m.ob ? 'yes' : 'no'],
      ['Official market record', a(m.url, 'open official JSON')]
    ];
    host.innerHTML = "<div class='tablewrap'><table><tbody>" +
      rows.map(function (r) {
        return "<tr><th style='width:250px'>" + r[0] + "</th><td>" + r[1] + "</td></tr>";
      }).join('') + "</tbody></table></div>" +
      "<p class='fine'>Every value above is copied from the collected official response for this ticker; " +
      "an em dash means the field was absent. Charts and full bid ladders for this market are on the " +
      "<a href='liquidity.html'>liquidity page</a>.</p>";
  }).catch(function (e) {
    host.innerHTML = "<div class='callout bad'>Could not load the dataset (" + e + ").</div>";
  });
})();
