# COORDINATION.md — Shared Task Board

> **Purpose:** Coordinate parallel agent sessions working on this repo to avoid conflicts and duplicate work.
> **Rule:** Claim a task by writing your session ID + file scope here, then commit & push the claim immediately. Never start a task another session has claimed. Keep scopes non-overlapping.

## Session ID
- **This session:** `arena/3c51bb52-demo1` (branch `arena/3c51bb52-demo1`, base `4a225ce` on `main`)
- **Started:** 2026-11-20

## Task Board

| ID | Task | Status | Owner (session) | Files touched | Sources / verification | Irregularities |
|----|------|--------|-----------------|---------------|------------------------|----------------|
| T1 | Site shell: nav, CSS, landing page, executive summary | **done** | arena/3c51bb52-demo1 | `index.html`, `assets/style.css`, `assets/app.js` | https://docs.kalshi.com/getting_started/api_environments · /getting_started/demo_env · /getting_started/quick_start · /getting_started/quick_start_authenticated_requests · /getting_started/market_settlement | — |
| T2 | Live markets: 5-topic tables (gas, elections, culture, crypto, golf), highest-dollar-volume sort, resolution tracking | **done** | arena/3c51bb52-demo1 | `markets.html`, `assets/markets.js`, `data/series-map.json` | `GET /markets`, `GET /events`, `GET /series/{ticker}` (public, no key) | F2 (sandbox can't reach kalshi.co → runtime verification in browser), F3 (series mapping runtime-verified), F4 ($ volume = estimate) |
| T3 | Analytics: price chart (time axis sec/min/hr), orderbook & liquidity depth | **done** | arena/3c51bb52-demo1 | `analytics.html`, `assets/analytics.js` | `GET /markets/{ticker}/orderbook`, `GET /markets/{ticker}/candlesticks`, WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | F5 (fp shapes normalized defensively), F9 (WS fallback to REST polling) |
| T4 | Portfolio: demo-account performance, trade categorization, strategies, trade executor | **done** | arena/3c51bb52-demo1 | `portfolio.html`, `assets/portfolio.js` | Auth required for real orders (official auth docs) → SIM execution vs live prices; fee formula ⌈0.07·C·P·(1−P)⌉ | F1 (SIM, real orders need server-side credential proxy — S1) |
| T5 | Suggestions, Q&A / missing-info, sources & verification, flagged-for-review pages | **done** | arena/3c51bb52-demo1 | `suggestions.html`, `sources.html`, `flagged.html` | Every row carries an official link; unverified = blank + flagged | F6 (repo was empty stub), F7 (sparse demo lineups), F8 (Pages source must be GitHub Actions), F10 (docs-path drift) |
| T6 | Final integration: build check, link check, PR → main, GitHub Pages deploy | **in progress** | arena/3c51bb52-demo1 | all (merge only) | internal-link check + `node --check` + core-logic tests pass locally | — |

**Status key:** `unclaimed` · `in progress` · `done` · `needs review` (published on Flagged for Review page; does not block anything)

## Log
- 2026-11-20 — `arena/3c51bb52-demo1` created COORDINATION.md, claimed T1–T5 (single-session run; no other sessions active). T6 left unclaimed for final integration step in this same session.
- 2026-11-20 — Verified official endpoints via docs.kalshi.com: demo REST `https://external-api.demo.kalshi.co/trade-api/v2`, demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`. Public market data needs no API key. Authenticated portfolio endpoints require signed requests (KALSHI-ACCESS-* headers).
- 2026-11-20 — Sandbox outbound is allowlisted (github/npm/pypi only); `external-api.demo.kalshi.co` unreachable from sandbox (curl 000). Live data therefore loads in the user's browser on GitHub Pages; site includes graceful fallback + "fetch failed / unverified" flags. No values are invented.

## Handoff / takeover rule
If a session crashes or its claim is >60 min old with no commits, any other session may take over and note the handoff here.

## Final integration record (T6)
- Checks before PR: `node --check` all JS ✅ · JSON validity ✅ · internal-link check (7 pages) ✅ · core-logic Node tests ✅ · element-ID audit ✅
- PR: https://github.com/karagemop466-tech/Demo1/pull/11 (arena/3c51bb52-demo1 → main)
- Merge result: _(pending)_
- GitHub Pages deploy: _(pending — requires repo Settings → Pages → Source = “GitHub Actions”; see flagged F8)_
