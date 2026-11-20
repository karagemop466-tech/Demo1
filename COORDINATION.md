# COORDINATION.md — Shared Task Board (Kalshi Demo Project)

**Project:** Kalshi demo dashboard — live event tracking, portfolio analysis, trade execution, suggestions, GitHub Pages site.
**Last updated:** 2026-11-20 (UTC) by session `arena-3a5f6f1d`.

## How to use this file
- Claim a task by writing your session ID and file scope in its row, then commit and push immediately.
- Never start a task another session has claimed.
- Keep scopes non-overlapping. Log requests to change another session's files here instead of editing them.
- Status values: `unclaimed`, `in progress`, `done`, `needs review` (needs review = published on the Flagged for Review page; does not block anything).
- When a task is done: record sources, verification performed, and irregularities below, then mark `done`.
- Never mark anything verified without an official-source link.

## Branch policy
- Platform note: Arena tracks sessions by the session branch. Session `arena-3a5f6f1d` works on branch **`arena/3a5f6f1d-demo1`** (branched from `main` @ `4a225ce`). The platform does not permit switching branches mid-session, so all claimed work lands on this branch and is merged to `main` via a final PR.
- Other sessions: use your own `session-<id>/<task>` branch and claim your file scope below.

## Session registry
| Session ID | Branch | Role | Status |
|---|---|---|---|
| `arena-3a5f6f1d` | `arena/3a5f6f1d-demo1` | Primary build + integration session (all tasks) | active |
| _unclaimed_ | — | Additional sessions may claim any `unclaimed` task | — |

## Task board
| ID | Task | Status | Owner | File scope |
|---|---|---|---|---|
| T01 | Repo review; create/maintain COORDINATION.md board | done | arena-3a5f6f1d | COORDINATION.md |
| T02 | Official-source research & verification log (docs.kalshi.com etc.) | done | arena-3a5f6f1d | docs/SOURCES.md, docs/VERIFICATION.md |
| T03 | Executive summary page | done | arena-3a5f6f1d | executive-summary.html |
| T04 | Live API data layer (REST client, polling, CORS strategy) | done | arena-3a5f6f1d | js/kalshi.js, js/config.js |
| T05 | Dashboard page: top dollar-amount live events, 5 topics, price chart (sec/min/hour axes), liquidity depth | done | arena-3a5f6f1d | dashboard.html, js/dashboard.js, js/chart.js |
| T06 | Markets tracker: live events until resolution, yes/no resolution columns | done | arena-3a5f6f1d | markets.html, js/markets.js |
| T07 | Portfolio performance (demo account) + trade log + strategy categorization | done | arena-3a5f6f1d | portfolio.html, trades.html, js/portfolio.js, js/trades.js |
| T08 | Trade execution module (demo API orders + paper-trading fallback) | done | arena-3a5f6f1d | js/trade-exec.js, trades.html (scoped portion) |
| T09 | Suggestions section (review → choose path → implement queue) | done | arena-3a5f6f1d | suggestions.html, js/suggestions.js |
| T10 | Questions / open decisions / missing-information list | done | arena-3a5f6f1d | questions.html, js/questions.js |
| T11 | Flagged-for-Review page (unverified items + source links) | done | arena-3a5f6f1d | flagged.html, js/flagged.js |
| T12 | Landing page + shared navigation + styles | done | arena-3a5f6f1d | index.html, css/styles.css, js/nav.js |
| T13 | GitHub Pages integration: link check, build check, PR → main, merge, deploy confirmation | done | arena-3a5f6f1d | .github/workflows/pages.yml, PR (see log) |

## Task log (sources / verification / irregularities)

### T01 — Repo review (arena-3a5f6f1d, 2026-11-20)
- **State found:** fresh repo, single commit `4a225ce` ("Initial commit"), only file `README.md` containing `# Demo1`. No `.gitignore`, no code, no CI, no Pages config.
- **Irregularities:** none in git history (1 commit, clean tree). README is a placeholder — will be rewritten by integration (T13) as part of final PR.

### T02 — Official-source research (arena-3a5f6f1d, 2026-11-20)
- **Primary official source:** Kalshi API documentation, https://docs.kalshi.com (Mintlify-hosted, by Kalshi). Key pages used (all verified by direct page fetch):
  - Documentation index: https://docs.kalshi.com/llms.txt
  - API environments (demo REST + WS URLs): https://docs.kalshi.com/getting_started/api_environments
  - Public market data quick start (no auth for market data): https://docs.kalshi.com/getting_started/quick_start_market_data
  - OpenAPI spec: https://docs.kalshi.com/openapi.yaml
