# Coordination board

Shared task board for parallel agent sessions working on `karagemop466-tech/Demo1`.
Status values: `unclaimed` · `in progress` · `done` · `needs review`.

## Sessions

| Session ID | Branch | Notes |
|---|---|---|
| `arena/e41f6700-demo1` | `arena/e41f6700-demo1` (merged) | Prior session. Shipped the initial single-page static prototype and merged it to `main` via PR #1 and PR #2. |
| `arena/c9e75f2f-demo1` | `arena/c9e75f2f-demo1` | **This session.** Owns the full rebuild: multi-page GitHub Pages site, live data layer, dashboard, portfolio/trading implementation, executive summary, suggestions, Q&A and flagged-review page. Also acts as the final integration session (single active session). |

## Task board

| Task | Status | Owner | File scope |
|---|---|---|---|
| Repo review + irregularity audit of prior session's files | done | arena/c9e75f2f-demo1 | `docs/REPO_REVIEW.md` |
| Requirements -> executable spec (all user asks mapped to sources) | done | arena/c9e75f2f-demo1 | `docs/REQUIREMENTS.md` |
| Official docs verification (endpoints, auth, candle intervals, order book semantics, lifecycle/settlement) | done | arena/c9e75f2f-demo1 | `docs/SOURCES.md`, `data/*.json` |
| Live demo data capture (markets, events, order books, candlesticks) | done | arena/c9e75f2f-demo1 | `data/*.json`, `scripts/fetch-demo-data.mjs` |
| CI data-refresh workflow (cron snapshot + optional account snapshot/trade) | done | arena/c9e75f2f-demo1 | `.github/workflows/data-refresh.yml`, `scripts/*.mjs` |
| Site shell: landing, nav, styles, shared JS | done | arena/c9e75f2f-demo1 | `index.html`, `assets/css/*.css`, `assets/js/*.js` |
| Subpages: markets, chart, liquidity, events, portfolio, trading, analysis, suggestions, questions, sources, executive summary | done | arena/c9e75f2f-demo1 | `markets/`, `chart/`, `liquidity/`, `events/`, `portfolio/`, `trading/`, `analysis/`, `suggestions/`, `questions/`, `sources/`, `summary/` |
| Verification pass: every data row carries an official source link | done | arena/c9e75f2f-demo1 | `docs/VERIFICATION.md`, `sources/` pages |
| Final integration: re-verify combined data, build check, PR to main, merge, Pages deploy | done | arena/c9e75f2f-demo1 | `docs/INTEGRATION.md` |

## Log

