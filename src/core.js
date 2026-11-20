export const TOPICS = [
  { id: "gas-prices", label: "Gas prices", page: "gas-prices.html" },
  { id: "elections", label: "Elections", page: "elections.html" },
  { id: "culture", label: "Culture", page: "culture.html" },
  { id: "crypto", label: "Crypto", page: "crypto.html" },
  { id: "golf", label: "Golf", page: "golf.html" },
];

const TOPIC_PATTERNS = {
  "gas-prices": /\b(?:gas(?:oline)?\s+prices?|price\s+of\s+gas(?:oline)?|gasoline|fuel\s+prices?)\b/i,
  elections: /\b(?:elections?|presidential|president|senate|senator|governor|primary|candidate|ballot|vote|mayor|congress|house\s+seat)\b/i,
  culture: /\b(?:culture|entertainment|movies?|films?|television|tv|music|albums?|artists?|awards?|oscars?|grammys?|box\s+office|celebrit(?:y|ies)|streaming|reality\s+shows?)\b/i,
  crypto: /\b(?:crypto(?:currency)?|bitcoin|btc|ethereum|eth|solana|xrp|dogecoin|tokens?)\b/i,
  golf: /\b(?:golf|pga|lpga|ryder\s+cup|fedex\s+cup|pga\s+tour|open\s+championship|the\s+masters)\b/i,
};

function eventSearchText(event) {
  const values = [event?.title, event?.sub_title, event?.category, event?.series_ticker];
  if (Array.isArray(event?.markets)) {
    for (const market of event.markets) {
      values.push(market?.title, market?.subtitle, market?.yes_sub_title, market?.no_sub_title);
    }
  }
  return values.filter((value) => typeof value === "string").join(" ");
}

/**
 * Topic labels are application-defined keyword/category filters, not a Kalshi
 * taxonomy. The underlying title, subtitle, and category come from Kalshi.
 */
export function classifyEvent(event) {
  const text = eventSearchText(event);
  const category = String(event?.category ?? "").toLowerCase();
  const topicIds = [];

  for (const topic of TOPICS) {
    const categoryMatch = topic.id === "culture"
      ? /\b(?:culture|entertainment)\b/.test(category)
      : topic.id === "crypto"
        ? /\bcrypto\b/.test(category)
        : false;
    if (categoryMatch || TOPIC_PATTERNS[topic.id].test(text)) topicIds.push(topic.id);
  }
  return topicIds;
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marketOutcome(market) {
  const result = String(market?.result ?? "").trim().toLowerCase();
  return result === "yes" || result === "no" ? result : null;
}

export function marketResolutionLabel(market) {
  const outcome = marketOutcome(market);
  if (outcome) return `${outcome.toUpperCase()} resolved`;
  if (market?.status === "settled") return "Settled — YES/NO result not returned";
  if (market?.status === "closed") return "Closed — awaiting result";
  if (market?.status === "open") return "Open";
  return "Unverified status";
}

export function pendingMarkets(event) {
  if (!Array.isArray(event?.markets)) return [];
  return event.markets.filter((market) =>
    !marketOutcome(market) && ["open", "closed"].includes(market?.status),
  );
}

export function openMarkets(event) {
  return pendingMarkets(event).filter((market) => market?.status === "open");
}

export function eventResolutionState(event) {
  const markets = Array.isArray(event?.markets) ? event.markets : [];
  if (markets.length === 0) return "No market details returned";
  const outcomes = markets.map(marketOutcome);
  if (outcomes.every(Boolean)) return "Resolved — market outcomes reported";
  if (markets.some((market) => market?.status === "settled" && !marketOutcome(market))) {
    return "Settled — one or more YES/NO outcomes missing";
  }
  if (openMarkets(event).length > 0) return "Open / live";
  if (pendingMarkets(event).some((market) => market?.status === "closed")) {
    return "Closed — awaiting resolution";
  }
  return "Status unavailable";
}

function levelArrayToNotional(levels) {
  if (!Array.isArray(levels)) return null;
  let total = 0;
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2) return null;
    const price = parseNumber(level[0]);
    const contracts = parseNumber(level[1]);
    if (price === null || contracts === null || price < 0 || contracts < 0) return null;
    total += price * contracts;
  }
  return total;
}

