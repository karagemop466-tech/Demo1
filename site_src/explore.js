/* Raw data browser. Renders exactly what was collected; no derived pricing. */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var recs = [];
  var fTopic = document.getElementById('fTopic');
  var fStatus = document.getElementById('fStatus');
  var fResult = document.getElementById('fResult');
  var fQ = document.getElementById('fQ');
  var fLimit = document.getElementById('fLimit');
  var fBody = document.getElementById('fBody');
  var fCount = document.getElementById('fCount');
  var TOPIC = { gas_prices: 'Gas prices', elections: 'Elections', culture: 'Culture', crypto: 'Crypto', golf: 'Golf' };

  function c(v) { if (v === null || v === undefined || v === '') return '<span class="na">\u2014</span>';
    var f = parseFloat(v); return isNaN(f) ? String(v) : (f * 100).toFixed(1); }
  function n(v) { return (v === null || v === undefined || v === '') ? '<span class="na">\u2014</span>' : String(v); }

  function render() {
    var q = (fQ.value || '').toLowerCase().trim();
    var lim = parseInt(fLimit.value, 10) || 100;
    var out = [];
    for (var i = 0; i < recs.length && out.length < lim; i++) {
      var r = recs[i];
      if (fTopic.value && r.t !== fTopic.value) continue;
      if (fStatus.value && r.st !== fStatus.value) continue;
      if (fResult.value === 'none' && r.rs) continue;
      if (fResult.value && fResult.value !== 'none' && (r.rs || '').toLowerCase() !== fResult.value) continue;
      if (q && !((r.mt || '').toLowerCase().indexOf(q) >= 0 || (r.tt || '').toLowerCase().indexOf(q) >= 0)) continue;
      out.push(r);
    }
    fCount.textContent = out.length + ' of ' + recs.length + ' records shown' +
      (out.length >= lim ? ' (row limit reached — raise it or narrow the filters)' : '');
    fBody.innerHTML = out.map(function (r) {
      return '<tr><td>' + (TOPIC[r.t] || r.t) + '</td>' +
        '<td><code>' + r.mt + '</code></td>' +
        '<td>' + (r.tt || '') + '</td>' +
        '<td>' + (r.st || '') + '</td>' +
        '<td>' + (r.rs ? r.rs.toUpperCase() : '<span class="na">\u2014</span>') + '</td>' +
        '<td>' + c(r.yb) + '</td><td>' + n(r.ybz) + '</td><td>' + c(r.lp) + '</td>' +
        '<td>' + n(r.v24) + '</td><td>' + n(r.v) + '</td><td>' + n(r.oi) + '</td>' +
        '<td>' + (r.dn === null || r.dn === undefined ? '<span class="na">\u2014</span>'
          : Number(r.dn).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
            (r.dnc === false ? ' <span class="pill warn">lower bound</span>' : '')) + '</td>' +
        '<td>' + n(r.ct) + '</td><td>' + n(r.sts) + '</td>' +
        '<td>' + (r.ob ? 'yes' : '<span class="na">no</span>') + '</td>' +
        '<td>' + (r.url ? '<a href="' + r.url + '" target="_blank" rel="noreferrer">record \u2197</a>' : '\u2014') + '</td></tr>';
    }).join('') || '<tr><td colspan="16" class="empty">No records match these filters.</td></tr>';
  }
  [fTopic, fStatus, fResult, fLimit].forEach(function (x) { x.addEventListener('change', render); });
  fQ.addEventListener('input', render);
  var preset = new URLSearchParams(location.search).get('q');
  if (preset) { fQ.value = preset; }
  fetch(me.getAttribute('data-src'))
    .then(function (r) { return r.json(); })
    .then(function (d) { recs = d.records || []; render(); })
    .catch(function (e) {
      fBody.innerHTML = '<tr><td colspan="16" class="empty">Could not load the dataset (' + e + ').</td></tr>';
    });
})();
