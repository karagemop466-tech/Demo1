# Kalshi Demo Research Dashboard

A live, source-linked research dashboard for the **Kalshi demo exchange**, focused only on
**gas prices, elections, culture, crypto and golf**.

**Live site:** https://karagemop466-tech.github.io/Demo1/ (root redirects to `/site/index.html`)

## What is verified, and how

Every figure on the site comes from the official Kalshi **demo** Trade API v2
(`https://external-api.demo.kalshi.co/trade-api/v2`, the recommended demo base URL documented at
[docs.kalshi.com/getting_started/api_environments](https://docs.kalshi.com/getting_started/api_environments)).

| Layer | Where | What it does |
|---|---|---|
| Collector | `tools/collect_kalshi.py` | Reads series, markets, order books, candlesticks and public trades on a GitHub Actions runner (the authoring sandbox cannot reach kalshi.com). Stores the **exact request URL** with every record. |
| Verified snapshot | `snapshot/*.json`, `snapshot/collect-log.txt` | Committed output of one collection run, incl. a request-by-request log (counts, errors, timings). |
| Site builder | `build_site.py` | Renders `site/` from the snapshot only. Refuses to build on a broken internal link; missing API fields render as “—”, never as invented values. |
| Account worker | `tools/account_worker.py` | Optional, **read-only**, standard-library signing client for portfolio/fills/settlements. Writes a derived, secret-free `snapshot/account.json`. |

Each table row links to the official request that produced it (market record, event record, order book,
candlestick query or trades query). Values absent from the API are blank and listed on the
**Flagged for review** page.

## Pages

| Page | Contents |
|---|---|
| `site/index.html` | Executive summary, snapshot health, topic coverage, API discovery categories |
| `site/markets.html` | All tracked open markets, ranked by computed 24 h dollar notional |
| `site/gas-prices.html`, `elections.html`, `culture.html`, `crypto.html`, `golf.html` | Per-topic live markets, resolved outcomes, the exact matching rule and every matched series with its match reason |
| `site/resolved.html` | Markets followed to settlement: YES/NO result, settlement value, timestamp, resolution source |
| `site/liquidity.html` | Candlestick price chart (time on X, contract price on Y, 1 m / 1 h / 1 d buckets) + contracts available at each price |
| `site/explore.html` | Raw data browser: every collected record, filterable, each linked to its official record |
| `site/portfolio.html` | Portfolio performance: live figures when `snapshot/account.json` exists, otherwise the exact endpoints and methodology |
| `site/strategies.html` | Strategy catalogue by trade type, with the inputs each one needs |
| `site/suggestions.html` | Review queue — nothing is auto-applied |
| `site/questions.html` | The 10 questions that must be answered before a decision; known vs missing |
| `site/flagged.html` | Irregularities and unverified items, with sources |
| `site/sources.html` | Every official documentation reference and the verification method |

`pages/` holds the earlier multi-page research notes and `archive/monitor.html` the earlier single-page
prototype; both are kept for reference and are linked from the site footer.

## Definitions used (and their limits)

- **“Highest dollar amount”** is not a Kalshi field. The dashboard ranks by a *computed* 24 h traded
  notional: Σ(`yes_price_dollars` × `count_fp`) over public trades in the last 24 hours, from
  [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades). The trade count behind each total is
  shown, and totals that could not be completed within the request budget are labelled as lower bounds.
- **Contract volume** is a contract count, not dollars, and is never labelled as such.
- **Liquidity at a price** comes from the order book, which returns **bids only**; the ask side is
  derived as 1.00 − opposite bid ([Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses)).
- **Resolution** is the API's `result` field (`yes` / `no`) on markets collected with `status=settled`
  ([Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle)).
- **Price history** uses only the documented 1 / 60 / 1440-minute candlestick intervals; no sub-minute
  points are fabricated. Streaming would need the authenticated WebSocket handshake.

## Known limits (published, not hidden)

1. The demo exchange is a **test venue with mock funds** — depth and prices are not production liquidity.
2. **No API key exists in this repository or the build environment.** Portfolio, fills, settlement and
   order execution are therefore documented, not populated. A static Pages site must never hold a key.
3. No order has ever been placed by this project. `tools/account_worker.py` has no write path.
4. Topic assignment is a published regex rule set, not an official Kalshi taxonomy. Matches that rest on a
   series ticker or tags rather than its title are flagged for review.
5. Fee-adjusted edge is not shown; the fee formula has not been verified against the official fee schedule.

## Reproducing

```bash
python tools/collect_kalshi.py collect   # needs outbound internet to the Kalshi demo API
python build_site.py                     # rebuilds site/ and fails on broken links
```

CI: `.github/workflows/live-data.yml` collects, `.github/workflows/pages.yml` rebuilds and publishes,
`.github/workflows/account.yml` optionally refreshes the read-only portfolio summary once a demo key is added
as repository secrets. See `COORDINATION.md` for the shared task board and audit log.
