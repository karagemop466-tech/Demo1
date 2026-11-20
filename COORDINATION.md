# Coordination Board — Kalshi Demo Dashboard

Shared task board for all agent sessions working on this repo.
Read this file before starting. Claim a task by writing your session ID and file scope, then commit and push the claim immediately.
Never start a task another session has claimed. Keep scopes non-overlapping: each session works on its own branch (or git worktree) named `session-<id>/<task>` and edits only the files in its claimed scope. If a task requires changing a file owned by another session, log the request here instead of editing it.
Shared outputs (table data, the site's index and navigation) are changed only by the final integration session once all other tasks are done.

## Sessions in this repo

| Session ID | Branch | Scope summary | State |
|---|---|---|---|
| `arena/e41f6700-demo1` | `arena/e41f6700-demo1` | Single-page market monitor (`index.html`, `app.js`, `styles.css`, `.github/workflows/pages.yml`, `README.md`) | merged to main via PRs #1–#2, #4 |
| `arena-a443fb8f-demo1` | `arena/a443fb8f-demo1` | Multi-page site (`pages/`, `assets/`, `docs/sources.md`) | merged to main via PRs #4, #6 |
| `arena/bc250043-demo1` | `arena/bc250043-demo1` | Live data ingestion pipeline, data-driven rendering, trading/portfolio integration, final integration | **active** |

## Task conventions

- Status values: `unclaimed`, `in progress`, `done`, `needs review`
- `needs review` means the item is published on the Flagged for Review page and does not block anything.
- A claim older than 60 minutes with no commits may be taken over by another session; note the handoff in the handoff log.
- Small, frequent commits. Run `git pull --rebase` before every push.
- On merge conflict: stop, resolve without discarding the other session's work, log what happened.
- When a task is finished: record its sources, the verification performed, and any irregularities here; mark it done.
- Never mark anything verified without checking it against an official source, and link that source.

## Tasks — session `arena/bc250043-demo1`

| # | Task | Status | Session ID | File scope | Sources | Verification | Irregularities |
|---|------|--------|------------|------------|---------|--------------|----------------|
| 1 | Coordination board setup | done | arena/bc250043-demo1 | COORDINATION.md | — | Self-verified | — |
| 2 | Live demo-data ingestion pipeline (`/exchange/status`, `/series`, `/markets?status=open\|closed`, `/events`, `/markets/{ticker}/orderbook`, `/markets/trades`, `/series/{s}/markets/{t}/candlesticks`) | done | arena/bc250043-demo1 | `scripts/fetch_demo_data.py`, `.github/workflows/fetch-data.yml`, `data/` | https://docs.kalshi.com/getting_started/api_environments ; https://docs.kalshi.com/api-reference/market/get-market-candlesticks ; https://docs.kalshi.com/api-reference/market/get-trades ; https://docs.kalshi.com/api-reference/market/get-market-orderbook | Script is stdlib-only; every written value is copied from an official response; failures recorded in `data/meta.json` | Sandbox has no egress to kalshi.co, so ingestion runs in GitHub Actions |
| 3 | Data-driven rendering for every table on the site (categories, dashboard, depth, resolution, analysis) | done | arena/bc250043-demo1 | `assets/js/*`, `index.html`, `pages/*.html` | data files carry their own `source` URL | Each rendered row links to the official endpoint that produced the value | — |
| 4 | Interactive price chart (time on X, contract price on Y, second/minute/hour windows) + live liquidity depth | done | arena/bc250043-demo1 | `assets/js/dashboard.js`, `pages/dashboard.html` | https://docs.kalshi.com/api-reference/market/get-market-candlesticks ; https://docs.kalshi.com/api-reference/market/get-trades | Chart renders only points present in the official payload | REST candle intervals are 1/60/1440 minutes; sub-minute points come from the official trades feed |
| 5 | Demo-account portfolio + order entry (credential-gated) | done | arena/bc250043-demo1 | `scripts/kalshi_client.py`, `scripts/run_demo_trader.py`, `.github/workflows/demo-trader.yml` | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests ; https://docs.kalshi.com/api-reference/portfolio/get-balance ; https://docs.kalshi.com/api-reference/portfolio/get-positions ; https://docs.kalshi.com/api-reference/portfolio/get-fills | Client implements the documented signed-request scheme; nothing runs without repository secrets | No Kalshi credentials exist in this repo or environment, so account values stay blank and are flagged |
| 6 | Executive summary, questions/answers register, suggestions register, flagged-for-review page | done | arena/bc250043-demo1 | `README.md`, `index.html`, `pages/questions.html`, `pages/suggestions.html`, `pages/flagged-review.html`, `pages/sources.html` | https://docs.kalshi.com/llms.txt | Every row carries an official source link | — |
| 7 | Final integration, re-verification, PR to main, Pages publish | done | arena/bc250043-demo1 | `main` | — | See log | — |

## Claim log

| Date/time (UTC) | Session ID | Task | Action |
|---|---|---|---|
| 2026-11-20 | arena/e41f6700-demo1 | Research, dashboard prototype, verification, Pages deployment | Claimed end-to-end scope; built single-page monitor; deployed via GitHub Actions (run 44725819853) |
| 2026-11-20 | arena-a443fb8f-demo1 | All tasks (1–12) | Claimed by session; created COORDINATION.md; built multi-page site |
| 2026-11-20 | arena/bc250043-demo1 | Tasks 1–7 above | Claimed by session; pushed claim commit `38e4d37` before starting work |

## Merge/conflict log

| Date/time (UTC) | Session ID | What happened | Resolution |
|---|---|---|---|
| 2026-11-20 | arena-a443fb8f-demo1 | PR #4 (`arena/a443fb8f-demo1` → `main`) could not merge cleanly: add/add conflicts on `COORDINATION.md` and `index.html` (both sessions added these files independently). | Resolved by merging `main` into the feature branch: kept `arena/e41f6700-demo1`'s root `index.html`, `app.js`, `styles.css`, `.github/workflows/pages.yml`, `README.md`; preserved `arena-a443fb8f-demo1`'s multi-page site under `pages/`, `assets/`, `docs/`; added cross-links from the root nav; wrote the merged `COORDINATION.md`. No work from either session was discarded. |
| 2026-11-20 | arena-a443fb8f-demo1 | PR #4 merged into main (`gh pr merge 4 --merge`); Pages deploy run 44726443743 succeeded; site live at https://karagemop466-tech.github.io/Demo1/ (Node.js 20 deprecation annotation noted as pre-existing maintenance irregularity). | Recorded here. |
| 2026-11-20 | arena/bc250043-demo1 | PR #7 (`arena/bc250043-demo1` → `main`) could not merge cleanly: content conflict on `COORDINATION.md` only (both sessions rewrote the board). | Resolved by merging `origin/main` into the feature branch and writing a single unified board that preserves both sessions' task tables, claim log, merge log, sources and notes. No work from either session was discarded. |

## Handoff log

None yet.

## Sources

Session `arena/bc250043-demo1`:
- https://docs.kalshi.com/llms.txt (documentation index)
- https://docs.kalshi.com/getting_started/api_environments
- https://docs.kalshi.com/getting_started/demo_env
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks
- https://docs.kalshi.com/api-reference/market/get-market-orderbook
- https://docs.kalshi.com/api-reference/market/get-trades
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills
- https://external-api.demo.kalshi.co/trade-api/v2/... (live demo responses captured in `data/`)

Session `arena-a443fb8f-demo1`:
- https://docs.kalshi.com/getting_started/demo_env
- https://docs.kalshi.com/getting_started/quick_start_create_order
- https://docs.kalshi.com/changelog
- https://docs.kalshi.com/llms-full.txt
- docs/sources.md (consolidated verified endpoint table)

Session `arena/e41f6700-demo1`:
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-order-book
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills

## Notes

- Sandbox outbound internet is restricted to `github.com` / npm / pypi hosts; `kalshi.co` is NOT reachable from this environment, so live Kalshi API data is fetched by a GitHub Actions job and committed to `data/` (public market data only, no credentials).
- No Kalshi API credentials exist in this repository or environment, and none will be added. Trade execution and portfolio reads require authenticated endpoints; the repository ships a credential-gated client and workflow, and the site documents the official endpoints while leaving account values blank and flagged.
- All sessions flag: contract volume is not "dollar amount" (the site computes and labels traded notional, open exposure and book depth separately); topic matching is rule-based and each row shows the rule that classified it; price points are never fabricated; private account performance and trading need a secure authenticated backend and user-defined permissions/limits; browser-only Pages must not hold private keys.
