# Official sources — Kalshi Trade API v2 (demo environment)

All endpoint claims in this site are checked against the official Kalshi API documentation at https://docs.kalshi.com. The sandbox build environment cannot reach kalshi.co (outbound internet is limited to github.com, npm, and PyPI hosts), so live market values, resolutions, balances, and trades could not be fetched from the official API. Per the project verification standard, every such value is left blank and flagged `unverified`; nothing is inferred or filled in.

## Base URLs (verified against docs.kalshi.com)

| Interface | Demo — recommended | Demo — also supported | Production |
|---|---|---|---|
| REST Trade API | https://external-api.demo.kalshi.co/trade-api/v2 | https://demo-api.kalshi.co/trade-api/v2 | https://external-api.kalshi.com/trade-api/v2 |
| WebSocket API | wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2 | wss://demo-api.kalshi.co/trade-api/ws/v2 | wss://external-api-ws.kalshi.com/trade-api/ws/v2 |

Source: https://docs.kalshi.com (REST API base URLs table; "Test In The Demo Environment"); https://docs.kalshi.com/getting_started/demo_env

## Endpoints (verified against docs.kalshi.com)

| Endpoint | Method | Auth required? | Notes |
|---|---|---|---|
| /events | GET | No | Paginated list of events (excludes multivariate; use /events/multivariate for those) |
| /events/{event_ticker} | GET | No | One event with its child markets |
| /markets | GET | No | Filterable by series_ticker, event_ticker, status |
| /markets/{ticker} | GET | No | Single market |
| /markets/{ticker}/orderbook | GET | No | Live order book |
| /markets/trades | GET | No | Recent public trades |
| /series | GET | No | Series list |
| /portfolio/balance | GET | Yes | Demo-account cash balance (mock funds) |
| /portfolio/positions | GET | Yes | Open positions |
| /portfolio/orders | GET | Yes | Order history |
| /portfolio/fills | GET | Yes | Your fills |
| /portfolio/settlements | GET | Yes | Settlement records for resolved markets |
| /portfolio/events/orders | POST | Yes | V2 order create (place bid/ask orders) |
| /portfolio/events/orders/{order_id} | DELETE | Yes | V2 order cancel |
| /portfolio/events/orders/{order_id}/amend | POST | Yes | V2 order amend |
| /account/limits | GET | Yes | Rate-limit tier token budget |

Sources:
- https://docs.kalshi.com/getting_started/quick_start_create_order (order placement: POST /portfolio/events/orders with KALSHI-ACCESS-KEY / KALSHI-ACCESS-SIGNATURE / KALSHI-ACCESS-TIMESTAMP)
- https://docs.kalshi.com/changelog (liquidity / liquidity_dollars deprecated, return 0; events return settlement_sources with name + url of the official source used to determine markets)
- https://docs.kalshi.com/llms-full.txt (full endpoint surface incl. WebSocket channels ticker / orderbook_delta)

## Authentication (verified against docs.kalshi.com)

Authenticated requests sign `timestamp + method + path` with an Ed25519 or RSA private key and send three headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE` (base64). Public market-data endpoints accept but do not require these headers. Demo API keys work only against demo endpoints; production keys do not work in demo.

## Environment note

Demo.kalshi.co uses mock funds, so it is the correct place to test order logic without real money. Credentials are not shared between environments.

## Irregularities flagged

1. The build sandbox cannot reach kalshi.co; no live Kalshi API response was fetched or empirically verified during this session.
2. No Kalshi API credentials exist in this repository, and none were created or stored. Trade execution and portfolio reads remain credential-gated and are flagged for the user to complete with their own demo API key.
3. The Kalshi changelog notes `liquidity` and `liquidity_dollars` on market responses are deprecated and return 0; contract availability at a price must be read from the order book instead.
