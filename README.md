# Kalshi Demo Monitor

A static, evidence-first GitHub Pages dashboard for Kalshi public demo markets. It focuses on gas prices, elections, culture, crypto, and golf, with topic pages, a selected-market session chart, orderbook depth, a portfolio readiness page, decision questions, reviewable suggestions, and a Flagged for Review register.

## Executive summary

- **Demo data:** reads public market snapshots from Kalshi’s recommended demo Trade API root, `https://external-api.demo.kalshi.co/trade-api/v2`.
- **Ranking:** the root summary sorts by API-reported total contract volume; the live REST monitor sorts by documented `volume_24h_fp` where available. Both values are contract counts, **not dollar-notional rankings**; “highest dollar amount” remains flagged because an authoritative definition/calculation has not been established.
- **Liquidity:** the selected market’s REST orderbook is shown as YES/NO bid levels with contract counts. It is a point-in-time bid snapshot, not total dollar liquidity or guaranteed execution.
- **Price history:** selected market YES bid samples are plotted on a timestamp axis at a 15-second browser sampling interval. History is in-memory and only collected while the page is open; no historical API series is claimed.
- **Resolution:** selected markets are polled via the official individual-market endpoint. Status is shown as returned; YES/NO is displayed only for an exact returned result. Tracking ends when the browser session ends.
- **Portfolio/trading:** balance, fills, positions, P&L, strategy analytics and order execution are not enabled. No credentials are accepted or stored, and no orders are submitted. A private backend, demo-only authorization, and explicit risk controls are prerequisites.
- **Coverage:** keyword-based topic classification over title/subtitle/ticker strings is not an official Kalshi taxonomy. The root market summary uses one page (up to 1,000 records); the live REST monitor is bounded to five cursor pages (up to 5,000 returned markets) and stops early when pagination ends. Separate category tables are reference/review pages with unverified values left blank, not exhaustive live feeds.
- **Fail-safe behavior:** unavailable source values remain blank, API errors are shown, and the dashboard does not substitute mock market values.

## Pages

- `index.html` — main market monitor, portfolio/analysis sections, and links to the multi-page review workspace.
- `pages/live-market-monitor.html` — public REST snapshot monitor with in-session chart, liquidity levels, and selected-market result polling.
- `pages/landing-executive-summary.html` — executive summary and category navigation.
- `pages/gas.html`, `pages/elections.html`, `pages/culture.html`, `pages/crypto.html`, `pages/golf.html` — topic tables and source links.
- `pages/portfolio.html` and `pages/trades.html` — authenticated-account and execution requirements; no credentials or orders are handled here.
- `pages/questions.html`, `pages/suggestions.html`, `pages/flagged-review.html` — decision questions, reviewable proposals, and flagged limitations.
- `docs/sources.md` — consolidated endpoint/source register.

## Run / deploy

Serve the repository as static files or use GitHub Pages with `.github/workflows/pages.yml`. No build dependencies are required. Browser access to the external API depends on network and CORS behavior; if blocked, the interface reports failure without fabricated rows. Do not put Kalshi private signing keys in static client code.

## Verified official sources

| Subject | Official source | Use |
|---|---|---|
| Separate demo/production REST and WebSocket endpoints | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) | Recommended demo roots and environment separation |
| Market list fields, cursor, status, price, contract volume and result | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | Dynamic market fields and bounded cursor pagination |
| Individual market lookup | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) | Selected-market lifecycle/status/result refresh |
| Public market-data flow | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Unauthenticated market-data examples |
| Orderbook levels and interpretation | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | Bid-side price and contract quantities; point-in-time behavior |
| Key security, signatures and scopes | [API Keys](https://docs.kalshi.com/getting_started/api_keys) | Authenticated endpoints and key safety |
| Private portfolio data | [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) | Balance / portfolio access requirements |
| Order creation | [Quick Start: Create Your First Order](https://docs.kalshi.com/getting_started/quick_start_create_order) | Trading prerequisites; no orders are sent here |
| WebSocket options | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | Future feed integration review |
| Demo account information | [Kalshi Help: Demo account](https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account) | Demo account context |

The API documentation above was fetched and reviewed in this session. The official demo `/markets?status=open&limit=10` endpoint was also fetched on 2026-11-20; it returned live market records with documented fields. No observed response rows are hard-coded in the site. See `COORDINATION.md` for the verification log, known irregularities, and the earlier merged Pages deployment record.
