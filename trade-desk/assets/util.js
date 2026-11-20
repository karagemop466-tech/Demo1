/* trade-desk/assets/util.js — shared primitives for the live trade terminal.
 *
 * No dependencies, no build step. Every rule that decides which topic a market
 * belongs to, and every formula used for money, fees and prices, is written here
 * once so the pages, the tests and the Python engine can be checked against the
 * same definitions.
 *
 * Official sources for this file (read 2026-11-20):
 *   fixed-point dollars/counts ... https://docs.kalshi.com/api-reference/market/get-markets
 *   order book shape ............ https://docs.kalshi.com/getting_started/orderbook_responses
 *   fee formula ................. https://kalshi.com/docs/kalshi-fee-schedule.pdf
 *   market lifecycle/result ..... https://docs.kalshi.com/getting_started/market_lifecycle
 */
(function (root) {
  "use strict";

  var REST_DEMO = "https://external-api.demo.kalshi.co/trade-api/v2";
  var WS_DEMO = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2";
  var DOCS = {
    environments: "https://docs.kalshi.com/getting_started/api_environments",
    markets: "https://docs.kalshi.com/api-reference/market/get-markets",
    orderbook: "https://docs.kalshi.com/getting_started/orderbook_responses",
    orderbookApi: "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    candles: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    trades: "https://docs.kalshi.com/api-reference/market/get-trades",
    events: "https://docs.kalshi.com/api-reference/events/get-events",
    series: "https://docs.kalshi.com/api-reference/market/get-series",
    lifecycle: "https://docs.kalshi.com/getting_started/market_lifecycle",
    settlement: "https://docs.kalshi.com/getting_started/market_settlement",
    fees: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    rateLimits: "https://docs.kalshi.com/getting_started/rate_limits",
    websockets: "https://docs.kalshi.com/getting_started/quick_start_websockets",
    apiKeys: "https://docs.kalshi.com/getting_started/api_keys"
  };

  /* ------------------------------------------------------------------ topics
   * The five topics the brief restricts the dashboard to. A market is assigned
   * by looking its series up in the committed series map (built by the engine
   * from the official GET /series records: category, categories, tags, title).
   * When a series is missing from the map, a documented ticker/title fallback is
   * used and the row is marked "fallback" so the reader can see it was not
   * confirmed by official series metadata.
   */
  var TOPICS = [
    { id: "gas", label: "Gas prices", color: "#b45309" },
    { id: "elections", label: "Elections", color: "#1d4ed8" },
    { id: "culture", label: "Culture", color: "#be185d" },
    { id: "crypto", label: "Crypto", color: "#047857" },
    { id: "golf", label: "Golf", color: "#6d28d9" }
  ];

  var CULTURE_TAGS = ["movies", "music", "music charts", "television", "awards", "oscars",
    "grammys", "rotten tomatoes", "celebrities", "video games", "box office", "emmys"];
  var ELECTION_TAGS = ["us elections", "international elections", "primaries",
    "election combos", "other us elections", "foreign elections", "state legislatures"];

  function lower(x) { return String(x == null ? "" : x).toLowerCase(); }
  function hasTag(series, tag) {
    var tags = (series && series.tags) || [];
    for (var i = 0; i < tags.length; i++) if (lower(tags[i]) === tag) return true;
    return false;
  }

  /* Energy series that are NOT retail US gasoline prices. The brief's "gas prices"
   * topic is the retail gasoline family (the AAA-style US gas price markets). Natural
   * gas, crude oil, WTI and Brent are different products, so they are excluded rather
   * than silently relabelled. Note that the demo files one of them (KXNATGASD) under
   * the official category "Entertainment"; without this guard it would leak into the
   * culture topic. Logged on the Flagged for Review page. */
  function isNonRetailEnergy(ticker, title) {
    var t = lower(ticker) + " " + lower(title);
    if (/aaagas|[^n]gas[dmwy]?(-|$)|gas price|gasoline|pump price|gas tax/.test(t) &&
        !/natural gas|natgas|ngas\b/.test(t)) return false;
    return /natural gas|natgas|^ngas|kxngas|kxnargas|crude|wti|brent|oil price|oil and gas production/.test(t);
  }

  /* Official-metadata classification. Returns {id, label, rule} or null.
   *
   * Decision order is fixed and documented; the first match wins:
   *   1. retail gasoline family .............. "gas"
   *   2. official category Crypto / crypto tag "crypto"
   *   3. official "Golf" tag, or Sports + golf words ... "golf"
   *   4. election tags / category Elections .... "elections"
   *   5. Entertainment/Culture category or culture tags "culture"
   * Everything else returns null and is not shown on the five topic pages.
   */
  function classifyBySeries(series) {
    if (!series) return null;
    var cat = lower(series.category);
    var title = lower(series.title);
    var ticker = lower(series.ticker);
    var blob = ticker + " " + title;

    if (isNonRetailEnergy(ticker, title)) return null;

    if (/^(kx)?aaagas|^(kx)?gas[dmwy]?(-|$)|^gas[- ]|gas price|gasoline|pump price/.test(blob)) {
      return { id: "gas", label: "Gas prices", rule: "retail gasoline series (ticker/title family)" };
    }
    if (cat === "crypto" || hasTag(series, "crypto") || /^kx?(btc|eth|sol|xrp|doge|shib|sui|zec|ada|hype)/.test(ticker)) {
      return { id: "crypto", label: "Crypto", rule: "official series category/tag Crypto" };
    }
    if (hasTag(series, "golf") || (cat === "sports" && /golf|\bpga\b|lpga|\bliv\b|ryder cup|solheim|owgr/.test(blob))) {
      return { id: "golf", label: "Golf", rule: "official Golf tag or Sports category with golf subject" };
    }
    for (var i = 0; i < ELECTION_TAGS.length; i++) {
      if (hasTag(series, ELECTION_TAGS[i])) {
        return { id: "elections", label: "Elections", rule: "official series tag: " + ELECTION_TAGS[i] };
      }
    }
    if (cat === "elections") {
      return { id: "elections", label: "Elections", rule: "official series category Elections" };
    }
    if (cat === "entertainment" || cat === "culture") {
      return { id: "culture", label: "Culture", rule: "official series category " + series.category };
    }
    for (var j = 0; j < CULTURE_TAGS.length; j++) {
      if (hasTag(series, CULTURE_TAGS[j])) {
        return { id: "culture", label: "Culture", rule: "official series tag: " + CULTURE_TAGS[j] };
      }
    }
    return null;
  }

  /* Fallback used only when the series is absent from the committed map. */
  function classifyByTicker(ticker, title) {
    var t = lower(ticker), s = lower(title);
    if (/^kxaaagas|^aaagas|^kxgas[dmwy]?-|gas price|gasoline/.test(t) || /gas price|gasoline|pump price/.test(s)) {
      return { id: "gas", label: "Gas prices", rule: "fallback ticker/title pattern (series not in map)" };
    }
    if (/golf|pga|lpga|liv|ryder|solheim/.test(t + " " + s)) {
      return { id: "golf", label: "Golf", rule: "fallback ticker/title pattern (series not in map)" };
    }
    if (/^kx(btc|eth|sol|xrp|doge|shib|sui|zec|ada)|bitcoin|ethereum|crypto/.test(t + " " + s)) {
      return { id: "crypto", label: "Crypto", rule: "fallback ticker/title pattern (series not in map)" };
    }
    if (/^kxpres|kxsena|kxhouse|kxgov|kxmayor|nominee|election/.test(t) || /election|nominee/.test(s)) {
      return { id: "elections", label: "Elections", rule: "fallback ticker/title pattern (series not in map)" };
    }
    if (/oscar|grammy|emmy|box office|billboard|album|movie|rotten tomatoes/.test(t + " " + s)) {
      return { id: "culture", label: "Culture", rule: "fallback ticker/title pattern (series not in map)" };
    }
    return null;
  }

  function classify(market, seriesMap, eventMap) {
    var ev = market && eventMap ? eventMap[market.event_ticker] : null;
    var seriesTicker = ev && ev.series_ticker;
    var series = seriesMap && seriesTicker ? seriesMap[seriesTicker] : null;
    var hit = classifyBySeries(series);
    if (hit) return hit;
    hit = classifyByTicker((market && market.ticker) || "", (market && market.title) || (ev && ev.title));
    return hit;
  }

  /* --------------------------------------------------------------- numbers */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function money(v, digits) {
    var n = num(v);
    if (n === null) return "—";
    var d = digits === undefined ? 2 : digits;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function cents(v, dp) {
    var n = num(v);
    if (n === null) return "—";
    return (n * 100).toFixed(dp === undefined ? 0 : dp) + "¢";
  }
  function contracts(v) {
    var n = num(v);
    if (n === null) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function pct(v, dp) {
    var n = num(v);
    if (n === null) return "—";
    return (n * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }
  function signedMoney(v, digits) {
    var n = num(v);
    if (n === null) return "—";
    return (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toFixed(digits === undefined ? 2 : digits);
  }
  function signedCents(v) {
    var n = num(v);
    if (n === null) return "—";
    return (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(0) + "¢";
  }

  /* --------------------------------------------------------------- escaping */
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function attr(s) { return esc(s); }

  /* ------------------------------------------------------------------ time */
  function iso(ts) {
    if (!ts) return "";
    if (typeof ts === "string") return ts;
    return new Date(ts).toISOString();
  }
  function clock(ts, withSeconds) {
    if (!ts) return "—";
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return "—";
    var s = d.toISOString().slice(11, withSeconds === false ? 16 : 19) + "Z";
    return s;
  }
  function ago(ts, now) {
    var t = new Date(ts).getTime();
    if (!isFinite(t)) return "—";
    var s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s ago";
    if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function countdown(ts, now) {
    var t = new Date(ts).getTime();
    if (!isFinite(t)) return "—";
    var s = Math.round((t - (now || Date.now())) / 1000);
    if (s <= 0) return "closed";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
  }

  /* ------------------------------------------------------------------ fees
   * Official taker fee (fee-schedule PDF): fee = ceil_to_cent(M * 0.07 * C * P * (1-P)).
   * The PDF's own table (fee for 100 contracts) is asserted in the test suite.
   * Maker fees (0.0175 * ...) are not used: every simulated fill here is a taker
   * fill, because the demo has no resting-order fill evidence to model makers.
   */
  function fee(contractsN, price, multiplier) {
    var c = num(contractsN), p = num(price), m = num(multiplier === undefined ? 1 : multiplier);
    if (c === null || p === null || m === null || c <= 0) return 0;
    if (p <= 0 || p >= 1) return 0;
    var raw = m * 0.07 * c * p * (1 - p);
    return Math.ceil(raw * 100 - 1e-9) / 100;
  }

  /* ---------------------------------------------------- order book helpers
   * The REST order book returns bids only, ascending, best bid last.
   * A YES ask at price X is implied by a NO bid at (1 - X) with the same size.
   */
  function ladder(book) {
    var ob = (book && book.orderbook_fp) || {};
    var yes = (ob.yes_dollars || []).map(function (l) { return { price: num(l[0]), size: num(l[1]) }; })
      .filter(function (l) { return l.price !== null && l.size !== null; });
    var no = (ob.no_dollars || []).map(function (l) { return { price: num(l[0]), size: num(l[1]) }; })
      .filter(function (l) { return l.price !== null && l.size !== null; });
    var bestYesBid = yes.length ? yes[yes.length - 1] : null;
    var bestNoBid = no.length ? no[no.length - 1] : null;
    var yesAsks = no.map(function (l) { return { price: 1 - l.price, size: l.size }; })
      .sort(function (a, b) { return a.price - b.price; });
    return {
      yesBids: yes.slice().sort(function (a, b) { return b.price - a.price; }),
      yesAsks: yesAsks,
      bestYesBid: bestYesBid ? bestYesBid.price : null,
      bestYesBidSize: bestYesBid ? bestYesBid.size : null,
      bestYesAsk: yesAsks.length ? yesAsks[0].price : null,
      bestYesAskSize: yesAsks.length ? yesAsks[0].size : null,
      bestNoBid: bestNoBid ? bestNoBid.price : null,
      bestNoBidSize: bestNoBid ? bestNoBid.size : null
    };
  }
  /* Contracts resting within `band` dollars of the given price, plus the
   * cumulative contracts needed to walk the ladder to that price. */
  function depth(levels, limit) {
    var total = 0, out = [];
    for (var i = 0; i < levels.length && i < (limit || 8); i++) {
      total += levels[i].size;
      out.push({ price: levels[i].price, size: levels[i].size, cumulative: total });
    }
    return { rows: out, total: total };
  }

  /* -------------------------------------------------------- market source */
  function marketUrl(ticker, eventTicker) {
    /* Venue page. Kalshi's public market URLs are /markets/{event}/{slug}/{ticker};
     * only the /markets/{slug} form is guaranteed to resolve, so link the event
     * search when the slug is unknown and label it as a venue lookup. */
    var ev = eventTicker || String(ticker || "").replace(/-[^-]+$/, "");
    return "https://kalshi.com/markets/" + encodeURIComponent(lower(ev));
  }
  function apiUrl(path) { return REST_DEMO + path; }
  function newsSearch(text) {
    return "https://news.google.com/search?q=" + encodeURIComponent(text) + "&hl=en-US&gl=US&ceid=US:en";
  }
  function settlementLinks(event) {
    var out = [];
    var srcs = (event && event.settlement_sources) || [];
    for (var i = 0; i < srcs.length; i++) {
      if (srcs[i] && srcs[i].url && /^https?:\/\//.test(srcs[i].url)) {
        out.push({ name: srcs[i].name || srcs[i].url, url: srcs[i].url });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ misc */
  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(root.location ? root.location.search : "");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function onReady(fn) {
    if (typeof document === "undefined") return;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else setTimeout(fn, 0);   /* already parsed: start now, not never */
  }
  function fmtDelta(v) {
    var n = num(v);
    if (n === null) return "—";
    return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
  }
  function uuid() {
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  var api = {
    REST_DEMO: REST_DEMO,
    WS_DEMO: WS_DEMO,
    DOCS: DOCS,
    TOPICS: TOPICS,
    classify: classify,
    classifyBySeries: classifyBySeries,
    classifyByTicker: classifyByTicker,
    num: num,
    money: money,
    cents: cents,
    contracts: contracts,
    pct: pct,
    signedMoney: signedMoney,
    signedCents: signedCents,
    esc: esc,
    attr: attr,
    iso: iso,
    clock: clock,
    ago: ago,
    countdown: countdown,
    fee: fee,
    ladder: ladder,
    depth: depth,
    marketUrl: marketUrl,
    apiUrl: apiUrl,
    newsSearch: newsSearch,
    settlementLinks: settlementLinks,
    qs: qs,
    onReady: onReady,
    fmtDelta: fmtDelta,
    uuid: uuid,
    topicById: function (id) {
      for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i];
      return null;
    }
  };

  root.TD = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
