/* Kalshi REST client for the browser.
 *
 * Public market data (markets, events, order books, candlesticks) needs no
 * authentication:
 *   https://docs.kalshi.com/getting_started/quick_start_market_data
 *
 * Account data (balance, positions, fills, orders) and order entry require a
 * signed request:
 *   https://docs.kalshi.com/getting_started/api_keys
 *   pre-sign text = timestamp_ms + METHOD + path_without_query
 *   headers       = KALSHI-ACCESS-KEY / KALSHI-ACCESS-TIMESTAMP / KALSHI-ACCESS-SIGNATURE
 *
 * The signature is produced with the Web Crypto API so nothing has to leave the
 * browser and no private key is ever stored on a server by this project.
 */

import { API, TRANSPORTS } from './config.js';

export const transportState = {
  active: null,
  tried: [],
  lastError: null,
  lastOkAt: null,
};

/** Build an absolute Kalshi demo API URL. */
export function apiUrl(path, query = {}) {
  const url = new URL(API.demoRest + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Fetch JSON over the first transport that works.
 * @returns {Promise<{data: object, transport: string, url: string}>}
 */
export async function apiGet(path, query = {}, { transports = TRANSPORTS, timeoutMs = 20000 } = {}) {
  const target = apiUrl(path, query);
  const tried = [];
  for (const t of transports) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(t.build(target), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      transportState.active = t.id;
      transportState.tried = tried.concat(t.id);
      transportState.lastError = null;
      transportState.lastOkAt = new Date().toISOString();
      return { data, transport: t.id, url: target };
    } catch (err) {
      tried.push(`${t.id}: ${err.message}`);
      transportState.tried = tried;
      transportState.lastError = err.message;
    }
  }
  const e = new Error(`All transports failed for ${path}: ${tried.join(' | ')}`);
  e.tried = tried;
  throw e;
}

/** Paginate a collection endpoint using the documented `cursor` parameter. */
export async function apiPaginate(path, query = {}, { key = 'markets', maxPages = 12 } = {}) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < maxPages; i++) {
    const q = { ...query, limit: query.limit ?? 1000 };
    if (cursor) q.cursor = cursor;
    const { data } = await apiGet(path, q);
    const items = Array.isArray(data?.[key]) ? data[key] : [];
    out.push(...items);
    cursor = data?.cursor || '';
    if (!cursor || items.length === 0) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

/** Parse a PEM block into DER bytes plus the PEM label. */
export function pemToDer(pem) {
  const m = String(pem).match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]+?)-----END \1-----/);
  if (!m) throw new Error('Could not parse PEM: expected a -----BEGIN ...----- block');
  return { label: m[1].trim(), der: b64ToBytes(m[2]) };
}

