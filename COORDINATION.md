# Coordination board

Shared task board for all agent sessions working on this repo.
Read this file before starting. Claim a task by writing your session ID and file scope, then commit and push the claim immediately.

Sessions seen on remote branches: `e41f6700` (prior, done), `bc250043` (this session), plus branches `0135085b`, `0cc392e4`, `175cafdf`, `3a5f6f1d`, `8344abc8`, `a443fb8f`, `ff423a65` (checked at claim time: identical to `origin/main`, i.e. no commits and no claims yet).

| Task | Status | Owner | File scope |
|---|---|---|---|
| Kalshi demo research, requirements, dashboard prototype and verification | done | arena/e41f6700-demo1 | `COORDINATION.md`, `README.md`, `index.html`, `styles.css`, `app.js`, `.github/workflows/pages.yml` |
| GitHub Pages deployment and merge verification | done | arena/e41f6700-demo1 | GitHub repository settings / Actions (external) |
| Live demo-data ingestion pipeline (REST snapshot + CORS probe) | in progress | arena/bc250043-demo1 | `scripts/fetch_demo_data.py`, `.github/workflows/fetch-data.yml`, `data/` |
| Multi-page dashboard site (landing + category subpages) | in progress | arena/bc250043-demo1 | `index.html`, `styles.css`, `app.js`, `markets.html`, `chart.html`, `portfolio.html`, `analysis.html`, `suggestions.html`, `review.html`, `sources.html` |
| Trading / portfolio integration (demo account, order entry, analysis) | in progress | arena/bc250043-demo1 | `scripts/kalshi_client.py`, `scripts/run_demo_trader.py`, `.github/workflows/demo-trader.yml`, `data/portfolio.json`, `data/trades.json`, `data/orders.json` |
| Executive summary, questions/answers register, suggestions register | in progress | arena/bc250043-demo1 | `README.md`, `review.html`, `suggestions.html`, `sources.html` |
| Final integration, re-verification, PR to main, Pages publish | pending | arena/bc250043-demo1 (candidate) | `main` |

## Log
- 2026-11-20 — Initial repo had only a minimal README. Checked for existing `COORDINATION.md`; none existed. Claimed end-to-end scope and committed/pushed claim. First pull against the not-yet-published remote branch failed because it did not exist; rebased against `origin/main`, then pushed current branch successfully.
- 2026-11-20 — Verified official quick-start market-data documentation and official Get Balance documentation by fetching pages. Quick-start documents unauthenticated public markets/events/orderbook examples. Balance reference documents the demo host and signed authentication headers. See source links in README and the site's rows.
- 2026-11-20 — Get Markets page fetch failed; related references for order book / positions / fills were linked but not all independently fetched. Marked as limitations, not verified claims. User-provided demo endpoint used as configured.
- 2026-11-20 — Added static dashboard with live API attempts, empty-on-failure behavior, keyword topic filters, contract-volume ranking, order-book request, portfolio/trading safety notice, questions, suggestions and review flags. No credential handling, orders, fabricated prices, history or performance data.
- 2026-11-20 — Verification: run `node --check app.js`; review HTML/CSS/JS against fetched sources and verify local links/build. External API success and GitHub Pages deployment require online Actions/API validation after push and cannot be asserted without a successful run.
- 2026-11-20 (session `bc250043`) — Re-read the repo line by line. Prior single-page prototype verified, but it could not satisfy the live/resolved/portfolio/trading requirements: no resolved-market history, no price history, no real dollar metric, no order book depth table, no trade execution. Confirmed `external-api.demo.kalshi.co` is reachable from this session's tooling and returned real demo market payloads (fields `volume_fp`, `open_interest_fp`, `notional_value_dollars`, `yes_bid_dollars`, `yes_ask_dollars`, `status`, `result`). Checked all other remote session branches: they are empty and hold no claims, so scope conflict risk was low at claim time.
- 2026-11-20 (session `bc250043`) — Claimed the ingestion pipeline, multi-page site, trading/portfolio integration and the final integration role. File scopes are listed above and are non-overlapping with the prior session's published files (which this session will supersede on `main` at integration time).

## Sources
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/market/get-markets (page fetch failed in this session)
- https://docs.kalshi.com/api-reference/market/get-market-order-book
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills

## Irregularities / outstanding integration
- Contract volume is not “dollar amount”; no dollar ranking offered absent a defensible official metric and methodology.
- Topic terms are heuristic pending authoritative series allowlist; potential omissions/false matches flagged in the UI.
- Historical price graph controls are present but no points are shown pending verified history API schema and support.
- Private account performance and trading need secure authenticated backend and user-defined permissions/limits. Browser-only Pages must not hold private keys.
- PR #1: https://github.com/karagemop466-tech/Demo1/pull/1 — merged 2026-11-20 (`gh pr merge 1 --merge`). Main deploy run https://github.com/karagemop466-tech/Demo1/actions/runs/44725819853 completed successfully (build and Pages deploy jobs both passed). GitHub Pages API reports `built`; URL: https://karagemop466-tech.github.io/Demo1/ . A second platform Pages build/deployment run was still in progress at last status check; the project deploy workflow itself succeeded.
- Local verification passed: `node --check app.js`, `git diff --check`, and static HTML internal anchor/file check. GitHub workflow validation and deploy passed. Browser/API runtime and live market response are not verified here; API may be CORS restricted.
- Known warning: GitHub Actions emitted a Node.js 20 deprecation annotation for upstream actions; build/deploy succeeded. It is listed as a maintenance irregularity, not a site failure.
