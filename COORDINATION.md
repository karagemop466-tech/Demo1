# Coordination Board — Kalshi Demo Dashboard (merged)

Shared task board for parallel agent sessions. Each session claims tasks by writing its session ID and file scope, then commits and pushes immediately. Never start a task another session has claimed. Keep scopes non-overlapping: each session works on its own branch/git worktree and edits only files in its claimed scope. If a task requires changing a file owned by another session, log the request here instead of editing it.

Sessions in this repo:
- `arena-a443fb8f-demo1` — branch `arena/a443fb8f-demo1` (multi-page site: landing/executive summary, category pages, dashboard, portfolio, trades, suggestions, questions, flagged review, docs/sources.md)
- `arena/e41f6700-demo1` — branch merged into main via PRs #1–#2 (single-page market monitor: index.html, app.js, styles.css, .github/workflows/pages.yml, README)

## Task conventions
- Status values: `unclaimed`, `in progress`, `done`, `needs review`
- `needs review` means the item is published on the Flagged for Review page and does not block anything.
- A claim older than 60 minutes with no commits may be taken over by another session; note the handoff in the log below.
- Small, frequent commits. Run `git pull --rebase` before every push.
- On merge conflict: stop, resolve without discarding the other session's work, log what happened.
- When a task is finished: record sources, verification performed, and irregularities here; mark it done.
- Never mark anything verified without checking it against an official source; link that source.
- Shared outputs (table data, site index/navigation) are changed only by the final integration session once all other tasks are done.


## Tasks — session arena/4df8be5b-demo1 (live data + verification build)

| # | Task | Status | Session ID | File scope | Sources | Verification | Irregularities |
|---|------|--------|------------|------------|---------|--------------|----------------|
| 20 | Live official-market snapshot collection script + generated verified dataset (gas/elections/culture/crypto/golf), resolved-outcome tracking | in progress | arena/4df8be5b-demo1 | `tools/collect_kalshi.py`, `data/markets.json`, `data/metadata.json`, `.github/workflows/live-data.yml` | docs.kalshi.com (See sources log) | Live fetch from `external-api.demo.kalshi.co` on GitHub Actions runners; every value carries the API URL it came from | Demo environment is a test exchange; values are demo-book values, not real-money liquidity |
| 21 | Verified static site build: landing + category pages + price-history chart (time axis, s/m/h windows) + depth-at-price + portfolio/trades documentation | in progress | arena/4df8be5b-demo1 | `build_site.py`, `site/**` (generated), `assets/**`, `pages/**` | docs.kalshi.com | Build validates every row has a source URL and every internal link resolves | Auth-only items (portfolio, order placement) cannot be verified without a demo API key — flagged, blank |
| 22 | Final integration: pull combined data, broken-link check, PR to main, merge, confirm Pages deploy | unclaimed | — | GitHub Actions / repo settings | — | — | — |

Claim log entry: 2026-11-20 — arena/4df8be5b-demo1 claimed tasks 20-21 (new file scope only; no edits to existing session files other than this board and the generated `site/` tree added by final integration).

## Tasks — session arena-a443fb8f-demo1

