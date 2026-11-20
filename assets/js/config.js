/* Shared configuration for the Kalshi Demo Monitor.
 *
 * Every endpoint and documentation URL below comes from the official Kalshi
 * documentation. See /sources/ for the full list and /docs/SOURCES.md for the
 * verification notes.
 */

export const API = {
  demoRest: 'https://external-api.demo.kalshi.co/trade-api/v2',
  demoRestAlt: 'https://demo-api.kalshi.co/trade-api/v2',
  demoWs: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
};

export const DOC = {
  environments: 'https://docs.kalshi.com/getting_started/api_environments',
  demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
  apiKeys: 'https://docs.kalshi.com/getting_started/api_keys',
  authRequests: 'https://docs.kalshi.com/getting_started/quick_start_authenticated_requests',
  createOrder: 'https://docs.kalshi.com/getting_started/quick_start_create_order',
  marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
  websockets: 'https://docs.kalshi.com/getting_started/quick_start_websockets',
  lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
  settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
  orderbook: 'https://docs.kalshi.com/getting_started/orderbook_responses',
  rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
  fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
  getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
  getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
  getEvents: 'https://docs.kalshi.com/api-reference/events/get-events',
  getCandlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
  getOrderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
  getBalance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
  getPositions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions',
  getFills: 'https://docs.kalshi.com/api-reference/portfolio/get-fills',
  getOrders: 'https://docs.kalshi.com/api-reference/orders/get-orders',
  createOrderV2: 'https://docs.kalshi.com/api-reference/orders/create-order-v2',
  orderErrors: 'https://docs.kalshi.com/getting_started/order_errors',
  orderDirection: 'https://docs.kalshi.com/getting_started/order_direction',
  seriesList: 'https://docs.kalshi.com/api-reference/market/get-series-list',
  historicalData: 'https://docs.kalshi.com/getting_started/historical_data',
  subaccounts: 'https://docs.kalshi.com/getting_started/subaccounts',
};

/**
 * Browser transports tried in order for public (unauthenticated) REST calls.
 *
 * `direct` is the normal path: the Kalshi demo API is a public HTTPS API. The
 * two relays exist only because this project could not verify browser CORS
 * behaviour from its build environment (see /flagged/). They are third-party
 * services: a relay sees the request URL, which for public market data contains
 * no credentials. The site always reports which transport actually worked.
 */
export const TRANSPORTS = [
  { id: 'direct', label: 'direct', build: (url) => url },
  { id: 'relay-corsproxy', label: 'relay (corsproxy.io)', build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
  { id: 'relay-allorigins', label: 'relay (allorigins.win)', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
];

export const TOPICS = [
  { id: 'gas', label: 'Gas prices', className: 'topic-gas' },
  { id: 'elections', label: 'Elections', className: 'topic-elections' },
  { id: 'culture', label: 'Culture', className: 'topic-culture' },
  { id: 'crypto', label: 'Crypto', className: 'topic-crypto' },
  { id: 'golf', label: 'Golf', className: 'topic-golf' },
];

export const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.id, t.label]));
export const TOPIC_CLASS = Object.fromEntries(TOPICS.map((t) => [t.id, t.className]));

/** Candlestick intervals the official API accepts, in minutes.
 *  https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *  period_interval valid values are 1 (1 minute), 60 (1 hour), 1440 (1 day). */
export const CANDLE_INTERVALS = [
  { id: '1', label: '1 minute (official candle)', minutes: 1 },
  { id: '60', label: '1 hour (official candle)', minutes: 60 },
  { id: '1440', label: '1 day (official candle)', minutes: 1440 },
];

/** Poll cadence for the live layer. Kalshi applies separate limits to
 *  unauthenticated public requests — see rate_limits. */
export const POLL_MS = 30000;
