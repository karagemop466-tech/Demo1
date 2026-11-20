# Official sources — Kalshi Trade API v2 (demo environment)

This register links each endpoint row directly to official Kalshi documentation. The shell sandbox has outbound-network restrictions, so this session did not use `curl` to the Kalshi host. The approved page-fetch tool did retrieve the official demo `GET /markets?status=open&limit=10` response on 2026-11-20; the site does not embed values from that response. Runtime browser CORS and fresh values are not verified for every visitor. Displayed values are read from the official public API at runtime; no static sample market values are used.

## Base URLs

| Interface | Demo — recommended | Demo — also supported | Production | Official source |
|---|---|---|---|---|
| REST Trade API | `https://external-api.demo.kalshi.co/trade-api/v2` | `https://demo-api.kalshi.co/trade-api/v2` | `https://external-api.kalshi.com/trade-api/v2` | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) |
| WebSocket API | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | `wss://demo-api.kalshi.co/trade-api/ws/v2` | `wss://external-api-ws.kalshi.com/trade-api/ws/v2` | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) |

## Endpoint references

| Endpoint | Method | Auth required? | Notes | Official source |
|---|---:|---:|---|---|
| `/events` | GET | No | Paginated list; status filter includes open/closed/settled; excludes multivariate events | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) |
| `/events/{event_ticker}` | GET | No | Lookup one event by ticker | [Get Event](https://docs.kalshi.com/api-reference/events/get-event) |
| `/markets` | GET | No | Market filters, pagination cursor, current price, volume and result fields | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| `/markets/{ticker}` | GET | No | One market by ticker; used for selected-market session status/result polling | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) |
| `/markets/{ticker}/orderbook` | GET | No | Point-in-time YES/NO bids and contract quantities; asks are not separately returned | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) |
| `/series/{series_ticker}/markets/{ticker}/candlesticks` | GET | No | Historical candlesticks; official reference documents supported interval and endpoint path | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) |
| `/markets/trades` | GET | No | Public trade records | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) |
| `/series` | GET | No | Series discovery; public market-data workflow | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) |
| `/portfolio/balance` | GET | Yes | Private demo account balance | [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance) |
| `/portfolio/positions` | GET | Yes | Private open positions | [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions) |
| `/portfolio/orders` | GET | Yes | Private order history | [Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) |
| `/portfolio/fills` | GET | Yes | Private fills | [Get Fills](https://docs.kalshi.com/api-reference/portfolio/get-fills) |
| `/portfolio/settlements` | GET | Yes | Private settlement records | [Get Settlements](https://docs.kalshi.com/api-reference/portfolio/get-settlements) |
| `/portfolio/events/orders` | POST | Yes | Create order; **not enabled by this static site** | [Create Your First Order](https://docs.kalshi.com/getting_started/quick_start_create_order) |
| `/portfolio/events/orders/{order_id}` | DELETE | Yes | Cancel order; not executed here | [Create Your First Order](https://docs.kalshi.com/getting_started/quick_start_create_order) |
| `/portfolio/events/orders/{order_id}/amend` | POST | Yes | Amend order; not executed here | [Create Your First Order](https://docs.kalshi.com/getting_started/quick_start_create_order) |

## Authentication and public-data boundaries

Public REST market-data endpoints used by the live monitor do not require API keys. Private portfolio/trade endpoints require signed requests. Kalshi documents Ed25519 and RSA key support and request signing over `timestamp + method + path` without the query string. Never put private keys in GitHub Pages JavaScript or browser storage. This repository collects no credentials and submits no orders.

- [API Keys](https://docs.kalshi.com/getting_started/api_keys) — key handling, signatures and scopes.
- [API Environments](https://docs.kalshi.com/getting_started/api_environments) — demo and production credentials/endpoints are separate.
- [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets) — authenticated WebSocket example; the current live monitor uses REST polling instead.
- [Kalshi demo account Help](https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account) — demo account context.

## Known limitations and irregularities

1. The requested “highest dollar amount” ranking is unresolved. This site ranks contract counts only; it does not claim those are dollars traded.
2. Topic matching uses title/subtitle/ticker keywords, not a verified exhaustive Kalshi taxonomy. API discovery is bounded and flagged for review.
3. The chart shows browser-session samples of YES bid, not the official candlestick history endpoint; samples disappear when the page closes.
4. Selected-market resolution polling is session-scoped and not a comprehensive archive of all events.
5. Browser CORS/API availability is not verified for every deployment/viewer environment. On failure the UI shows no substituted values.
6. Private portfolio analytics and trade execution remain disabled pending secure backend, authorization, and explicit risk controls.
7. The API changelog marks market-level `liquidity` and `liquidity_dollars` deprecated/zero; the orderbook is used for contract depth instead. See [API Changelog](https://docs.kalshi.com/changelog).
