# COORDINATION.md — Shared task board

Shared board for parallel agent sessions. Status values: `unclaimed`, `in progress`, `done`, `needs review`.
`needs review` = published on the **Flagged for Review** page; it does not block anything.

## Session claim (this session)

- **Session ID:** `175cafdf` — branch `arena/175cafdf-demo1` (fixed for this session; the branch name is not changed).
- **Claimed at:** 2026-11-20 (UTC), before any implementation commit.
- **Scope:** all tasks in the Kalshi demo request, on this branch only. Files: `README.md`, `COORDINATION.md`, `docs/**` (GitHub Pages site and data), `.nojekyll`.

## Overlap notice (read before merging)

Five other session branches exist on `origin` with their own claims for the same Kalshi dashboard work. None of those claims are on `main`, and none were edited by this session:

| Branch | Claim commit | Claimed scope |
|---|---|---|
| `arena/0135085b-demo1` | `f549584` | index.html, styles.css, app.js, pages/, README, .github/workflows |
| `arena/0cc392e4-demo1` | `0b750ff` | docs/**, index.html, assets/**, src/**, tests/** |
| `arena/a443fb8f-demo1` | `8a49bb5` | COORDINATION.md, docs/sources.md, pages/*.html, index.html |
| `arena/e41f6700-demo1` | `5418e9a` | COORDINATION.md, README, index.html, styles.css, app.js, docs/ |
| `arena/ff423a65-demo1` | `7af87db` | README, COORDINATION, *.html, assets/**, .github/** |

Result: the same task is claimed on up to six branches. Merging all of them to `main` will conflict on `index.html`, `README.md`, `COORDINATION.md`, and `docs/`. **Recommended:** the final integration session picks one branch as the base, and the others are reconciled into it, not merged side by side. This session did not delete or modify any other branch.

## Task board

| # | Task | Status | Owner | File scope | Sources | Verification | Irregularities |
|---|---|---|---|---|---|---|---|
| 1 | Repo review (line by line) | done | 175cafdf | README.md, COORDINATION.md | See "Repo review" below | Checked `git ls-files`, branches, `.gitignore`/LICENSE presence | Listed below |
| 2 | Executive summary | done | 175cafdf | docs/executive-summary.html | Kalshi API docs + API responses (see Sources) | Each figure taken from a fetched API response | Listed below |
| 3 | Category markets table (gas, golf, crypto, elections, culture) | needs review (partial: 15 verified rows; culture unverified) | 175cafdf | docs/markets.html, docs/data/markets.json | Kalshi production REST API (links per row) | Field-by-field from API JSON; culture unverified | Partial sample only; see Flagged |
| 4 | Live interactive dashboard (price chart, seconds/minutes/hours, orderbook liquidity) | done (browser-side; live feed unverified) | 175cafdf | docs/dashboard.html, docs/assets/dashboard.js | Kalshi candlesticks + orderbook + market endpoints (docs links) | Rendering tested in jsdom with mocked responses (chart, summary, orderbook); live browser CORS not tested | CORS from browser unverified; real-time polling rate limits not read |
| 5 | Portfolio performance (demo account) | needs review (blocked: no API key) | 175cafdf | docs/portfolio.html | Kalshi docs (auth) | Portfolio endpoint returned an error without credentials | No API key available |
| 6 | Trade execution + performance tracking | needs review (blocked: no API key; nothing traded) | 175cafdf | docs/portfolio.html | — | Not executed | No credentials; no trades placed |
| 7 | Trade analysis / categorization / strategies | done (framework only) | 175cafdf | docs/analysis.html | — | No trade data exists to categorize | Blocked by task 5/6 |
| 8 | Suggestions section (review before change) | done | 175cafdf | docs/suggestions.html | — | Proposals only; nothing implemented | — |
| 9 | Questions / information / answers | done | 175cafdf | docs/questions.html | Kalshi docs | Mapped to sources | — |
| 10 | Flagged for Review page | done | 175cafdf | docs/flagged.html | All links listed there | Each item links its source | — |
| 11 | Integration: site build check, links, GitHub Pages, PR + merge | in progress (link check + jsdom render tests passed; PR/merge next) | 175cafdf | docs/**, .nojekyll | — | — | — |

## Repo review (task 1)

Checked on 2026-11-20 with `git ls-files`, `git branch -a`, `git ls-remote origin`, and `git show origin/<branch>:COORDINATION.md`.

- `README.md` is one line (`# Demo1`). No description, setup, or usage.
- No `LICENSE` file.
- No `.gitignore` file.
- No `COORDINATION.md` existed on `main` (created here).
- No CI workflow or build config on `main`.
- Commit history: one commit (`4a225ce Initial commit`) on `main` and on this branch.
- Five unmerged session branches with overlapping claims (see Overlap notice).
- Task text: the coordination rules name branches `session-<id>/<task>`, but this session's branch is fixed as `arena/175cafdf-demo1`. The system rule to stay on the current branch was followed.
- Task text contains escaped markup (`&amp;lt;id&amp;gt;`) in the branch-name rule. Read as `session-<id>/<task>`.

## Verification log

- 2026-11-20: Kalshi API docs read at docs.kalshi.com (Get Markets, Get Events, Get Market Candlesticks, Get Market Orderbook, llms.txt). Endpoint paths and parameters are taken from those pages.
- 2026-11-20: Production REST responses fetched for `KXAAAGASM`, `KXPGATOUR`, `KXBTC`, `KXNEXTNATOSECGEN-99` (via events), `series?category=Crypto|Culture|Elections`. Fetch tool used because the sandbox shell cannot reach Kalshi hosts.
- 2026-11-20: Demo REST responses fetched from `external-api.demo.kalshi.co`. Demo data contains placeholder-like values (see Flagged).
- 2026-11-20: `GET /portfolio/balance` on the demo host returned an error without credentials. No credentials were available, so portfolio and trading tasks are blocked.

## Sources and verification (per task)

- **Tasks 2, 3, 9, 10:** Kalshi REST API responses (production `external-api.kalshi.com`, demo `external-api.demo.kalshi.co`) and docs.kalshi.com pages. Every verified row on `docs/markets.html` links to its API response. Field-by-field check: each value in `docs/data/markets.json` was copied from the API JSON listed in its `source_url`.
- **Task 3 (gas):** AAA national average $3.6898 on 11/20/26 from gasprices.aaa.com (read in this session).
- **Task 4 (dashboard):** documented endpoints: candlesticks (`period_interval` 1, 60, 1440), orderbook (`depth` 0–100; NO bid at p = YES ask at 1−p, per docs.kalshi.com/getting_started/orderbook_responses).
- **Secondary web articles** were used only to locate series tickers; each ticker was checked against the API.
- **Tests run:** all 10 pages return HTTP 200 from a local static server; `node --check` passes for both JS files; all internal links and asset paths resolve; markets, analysis, and dashboard render in jsdom (mocked network). A headless browser could not be installed (Chromium download is outside the sandbox allowlist).

## Irregularities (all listed on `docs/flagged.html`)

- Culture: no verified open market (row blank).
- Coverage: 15 verified rows; no full market list; the events endpoint ignored its `category` parameter in tests.
- Demo environment: placeholder values ("x", "demo strike"), 2099 closes; same event labelled "World" in demo and "Science and Technology" in production (KXELONMARS-99).
- Settlement sources: several culture series point to Google search URLs.
- Malformed contract links (KXHYPEPERP) and staging S3 URLs in `contract_url`.
- Gas: "above $3.65" last trade $0.02 vs AAA $3.6898 — unverified; needs trade-timestamp check.
- BTC range: displayed YES ask sizes with zero volume.
- A docs page links to `get-market-order-book`; the API reference page is `get-market-orderbook` (not tested for broken link).
- Fees, rate limits, WebSocket, and settlement docs listed in the index but not read.
- Repo: README is one line; no LICENSE, .gitignore, or CI on `main`.
- Portfolio and trading: blocked without an API key (no key stored anywhere).

## Pull request and deploy

- Branch: `arena/175cafdf-demo1` → `main`.
- PR: recorded below once created.
- GitHub Pages: source `main` branch, folder `/docs`.

## Log

- 2026-11-20 — Session `175cafdf` claimed all tasks on `arena/175cafdf-demo1` and recorded the overlap with five other branches.
- 2026-11-20 — Built `docs/` site (10 pages + `markets.json`), committed as `ebc8ba0`. Fixed a dashboard bug (unhandled rejection) and a summary-format bug found in jsdom tests.
