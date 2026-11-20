# Demo1 — Kalshi Demo Dashboard

A static GitHub Pages site (repository root, served from `main` at `/`) that tracks Kalshi prediction markets in five categories (gas prices, golf, crypto, elections, culture), with a source-linked table, a live price chart, an orderbook liquidity view, analysis, open questions, suggestions, and a Flagged for Review page.

- **Live site:** GitHub Pages for this repository, served from the `main` branch, root folder (`/`).
- **Coordination:** see [COORDINATION.md](COORDINATION.md) for task status, sources, verification, and irregularities.

## Verified dashboard (this session)

`site/` is a separate, fully source-linked dashboard built from a single, logged collection run against the
**official Kalshi demo Trade API** (`snapshot/`). Open it at `/site/index.html`.

| Path | Purpose |
|---|---|
| `tools/collect_kalshi.py` | Collector: series, markets (`open`/`settled`/`closed`), events, order books, candlesticks, public trades |
| `snapshot/*.json`, `snapshot/collect-log.txt` | The verified snapshot + request-by-request log (485 requests, 0 failures) |
| `build_site.py` | Renders `site/` from `snapshot/` only; fails on any broken internal link |
| `tools/account_worker.py` | Optional **read-only** signed client for demo portfolio data (no write path, no orders) |
| `site/` | Overview, live markets, 5 topic pages, resolved outcomes, liquidity + chart, data browser, portfolio, strategies, suggestions, questions, flagged, sources |

Definitions used: dollar ranking = computed 24 h traded notional (Σ `yes_price_dollars` × `count_fp`, trade count
shown); liquidity = order-book bids with contract counts (asks derived as 1.00 − opposite bid); resolution =
API `result` field on settled markets; history = documented 1/60/1440-minute candlesticks only. Absent values are
blank and listed on the Flagged for Review page.

## Structure

| Path | Purpose |
|---|---|
| `index.html` | Landing page |
| `executive-summary.html` | Executive summary, blocked items, decisions needed |
| `markets.html` | Verified market rows, each linked to its API source |
| `dashboard.html` | Live chart (seconds / minutes / hours) and orderbook liquidity |
| `portfolio.html` | Demo-account portfolio and trade log (blocked: no API key) |
| `analysis.html` | Snapshot findings and trade-categorization framework |
| `questions.html` | Questions, answers so far, and missing information |
| `suggestions.html` | Improvement proposals (none implemented; choose first) |
| `flagged.html` | Flagged for Review: unverified items, irregularities, repo findings |
| `sources.html` | Official sources and whether each was read |
| `data/markets.json` | The verified market table (source of truth for the site) |
| `assets/` | Shared CSS, navigation, and dashboard script (no external dependencies) |

## Data hub, CI pipeline & audit trail (session arena-6aa291e9-demo1)

A second, CORS-proof data path plus the audit layer lives under `docs/`:

| Path | Purpose |
|---|---|
| `docs/index.html` | Data hub landing — top-USD events across all topics, pipeline status |
| `docs/pages/live.html` | Dashboard: est. USD ranking, price chart (15 min → 7-day windows, 1m/60m official candles), order-book depth with contracts at each price |
| `docs/pages/resolutions.html` | Events tracked by CI until they resolve YES/NO (with `settlement_ts`, `settlement_value_dollars`) |
| `docs/pages/portfolio.html` | Demo-account portfolio/trade analysis (credential-gated; `scripts/demo_trader.py`) |
| `docs/pages/verification.html` | Line-by-line verification log — every claim linked to official sources |
| `docs/pages/flagged.html` | Flagged for Review register (F1–F14) with evidence links |
| `docs/pages/repo-review.html` | Line-by-line repository review |
| `docs/pages/suggestions.html` | Suggestions queue + questions/information/answers matrix |
| `docs/pages/sources.html` | Full source register (mirrors `SOURCES.md`) |
| `docs/data/*.json` | Provenance-stamped pipeline output (`snapshot.json`, `history.json` — 1m/60m candles, `resolutions.json`, `series_map.json`, `run_log.json`) |
| `scripts/fetch_kalshi_data.py` | CI pipeline (`.github/workflows/kalshi-data.yml`, every 15 min; commits data on `main`) |
| `scripts/demo_trader.py` | Signed demo-account client (order V2); disabled strategies in `scripts/strategies.json` |
| `tests/test_fetch_kalshi_data.py` | Offline unit tests using recorded live payloads |
| `EXECUTIVE_SUMMARY.md`, `SOURCES.md`, `REVIEW.md` | Executive summary, verified sources register, repo review |

