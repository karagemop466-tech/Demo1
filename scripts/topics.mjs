/**
 * Topic taxonomy for the Kalshi demo dashboard.
 *
 * IMPORTANT — provenance and honesty rules encoded here:
 *  - Kalshi does not publish an official "gas / elections / culture / crypto / golf"
 *    taxonomy. Event records expose a deprecated `category` field and the series
 *    list exposes a series-level category (see Get Series List).
 *    https://docs.kalshi.com/api-reference/events/get-events
 *    https://docs.kalshi.com/api-reference/market/get-series-list
 *  - Therefore every classification in this project records HOW it was classified
 *    (`category` | `keyword` | `series-allowlist`) so a reviewer can audit it.
 *  - `seriesAllowlist` is an explicit, human-approvable list of series tickers.
 *    Add a ticker there and it is classified with method `series-allowlist`.
 */

/** Series-category -> topic. Verified against the live demo series list at capture time. */
export const CATEGORY_MAP = {
  Politics: 'elections',
  Elections: 'elections',
  Economy: 'gas',
  Economics: 'gas',
  Climate: 'gas',
  Energy: 'gas',
  Crypto: 'crypto',
  'Crypto Prices': 'crypto',
  Culture: 'culture',
  Entertainment: 'culture',
  Sports: 'golf',
  Golf: 'golf',
};

/** Keyword rules. Matched against event title, market yes_sub_title/no_sub_title and tickers. */
export const KEYWORDS = {
  gas: [
    'gasoline', 'gas price', 'gas prices', 'national average gas', 'regular gas',
    'diesel', 'fuel price', 'fuel prices', 'crude oil', 'wti', 'brent',
    'natural gas', 'home heating', 'heating oil', 'propane', 'gasoline price',
  ],
  elections: [
    'election', 'elections', 'presidential', 'president', 'senate', 'governor',
    'house race', 'congress', 'primary', 'general election', 'ballot',
    'nominee', 'vote', 'voting', 'midterm', 'special election', 'inauguration',
  ],
  culture: [
    'movie', 'film', 'box office', 'album', 'music', 'celebrity', 'tv show',
    'entertainment', 'award', 'oscar', 'grammy', 'emmy', 'netflix', 'streaming',
    'spotify', 'billboard', 'billboard', 'rotten tomatoes', 'netflix top 10',
    'taylor swift', 'box office', 'concert', 'tour', 'book', 'novel', 'bestseller',
  ],
  crypto: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'xrp', 'dogecoin',
    'doge', 'crypto', 'litecoin', 'cardano', 'stablecoin', 'usdt', 'usdc',
    'crypto price', 'blockchain', 'coinbase',
  ],
  golf: [
    'golf', 'pga', 'lpga', 'masters', 'ryder cup', 'us open', 'open championship',
    'the open', 'wimbledon', 'tour', 'birdie', 'bogey', 'cut line', 'player',
    'championship', 'fedex', 'pga tour', 'european tour',
  ],
};

export const TOPICS = ['gas', 'elections', 'culture', 'crypto', 'golf'];

export const TOPIC_LABELS = {
  gas: 'Gas prices',
  elections: 'Elections',
  culture: 'Culture',
  crypto: 'Crypto',
  golf: 'Golf',
};

/**
 * Classify one record.
 * @param {object} record  event or market object
 * @param {object} ctx     { seriesAllowlist: Set<string>, seriesCategory: Map<string,string> }
 * @returns {{topic: string, method: string, evidence: string}|null}
 */
export function classify(record, ctx = {}) {
  const allowlist = ctx.seriesAllowlist instanceof Set ? ctx.seriesAllowlist : new Set();
  const seriesCategory = ctx.seriesCategory instanceof Map ? ctx.seriesCategory : new Map();
  const seriesTicker = record.series_ticker || record.seriesTicker || '';
  const eventTicker = record.event_ticker || record.eventTicker || '';

  if (seriesTicker && allowlist.has(seriesTicker)) {
    return { topic: allowlist.get(seriesTicker), method: 'series-allowlist', evidence: seriesTicker };
  }
  if (seriesTicker) {
    const cat = seriesCategory.get(seriesTicker);
    const topic = cat ? CATEGORY_MAP[cat] : undefined;
    if (topic) return { topic, method: 'series-category', evidence: `${seriesTicker} (${cat})` };
  }

  const haystack = [
    record.title,
    record.yes_sub_title,
    record.no_sub_title,
    record.subtitle,
    record.event_ticker,
    record.ticker,
    record.series_ticker,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const topic of TOPICS) {
    for (const kw of KEYWORDS[topic]) {
      if (haystack.includes(kw.toLowerCase())) {
        return { topic, method: 'keyword', evidence: kw };
      }
    }
  }
  return null;
}