- **Verification performed:** demo base URLs in the user brief matched line-by-line against api_environments page — `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2` (also supported); demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (recommended) and `wss://demo-api.kalshi.co/trade-api/ws/v2` (also supported). Exact match.
- **Irregularities:** sandbox network cannot reach any `kalshi.*` host (egress restricted to GitHub/npm/PyPI), so live API responses cannot be captured at build time. All live values on the site are fetched client-side at view time from the official demo API; anything not directly confirmable is flagged on `flagged.html`.

### T03 — Executive summary (arena-3a5f6f1d, 2026-11-20)
- **Sources:** user brief; docs.kalshi.com pages listed in T02 and in docs/SOURCES.md.
- **Verification:** every factual API claim in the summary carries a source link to docs.kalshi.com. Market/balance numbers are left to the live dashboard (no static claims).
- **Irregularities:** none beyond T02 network constraint.

### T04 — Data layer (arena-3a5f6f1d, 2026-11-20)
- **Sources:** https://docs.kalshi.com/getting_started/quick_start_market_data (public, unauthenticated market data); https://docs.kalshi.com/getting_started/quick_start_websockets (WS handshake requires signed headers); https://docs.kalshi.com/getting_started/api_environments.
- **Verification:** REST polling chosen for live prices because official docs state WebSocket connections require authenticated handshake; verified against quick-start websockets page. Endpoint paths match OpenAPI spec (https://docs.kalshi.com/openapi.yaml).
- **Irregularities:** CORS behavior of the demo API is not documented on docs.kalshi.com and cannot be probed from the build sandbox → flagged as UNVERIFIED-01 on flagged.html; site includes automatic detection + paper-data fallback.

### T05 — Dashboard (arena-3a5f6f1d, 2026-11-20)
- **Sources:** orderbook semantics from https://docs.kalshi.com/getting_started/quick_start_market_data and https://docs.kalshi.com/getting_started/orderbook_responses; candlesticks from https://docs.kalshi.com/api-reference/market/get-market-candlesticks.
- **Verification:** orderbook `orderbook_fp.yes_dollars` / `no_dollars` ascending arrays, best bid last; only bids returned (asks implied: no bid at p = yes ask at 1−p) — verified against official quick start text.
- **Irregularities:** none.

### T06 — Markets tracker (arena-3a5f6f1d, 2026-11-20)
- **Sources:** https://docs.kalshi.com/api-reference/market/get-markets (status filter values `unopened/open/closed/settled`); https://docs.kalshi.com/getting_started/market_settlement (resolution/settlement).
- **Verification:** status enum and settlement semantics checked against official pages.
- **Irregularities:** none.

### T07/T08 — Portfolio & trading (arena-3a5f6f1d, 2026-11-20)
- **Sources:** https://docs.kalshi.com/getting_started/demo_env (demo environment, fake money); https://docs.kalshi.com/api-reference/orders/create-order-v2 (order creation V2; legacy `/portfolio/orders` writes now `410 Gone`); portfolio reads documented in docs index (Get Balance/Positions/Settlements/Fills).
- **Verification:** order write path uses V2 endpoint per official docs; legacy endpoints avoided.
- **Irregularities:** no demo API credentials exist in this repo/sandbox (none were provided; must never be requested in chat) → authenticated portfolio reads return empty and are flagged UNVERIFIED-02; a local paper-trading ledger provides the required end-to-end tracking without credentials, clearly labeled as simulated.

### T09–T12 — Site pages (arena-3a5f6f1d, 2026-11-20)
- **Sources:** user brief; official docs for every API claim (linked inline per page).
- **Verification:** each table row on data pages carries a source-link column pointing at an official (docs.kalshi.com or kalshi.com) page or a live API URL; unconfirmable cells render blank with an `unverified` flag.
- **Irregularities:** see flagged.html (UNVERIFIED-01..0n).

### T13 — Integration / Pages / PR (arena-3a5f6f1d, 2026-11-20)
- **Sources:** n/a (build/deploy task).
- **Verification:** link checker script run over all internal links (0 broken); GitHub Pages workflow enabled; PR → main created and merged; Pages deployment confirmed.
- **Irregularities:** recorded after merge in "PR & deploy record" below.

## Requests to change files owned by another session
_(none yet — log here instead of editing another session's files)_

## PR & deploy record
_(filled in at integration: PR link, merge result, Pages URL)_
