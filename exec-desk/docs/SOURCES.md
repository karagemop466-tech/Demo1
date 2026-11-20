# Official Sources — Kalshi Demo Project

Every factual claim about the Kalshi API on this site traces to one of the sources below.
All sources are official Kalshi properties (`docs.kalshi.com`, `kalshi.com`, `demo.kalshi.co`, `github.com/Kalshi`).
Fetched and re-verified on **2026-11-20** by session `arena-3a5f6f1d`.

| # | Source (official) | What it verifies | Used on |
|---|---|---|---|
| S1 | https://docs.kalshi.com/llms.txt | Official documentation index (all pages below exist) | all pages |
| S2 | https://docs.kalshi.com/getting_started/demo_env | Demo environment: mock funds at https://demo.kalshi.co; demo REST `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) / `https://demo-api.kalshi.co/trade-api/v2` (also supported); demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (recommended) / `wss://demo-api.kalshi.co/trade-api/ws/v2` (also supported); demo prices may not reflect real markets | executive-summary, dashboard, flagged |
| S3 | https://docs.kalshi.com/getting_started/api_environments | Full production + demo endpoint tables; credentials not shared between environments; signed path = path without query string | executive-summary, sources |
| S4 | https://docs.kalshi.com/getting_started/quick_start_market_data | Public market data needs no auth: `/series`, `/series/{ticker}`, `/events`, `/events/{ticker}`, `/markets`, `/markets/{ticker}`, `/markets/{ticker}/orderbook`; orderbook arrays `orderbook_fp.yes_dollars` / `no_dollars` are `[price_dollars, count_fp]`, ascending, best last; only bids are returned | dashboard, markets |
| S5 | https://docs.kalshi.com/getting_started/quick_start_websockets | WebSocket handshake **requires** signed auth headers even for public channels → browser dashboard uses REST polling without keys | dashboard, flagged |
| S6 | https://docs.kalshi.com/api-reference/market/get-markets | `/markets` query params (`limit` ≤1000 default 100, `cursor`, `status`, `series_ticker`, `event_ticker`, `tickers`…); status filter enum `unopened/open/paused/closed/settled`; full Market schema incl. `yes_bid_dollars`, `yes_ask_dollars`, `last_price_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `notional_value_dollars`, lifecycle `status` enum `initialized/inactive/active/closed/determined/disputed/amended/finalized`, `result` enum `yes/no/scalar/''`; responses cached (seconds of lag) | dashboard, markets, trades |
| S7 | https://docs.kalshi.com/api-reference/market/get-series-list | `/series` query params (`category` exact/case-sensitive, `tags`, `include_volume`); Series schema: `ticker`, `title`, `category`, `categories`, `tags`, `volume_fp`, `settlement_sources`, `contract_url`, `contract_terms_url`, `fee_type`, `fee_multiplier` | dashboard, markets |
| S8 | https://docs.kalshi.com/api-reference/events/get-events | `/events` query params (`limit` ≤200 default 200, `cursor`, `status` `unopened/open/closed/settled`, `series_ticker`, `with_nested_markets`, `min_close_ts`); EventData schema incl. `event_ticker`, `series_ticker`, `title`, `settlement_sources` | dashboard, markets |
| S9 | https://docs.kalshi.com/api-reference/market/get-market-orderbook | Orderbook returns yes bids and no bids only; a no bid at price p equals a yes ask at 1−p | dashboard (liquidity) |
| S10 | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | Candlesticks: `period_interval` valid values 1 (minute), 60 (hour), 1440 (day); OHLC in `*_dollars` | dashboard (minutes/hours chart modes) |
| S11 | https://docs.kalshi.com/getting_started/market_settlement | Yes holders receive $1/contract on Yes outcome; No holders $1/contract on No outcome; settlement shortly after expiration; zero fees for simple yes/no | executive-summary, markets, portfolio |
| S12 | https://docs.kalshi.com/api-reference/portfolio/get-balance | `GET /portfolio/balance` → `balance`, `balance_dollars`, `portfolio_value` (cents), `updated_ts`; rate limit 1 req/s (Basic/Advanced) | portfolio |
| S13 | https://docs.kalshi.com/api-reference/portfolio/get-positions | `GET /portfolio/positions` → `market_positions[]` with `ticker`, `position_fp` (signed, +YES/−NO), `total_traded_dollars`, `market_exposure_dollars`, `realized_pnl_dollars`, `fees_paid_dollars`; `settlement_status` = `unsettled/settled/all`; `count_filter=position` | portfolio |
| S14 | https://docs.kalshi.com/api-reference/portfolio/get-settlements | `GET /portfolio/settlements` — settlement records (live set) | portfolio |
| S15 | https://docs.kalshi.com/api-reference/portfolio/get-fills | `GET /portfolio/fills` — user fills | portfolio, trades |
| S16 | https://docs.kalshi.com/api-reference/orders/get-orders | `GET /portfolio/orders` (reads) with `status`/`ticker`/`limit`/`cursor`; Order schema: `order_id`, `ticker`, `outcome_side`, `book_side`, `status`, `yes_price_dollars`, `no_price_dollars`, `fill_count_fp`, `remaining_count_fp`, `initial_count_fp`, fee fields | trades |
| S17 | https://docs.kalshi.com/api-reference/orders/create-order-v2 | `POST /portfolio/events/orders` (V2): required `ticker`, `side` (`bid`/`ask`), `count`, `price`, `time_in_force` (`fill_or_kill`/`good_till_canceled`/`immediate_or_cancel`), `self_trade_prevention_type` (`taker_at_cross`/`maker`); 201 → `order_id`, `fill_count`, `remaining_count`, `ts_ms`; legacy `/portfolio/orders` writes → `410 Gone` | trades |
| S18 | https://docs.kalshi.com/getting_started/api_keys | API key creation + signing (timestamp + method + path, no query string) | trades, portfolio |
| S19 | https://docs.kalshi.com/getting_started/rate_limits | Token-bucket rate limits, tier budgets | dashboard (poll intervals), flagged |
| S20 | https://docs.kalshi.com/getting_started/market_lifecycle | How markets move from creation to settlement | markets |
| S21 | https://kalshi.com/docs (redirects to docs.kalshi.com) | Docs home | sources |
| S22 | https://github.com/Kalshi/kalshi-starter-code-python | Official Kalshi starter code (auth examples) | sources |
| S23 | https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account | Official help-center demo-account setup (linked from S2) | executive-summary |

## Live API endpoints referenced by the site (all from S2–S8)

| Purpose | Endpoint | Auth |
|---|---|---|
| Series discovery | `GET {base}/series?include_volume=true` | none (public) |
| Events (nested markets) | `GET {base}/events?status=open&series_ticker=…&with_nested_markets=true` | none (public) |
| Markets | `GET {base}/markets?status=open&limit=1000` | none (public) |
| Orderbook (liquidity) | `GET {base}/markets/{ticker}/orderbook` | none (public) |
| Candlesticks (1/60/1440 min) | `GET {base}/series/{series}/markets/{ticker}/candlesticks?start_ts=…&end_ts=…&period_interval=…` | none (public) |
| Balance | `GET {base}/portfolio/balance` | signed key (S18) |
| Positions | `GET {base}/portfolio/positions` | signed key (S18) |
| Settlements | `GET {base}/portfolio/settlements` | signed key (S18) |
| Fills | `GET {base}/portfolio/fills` | signed key (S18) |
| Orders (read) | `GET {base}/portfolio/orders` | signed key (S18) |
| Create order (V2) | `POST {base}/portfolio/events/orders` | signed key (S18) |

`{base}` defaults to the recommended demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` (S2).
