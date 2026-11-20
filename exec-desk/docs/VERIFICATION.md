# Verification Log — line by line

Verification method: every API fact was read directly from the official Kalshi documentation
(`docs.kalshi.com`, fetched page-by-page on 2026-11-20) and cross-checked against the OpenAPI
spec embedded in those pages. Sources are numbered per [SOURCES.md](SOURCES.md).

| Line / claim | Where it appears | Verified against | Result |
|---|---|---|---|
| Demo REST recommended = `https://external-api.demo.kalshi.co/trade-api/v2` | executive-summary, config.js | S2 (demo_env) table row "REST Trade API / Recommended demo endpoint" | ✅ exact match to user brief |
| Demo REST also supported = `https://demo-api.kalshi.co/trade-api/v2` | executive-summary, config.js | S2 table "Also supported" | ✅ exact match |
| Demo WS recommended = `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | executive-summary, config.js | S2 table "WebSocket API" | ✅ exact match |
| Demo WS also supported = `wss://demo-api.kalshi.co/trade-api/ws/v2` | executive-summary, config.js | S2 table | ✅ exact match |
| Public market data requires no authentication | kalshi.js (no auth headers on market reads) | S4 ("No authentication headers are required…") | ✅ |
| WebSocket requires signed handshake even for public channels | flagged UNVERIFIED-01 rationale, dashboard polling design | S5 ("WebSocket connections require authentication during the connection handshake") | ✅ |
| Orderbook returns bids only; arrays ascending, best last | dashboard depth chart | S4 (code comment "arrays are sorted ascending, best bid last") + S9 | ✅ |
| Implied ask = 1 − best no bid | dashboard depth chart legend | S9 (binary equivalence described on page) | ✅ |
| `status` filter values `unopened/open/paused/closed/settled` | markets.html filter | S6 (MarketStatusQuery enum) | ✅ |
| Market lifecycle `status` enum `initialized/inactive/active/closed/determined/disputed/amended/finalized` | markets.html state logic | S6 (Market.status enum) | ✅ |
| `result` enum `yes/no/scalar/''` | markets.html resolution column | S6 (Market.result enum) | ✅ |
| Yes outcome pays $1/contract, No pays $1/contract | executive-summary, markets.html | S11 | ✅ |
| `/markets` `limit` default 100, max 1000 | kalshi.js paging | S6 (MarketLimitQuery) | ✅ |
| `/events` `limit` default 200, max 200 | kalshi.js paging | S8 (limit parameter) | ✅ |
| `volume_24h_fp`, `volume_fp`, `open_interest_fp`, `notional_value_dollars`, `last_price_dollars` field names | dashboard ranking table | S6 (Market schema, required fields) | ✅ |
| 24h dollar-volume = `volume_24h_fp × last_price_dollars` (computed, not an API field) | dashboard ranking | computed client-side; **not** an official field → flagged UNVERIFIED-04 | ⚠️ flagged |
| Candlestick `period_interval` valid values 1 / 60 / 1440 minutes | dashboard minutes & hours modes | S10 (docs index line for Get Market Candlesticks) | ✅ |
| Seconds-scale chart must be client-sampled (no official sub-minute candles) | dashboard seconds mode | S10 (only 1/60/1440 supported) | ✅ |
| Series discovery fields `ticker/title/category/categories/tags/volume_fp` | topic classifier | S7 (Series schema) | ✅ |
| Series `category` filter exact & case-sensitive | topic classifier (uses client-side keyword matching instead) | S7 (parameter description) | ✅ |
| Event fields `event_ticker/series_ticker/title/settlement_sources` | dashboard events | S8 (EventData schema) | ✅ |
| `GET /portfolio/balance` fields `balance/balance_dollars/portfolio_value/updated_ts` | portfolio.html | S12 | ✅ |
| Balance rate limit 1 req/s (Basic/Advanced) | portfolio poll interval (≥1s) | S12 | ✅ |
| `GET /portfolio/positions` field names incl. `position_fp` signed (+YES/−NO) | portfolio.html | S13 (MarketPosition schema) | ✅ |
| `GET /portfolio/orders` read path + Order schema field names | trades.html | S16 (`get /portfolio/orders` in embedded OpenAPI) | ✅ |
| Order creation path `POST /portfolio/events/orders` + required body fields | trade-exec.js | S17 (embedded OpenAPI, required list) | ✅ |
| Legacy `POST /portfolio/orders` returns 410 | trade-exec.js (never used) | S17 description | ✅ |
| Order response `order_id/fill_count/remaining_count/ts_ms`; 201 ≠ resting | trade-exec.js | S17 | ✅ |
| Signed message = `timestamp + METHOD + path` (no query string) | trade-exec.js (client-side signer) | S3 + S18 | ✅ |
| Demo credentials not shared with production; demo = mock funds; prices may not reflect real markets | executive-summary, flagged UNVERIFIED-05 | S2 + S3 | ✅ |
| Market responses cached → several seconds of lag | dashboard "as of" timestamps | S6 (caching note) | ✅ |

## Irregularities found (all published on flagged.html)

1. **UNVERIFIED-01 — Browser CORS behavior of the demo API is not documented** on docs.kalshi.com and could not be probed from the build sandbox (egress restricted to GitHub/npm/PyPI hosts). Site detects failure at runtime and reports it; no value is invented.
2. **UNVERIFIED-02 — No demo API credentials** exist in this repository (none were provided; credentials must never be requested in chat). Authenticated portfolio values render blank until a key is supplied in the site's settings; a clearly-labeled simulated ledger covers workflow testing.
3. **UNVERIFIED-03 — Third-party CORS relay** (`api.allorigins.win`) used only as an automatic fallback transport; data is fetched from the official API URL but relayed by a third party. Toggleable; flagged.
4. **UNVERIFIED-04 — "Highest dollar amount" metric definition**: the API exposes `volume_24h_fp`, `open_interest_fp`, `notional_value_dollars`; the dashboard's primary rank uses computed 24h dollar volume (`volume_24h_fp × last_price_dollars`) because no official "dollar volume" field exists. Definition is an open question (questions.html Q1).
5. **UNVERIFIED-05 — Demo vs. production data**: official docs warn demo prices/behavior may not reflect real markets (S2). All live figures on this site are demo-environment figures.
6. **Docs anomaly noted:** S6 top description lists status values `unopened, open, closed, settled` while the embedded OpenAPI enum also includes `paused`; the site accepts the OpenAPI enum (superset) and passes only documented filter values.
7. **Docs anomaly noted:** Market `title` and `subtitle` are marked deprecated (S6); the site renders `event.title + market.yes_sub_title` instead.

## What was NOT verified (blank, never filled in)

- Any portfolio/balance figure (no credentials) → blank + UNVERIFIED-02.
- Actual CORS header presence → runtime detection only → UNVERIFIED-01.
- Any production (non-demo) price, volume, or fee figure → site is demo-only by requirement.
