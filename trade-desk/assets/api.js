/* trade-desk/assets/api.js — thin, dependency-free client for the official
 * Kalshi demo Trade API (public, unauthenticated endpoints only).
 *
 * Endpoints used (all documented as public; none of them need a key):
 *   GET /exchange/status .......................... https://docs.kalshi.com/api-reference/exchange/get-exchange-status
 *   GET /markets (status, limit, cursor, mve) ..... https://docs.kalshi.com/api-reference/market/get-markets
 *   GET /markets?tickers=A,B ...................... same page (comma-separated list)
 *   GET /markets/trades (limit, min_ts, ticker) ... https://docs.kalshi.com/api-reference/market/get-trades
 *   GET /markets/{ticker}/orderbook (depth) ....... https://docs.kalshi.com/getting_started/orderbook_responses
 *   GET /series/{series}/markets/{ticker}/candlesticks
 *                                                  https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *   GET /events/{ticker} .......................... https://docs.kalshi.com/api-reference/events/get-events
 *
 * What this client deliberately does NOT do:
 *   - it never signs a request and never stores a key (a public page must not);
 *   - it never opens the WebSocket: the official quick start states connections
 *     require a signed handshake even for public channels
 *     (https://docs.kalshi.com/getting_started/quick_start_websockets), so live
 *     updates here are REST polls and are labelled with their true latency;
 *   - it never invents a value: every failure surfaces as an error string on the
 *     page, and every displayed number keeps the request URL that produced it.
 *
 * Rate limits: unauthenticated public requests have separate limits and the docs
 * say to back off on 429 (https://docs.kalshi.com/getting_started/rate_limits).
 * api.js therefore enforces a minimum gap between requests, a single in-flight
 * request per URL, exponential backoff on 429/5xx, and a hard stop after N
 * consecutive failures so a background tab cannot hammer the venue.
 */
