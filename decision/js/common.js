/* Shared chrome: nav, status banner, snapshot fallback loader. */
(function (global) {
  'use strict';

  var PAGES = [
    ['index.html', 'Overview'],
    ['dashboard.html', 'Live desk'],
    ['resolutions.html', 'Resolution tracker'],
    ['portfolio.html', 'Live portfolio'],
    ['trading.html', 'Demo trading'],
    ['requirements.html', 'Requirements matrix'],
    ['api-notes.html', 'API verification'],
    ['../flagged.html', 'Flagged for review ↗'],
    ['../index.html', '← Main hub']
  ];

  function renderNav(active) {
    var links = PAGES.map(function (p) {
      return '<a href="' + p[0] + '"' + (p[0] === active ? ' class="active" aria-current="page"' : '') + '>' + p[1] + '</a>';
    }).join('');
    var el = document.getElementById('site-nav');
    if (el) el.innerHTML = links;
  }

  function setConn(state, text) {
    var c = document.getElementById('conn');
    if (!c) return;
    c.className = 'conn ' + state;
    document.getElementById('conn-text').textContent = text;
  }

  /* Load a committed, provenance-stamped snapshot as fallback when the live
   * demo API cannot be reached from the browser. Never used to invent values. */
  function loadSnapshot(name) {
    return fetch('data/' + name).then(function (r) {
      if (!r.ok) throw new Error('snapshot ' + name + ' missing');
      return r.json();
    });
  }

  function renderMeta(meta, targetId) {
    var el = document.getElementById(targetId);
    if (!el || !meta) return;
    el.innerHTML = 'Snapshot collected <b>' + KALSHI.esc(meta.collected_at_utc) + '</b> via GET requests to the official demo API. ' +
      'Each row links its exact source URL. Values are excerpts of the raw responses — nothing inferred.';
  }

  global.SITE = {
    renderNav: renderNav, setConn: setConn, loadSnapshot: loadSnapshot, renderMeta: renderMeta,
    pages: PAGES
  };
})(window);