/**
 * Sum the price-times-contract-count notional for YES and NO bid levels.
 * Returns null when the API response does not contain both fixed-point sides;
 * an empty, valid book returns zero.
 */
export function visibleBidNotional(orderbook) {
  const book = orderbook?.orderbook_fp;
  if (!book || typeof book !== "object") return null;
  const yes = levelArrayToNotional(book.yes_dollars);
  const no = levelArrayToNotional(book.no_dollars);
  if (yes === null || no === null) return null;
  return yes + no;
}

export function marketBookMetrics(orderbook) {
  const book = orderbook?.orderbook_fp;
  if (!book || typeof book !== "object") return null;
  if (!Array.isArray(book.yes_dollars) || !Array.isArray(book.no_dollars)) return null;

  const levels = [];
  for (const [side, entries] of [["YES bid", book.yes_dollars], ["NO bid", book.no_dollars]]) {
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const price = parseNumber(entry[0]);
      const contracts = parseNumber(entry[1]);
      if (price === null || contracts === null || price < 0 || contracts < 0) return null;
      levels.push({
        side,
        price,
        priceRaw: String(entry[0]),
        contracts,
        contractsRaw: String(entry[1]),
        notional: price * contracts,
      });
    }
  }
  levels.sort((a, b) => a.side.localeCompare(b.side) || b.price - a.price);
  return { levels, visibleBidNotional: visibleBidNotional(orderbook) };
}

export function aggregateMarketField(markets, field) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  let total = 0;
  for (const market of markets) {
    const value = parseNumber(market?.[field]);
    if (value === null) return null;
    total += value;
  }
  return total;
}

/**
 * The event ranking is only comparable when every open market has a valid
 * orderbook snapshot. Closed markets have no live book and are not included.
 */
export function eventBookMetric(event, booksByTicker) {
  const active = openMarkets(event);
  if (active.length === 0) {
    return { value: null, coverage: 0, total: 0, complete: false };
  }
  let value = 0;
  let coverage = 0;
  for (const market of active) {
    const book = booksByTicker instanceof Map
      ? booksByTicker.get(market?.ticker)
      : booksByTicker?.[market?.ticker];
    const notional = visibleBidNotional(book);
    if (notional !== null) {
      value += notional;
      coverage += 1;
    }
  }
  const complete = coverage === active.length;
  return {
    value: complete ? value : null,
    partialValue: value,
    coverage,
    total: active.length,
    complete,
  };
}

export function rankEvents(events, booksByTicker) {
  return [...events].sort((a, b) => {
    const metricA = eventBookMetric(a, booksByTicker);
    const metricB = eventBookMetric(b, booksByTicker);
    if (metricA.complete !== metricB.complete) return metricA.complete ? -1 : 1;
    if (metricA.complete && metricB.complete && metricA.value !== metricB.value) {
      return metricB.value - metricA.value;
    }
    return String(a?.event_ticker ?? "").localeCompare(String(b?.event_ticker ?? ""));
  });
}

export function eventDataStatus(event) {
  const markets = Array.isArray(event?.markets) ? event.markets : [];
  if (markets.length === 0) return "No market details returned";
  const open = openMarkets(event).length;
  const pending = pendingMarkets(event);
  const allHaveOutcomes = markets.every((market) => Boolean(marketOutcome(market)));
  if (allHaveOutcomes) return "Resolved";
  if (open > 0 && pending.some((market) => market?.status === "closed")) return "Live + awaiting resolution";
  if (open > 0) return "Live";
  if (pending.some((market) => market?.status === "closed")) return "Closed / pending resolution";
  if (markets.some((market) => market?.status === "settled" && !marketOutcome(market))) {
    return "Settled — YES/NO result missing";
  }
  return "Status unavailable";
}

export function eventSourceUrl(apiBase, eventTicker) {
  const url = new URL(`${apiBase}/events`);
  url.searchParams.set("tickers", eventTicker);
  url.searchParams.set("with_nested_markets", "true");
  return url.toString();
}

export function marketSourceUrl(apiBase, ticker) {
  return `${apiBase}/markets/${encodeURIComponent(ticker)}`;
}

export function orderbookSourceUrl(apiBase, ticker) {
  return `${apiBase}/markets/${encodeURIComponent(ticker)}/orderbook`;
}

export function safeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