/** DER length encoder (short and long form). */
function derLen(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function derTLV(tag, content) {
  return Uint8Array.from([tag, ...derLen(content.length), ...content]);
}

/**
 * Wrap a PKCS#1 RSA private key (the PEM Kalshi generates for RSA keys,
 * "BEGIN RSA PRIVATE KEY") in a PKCS#8 envelope so Web Crypto can import it.
 * Structure: SEQUENCE { INTEGER 0, AlgorithmIdentifier{rsaEncryption, NULL},
 *                        OCTET STRING { pkcs1 } }
 */
export function pkcs1ToPkcs8(pkcs1) {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const rsaOid = Uint8Array.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  const nul = Uint8Array.from([0x05, 0x00]);
  const algId = derTLV(0x30, Uint8Array.from([...rsaOid, ...nul]));
  const keyOctets = derTLV(0x04, pkcs1);
  const body = Uint8Array.from([...version, ...algId, ...keyOctets]);
  return derTLV(0x30, body);
}

/** Read the algorithm OID out of a PKCS#8 blob. */
function pkcs8Algorithm(der) {
  // SEQUENCE { INTEGER version, SEQUENCE { OID algorithm } ... }
  let i = 0;
  if (der[i++] !== 0x30) return null;
  i++; // outer length (short-form assumption is fine for key sizes we accept)
  if (der[i++] !== 0x02) return null;
  i++; // version length
  i++; // version value
  if (der[i++] !== 0x30) return null;
  i++; // alg id length
  if (der[i++] !== 0x06) return null;
  const oidLen = der[i++];
  const oid = Array.from(der.slice(i, i + oidLen));
  if (oid.join(',') === '43,129,112') return 'Ed25519'; // 1.3.101.112
  return 'RSA';
}

/**
 * Import a Kalshi private key PEM into a Web Crypto signing key.
 * Supports the two key types Kalshi documents:
 *   RSA (2048-bit)  -> RSA-PSS, SHA-256, MGF1-SHA256, salt = digest length
 *   Ed25519         -> Ed25519 signature over the pre-sign text
 */
export async function importSigningKey(pem) {
  const { label, der } = pemToDer(pem);
  let bytes = der;
  let algorithm;
  if (label === 'RSA PRIVATE KEY') {
    bytes = pkcs1ToPkcs8(der);
    algorithm = { name: 'RSA-PSS', hash: 'SHA-256' };
  } else if (label === 'PRIVATE KEY') {
    const kind = pkcs8Algorithm(der);
    algorithm = kind === 'Ed25519' ? { name: 'Ed25519' } : { name: 'RSA-PSS', hash: 'SHA-256' };
    if (kind === 'Ed25519' && !globalThis.crypto?.subtle) {
      throw new Error('This browser does not expose Ed25519 in Web Crypto. Use an RSA (2048-bit) key for browser signing.');
    }
  } else {
    throw new Error(`Unsupported PEM label "${label}". Expected "RSA PRIVATE KEY" or "PRIVATE KEY".`);
  }
  return crypto.subtle.importKey('pkcs8', bytes, algorithm, false, ['sign']);
}

/** Sign a request exactly as Kalshi documents it. */
export async function signRequest(key, timestampMs, method, path) {
  const text = `${timestampMs}${method.toUpperCase()}${path.split('?')[0]}`;
  const sig = await crypto.subtle.sign(
    key.algorithm.name === 'RSA-PSS'
      ? { name: 'RSA-PSS', saltLength: 32 }
      : { name: 'Ed25519' },
    key,
    new TextEncoder().encode(text),
  );
  return bytesToB64(sig);
}

/** Perform a signed (authenticated) request against the demo environment. */
export async function signedRequest({ method = 'GET', path, query = {}, body = null, keyId, privateKeyPem }) {
  if (!keyId || !privateKeyPem) throw new Error('Missing API key id or private key');
  const key = await importSigningKey(privateKeyPem);
  const timestampMs = Date.now();
  const signature = await signRequest(key, timestampMs, method, path);
  const url = new URL(API.demoRest + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const headers = {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), { method: method.toUpperCase(), headers, body: body === null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${method} ${path}${data?.error?.code ? ` (${data.error.code})` : ''}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Typed helpers                                                       */
/* ------------------------------------------------------------------ */

export async function fetchMarkets(status = 'open') {
  return apiPaginate('/markets', { status, limit: 1000 }, { key: 'markets', maxPages: 12 });
}

export async function fetchEvents() {
  return apiPaginate('/events', { with_nested_markets: 'true', limit: 200 }, { key: 'events', maxPages: 12 });
}

export async function fetchOrderbook(ticker, depth = 25) {
  const { data } = await apiGet(`/markets/${encodeURIComponent(ticker)}/orderbook`, { depth });
  const ob = data?.orderbook_fp || data?.orderbook || {};
  const parse = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map(([price, count]) => ({ price: Number(price), count: Number(count) }))
      .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.count))
      .map((l) => ({ ...l, notional: Math.round(l.price * l.count * 100) / 100 }));
  const yes = parse(ob.yes_dollars || ob.yes);
  const no = parse(ob.no_dollars || ob.no);
  const best = (a) => (a.length ? a[a.length - 1].price : null);
  const bestYesBid = best(yes);
  const bestNoBid = best(no);
  return {
    yes,
    no,
    bestYesBid,
    bestNoBid,
    // Kalshi returns bids only; the ask side is derived (orderbook_responses).
    impliedYesAsk: bestNoBid === null ? null : Math.round((1 - bestNoBid) * 10000) / 10000,
    impliedNoAsk: bestYesBid === null ? null : Math.round((1 - bestYesBid) * 10000) / 10000,
    yesDepthContracts: yes.reduce((s, l) => s + l.count, 0),
    noDepthContracts: no.reduce((s, l) => s + l.count, 0),
    yesDepthNotional: yes.reduce((s, l) => s + l.notional, 0),
    noDepthNotional: no.reduce((s, l) => s + l.notional, 0),
  };
}

export async function fetchCandles(seriesTicker, ticker, startTs, endTs, periodInterval = 1) {
  const path = `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`;
  const { data } = await apiGet(path, { start_ts: startTs, end_ts: endTs, period_interval: periodInterval });
  return Array.isArray(data?.candlesticks) ? data.candlesticks : [];
}
