# Verification log — session arena/ed67272c-demo1 (2026-11-20)

Method: direct sandbox network access to Kalshi hosts is blocked, so every API check below was performed by fetching the exact URL (GET) with the platform page-fetcher and recording the raw JSON. Docs pages were fetched from docs.kalshi.com. Local build checks run in the sandbox (node/git). Nothing below is quoted from memory.

## Official documentation fetched & reviewed
| Page | Use |
|---|---|
| https://docs.kalshi.com/ (index) | Doc index; llms.txt discovery |
| https://docs.kalshi.com/llms.txt (chunks 0–3) | Full endpoint catalog incl. order V2, portfolio, search endpoints |
| https://docs.kalshi.com/getting_started/demo_env | Demo REST/WS endpoints, mock funds, demo account tutorial link |
| https://docs.kalshi.com/api-reference/market/get-series-list | `/series` category (exact, case-sensitive) / tags / include_volume params |
| https://docs.kalshi.com/api-reference/market/get-market-candlesticks | public, period_interval 1/60/1440, ≤5000 periods, seconds timestamps |
| https://docs.kalshi.com/api-reference/market/get-trades | path `/markets/trades`, public, limit 1–1000, ticker/min_ts/max_ts |
| https://docs.kalshi.com/api-reference/events/get-events | limit ≤200, status enum, with_nested_markets, tickers param, deprecated event.category |
| https://docs.kalshi.com/getting_started/orderbook_responses | book structure, bids-only rule, reciprocal price math, depth param |
| https://docs.kalshi.com/getting_started/api_keys | key types (Ed25519 default, RSA PKCS#1), signing spec, 30 s tolerance, scopes |
| https://docs.kalshi.com/getting_started/quick_start_authenticated_requests | headers, pre-sign text, balance in cents example |
| https://docs.kalshi.com/getting_started/fixed_point_migration | *_dollars ≤4 dp, *_fp counts, price_ranges grid table |
| https://docs.kalshi.com/api-reference/orders/create-order-v2 | POST /portfolio/events/orders full request/response schema |
| https://docs.kalshi.com/api-reference/orders/cancel-order-v2 | DELETE /portfolio/events/orders/{id}?market_ticker= |
| https://docs.kalshi.com/api-reference/orders/get-orders | GET /portfolio/orders, status filter, order schema |
| https://docs.kalshi.com/api-reference/portfolio/get-balance | balance/portfolio_value cents + balance_dollars, 1 req/s limit |
| https://docs.kalshi.com/api-reference/portfolio/get-fills | fill schema incl. outcome_side/book_side mapping, fee_cost (unit unstated → flagged) |
| https://docs.kalshi.com/api-reference/portfolio/get-positions | position_fp signed, realized_pnl_dollars, fees_paid_dollars, settlement_status |
| https://docs.kalshi.com/api-reference/search/get-filters-for-sports | sports filter taxonomy endpoint |

## Demo API responses fetched & preserved (site/data/)
| Query (exact) | Preserved in |
|---|---|
| /markets?limit=2 | api-notes context (MVE markets, fixed-point fields) |
| /markets/{ticker}/orderbook (MVE + KXDEMOFUTHOURLY-26NOV20H12-UP) | snapshot-orderbook-candlesticks.json |
| /markets/trades?ticker=…&limit=2 and ?limit=6 | snapshot-trades.json |
| /events?status=open&limit=60 (6 pages) | topic/category catalog → classification rule |
| /series?category=Crypto | snapshot-series-crypto.json (~36 pages total; sample kept) |
| /series?category=Economics&include_volume=true | snapshot-series-gas.json (118 pages; sample kept) |
| /series?category=Culture | snapshot-series-culture.json (full small list) |
| /series?category=Elections&include_volume=true | snapshot-series-elections.json (529 pages; sample kept) |
| /series?tags=Golf (and tags=golf → null) | snapshot-series-golf.json (27 pages; sample kept; case-sensitivity flagged) |
| /events?series_ticker=KXAAAGASW&status=open&with_nested_markets=true&limit=1 | snapshot-events-gas.json |
| /markets?event_ticker=KXAAAGASW-26NOV23 (and -26NOV16) | snapshot-events-gas.json / snapshot-resolutions-gas.json |
| /events?status=settled&series_ticker=KXAAAGASW | snapshot-resolutions-gas.json |
| /series/KXAAAGASW/markets/KXAAAGASW-26NOV23-3.5800/candlesticks (1-min window) | empty array observed → snapshot-orderbook-candlesticks.json |
| /series/KXDEMOFUTHOURLY/.../candlesticks (same-day window) | empty array despite trade at 11:28:33Z → flagged F-03 |
| /search/filters_by_sport | verified reachable publicly (3 pages) |

## Third-party verification
- CORS: https://cors-test.codehappy.dev/?url=https%3A%2F%2Fexternal-api.demo.kalshi.co%2Ftrade-api%2Fv2%2Fmarkets%3Flimit%3D1&method=get — response headers show `access-control-allow-origin` echoing the tester origin + `access-control-allow-credentials: true` + `vary: Origin`. Cross-checked via https://api.hackertarget.com/httpheaders/ (no-Origin request → no ACAO, consistent with origin-echo design).

## Local build checks (sandbox)
- `node --check` on every `site/js/*.js` (also enforced in CI).
- JSON.parse validation of all `site/data/*.json` (also enforced in CI).
- Internal link check across all `site/*.html` (also enforced in CI).
- Git: work committed on `arena/ed67272c-demo1`, `git pull --rebase` before each push per coordination protocol.

## Irregularities found (full register on flagged.html)
F-01 limit param ignored on demo /markets · F-02 CORS origin-echo (resolved prior unknown) · F-03 empty candles despite trades · F-04 status vocabulary mismatch (active/finalized vs documented open/settled) · F-05 no official dollar-volume field (proxy labeled) · F-06 fee_cost unit undocumented · F-07 tags/category case-sensitivity · F-08 event.category deprecated · F-09 demo key cannot be created by agent · F-10 demo behavior may not reflect production · F-11 legacy order writes removed (410 → use V2).
