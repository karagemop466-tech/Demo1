/**
 * Kalshi demo REST client — Node 18+ (global fetch), no third-party dependencies.
 *
 * Every endpoint and field used here is documented at https://docs.kalshi.com.
 * Base URLs confirmed at https://docs.kalshi.com/getting_started/api_environments
 *   Demo REST (recommended): https://external-api.demo.kalshi.co/trade-api/v2
 *   Demo REST (also supported): https://demo-api.kalshi.co/trade-api/v2
 *
 * Signing (https://docs.kalshi.com/getting_started/api_keys):
 *   pre-sign text = timestamp_ms + HTTP_METHOD + path_without_query
 *   headers       = KALSHI-ACCESS-KEY / KALSHI-ACCESS-TIMESTAMP / KALSHI-ACCESS-SIGNATURE
 *   RSA key       = RSA-PSS, SHA-256, MGF1-SHA256, salt length = digest length
 *   Ed25519 key   = sign the pre-sign text directly
 */

import crypto from 'node:crypto';

export const DEMO_REST = 'https://external-api.demo.kalshi.co/trade-api/v2';
export const DEMO_REST_ALT = 'https://demo-api.kalshi.co/trade-api/v2';
export const DEMO_WS = 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2';

export const DOC = {
  environments: 'https://docs.kalshi.com/getting_started/api_environments',
  demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
  apiKeys: 'https://docs.kalshi.com/getting_started/api_keys',
  marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
  websockets: 'https://docs.kalshi.com/getting_started/quick_start_websockets',
  lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
  settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
  orderbook: 'https://docs.kalshi.com/getting_started/orderbook_responses',
  rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
  fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
  createOrder: 'https://docs.kalshi.com/getting_started/quick_start_create_order',
  getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
  getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
  getEvents: 'https://docs.kalshi.com/api-reference/events/get-events',
  getCandlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
  getOrderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
  getBalance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
  getPositions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions',
  getFills: 'https://docs.kalshi.com/api-reference/portfolio/get-fills',
  getOrders: 'https://docs.kalshi.com/api-reference/orders/get-orders',
  createOrder: 'https://docs.kalshi.com/api-reference/orders/create-order-v2',
  seriesList: 'https://docs.kalshi.com/api-reference/market/get-series-list',
};

/** Thin JSON fetch with timeout + error text that keeps the API error body. */
export async function getJSON(url, { headers = {}, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk a cursor-paginated collection endpoint.
 * `pagePath` is relative to the API root, e.g. "/markets".
 */
export async function paginate(base, pagePath, query = {}, { maxPages = 40, key = 'markets' } = {}) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(base + pagePath);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await getJSON(url.toString());
    const items = Array.isArray(body?.[key]) ? body[key] : [];
    out.push(...items);
    cursor = body?.cursor || '';
    if (!cursor || items.length === 0) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Request signing                                                     */
/* ------------------------------------------------------------------ */

/** Build the pre-sign text: timestamp + method + path (query string stripped). */
export function presignText(timestampMs, method, path) {
  const cleanPath = path.split('?')[0];
  return `${timestampMs}${method.toUpperCase()}${cleanPath}`;
}

/**
 * Sign a request. `privateKeyPem` may be a PKCS#1 RSA PEM ("BEGIN RSA PRIVATE KEY")
 * or a PKCS#8 PEM ("BEGIN PRIVATE KEY") holding an RSA or Ed25519 key.
 * Returns base64 signature, matching the documented header format.
 */
export function sign(privateKeyPem, timestampMs, method, path) {
  const text = presignText(timestampMs, method, path);
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType === 'ed25519') {
    return crypto.sign(null, Buffer.from(text, 'utf8'), key).toString('base64');
  }
  return crypto
    .sign('sha256', Buffer.from(text, 'utf8'), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString('base64');
}

/** Perform a signed (authenticated) REST call. */
export async function signedRequest({
  base = DEMO_REST,
  method = 'GET',
  path,
  query = {},
  body = null,
  apiKeyId,
  privateKeyPem,
  timeoutMs = 30000,
}) {
  if (!apiKeyId || !privateKeyPem) throw new Error('Missing Kalshi credentials');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const timestampMs = Date.now();
  const signature = sign(privateKeyPem, timestampMs, method, path);
  const headers = {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
  if (body !== null) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: method.toUpperCase(),
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${method} ${path}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Fixed-point helpers (https://docs.kalshi.com/getting_started/fixed_point_migration) */
/* ------------------------------------------------------------------ */

/** Parse a fixed-point string such as "13.00" into a Number. Returns null when blank. */
export function fp(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse a dollar string such as "0.4200" into a Number. Returns null when blank. */
export function usd(value) {
  return fp(value);
}
