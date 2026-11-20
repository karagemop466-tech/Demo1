# Executive summary — Kalshi demo monitor (2026-11-20)

## Objective
Collect, organize and analyze Kalshi **demo** exchange data around five topics (gas prices, elections, culture, crypto, golf), track live events to resolution, analyze a demo-account portfolio, execute demo trades, and expose every finding with verifiable sources on a public GitHub Pages dashboard.

## Environment (all verified against official sources)
- **Endpoints (recommended demo):** REST `https://external-api.demo.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`. Also supported: `demo-api.kalshi.co` host. Source: https://docs.kalshi.com/getting_started/demo_env
- **Mock funds:** demo accounts trade with play money; credentials are not shared with production. Source: same page.
- **Public market data needs no key.** Markets, order books, trades, events, series and candlesticks were all fetched unauthenticated on 2026-11-20.
- **Account data and orders need an API key** (Ed25519 default; RSA-PSS supported): sign `timestampMs + METHOD + path-without-query`, headers `KALSHI-ACCESS-KEY/TIMESTAMP/SIGNATURE`. Sources: api_keys + quick_start_authenticated_requests.
- **Browser CORS works** for the demo API (server echoes requester Origin). Verified via header test evidence. Preflight for signed requests still needs one live confirmation once a key exists (flagged).
- **Data formats:** prices are fixed-point dollar strings (`*_dollars`, ≤4 dp); counts are fixed-point strings (`*_fp`, 2 dp); order books expose bids only (YES bid X = NO ask $1−X); candlestick intervals are 1/60/1440 minutes only.

## What was built
1. **Live dashboard** — classifies demo events into the five topics using only official series `category`/`tags` fields (case-sensitive filters verified), ranks by **estimated traded value** = Σ(volume × last price) (clearly labeled proxy; no official dollar-volume field exists — flagged), charts price with live 5-second trade ticks plus 5 m/15 m/1 h trade windows and 6 h/24 h/7 d official candles, and shows full order-book depth: contracts at each price, derived asks/spread, displayed liquidity per side.
2. **Resolution tracking** — watchlist of live topic events recorded in the browser (first seen, transitions, outcome), plus verified settled samples: the weekly AAA gas-price event of Nov 16, 2026 settled with every strike ≥ $3.94 resolving **no** at 14:32:51Z (`settlement_value_dollars` $0.0000).
3. **Portfolio & trading (demo)** — full client-side implementation of signed authentication (WebCrypto Ed25519/RSA-PSS, PKCS#1→PKCS#8 conversion for legacy RSA PEMs), balance/positions/fills/orders rendering, P&L aggregation, V2 order placement with price-grid validation and explicit preview+confirmation, order cancellation, and a local trade journal with strategy tags. **Activation requires the user's demo API key** — the only manual step, flagged (agents must not handle secrets).
4. **Decision support** — suggestions register (10 items with review statuses) and open-questions register (12 items: what we know with sources, what's missing, how to discover it), plus 11 flagged irregularities and 8 deliberately-blank unverified items.
5. **Traceability** — every table row links its source (exact API query URL or official docs page); requirement matrix R-01…R-18 maps the brief to implementations and evidence.

## Findings that matter for decisions
- **Demo liquidity is thin and bot-driven.** Books often have 0–1 levels; conclusions from demo analytics are mechanics-testing, not market signal (official docs warn demo behavior may not be reflective).
- **The “highest dollar amount” metric is a choice, not a fact.** Contract volume (e.g. gas series KXAAAGASW: 94.7M contracts lifetime) ≠ dollars. Three defensible definitions are proposed; the current labeled proxy is conservative.
- **Topic taxonomy needs one scope call from you:** does “elections” include the separate `Politics` category, and does “culture” include `Entertainment`? Current rule: Elections category only; Culture+Entertainment. (Q-11 / classification table.)
- **Two API irregularities observed in demo:** the `limit` param on `/markets` appears ignored (F-01) and market object `status` values (`active`, `finalized`) differ from the documented filter enum (`open`, `settled`) (F-04). Both are worked around and documented.
- **Candlesticks occasionally lag trades in demo** (empty candle array despite a trade minutes earlier — F-03). Sub-hour charts therefore use official trade records.

## What is deliberately blank
Demo account balances, positions, fills, orders, P&L and any trade outcomes — no API key exists in this project, and none is stored in the repo. These panels populate the moment a demo key is connected in the browser (one-time, ~2 minutes, official steps linked on the Portfolio page).
