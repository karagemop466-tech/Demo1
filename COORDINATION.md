# Coordination board

Session: `arena/e41f6700-demo1` (current Arena-managed branch). No other session claims were present when checked.

| Task | Status | Owner | File scope |
|---|---|---|---|
| Kalshi demo research, requirements, dashboard prototype and verification | done | arena/e41f6700-demo1 | `COORDINATION.md`, `README.md`, `index.html`, `styles.css`, `app.js`, `.github/workflows/pages.yml` |
| GitHub Pages deployment and merge verification | needs review | arena/e41f6700-demo1 | GitHub repository settings / Actions (external) |

## Log
- 2026-11-20 — Initial repo had only a minimal README. Checked for existing `COORDINATION.md`; none existed. Claimed end-to-end scope and committed/pushed claim. First pull against the not-yet-published remote branch failed because it did not exist; rebased against `origin/main`, then pushed current branch successfully.
- 2026-11-20 — Verified official quick-start market-data documentation and official Get Balance documentation by fetching pages. Quick-start documents unauthenticated public markets/events/orderbook examples. Balance reference documents the demo host and signed authentication headers. See source links in README and the site's rows.
- 2026-11-20 — Get Markets page fetch failed; related references for order book / positions / fills were linked but not all independently fetched. Marked as limitations, not verified claims. User-provided demo endpoint used as configured.
- 2026-11-20 — Added static dashboard with live API attempts, empty-on-failure behavior, keyword topic filters, contract-volume ranking, order-book request, portfolio/trading safety notice, questions, suggestions and review flags. No credential handling, orders, fabricated prices, history or performance data.
- 2026-11-20 — Verification: run `node --check app.js`; review HTML/CSS/JS against fetched sources and verify local links/build. External API success and GitHub Pages deployment require online Actions/API validation after push and cannot be asserted without a successful run.

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
- The user requested a PR/merge and confirmed Pages deployment. This is the current Arena branch, not a separate integration branch; the branch instructions prohibit switching/creating branches. Do not merge until a PR exists, build/deploy checks pass and a live deployment is confirmed. Flagged items do not prevent review but safe trade execution is intentionally absent.
