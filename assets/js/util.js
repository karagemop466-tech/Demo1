/* Small DOM / formatting helpers shared by every page. */

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Fixed-point strings: "13.00" -> 13, "0.4200" -> 0.42. Blank stays null. */
export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function money(value, { sign = false, digits = 2 } = {}) {
  const n = num(value);
  if (n === null) return '';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const prefix = n < 0 ? '-$' : sign ? '+$' : '$';
  return `${prefix}${s}`;
}

/** Price in dollars -> "42.0¢" style display, or "$0.42". */
export function price(value) {
  const n = num(value);
  if (n === null) return '';
  return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function cents(value) {
  const n = num(value);
  if (n === null) return '';
  return `${Math.round(n * 100)}¢`;
}

export function count(value) {
  const n = num(value);
  if (n === null) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function pct(value, digits = 1) {
  const n = num(value);
  if (n === null) return '';
  return `${(n * 100).toFixed(digits)}%`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function fmtDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

export function fmtClock(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** External documentation link rendered as a small monospace anchor. */
export function srcLink(href, label = 'source') {
  return `<a class="srclink" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;
}

/** Blank cell placeholder — never a zero, never an invented value. */
export function dash(value) {
  return value === null || value === undefined || value === '' ? '<span class="small">—</span>' : value;
}

export function toast(message, ms = 4200) {
  let node = document.getElementById('toast');
  if (!node) {
    node = el('div', { id: 'toast', class: 'toast hidden' });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(node._t);
  node._t = setTimeout(() => node.classList.add('hidden'), ms);
}

export function statusBadge(text, kind = 'neutral') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

/** Kalshi market statuses -> badge colour.
 *  https://docs.kalshi.com/getting_started/market_lifecycle */
export function statusKind(status) {
  switch (status) {
    case 'active': return 'ok';
    case 'initialized': return 'info';
    case 'inactive': return 'warn';
    case 'closed': return 'neutral';
    case 'determined': return 'info';
    case 'disputed': return 'warn';
    case 'amended': return 'warn';
    case 'finalized': return 'ok';
    default: return 'neutral';
  }
}

/** Kalshi resolution result -> display. result is yes | no | scalar | null. */
export function resultCell(result) {
  if (!result) return '<span class="result-none">not resolved</span>';
  if (result === 'yes') return '<span class="result-yes">YES</span>';
  if (result === 'no') return '<span class="result-no">NO</span>';
  return `<span class="mono">${esc(result)}</span>`;
}

export function topicCell(topic) {
  if (!topic) return '<span class="small">—</span>';
  const cls = { gas: 'topic-gas', elections: 'topic-elections', culture: 'topic-culture', crypto: 'topic-crypto', golf: 'topic-golf' }[topic] || '';
  const label = { gas: 'gas', elections: 'elections', culture: 'culture', crypto: 'crypto', golf: 'golf' }[topic] || topic;
  return `<span class="topic-tag ${cls}">${esc(label)}</span>`;
}

export function setConn(state, text) {
  const node = document.getElementById('conn');
  if (!node) return;
  node.className = `conn ${state}`;
  const label = node.querySelector('span');
  if (label) label.textContent = text;
}
