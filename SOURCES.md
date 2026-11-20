# SOURCES.md — verified sources (all fetched 2026-11-20 unless noted)

Session `arena-6aa291e9-demo1`. Rule followed everywhere: official source or blank + flag. Mirrored at
[docs/pages/sources.html](https://karagemop466-tech.github.io/Demo1/docs/pages/sources.html).

## A. Official Kalshi documentation (fetched this session)

| # | Page | What it verified |
|---|---|---|
| A1 | https://docs.kalshi.com/llms.txt | Documentation index (discovery) |
| A2 | https://docs.kalshi.com/getting_started/api_environments.md | REST/WS base URLs, demo+production, signing path rule |
| A3 | https://docs.kalshi.com/getting_started/demo_env.md | Demo environment, endpoint table (matches the URLs given in the task) |
| A4 | https://docs.kalshi.com/getting_started/quick_start_market_data.md | Public unauthenticated market data |
| A5 | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md | Auth headers, RSA-PSS/Ed25519 signing, timestamp ±30 s |
| A6 | https://docs.kalshi.com/getting_started/quick_start_websockets.md | WS handshake auth required for ALL channels; subscribe format |
| A7 | https://docs.kalshi.com/api-reference/events/get-events.md | Events params (status enum, limit ≤200, tickers, with_nested_markets), category deprecated |
| A8 | https://docs.kalshi.com/api-reference/market/get-series-list.md | /series category (exact, case-sensitive) + tags filters; fee_type; settlement_sources |
| A9 | https://docs.kalshi.com/getting_started/orderbook_responses.md | orderbook_fp schema; bid-only; implied asks; empty-book semantics |
| A10 | https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md | period_interval 1/60/1440; start_ts/end_ts |
| A11 | https://docs.kalshi.com/getting_started/fixed_point_migration.md | *_dollars (≤4 dp) / *_fp (2 dp) semantics; price_ranges |
| A12 | https://docs.kalshi.com/api-reference/orders/create-order-v2.md | POST /portfolio/events/orders; required fields; legacy writes → 410 Gone |
| A13 | https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md | DELETE /portfolio/events/orders/{order_id}; market_ticker auto-routing |
| A14 | https://docs.kalshi.com/api-reference/portfolio/get-balance.md | balance (cents), balance_dollars, portfolio_value, updated_ts; own bucket |
| A15 | https://docs.kalshi.com/getting_started/rate_limits.md | token buckets, 429 semantics, unauthenticated limits unpublished |
| A16 | https://docs.kalshi.com/getting_started/market_settlement.md | YES→$1 / NO→$1 payout mechanics |
| A17 | https://docs.kalshi.com/getting_started/pagination.md | cursor pagination (used by pipeline) |
| A18 | https://docs.kalshi.com/getting_started/api_keys.md | key creation/scopes guidance |
| A19 | https://docs.kalshi.com/getting_started/historical_data.md | older-than-cutoff endpoints (backtesting lead) |
| A20 | https://docs.kalshi.com/api-reference/exchange/get-exchange-status.md | public exchange health endpoint |

## B. Official DEMO API — live probes (unauthenticated GETs, 2026-11-20)

| # | Probe | Observed |
|---|---|---|
| B1 | https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=2 | 200 without auth; fixed-point fields; MVE cross-category markets |
| B2 | https://external-api.demo.kalshi.co/trade-api/v2/events?limit=3&status=open | events with category/series/settlement_sources; MECNET flag |
| B3 | https://external-api.demo.kalshi.co/trade-api/v2/series?category=Crypto | full crypto series list (category filter works) |
| B4 | https://external-api.demo.kalshi.co/trade-api/v2/series?tags=Golf | golf series (KXPGACUT, KXPGAPLAYOFF, KXTHEOPEN…) |
| B5 | https://external-api.demo.kalshi.co/trade-api/v2/series?tags=Oscars | Entertainment/Oscars series |
| B6 | https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories | full taxonomy (Elections, Crypto, Entertainment, Economics, Sports…) |
| B7 | https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXAAAGASMIN&status=open&with_nested_markets=true | gas ladder; settled market result=yes, settlement_ts, $1.00 |
| B8 | https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXBTCMINMON&status=open&with_nested_markets=true | BTC ladder (most active demo books) |
| B9 | https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXPGAPLAYOFF&status=open&with_nested_markets=true | golf event |
| B10 | https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXOSCARSUPACTO&status=open&with_nested_markets=true | culture (Oscars) event |
| B11 | https://external-api.demo.kalshi.co/trade-api/v2/events/KXNEXTNATOSECGEN-99 | elections event (via list probe B2) |

## C. Official non-docs pages

| # | Page | Used for |
|---|---|---|
| C1 | https://demo.kalshi.co/ | demo account + API keys |
| C2 | https://kalshi.com/docs/kalshi-fee-schedule.pdf | fee model reference (fee_type/fee_multiplier) |
| C3 | https://kalshi.com/markets/kxaaagasmin/us-lowest-gas-price-yearly/kxaaagasmin-26dec31 | cross-check of gas series existence |

## D. Third-party leads (labeled non-official; verified claims re-verified officially)

| # | Item | Used for |
|---|---|---|
| D1 | https://github.com/dtmiescke/kalshi-bot/pull/222 | CORS lead (403 on Origin) — superseded by direct header test below |
| D3 | `data/cors.json` (repo) — headers read from an official demo-API response carrying `Origin` | **CORS verified working** for this site's origin (F1 resolved 2026-11-20) |
| D2 | https://cryptostruct.com/prediction-markets/kalshi-kxaaagasw | gas series ticker lead (later confirmed live via demo API) |

## E. GitHub / platform

| # | Item | Used for |
|---|---|---|
| E1 | https://docs.github.com/en/pages | Pages serving model (legacy branch publishing serves all repo files) |
| E2 | https://karagemop466-tech.github.io/Demo1/ | the live site itself |
