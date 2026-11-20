# Coordination board

Session: `arena/7bc11020-demo1` (current Arena-managed branch, branched from `main` at `5dd6f04320c8420e264ef91a8202fd137d4e73ca`). Previous session `arena/e41f6700-demo1` claimed end-to-end scope on its branch and marked its tasks done (single-page dashboard + Pages deploy claim). This session extends the site to multi-page category subpages, live graph/liquidity panels, resolution tracking, portfolio/trade-analysis register, suggestions and Q&A review, full per-row source verification, and GitHub Pages publication via PR merge into `main`.

| Task | Status | Owner | File scope |
|---|---|---|---|
| Claim end-to-end extension scope | in progress | arena/7bc11020-demo1 | `COORDINATION.md` |
| Verify official Kalshi docs sources (markets, order book, history/candles, auth, balance, positions, fills, websocket) | unclaimed | arena/7bc11020-demo1 | Docs fetch log in `COORDINATION.md`; no code changes |
| Verify demo API response shape (public markets + order book) | unclaimed | arena/7bc11020-demo1 | Verification notes only; no repo data fabricated |
| Landing page + executive summary | unclaimed | arena/7bc11020-demo1 | `index.html`, `styles.css` |
| Category subpages (gas, elections, culture, crypto, golf) with verified market tables | unclaimed | arena/7bc11020-demo1 | `markets/*.html`, `styles.css` |
| Live price graph (time X-axis w/ seconds/minutes/hours window, Y=contract price) + liquidity/depth panel | unclaimed | arena/7bc11020-demo1 | `chart.html`, `app.js` |
| Resolution tracking (pending / resolved YES / resolved NO) | unclaimed | arena/7bc11020-demo1 | `markets/*.html`, `app.js` |
| Portfolio performance register + trade analysis (no credentials; limits documented) | unclaimed | arena/7bc11020-demo1 | `portfolio.html`, `analysis.html` |
| Trade execution intent register (not connected; no orders from static site) | unclaimed | arena/7bc11020-demo1 | `portfolio.html`, `analysis.html` |
| Suggestions review queue | unclaimed | arena/7bc11020-demo1 | `suggestions.html` |
| Questions & answers register + flagged-for-review page | unclaimed | arena/7bc11020-demo1 | `questions.html`, `review.html` |
| Full verification audit: every table row has official source link; unverified left blank + flagged | unclaimed | arena/7bc11020-demo1 | All HTML + `COORDINATION.md` |
| GitHub Pages deploy via PR merge into `main`; confirm deploy; record PR/merge result | unclaimed | arena/7bc11020-demo1 | `.github/workflows/pages.yml`, PR, `COORDINATION.md` |

## Log
- 2026-11-20 — New session branch `arena/7bc11020-demo1` created from `main` `5dd6f04`. Reviewed existing repo: single-page dashboard (`index.html`, `styles.css`, `app.js`), Pages workflow (`push: branches: [main]`), README with sources and limitations, COORDINATION.md from prior session. Prior session claims tasks done; this session extends per current tasking.
- Prior session sources: Quick Start market data, Get Balance, Get Markets (link only, page fetch failed), Get Market Order Book (link only), Get Positions (link only), Get Fills (link only). Deploy claim: PR #1 merged, Pages URL https://karagemop466-tech.github.io/Demo1/ , to be re-verified in this session.

## Sources to verify (official docs.kalshi.com)
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-order-book
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills
- https://docs.kalshi.com/websockets/websocket-connection (to verify live price feed support)

## Irregularities / outstanding
- Contract volume is not “dollar amount”; no defensible dollar ranking exists from public contract-count fields alone. Will be flagged, not inferred.
- Topic inclusion is heuristic keyword matching pending an authoritative series allowlist.
- Historical price graph: no verified history/candles endpoint schema yet; no fabricated points.
- Private account performance and trading need authenticated demo access and a secure server-side signing service; browser-only Pages must not hold private keys. No orders will be placed.
