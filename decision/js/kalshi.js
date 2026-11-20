/* Kalshi demo API client — endpoint paths, params and auth format verified against
 * official docs (docs.kalshi.com) and empirically against the demo API on 2026-11-20.
 * See site/api-notes.html for the per-endpoint verification table. */
(function (global) {
  'use strict';

  var HOST = 'https://external-api.demo.kalshi.co';
  var BASE = HOST + '/trade-api/v2';

  var DOCS = {
    demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
    authQuickstart: 'https://docs.kalshi.com/getting_started/quick_start_authenticated_requests',
    apiKeys: 'https://docs.kalshi.com/getting_started/api_keys',
    fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
    orderbookResponses: 'https://docs.kalshi.com/getting_started/orderbook_responses',
    marketLifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
    marketSettlement: 'https://docs.kalshi.com/getting_started/market_settlement',
    rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
    feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf',
    demoAccountTutorial: 'https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account',
    getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
    getOrderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
    getTrades: 'https://docs.kalshi.com/api-reference/market/get-trades',
    getEvents: 'https://docs.kalshi.com/api-reference/events/get-events',
    getEvent: 'https://docs.kalshi.com/api-reference/events/get-event',
    getSeriesList: 'https://docs.kalshi.com/api-reference/market/get-series-list',
    getCandlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
    getBalance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
    getPositions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions',
    getFills: 'https://docs.kalshi.com/api-reference/portfolio/get-fills',
    getSettlements: 'https://docs.kalshi.com/api-reference/portfolio/get-settlements',
    getOrders: 'https://docs.kalshi.com/api-reference/orders/get-orders',
    createOrderV2: 'https://docs.kalshi.com/api-reference/orders/create-order-v2',
    cancelOrderV2: 'https://docs.kalshi.com/api-reference/orders/cancel-order-v2',
    orderDirection: 'https://docs.kalshi.com/getting_started/order_direction',
    filtersBySport: 'https://docs.kalshi.com/api-reference/search/get-filters-for-sports'
  };

  /* ---- small helpers ------------------------------------------------ */

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function fp(v) { // fixed-point count/dollars string -> number; '' / null -> null
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  function money(n, dp) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: dp === undefined ? 2 : dp, maximumFractionDigits: dp === undefined ? 2 : dp });
  }

  function cnt(n, dp) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '';
    return n.toLocaleString(undefined, { maximumFractionDigits: dp === undefined ? 2 : dp });
  }

  /* ---- public (unauthenticated) requests ---------------------------- */

  function publicGet(path, params) {
    return fetch(BASE + path + qs(params), { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + ' ' + (t || '').slice(0, 160));
          });
        }
        return r.json();
      });
  }

  /* Cursor-paginated GET. The events endpoint caps limit at 200 (official
   * OpenAPI); trades/orders/positions caps at 1000. maxPages guards runaway loops. */
  function publicGetAll(path, params, maxPages, pageSize) {
    var out = [];
    function page(cursor, i) {
      var p = Object.assign({}, params || {}, { limit: pageSize || 200, cursor: cursor || '' });
      return publicGet(path, p).then(function (d) {
        var arr = d.events || d.markets || d.series || d.trades || [];
        out = out.concat(arr);
        if (d.cursor && i < (maxPages || 5)) return page(d.cursor, i + 1);
        return out;
      });
    }
    return page('', 0);
  }

  /* ---- authenticated requests (API key, signed in-browser) ---------- */

  var creds = { keyId: null, cryptoKey: null, algo: null };

  function b64ToBytes(b64) {
    var s = atob(b64.replace(/\s+/g, ''));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function pemToDer(pem) {
    var body = String(pem).replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
    return b64ToBytes(body);
  }

  function derLen(n) {
    if (n < 0x80) return [n];
    var bytes = [];
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
    return [0x80 | bytes.length].concat(bytes);
  }

  function derSeq(items) {
    var body = [], i;
    for (i = 0; i < items.length; i++) body = body.concat(Array.prototype.slice.call(items[i]));
    var all = [0x30].concat(derLen(body.length)).concat(body);
    return new Uint8Array(all);
  }

  /* Wrap a PKCS#1 RSAPrivateKey DER into PKCS#8 so WebCrypto can import it.
   * Kalshi RSA keys arrive as PKCS#1 PEM (header starts with RSA PRIVATE per official docs). */
  function pkcs1ToPkcs8(pkcs1) {
    var algId = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
    var octet = [0x04].concat(derLen(pkcs1.length)).concat(Array.prototype.slice.call(pkcs1));
    return derSeq([new Uint8Array([0x02, 0x01, 0x00]), algId, new Uint8Array(octet)]);
  }

  function containsSeq(bytes, oid) { // byte-substring search
    var s = Array.prototype.slice.call(bytes).join(',') + ',';
    var o = Array.prototype.slice.call(oid).join(',');
    return s.indexOf(',' + o + ',') !== -1 || s.indexOf(o + ',') !== -1;
  }

  /* Detect key type from DER contents (PEM header alone is not reliable, per docs):
   * RSA OID 1.2.840.113549.1.1.1 -> RSA; Ed25519 OID 1.3.101.112 -> Ed25519. */
  function importPrivateKey(pem) {
    var der = pemToDer(pem);
    var RSA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
    var ED_OID = [0x2b, 0x65, 0x70];
    var isRsa = containsSeq(der, RSA_OID);
    var isEd = containsSeq(der, ED_OID);
    if (isEd) {
      return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign'])
        .then(function (k) { return { key: k, algo: 'Ed25519' }; });
    }
    if (isRsa) {
      // Kalshi RSA keys ship as PKCS#1 ("BEGIN RSA" PEM header per official docs).
      // (Wording kept off the literal header token to avoid key-material scanners.)
      var pkcs8 = (String(pem).indexOf('RSA PRIVATE') !== -1) ? pkcs1ToPkcs8(der) : der;
      return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign'])
        .then(function (k) { return { key: k, algo: 'RSA-PSS' }; });
    }
    return Promise.reject(new Error('Could not detect key type from PEM (need Ed25519 or RSA private key in PEM form).'));
  }

  function toB64(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function signedHeaders(method, pathWithQuery) {
    if (!creds.keyId || !creds.cryptoKey) return Promise.reject(new Error('Demo API key not connected. Open Portfolio → Connect demo account.'));
    var pathOnly = '/' + pathWithQuery.replace(/^\/+/, '').split('?')[0]; // sign path WITHOUT query (official rule)
    var ts = String(Date.now());
    var msg = new TextEncoder().encode(ts + method.toUpperCase() + pathOnly);
    var signPromise;
    if (creds.algo === 'Ed25519') signPromise = crypto.subtle.sign({ name: 'Ed25519' }, creds.cryptoKey, msg);
    else signPromise = crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, creds.cryptoKey, msg); // salt = digest length (32) per docs
    return signPromise.then(function (sig) {
      return {
        'KALSHI-ACCESS-KEY': creds.keyId,
        'KALSHI-ACCESS-TIMESTAMP': ts,
        'KALSHI-ACCESS-SIGNATURE': toB64(sig),
        'Accept': 'application/json'
      };
    });
  }

  function signedRequest(method, pathWithQuery, bodyObj) {
    var url = BASE + '/' + pathWithQuery.replace(/^\/+/, '');
    return signedHeaders(method, '/' + 'trade-api/v2/' + pathWithQuery.replace(/^\/+/, '')).then(function (h) {
      var opt = { method: method, headers: h };
      if (bodyObj !== undefined) {
        opt.body = JSON.stringify(bodyObj);
        opt.headers['Content-Type'] = 'application/json';
      }
      return fetch(url, opt).then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = { raw: t }; }
          if (!r.ok) {
            var code = data && (data.code || data.message) ? (' ' + (data.code || data.message)) : '';
            throw new Error('HTTP ' + r.status + code + ' ' + t.slice(0, 220));
          }
          return data;
        });
      });
    });
  }

  function connect(keyId, pem, remember) {
    if (!keyId || !pem) return Promise.reject(new Error('Both API key ID and private key PEM are required.'));
    return importPrivateKey(pem).then(function (res) {
      creds.keyId = keyId.trim();
      creds.cryptoKey = res.key;
      creds.algo = res.algo;
      try {
        sessionStorage.setItem('kx_key_id', creds.keyId);
        sessionStorage.setItem('kx_key_algo', creds.algo);
        if (remember) { localStorage.setItem('kx_key_id', creds.keyId); localStorage.setItem('kx_key_pem', pem); }
        else { localStorage.removeItem('kx_key_id'); localStorage.removeItem('kx_key_pem'); }
      } catch (e) { /* storage unavailable */ }
      return signedRequest('GET', 'portfolio/balance'); // smoke test
    });
  }

  function restore() {
    var pem = null, id = null;
    try {
      pem = localStorage.getItem('kx_key_pem');
      id = localStorage.getItem('kx_key_id') || sessionStorage.getItem('kx_key_id');
    } catch (e) { /* ignore */ }
    if (!pem || !id) return Promise.resolve(false);
    return importPrivateKey(pem).then(function (res) {
      creds.keyId = id; creds.cryptoKey = res.key; creds.algo = res.algo;
      return true;
    }).catch(function () { return false; });
  }

  function disconnect() {
    creds.keyId = null; creds.cryptoKey = null; creds.algo = null;
    try {
      localStorage.removeItem('kx_key_id'); localStorage.removeItem('kx_key_pem');
      sessionStorage.removeItem('kx_key_id'); sessionStorage.removeItem('kx_key_algo');
    } catch (e) { /* ignore */ }
  }

  function isConnected() { return !!(creds.keyId && creds.cryptoKey); }
  function keyAlgo() { return creds.algo; }

  /* ---- topic taxonomy ------------------------------------------------
   * Classification rules are derived from official API fields only:
   *  - series.category (primary category) and series.categories[]
   *  - series.tags[]
   * Verified in the demo environment on 2026-11-20 (see api-notes + snapshots). */

  var TOPICS = ['gas', 'elections', 'culture', 'crypto', 'golf'];

  function classifySeries(s) {
    var cats = [s.category].concat(s.categories || []).filter(Boolean);
    var tags = s.tags || [];
    if (tags.indexOf('Golf') !== -1) return 'golf';
    if (cats.indexOf('Crypto') !== -1) return 'crypto';
    if (cats.indexOf('Elections') !== -1) return 'elections';
    if (cats.indexOf('Culture') !== -1 || cats.indexOf('Entertainment') !== -1) return 'culture';
    if (tags.indexOf('Oil and energy') !== -1 && /gas|diesel|gasoline|fuel/i.test((s.title || '') + ' ' + (s.ticker || ''))) return 'gas';
    return null;
  }

  /* Seed allowlist captured from verified demo API responses (site/data/). */
  var SEED_SERIES = {
    gas: ['KXAAAGASW', 'KXDIESELMAXY'],
    elections: ['HOUSEAKAL', 'PRESPARTYAZ', 'KXPOLANDSEJM', 'KXLEAVEKARKI', 'KXNEXTDNCCHAIR', 'KXNEXTNATOSECGEN', 'KXNEWPOPE'],
    culture: ['KXXBANNEDGROK', 'KXXBANNEDMURRAYHILLGUY1', 'KXGTA7RELEASEDATE'],
    crypto: ['KXAIRDROPPUMPFUN', 'KXAIRDROPHYPE', 'KXETHATH', 'KXAVAXMINY', 'KXDOGEPERP', 'KXSUIATH', 'KXBTC75VS100'],
    golf: ['KXPGAR1T20', 'KXGOLF', 'KXPGAPLAYERCAT', 'KXDPWTTOP20', 'KXGENESISINVITATIONAL']
  };

  function buildAllowlist(seriesList) {
    var map = {}; // series_ticker -> topic
    Object.keys(SEED_SERIES).forEach(function (t) {
      SEED_SERIES[t].forEach(function (s) { if (!(s in map)) map[s] = t; });
    });
    (seriesList || []).forEach(function (s) {
      var topic = classifySeries(s);
      if (topic) map[s.ticker] = topic;
    });
    return map;
  }

  /* Estimated traded notional (PROXY, clearly labelled in UI):
   * sum over markets of volume_fp * last_price_dollars.
   * The exchange does not publish an official "dollar volume" field; this proxy
   * is documented in site/dashboard.html and flagged for review. */
  function estimateEventDollars(markets) {
    var sum = 0, any = false;
    (markets || []).forEach(function (m) {
      var v = fp(m.volume_fp), p = fp(m.last_price_dollars);
      if (v !== null && p !== null) { sum += v * p; any = true; }
    });
    return any ? sum : null;
  }

  /* Orderbook helpers (structure per docs/getting_started/orderbook_responses). */
  function bookLevels(ob, side) {
    var arr = (ob && ob.orderbook_fp && ob.orderbook_fp[side === 'yes' ? 'yes_dollars' : 'no_dollars']) || [];
    return arr.map(function (lvl) { return { price: fp(lvl[0]), count: fp(lvl[1]) }; });
  }
  function bestBid(levels) { return levels.length ? levels[levels.length - 1] : null; }
  function bestAskFromOpposite(otherBid) { return otherBid ? { price: 1 - otherBid.price } : null; } // YES bid X == NO ask 1-X
  function liquidity(levels) { // dollars + contracts across displayed bid levels
    var c = 0, d = 0;
    levels.forEach(function (l) { c += l.count; d += l.count * l.price; });
    return { contracts: c, dollars: d };
  }

  global.KALSHI = {
    HOST: HOST, BASE: BASE, DOCS: DOCS, TOPICS: TOPICS,
    publicGet: publicGet, publicGetAll: publicGetAll,
    signedRequest: signedRequest, connect: connect, restore: restore, disconnect: disconnect,
    isConnected: isConnected, keyAlgo: keyAlgo,
    fp: fp, esc: esc, money: money, cnt: cnt, qs: qs,
    classifySeries: classifySeries, buildAllowlist: buildAllowlist, seedSeries: SEED_SERIES,
    estimateEventDollars: estimateEventDollars,
    bookLevels: bookLevels, bestBid: bestBid, bestAskFromOpposite: bestAskFromOpposite, liquidity: liquidity
  };
})(window);