## Data sources

All market values come from Kalshi's public REST API (no key needed for market data):

- Production: `https://external-api.kalshi.com/trade-api/v2`
- Demo: `https://external-api.demo.kalshi.co/trade-api/v2`

Documentation: <https://docs.kalshi.com/llms.txt>. Gas settlement input: <https://gasprices.aaa.com/>.

## Limits

- The table is a sample (15 verified rows), not a full market list.
- Culture has no verified open market; that row is blank and flagged.
- Portfolio tracking and trading need a Kalshi API key, which is not stored in this repository.
- Live browser requests to Kalshi: **CORS verified working** on 2026-11-20 (`data/cors.json` — the official API reflects this site's origin).

## Local preview

No build step. Serve the folder with any static server:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Other pages on this site

- `monitor/` — single-page market monitor from session `arena/e41f6700-demo1` (moved here from the repository root; its files are unchanged except link paths).
- `pages/` — multi-page site from session `arena/a443fb8f-demo1` (landing/executive summary, category pages, dashboard, portfolio, trades, suggestions, questions, flagged review). Linked from the landing page.

## Single-page monitor (session arena/e41f6700-demo1)

A static GitHub Pages research dashboard for Kalshi demo public market data, focused on gas prices, elections, culture, crypto and golf. Includes market scanning, order-book inspection, portfolio/strategy requirements, a suggestions review queue and an explicit flagged-unknowns register.

## Executive summary

- **Market discovery:** the page requests open demo markets from `https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=1000`, filters topic keywords, and ranks matching markets by the API-reported contract volume. It refreshes every 30 seconds. It does not label contract volume as dollars or claim it measures the “highest dollar amount.”
- **Depth:** selecting “Inspect book” requests the public market order book and shows returned bid levels and quantities, when available. Displayed bids are not a guarantee of execution.
- **History and resolution:** open market rows display returned status/result values when present. The price-history panel deliberately displays no fabricated graph: historical endpoint integration and timestamp/interval verification remain open work.
- **Account and trading:** portfolio access is authenticated. This static site does not request, store, sign with credentials or submit orders. Secure account reporting and order entry require a server-side signing service, explicit demo account authorization, risk controls and verification.
- **Decision support:** the site lists unanswered questions, source-linked official documentation, reviewable improvement suggestions, and known irregularities. Empty/unavailable data stays blank.

## Use / deploy

Open `monitor/index.html`, or enable GitHub Pages for the repository using the GitHub Actions workflow in `.github/workflows/pages.yml`. This is dependency-free static HTML/CSS/JavaScript. A browser may block API calls because of cross-origin policy or API availability; the dashboard reports that condition without inserting sample records. Deploying the site does not make authenticated endpoints or trade execution safe.

## Verified official references

| Detail used | Official source | Verification |
|---|---|---|
| Public unauthenticated market-data approach and markets/events/orderbook examples | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Official documentation page fetched and reviewed 2026-11-20. It documents public unauthenticated production data and examples for markets, events, and orderbook; demo endpoint base is shown in relevant API docs. |
| Demo REST base URL, balance authentication headers | [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance) | Official page fetched and reviewed 2026-11-20; includes demo base URL alternatives and requires key, signature, timestamp headers. |
| Markets endpoint | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | Official reference linked for manual review; its page could not be independently fetched in this session. The markets request follows the official quick-start example. |
| Order book / bid depth | [Get Market Order Book](https://docs.kalshi.com/api-reference/market/get-market-order-book) | Official reference linked for manual review; quick-start page fetched and documents the market order-book endpoint and bid quantities. |
| Positions and fills | [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions), [Get Fills](https://docs.kalshi.com/api-reference/portfolio/get-fills) | Official references linked for manual review; details were not independently fetched. |

## Known limitations / flagged for review

1. Topic matching currently uses keywords across returned titles/tickers/categories, not an authoritative taxonomy. It can omit or misclassify records.
2. Volume is a contract count. No dollar ranking is shown because volume alone cannot establish current market liquidity, notional traded, open exposure or available dollars at a price.
3. UI price-history controls are visual placeholders; no history series is plotted until the historical endpoint and its supported resolutions are verified and implemented.
4. Resolution display uses returned `status` and `result` fields only; history, final settlement and timestamps are not independently reconciled.
5. Portfolio performance and trade analytics are blank because no authenticated demo account data is available.
6. Browser CORS and availability may block API calls. A proxy/server would be needed if confirmed. No proxy or credentials are included.
7. No Github Pages deployment can be confirmed from this local change alone; publishing requires the repository’s Pages configuration and successful GitHub Actions run.

See [COORDINATION.md](COORDINATION.md) and the site's **Questions & flagged for review** section for the audit trail and missing-information checklist.


---

## Live demo desk (added 2026-11-20, session `8c8d4499`)

The earlier pages in this repository could not read the Kalshi demo API from their build
sandbox, so their tables were blank. That limitation was specific to `bash` egress in the
sandbox — the API itself is public and answered **19 live requests** during this session, and the
new pages use it directly from the browser.

| Page | What it does | Data path |
|---|---|---|
| `pages/live.html` | Ranks live events by **traded notional (USD)** = `volume_fp × notional_value_dollars`, filtered to gas prices, elections, culture, crypto and golf; price chart (time on X, contract price in USD on Y) with `1m/1h/1d` candles or sub-minute trade ticks; order-book ladder with contracts **and dollars at each price**; watch buttons for resolution tracking; a request log showing the exact URL behind every number | `GET /markets/trades` → `GET /markets?tickers=` → `GET /events?tickers=` → `GET /series?category=…&tags=…` → `GET /markets/{ticker}/orderbook` → `GET /series/{series}/markets/{ticker}/candlesticks` |
| `pages/resolutions.html` | Tracks each watched event until the API returns `result = "yes"` / `"no"`, records `settlement_ts` / `settlement_value_dollars`, and keeps an append-only, source-linked resolution log in the browser | `GET /markets?event_ticker=…` |
| `pages/strategy.html` | Fill ledger (official `count_fp` / `yes_price_dollars` / `no_price_dollars` / `fee_cost` / `outcome_side` fields), rule-based strategy tags, realised P&L computed only from resolved markets, CSV/JSON export, and an order **draft** (never a send) | local bridge → `GET /portfolio/balance`, `/positions`, `/fills` |
| `docs/api-verification.md` | 20-row verification table (claim → official source → observed response), 4 environment statements, 8 repo-review findings, 8 explicitly unverified items | `docs.kalshi.com` + live demo responses |
| `tools/kalshi-signer.mjs` | Optional local bridge: signs `timestamp + METHOD + path` with RSA-PSS/SHA-256 or Ed25519 (both round-trip verified locally), adds CORS, allowlists paths, and refuses order writes unless started with `ALLOW_ORDERS=1` on a demo host | account owner's machine |
| `tests/dashboard.test.mjs` | 46 headless checks (jsdom) that the pages call the right endpoints and render only returned values — all passing | — |
| `tools/check-links.mjs` | Broken-link, secret-material and source-citation audit used by CI | — |

**Honest limits.** No Kalshi credentials exist in this repository, so no order was placed and no
account balance, position or fill was read; those cells are blank and flagged. Contract *volume*
is a count, so the dollar column is an explicit `contracts × settlement notional` calculation, not
a measure of money at risk. Sub-minute price history comes from individual trades because the
candlestick endpoint only supports 1, 60 and 1440-minute intervals. Browser-side cross-origin access
to the demo host is detected at view time (see the request log on the page) — if it is blocked, the
page says so and points at the local bridge instead of substituting values.