- **2026-11-20 — Claim.** This session read `COORDINATION.md`, found the prior session's task marked done, and confirmed no other session had an active claim. Claimed the full rebuild scope above and pushed the claim before starting edits. File scopes are disjoint from the prior (already merged) session's work.
- **2026-11-20 — Repo review findings (prior session's files).** Flagged in `docs/REPO_REVIEW.md`:
  1. `app.js` used `m.yes_bid_dollars ?? (m.yes_bid/100)` — the fallback divided a fixed-point field by 100 and could mislabel prices.
  2. `app.js` rendered the order book with `arr.slice().reverse().slice(0,8)` and no side-aware labelling, so "YES bid"/"NO bid" rows could not be distinguished by price level and depth was truncated arbitrarily.
  3. `app.js` built market links as `https://kalshi.com/markets/{event_ticker}` — not an official Kalshi market permalink format; official docs link markets by ticker via the API/exchange site.
  4. The prior site had a price-chart canvas with no data source, so the "graph" control was inert while the page still advertised charting.
  5. `README.md` claimed "PR #1 … merged" and a successful Pages deploy; that was true, but the Pages API currently reports `build_type: legacy`, `source.branch: main`, while the repo also contains an Actions Pages workflow — two competing publish paths for the same site.
  6. The prior `app.js` had no `let`/`const` scoping of the fetch interval (single global `timer`), no request cancellation, and the market list was re-fetched every 30s regardless of whether the previous request had resolved.
  7. Prior site presented contract volume under a "HIGHEST OBSERVED VOLUME" label while the user's requirement is "highest dollar amount" — a metric mismatch left unresolved.
  8. No `LICENSE`, no `SECURITY.md`, no `.gitignore` in the repo.
- **2026-11-20 — Sources verified by fetching official pages.** Confirmed from `docs.kalshi.com`: demo REST base `https://external-api.demo.kalshi.co/trade-api/v2` (also `https://demo-api.kalshi.co/trade-api/v2`); demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`; candlestick `period_interval` valid values are **1 / 60 / 1440 minutes only**; order book returns **bids only** (yes and no), asks are derived; signing = base64 signature over `timestamp + method + path_without_query` with `KALSHI-ACCESS-KEY/TIMESTAMP/SIGNATURE`; Ed25519 or RSA-PSS SHA-256; timestamp tolerance 30 s. Full link list in `docs/SOURCES.md`.
- **2026-11-20 — Live demo data confirmed reachable.** `GET https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=5` returned real demo records (e.g. ticker `KXMVECROSSCATEGORY-S2026PYLUGNTAUCUAPTST-NF7I2RKUA`, `status: active`, `notional_value_dollars: 1.0000`). Fields include `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `notional_value_dollars`, `result`, `settlement_ts`, `yes_bid_dollars`/`yes_ask_dollars` with `*_size_fp` sizes.
- **2026-11-20 — Credential reality (flagged, not blocking).** The sandbox has **no** Kalshi API key ID or private key (`env` scan clean; repo Actions secrets are not listable by the app token — HTTP 403). The official demo environment requires an account created through Kalshi's signup (phone verification), and demo credentials are not shared with production. Therefore this session cannot execute authenticated calls. The trading + portfolio paths are implemented to the documented spec and are exercised by CI whenever `KALSHI_API_KEY_ID` / `KALSHI_PRIVATE_KEY` repository secrets exist; until then the site reports `NOT CONNECTED` rather than inventing numbers. See `docs/FLAGGED.md`.
- **2026-11-20 — Build.** Multi-page static site, no build step, no external JS/CSS dependencies. Pages: landing, executive summary, markets, chart, liquidity, events, portfolio, trading, analysis, suggestions, questions, sources, flagged review.
- **2026-11-20 — Verification.** `node --check` on every JS file, internal link/anchor check on every HTML page, and a row-by-row source-link check. Recorded in `docs/VERIFICATION.md`.
- **2026-11-20 — Publish.** PR created from `arena/c9e75f2f-demo1` to `main` and merged. Pages deploy verified via the GitHub Pages API (`status: built`). PR + merge details in `docs/INTEGRATION.md`.

## Sources (all official)

- https://docs.kalshi.com/getting_started/api_environments
- https://docs.kalshi.com/getting_started/demo_env
- https://docs.kalshi.com/getting_started/api_keys
- https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
- https://docs.kalshi.com/getting_started/quick_start_create_order
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/getting_started/quick_start_websockets
- https://docs.kalshi.com/getting_started/market_lifecycle
- https://docs.kalshi.com/getting_started/market_settlement
- https://docs.kalshi.com/getting_started/orderbook_responses
- https://docs.kalshi.com/getting_started/rate_limits
- https://docs.kalshi.com/getting_started/fixed_point_migration
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks
- https://docs.kalshi.com/api-reference/market/get-market-orderbook
- https://docs.kalshi.com/api-reference/market/get-events
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills
- https://docs.kalshi.com/api-reference/portfolio/create-order
- https://docs.kalshi.com/api-reference/portfolio/get-orders

## Irregularities (published on the site's "Flagged for review" page)

- No Kalshi demo credentials are available to this session, so authenticated portfolio/trading cannot be executed here. See `docs/FLAGGED.md`.
- Browser CORS behaviour for `external-api.demo.kalshi.co` could not be verified from this sandbox (no direct network route). The site tries a direct request first and then documented public relays; the site reports which path succeeded.
- The repo has both a legacy GitHub Pages build (`build_type: legacy`) and an Actions Pages workflow; the Actions workflow is the one this session publishes with.
- "Highest dollar amount" has no single official definition. The site ranks by explicitly-labelled, separately-computed dollar metrics (open-interest notional, 24 h traded notional, depth notional at a chosen size) rather than silently substituting contract volume.
