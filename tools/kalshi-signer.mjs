#!/usr/bin/env node
/*
 * Kalshi demo — local signed-request bridge (optional, run locally by the account owner).
 *
 * Why this exists
 *  - The authenticated Kalshi endpoints (balance, positions, fills, order create/cancel)
 *    require three headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE, KALSHI-ACCESS-TIMESTAMP,
 *    where the signature is over  `timestamp + METHOD + path`  (path from the API root, no query
 *    string) using the account's private key. Source:
 *      https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md
 *      https://docs.kalshi.com/getting_started/quick_start_create_order.md
 *      https://docs.kalshi.com/getting_started/api_environments.md  (demo base URLs)
 *  - A private key can never live in a GitHub Pages bundle, and browsers cannot add custom
 *    headers to a WebSocket handshake (so the WS API is also out of reach for a static page):
 *      https://docs.kalshi.com/getting_started/quick_start_websockets.md
 *  - This process keeps the key on your machine, signs requests locally, and adds CORS headers
 *    so the static dashboard can read portfolio data and (only if you enable it) place demo orders.
 *
 * Usage
 *   KALSHI_API_KEY_ID=key_xxx \
 *   KALSHI_PRIVATE_KEY_PEM="$(cat ~/kalshi_demo.pem)" \
 *   node tools/kalshi-signer.mjs
 *
 *   then in the dashboard set the API host to http://localhost:8787/trade-api/v2
 *
 * Guards
 *   - refuses to start without a key id + private key
 *   - allowlist of paths (portfolio reads, order writes, public market data passthrough)
 *   - order writes additionally require ALLOW_ORDERS=1 and only ever target a demo host
 *   - prints no key material; never logs header values
 * No dependency outside the Node standard library.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const ALLOW_ORDERS = process.env.ALLOW_ORDERS === '1';
const KEY_ID = process.env.KALSHI_API_KEY_ID || '';
const PEM = process.env.KALSHI_PRIVATE_KEY_PEM_FILE ? fs.readFileSync(process.env.KALSHI_PRIVATE_KEY_PEM_FILE, 'utf8') : (process.env.KALSHI_PRIVATE_KEY_PEM || '');

const DEMO_HOSTS = ['external-api.demo.kalshi.co', 'demo-api.kalshi.co'];
const BASE = process.env.KALSHI_BASE || 'https://external-api.demo.kalshi.co/trade-api/v2';
const base = new URL(BASE);
if (base.protocol !== 'https:' || !DEMO_HOSTS.includes(base.hostname)) {
  console.error('Refusing to run: KALSHI_BASE must be an https:// URL on a Kalshi *demo* host ' +
    '(' + DEMO_HOSTS.join(' or ') + '). This bridge is demo-only by design.');
  process.exit(1);
}
if (!KEY_ID || !PEM) {
  console.error('Missing KALSHI_API_KEY_ID and/or KALSHI_PRIVATE_KEY_PEM(_FILE).\n' +
    'Public market data does NOT need this bridge — open the dashboard directly. Start it only when you\n' +
    'want the authenticated portfolio reads/order writes, and keep the key out of the repository.');
  process.exit(1);
}

let key;
try { key = crypto.createPrivateKey(PEM); } catch (e) { console.error('Private key could not be parsed: ' + e.message); process.exit(1); }
const keyType = key.asymmetricKeyType;   // 'rsa' -> RSA-PSS/SHA-256, 'ed25519' -> Ed25519 (both accepted by Kalshi)

const READ_PREFIXES = ['/portfolio/balance', '/portfolio/positions', '/portfolio/fills', '/portfolio/settlements',
  '/portfolio/orders', '/portfolio/deposits', '/portfolio/withdrawals', '/portfolio/credit_history', '/markets', '/events', '/series', '/exchange'];
const ORDER_PREFIXES = ['/portfolio/events/orders'];

function allowed(method, path) {
  const p = path.split('?')[0];
  if (method === 'GET') return READ_PREFIXES.some((x) => p.startsWith(x));
  if ((method === 'POST' || method === 'DELETE') && ALLOW_ORDERS) return ORDER_PREFIXES.some((x) => p.startsWith(x));
  return false;
}

function signature(ts, method, signPath) {
  const msg = ts + method + signPath;
  if (keyType === 'ed25519') return crypto.sign(null, Buffer.from(msg), key).toString('base64');
  return crypto.sign('sha256', Buffer.from(msg), { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }).toString('base64');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://localhost');
  const apiPath = url.pathname.replace(/^\/trade-api\/v2/, '') || '/';
  if (!allowed(req.method, apiPath)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'path_not_allowed', path: apiPath, method: req.method, allow_orders: ALLOW_ORDERS }));
  }
  const ts = String(Date.now());
  let body;
  if (req.method !== 'GET') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length) body = Buffer.concat(chunks).toString('utf8');
  }
  const headers = {
    'KALSHI-ACCESS-KEY': KEY_ID,
    'KALSHI-ACCESS-SIGNATURE': signature(ts, req.method, base.pathname + apiPath),   /* signed path excludes the query string */
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'Accept': 'application/json'
  };
  if (body) headers['Content-Type'] = 'application/json';

  const target = base.origin + base.pathname + apiPath + url.search;
  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    console.log(new Date().toISOString(), req.method, target, '->', upstream.status, text.length + ' bytes');
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (e) {
    console.log(new Date().toISOString(), req.method, target, '-> transport error:', e.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bridge_transport_error', detail: e.message, target }));
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Kalshi demo bridge listening on http://0.0.0.0:' + PORT + base.pathname);
  console.log('  signing with: ' + keyType.toUpperCase() + ' (key id ' + KEY_ID.slice(0, 6) + '…), upstream ' + base.origin + base.pathname);
  console.log('  order writes: ' + (ALLOW_ORDERS ? 'ENABLED (ALLOW_ORDERS=1) — real demo-environment orders will be placed' : 'disabled'));
  console.log('  point the dashboard API host at http://localhost:' + PORT + base.pathname);
});
