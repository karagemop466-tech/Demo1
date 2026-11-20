/* Shared shell: header, navigation, footer, connection indicator.
 *
 * The header and footer are injected here so all pages stay consistent and a
 * page only has to describe its own content. Pages that need a link map in
 * <body data-page="markets"> so the correct nav item is highlighted.
 */

import { API, DOC } from './config.js';
import { setConn } from './util.js';

const NAV = [
  {
    group: 'Overview',
    items: [
      { id: 'home', label: 'Home', href: '../index.html', rootHref: 'index.html' },
      { id: 'summary', label: 'Executive summary', href: '../summary/', rootHref: 'summary/' },
    ],
  },
  {
    group: 'Market data',
    items: [
      { id: 'markets', label: 'Markets', href: '../markets/', rootHref: 'markets/' },
      { id: 'chart', label: 'Price chart', href: '../chart/', rootHref: 'chart/' },
      { id: 'liquidity', label: 'Liquidity', href: '../liquidity/', rootHref: 'liquidity/' },
      { id: 'events', label: 'Events & resolution', href: '../events/', rootHref: 'events/' },
    ],
  },
  {
    group: 'Demo account',
    items: [
      { id: 'portfolio', label: 'Portfolio', href: '../portfolio/', rootHref: 'portfolio/' },
      { id: 'trading', label: 'Trading', href: '../trading/', rootHref: 'trading/' },
      { id: 'analysis', label: 'Trade analysis', href: '../analysis/', rootHref: 'analysis/' },
    ],
  },
  {
    group: 'Review',
    items: [
      { id: 'suggestions', label: 'Suggestions', href: '../suggestions/', rootHref: 'suggestions/' },
      { id: 'questions', label: 'Questions & gaps', href: '../questions/', rootHref: 'questions/' },
      { id: 'sources', label: 'Sources', href: '../sources/', rootHref: 'sources/' },
      { id: 'flagged', label: 'Flagged for review', href: '../flagged/', rootHref: 'flagged/' },
    ],
  },
];

function depth() {
  const path = window.location.pathname;
  return /\/[^/]+\/[^/]*$/.test(path) && !path.endsWith('/index.html') ? 1 : 0;
}

function resolve(href, isRoot) {
  if (isRoot) return href.replace(/^\.\.\//, '');
  return href;
}

function renderHeader() {
  const host = document.getElementById('site-header');
  if (!host) return;
  const page = document.body.dataset.page || '';
  const isRoot = document.body.dataset.root === 'true';
  const links = NAV.flatMap((g) =>
    g.items.map((i) => {
      const href = isRoot ? i.rootHref : i.href;
      const cls = i.id === page ? ' class="active"' : '';
      return `<a href="${href}"${cls}>${i.label}</a>`;
    }),
  );
  // Rebuild grouped markup
  const groups = NAV.map((g) => {
    const items = g.items
      .map((i) => {
        const href = isRoot ? i.rootHref : i.href;
        const cls = i.id === page ? ' class="active"' : '';
        return `<a href="${href}"${cls}>${i.label}</a>`;
      })
      .join('');
    return `<div class="navgroup"><span class="navgroup-label">${g.group}</span><div class="navgroup-items">${items}</div></div>`;
  }).join('');

  host.innerHTML = `
    <div class="top">
      <div class="top-inner top-row">
        <a class="brand" href="${isRoot ? 'index.html' : '../index.html'}">
          <span class="mark">K</span> KALSHI <span class="env">DEMO</span>
        </a>
        <div class="conn" id="conn"><i class="dot"></i><span>idle</span></div>
      </div>
      <div class="navwrap"><nav class="topnav">${groups}</nav></div>
    </div>`;
  void links;
}

function renderFooter() {
  const host = document.getElementById('site-footer');
  if (!host) return;
  const isRoot = document.body.dataset.root === 'true';
  const prefix = isRoot ? '' : '../';
  host.innerHTML = `
    <footer>
      <div class="foot-inner">
        <span>Kalshi Demo Monitor · static research dashboard · demo environment only (mock funds)</span>
        <span>
          REST base <code class="mono">${API.demoRest}</code> ·
          <a href="${DOC.environments}" target="_blank" rel="noreferrer">official docs ↗</a> ·
          <a href="${prefix}sources/">source index</a> ·
          <a href="${prefix}flagged/">flagged for review</a>
        </span>
      </div>
    </footer>`;
}

function markYear() {
  document.querySelectorAll('[data-year]').forEach((n) => {
    n.textContent = String(new Date().getFullYear());
  });
}

export function setConnection(state, text) {
  setConn(state, text);
}

export function pageDepth() {
  return depth();
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  markYear();
  setConn('offline', 'connecting…');
});
