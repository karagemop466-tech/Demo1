# Kalshi Demo Market Signal Board

A static, source-linked dashboard for **Kalshi's demo** market data, scoped to gas prices, elections, culture, crypto, and golf. It provides a live event table, order-book depth, a price chart, a browser-local resolution watchlist, a portfolio/analysis readiness brief, and a review queue for product suggestions.

> **Read-only market data.** Account portfolio reads and order submission are deliberately not connected. This repo contains no Kalshi credentials or private key. Do not place private keys in GitHub Pages, a browser form, local storage, or this repository.

## What the site does

- Requests event and public market data from the recommended demo REST root, `https://external-api.demo.kalshi.co/trade-api/v2`; the documented supported alternate root is available as a fallback.
- Shows live and unresolved events under the five requested topic pages. Topic tags are an explicit site-side keyword/category heuristic, not an official Kalshi taxonomy.
- Ranks events only when every open market has a valid book snapshot. The ranking is **visible bid notional**: sum of `price_dollars × contract count` for the returned YES and NO bid levels of the open markets. It is not Kalshi-reported dollar volume, and it is not a guarantee of executable liquidity.
- Displays contracts at each returned YES/NO bid price. It does not manufacture separate ask levels. The market data table keeps dollar prices separate from contract-count volume and open interest.
- Offers 60-second, 5-minute, 1-hour, 6-hour, and 24-hour price windows. The short view collects a REST market-price snapshot every 15 seconds while the page is open; longer chart windows use Kalshi REST candlesticks when returned. This is not an exchange tick-by-tick stream.
- Lets a viewer watch an event in the current browser and checks for explicit market `result` values (`yes` / `no`). Watch state is stored in that browser's local storage; there is no background service while the page is closed.
- Keeps account values blank until a real authenticated response is available. It does not invent balance, P&L, positions, fills, fees, win rates, or strategy performance.
- Provides suggestion approve/defer/reject controls that save only a browser-local review choice. They do not apply code changes or authorize trades.

## Important verified limitations

- Kalshi documents separate production and demo environments and states that demo prices/behavior may not reflect real markets.
- Public market-data REST calls are documented without authentication. Portfolio endpoints and order entry require signed account authorization.
- Kalshi's API key documentation describes private-key signing. GitHub Pages is static hosting and is not a secure signer, so this repo does not collect or store private keys and does not call private account/order endpoints.
- Kalshi's API changelog says market `liquidity` / `liquidity_dollars` fields are deprecated and return zero. The site therefore reads the order book and labels its own calculation rather than relying on those fields.
- REST candlestick intervals documented by Kalshi are 1 minute, 1 hour, and 1 day. Seconds shown in the UI are client-side snapshots, not historical second candles.

For unresolved questions, see [Executive summary](requirements.html), [Trade analysis](analysis.html), and [Flagged for review](review.html). The [Sources](sources.html) page lists the official documentation checked for implementation.

## Run locally

No package installation or build step is needed. Serve the repository root over HTTP (ES modules do not run reliably from `file://`):

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Public demo market data is fetched by the browser at runtime. If that request or the browser's network path is unavailable, the site reports the error and leaves the data blank rather than showing mock values.

## Verify locally

```sh
npm test
npm run check:site
```

Tests use Node's built-in test runner and do not call Kalshi's live API. The site checker verifies local navigation targets and that the required static data tables have source columns. Runtime market payloads remain runtime data and are linked to the official demo API.

## GitHub Pages

`.github/workflows/pages.yml` tests the site and deploys the repository root through GitHub Pages on pushes to `main` and on manual workflow dispatch. The repository's Pages source should be set to **GitHub Actions**. A successful workflow deploy URL is recorded in `COORDINATION.md` when confirmed.

## Repository map

- `index.html` — live dashboard
- `gas-prices.html`, `elections.html`, `culture.html`, `crypto.html`, `golf.html` — topic views
- `portfolio.html`, `analysis.html`, `requirements.html`, `suggestions.html`, `review.html`, `sources.html` — account readiness, analysis design, questions, review, and evidence
- `assets/app.js`, `assets/site.css` — browser UI and styles
- `src/core.js` — topic, resolution, order-book, and ranking helpers
- `tests/` — deterministic unit tests; no fixtures pretending to be live market data
- `COORDINATION.md` — shared task board and source / verification log

## Official Kalshi sources

- [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments)
- [Test in the Demo Environment](https://docs.kalshi.com/getting_started/demo_env)
- [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Get Events](https://docs.kalshi.com/api-reference/events/get-events)
- [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook)
- [Get Historical Market](https://docs.kalshi.com/api-reference/historical/get-historical-market)
- [Get Multiple Market Orderbooks](https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks)
- [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)
- [API Keys](https://docs.kalshi.com/getting_started/api_keys)
- [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance), [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions), [Get Fills](https://docs.kalshi.com/api-reference/portfolio/get-fills)
- [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2)
- [API Changelog](https://docs.kalshi.com/changelog)