| # | Task | Status | Session ID | File scope | Sources | Verification | Irregularities |
|---|------|--------|------------|------------|---------|--------------|----------------|
| 1 | Coordination board setup (this file) | done | arena-a443fb8f-demo1 | COORDINATION.md | — | Self-verified | None |
| 2 | Official Kalshi API source research & verification | done | arena-a443fb8f-demo1 | docs/sources.md | https://docs.kalshi.com/getting_started/demo_env ; https://docs.kalshi.com/getting_started/quick_start_create_order ; https://docs.kalshi.com/changelog ; https://docs.kalshi.com/llms-full.txt | Verified against docs.kalshi.com (official): demo REST/WebSocket base URLs match user-provided endpoints; public market data needs no key; portfolio/trading/WebSocket need signed Ed25519/RSA key | Irregularity: build sandbox cannot reach kalshi.co, so live responses were not empirically fetched |
| 3 | Landing page + executive summary | done | arena-a443fb8f-demo1 | pages/landing-executive-summary.html | docs/sources.md | Verified: links point to docs.kalshi.com | — |
| 4 | Category subpages: gas prices, elections, culture, crypto, golf (event tables w/ source links) | done | arena-a443fb8f-demo1 | pages/{gas,elections,culture,crypto,golf}.html | docs/sources.md | Every row has an official API source link; all values blank + unverified | Live market data not reachable from sandbox |
| 5 | Live interactive dashboard: price graph (time X, contract price Y, seconds/minutes/hours zoom), liquidity & contract-availability table | done | arena-a443fb8f-demo1 | pages/dashboard.html + assets/ | docs/sources.md | Graph controls wired; live feed requires credentials | Simulated data only ever labeled explicitly as simulated |
| 6 | Portfolio performance tracking (Kalshi demo account) | done | arena-a443fb8f-demo1 | pages/portfolio.html | docs/sources.md | Endpoints documented with official links | Requires API credentials; no credentials stored |
| 7 | Trade execution interface | done | arena-a443fb8f-demo1 | pages/trades.html | docs/sources.md | POST /portfolio/events/orders documented with official link | Requires API credentials; execution not possible from this session |
| 8 | Suggestions section (review before implementing) | done | arena-a443fb8f-demo1 | pages/suggestions.html | — | n/a | — |
| 9 | Questions / information / answers for decision-making | done | arena-a443fb8f-demo1 | pages/questions.html | docs/sources.md | Pending live data | — |
| 10 | Flagged for Review page (unverified items + irregularities) | done | arena-a443fb8f-demo1 | pages/flagged-review.html | — | n/a | — |
| 11 | GitHub Pages: enable, build check, broken-link check, publish | done | arena-a443fb8f-demo1 | Pages settings via gh API | docs.github.com | Pages already enabled on repo, serving main at https://karagemop466-tech.github.io/Demo1/ (status: built). Local broken-link check: none. Will re-deploy automatically when main is updated via merge. | Cannot change Pages source branch via gh API (403 integration permission); not needed since Pages serves main and the PR merges into main |
| 12 | Final integration: merge conflict resolution, combined-site verification, PR to main, merge, record PR link & merge result | done | arena-a443fb8f-demo1 | all | docs/sources.md; docs.kalshi.com | Internal links verified (both sessions' files); all table rows carry official source links; unverified values left blank and flagged | PR #4 merged into main via `gh pr merge 4 --merge`; GitHub Pages deploy run 44726443743 succeeded; site live at https://karagemop466-tech.github.io/Demo1/ |

## Tasks — session arena/e41f6700-demo1

| Task | Status | Owner | File scope |
|---|---|---|---|
| Kalshi demo research, requirements, dashboard prototype and verification | done | arena/e41f6700-demo1 | `COORDINATION.md`, `README.md`, `index.html`, `styles.css`, `app.js`, `.github/workflows/pages.yml` |
| GitHub Pages deployment and merge verification | done | arena/e41f6700-demo1 | GitHub repository settings / Actions (external) |

## Integration log

| Date/time (UTC) | Session ID | Action |
|---|---|---|
| 2026-11-20 | arena-a443fb8f-demo1 | PR #4 (arena/a443fb8f-demo1 → main) could not merge cleanly: add/add conflicts on COORDINATION.md and index.html (both sessions added these files independently). |
| 2026-11-20 | arena-a443fb8f-demo1 | Resolved by merging main into the feature branch: kept arena/e41f6700-demo1's root `index.html`, `app.js`, `styles.css`, `.github/workflows/pages.yml`, `README.md` (their deployed single-page monitor); preserved arena-a443fb8f-demo1's multi-page site under `pages/` (landing-executive-summary.html, dashboard.html, category pages, portfolio, trades, suggestions, questions, flagged-review, assets/, docs/); added cross-links from root nav to the multi-page section; wrote this merged COORDINATION.md. No work from either session was discarded. |
| 2026-11-20 | arena-a443fb8f-demo1 | Re-ran local broken-link check on combined tree: none. |
| 2026-11-20 | arena-a443fb8f-demo1 | PR #4 (https://github.com/karagemop466-tech/Demo1/pull/4) merged into main with `gh pr merge 4 --merge`; GitHub Pages deploy run 44726443743 succeeded; site live at https://karagemop466-tech.github.io/Demo1/ (Node.js 20 deprecation annotation noted as pre-existing maintenance irregularity). |
| 2026-11-20 | arena-a443fb8f-demo1 | Task 12 marked done; final COORDINATION.md record pushed to arena/a443fb8f-demo1 (follow-up PR #5 to main to keep main's board current). |

## Claim log

| Date/time (UTC) | Session ID | Task | Action |
|---|---|---|---|
| 2026-11-20 | arena-a443fb8f-demo1 | All tasks (1–12) | Claimed by session; created COORDINATION.md; built multi-page site |
| 2026-11-20 | arena/e41f6700-demo1 | Research, dashboard prototype, verification, Pages deployment | Claimed end-to-end scope; built single-page monitor; deployed via GitHub Actions (run 44725819853) |

## Handoff log

None yet.

## Sources

Session arena-a443fb8f-demo1:
- https://docs.kalshi.com/getting_started/demo_env
- https://docs.kalshi.com/getting_started/quick_start_create_order
- https://docs.kalshi.com/changelog
- https://docs.kalshi.com/llms-full.txt
- docs/sources.md (consolidated verified endpoint table)

Session arena/e41f6700-demo1:
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/market/get-markets (page fetch failed in that session — linked for manual review)
- https://docs.kalshi.com/api-reference/market/get-market-order-book
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills

## Notes

- Sandbox outbound internet is restricted to github.com / npm / pypi hosts; kalshi.co is NOT reachable from this environment. Live Kalshi API data cannot be fetched or empirically verified here. All market values are therefore left blank and flagged `unverified` with source links to the official Kalshi API docs, per the verification requirement ("never infer or fill in values").
- No Kalshi API credentials exist in this repository and none will be added. Trade execution and portfolio reads require authenticated endpoints; the site documents the official endpoints and leaves execution as a credential-gated, flagged item.
- Both sessions' sites flag: contract volume is not "dollar amount"; topic matching is heuristic; historical price points are not fabricated; private account performance and trading need secure authenticated backend and user-defined permissions/limits; browser-only Pages must not hold private keys.
