# Kalshi Demo Market Monitor

A static GitHub Pages research dashboard for Kalshi demo public market data, focused on gas prices, elections, culture, crypto and golf. Includes market scanning, order-book inspection, portfolio/strategy requirements, a suggestions review queue and an explicit flagged-unknowns register.

## Executive summary

- **Market discovery:** the page requests open demo markets from `https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=1000`, filters topic keywords, and ranks matching markets by the API-reported contract volume. It refreshes every 30 seconds. It does not label contract volume as dollars or claim it measures the “highest dollar amount.”
- **Depth:** selecting “Inspect book” requests the public market order book and shows returned bid levels and quantities, when available. Displayed bids are not a guarantee of execution.
- **History and resolution:** open market rows display returned status/result values when present. The price-history panel deliberately displays no fabricated graph: historical endpoint integration and timestamp/interval verification remain open work.
- **Account and trading:** portfolio access is authenticated. This static site does not request, store, sign with credentials or submit orders. Secure account reporting and order entry require a server-side signing service, explicit demo account authorization, risk controls and verification.
- **Decision support:** the site lists unanswered questions, source-linked official documentation, reviewable improvement suggestions, and known irregularities. Empty/unavailable data stays blank.

## Use / deploy

Open `index.html`, or enable GitHub Pages for the repository using the GitHub Actions workflow in `.github/workflows/pages.yml`. This is dependency-free static HTML/CSS/JavaScript. A browser may block API calls because of cross-origin policy or API availability; the dashboard reports that condition without inserting sample records. Deploying the site does not make authenticated endpoints or trade execution safe.

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