(function (root) {
  "use strict";
  var TD = root.TD;

  var state = {
    lastAt: 0,
    minGapMs: 120,
    inflight: {},
    cache: {},
    calls: 0,
    errors: 0,
    consecutiveErrors: 0,
    stopped: false,
    onEvent: null
  };

  function log(kind, detail) {
    if (typeof state.onEvent === "function") {
      try { state.onEvent({ kind: kind, detail: detail, at: new Date().toISOString() }); } catch (e) { /* page callback */ }
    }
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function url(path) {
    return TD.REST_DEMO + path;
  }

  /* fetchJson(path, {cacheMs, retries, signal}) → {ok, data, error, url, ms, cached} */
  async function fetchJson(path, opts) {
    opts = opts || {};
    var full = url(path);
    var cacheMs = opts.cacheMs === undefined ? 0 : opts.cacheMs;

    if (cacheMs > 0 && state.cache[full] && Date.now() - state.cache[full].at < cacheMs) {
      return Object.assign({}, state.cache[full].value, { cached: true });
    }
    if (state.inflight[full]) return state.inflight[full];
    if (state.stopped) {
      return { ok: false, error: "stopped after repeated API failures", url: full, data: null };
    }

    var attempt = 0;
    var maxAttempts = opts.retries === undefined ? 3 : opts.retries;
    /* A network failure (DNS, offline, CORS block, blocked host) is not a transient
     * server condition: retrying twice more only delays telling the reader that the
     * venue is unreachable. Those fail after one quick retry; 429/5xx keep the
     * documented exponential backoff. */
    var maxNetworkAttempts = 2;
    var started = Date.now();

    var p = (async function () {
      while (attempt < maxAttempts) {
        attempt += 1;
        var gap = state.minGapMs - (Date.now() - state.lastAt);
        if (gap > 0) await sleep(gap);
        state.lastAt = Date.now();
        state.calls += 1;

        var ctrl = null;
        var timer = null;
        try {
          if (typeof AbortController !== "undefined") {
            ctrl = new AbortController();
            timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 15000);
          }
          var res = await fetch(full, {
            method: "GET",
            headers: { Accept: "application/json" },
            mode: "cors",
            cache: "no-store",
            signal: ctrl ? ctrl.signal : undefined
          });
          if (timer) clearTimeout(timer);

          if (res.status === 429 || res.status >= 500) {
            var body = "";
            try { body = (await res.text()).slice(0, 200); } catch (e) { body = ""; }
            state.errors += 1;
            state.consecutiveErrors += 1;
            log("retry", { url: full, status: res.status, attempt: attempt, body: body });
            if (state.consecutiveErrors >= 8) {
              state.stopped = true;
              return { ok: false, error: "HTTP " + res.status + " — polling stopped after repeated failures", url: full, data: null, status: res.status };
            }
            if (attempt >= maxAttempts) {
              return { ok: false, error: "HTTP " + res.status + " " + body, url: full, data: null, status: res.status };
            }
            await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
            continue;
          }
          if (!res.ok) {
            var t = "";
            try { t = (await res.text()).slice(0, 300); } catch (e) { t = ""; }
            state.errors += 1;
            state.consecutiveErrors += 1;
            var value = { ok: false, error: "HTTP " + res.status + " " + t, url: full, data: null, status: res.status };
            if (cacheMs > 0) state.cache[full] = { at: Date.now(), value: value };
            return value;
          }
          var data = await res.json();
          state.consecutiveErrors = 0;
          var out = {
            ok: true,
            data: data,
            url: full,
            status: res.status,
            ms: Date.now() - started,
            fetched_at: new Date().toISOString()
          };
          if (cacheMs > 0) state.cache[full] = { at: Date.now(), value: out };
          return out;
        } catch (err) {
          if (timer) clearTimeout(timer);
          state.errors += 1;
          state.consecutiveErrors += 1;
          var msg = err && err.name === "AbortError" ? "timeout after " + (opts.timeoutMs || 15000) + "ms" : String(err && err.message ? err.message : err);
          log("error", { url: full, message: msg, attempt: attempt });
          if (state.consecutiveErrors >= 8) {
            state.stopped = true;
            return { ok: false, error: msg + " — polling stopped after repeated failures", url: full, data: null, network: true };
          }
          if (attempt >= maxNetworkAttempts) {
            return {
              ok: false,
              error: msg + " (the browser could not reach " + new URL(full).host +
                "; check your connection, an ad-blocker, or the venue's status)",
              url: full, data: null, network: true, unreachable: true
            };
          }
          await sleep(300);
        }
      }
      return { ok: false, error: "no attempt made", url: full, data: null };
    })();

    state.inflight[full] = p;
    try { return await p; } finally { delete state.inflight[full]; }
  }

  /* ---------------------------------------------------------------- helpers */
  function status() {
    return fetchJson("/exchange/status", { retries: 2, cacheMs: 5000 });
  }
  /* One page of open markets. limit max is 1000 (docs). */
  function markets(params) {
    var q = ["status=open", "limit=" + Math.min(1000, (params && params.limit) || 1000), "mve_filter=exclude"];
    if (params && params.cursor) q.push("cursor=" + encodeURIComponent(params.cursor));
    if (params && params.series_ticker) q.push("series_ticker=" + encodeURIComponent(params.series_ticker));
    return fetchJson("/markets?" + q.join("&"), { cacheMs: (params && params.cacheMs) || 0 });
  }
  function marketsByTicker(tickers) {
    if (!tickers || !tickers.length) return Promise.resolve({ ok: true, data: { markets: [] }, url: url("/markets?tickers="), empty: true });
    var list = tickers.slice(0, 100).join(",");
    return fetchJson("/markets?tickers=" + encodeURIComponent(list), { cacheMs: 1500 });
  }
  function trades(params) {
    var q = ["limit=" + Math.min(1000, (params && params.limit) || 1000)];
    if (params && params.min_ts) q.push("min_ts=" + params.min_ts);
    if (params && params.max_ts) q.push("max_ts=" + params.max_ts);
    if (params && params.ticker) q.push("ticker=" + encodeURIComponent(params.ticker));
    if (params && params.cursor) q.push("cursor=" + encodeURIComponent(params.cursor));
    return fetchJson("/markets/trades?" + q.join("&"), { cacheMs: (params && params.cacheMs) || 0 });
  }
  function orderbook(ticker, depth) {
    return fetchJson("/markets/" + encodeURIComponent(ticker) + "/orderbook?depth=" + ((depth || 20)), { cacheMs: 4000 });
  }
  function candles(seriesTicker, ticker, startTs, endTs, interval) {
    return fetchJson("/series/" + encodeURIComponent(seriesTicker) + "/markets/" + encodeURIComponent(ticker) +
      "/candlesticks?start_ts=" + startTs + "&end_ts=" + endTs + "&period_interval=" + (interval || 1),
      { cacheMs: 20000 });
  }
  function event(eventTicker) {
    return fetchJson("/events/" + encodeURIComponent(eventTicker), { cacheMs: 600000 });
  }
  function settleMarkets(tickers) {
    /* Closed/finalized markets: same endpoint, explicit status list. */
    var list = tickers.slice(0, 40).join(",");
    return fetchJson("/markets?tickers=" + encodeURIComponent(list), { cacheMs: 8000 });
  }

  function stats() {
    return {
      calls: state.calls,
      errors: state.errors,
      consecutiveErrors: state.consecutiveErrors,
      stopped: state.stopped,
      minGapMs: state.minGapMs
    };
  }
  function configure(opts) {
    if (opts && typeof opts.minGapMs === "number") state.minGapMs = Math.max(60, opts.minGapMs);
    if (opts && typeof opts.onEvent === "function") state.onEvent = opts.onEvent;
  }
  function reset() {
    state.stopped = false;
    state.consecutiveErrors = 0;
  }

  root.Api = {
    status: status,
    markets: markets,
    marketsByTicker: marketsByTicker,
    trades: trades,
    orderbook: orderbook,
    candles: candles,
    event: event,
    settleMarkets: settleMarkets,
    fetchJson: fetchJson,
    stats: stats,
    configure: configure,
    reset: reset,
    url: url
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
