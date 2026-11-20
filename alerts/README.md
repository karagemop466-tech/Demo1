# Live alert chat (`alerts/`)

A two-pane scrolling chat for the Kalshi **demo** exchange, covering the five
tracked topics: gas prices, elections, culture, crypto and golf.

* **Left chat — all alerts.** Every contract-price move of **$0.10 or more in
  either direction** between two adjacent official candlesticks.
* **Right chat — model shortlist.** The same events, filtered and ranked by a
  published scoring model (the **QLM score**) so a trader can see first which
  events the model likes and why.

Both chats are live: the page can poll the official demo API for new
1-minute candles every 30 seconds and appends any qualifying move as it
happens. If the browser cannot reach the API, the page says so, shows the
request that failed, and keeps working from the committed official snapshot.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page. Plain HTML/CSS/JS, no build step, no external requests. |
| `assets/alerts.css` | Styles. |
| `assets/alerts.js` | Rendering, filtering and the live poller. |
| `data/feed.json` | The committed feed: alerts, shortlist, model card, coverage, sources. Generated — do not hand-edit. |
| `tools/build_alerts.py` | Builds `data/feed.json` from the committed official responses. |
| `tools/test_alerts.py` | 23 line-by-line checks over the published feed. |
| `tools/build_verification.py` | Regenerates `verification.html` from the test suite. |
| `tools/test_dom.mjs` | jsdom test: the page renders both chats from the committed feed. |
| `verification.html` | The line-by-line verification record (generated). |

## How the feed is built

```
snapshot/charts.json    official 1-minute / 1-hour / 1-day candles  (10 markets)
engine/jumps.json       every >= $0.10 move between adjacent candles, each row
                        carrying the candlesticks request URL that produced it
snapshot/markets.json   quotes, order book, 24 h traded notional, open interest,
                        close time, settlement fields, source URL per value
snapshot/resolved.json  status + result for closed markets
        |
        |  tools/build_alerts.py
        v
alerts/data/feed.json   -> the two chats + the model card + coverage
```

Rebuild and re-verify:

```bash
python3 alerts/tools/build_alerts.py
python3 alerts/tools/test_alerts.py
python3 alerts/tools/build_verification.py
node alerts/tools/test_dom.mjs          # needs jsdom (npm install)
```

The feed is **reproducible**: `test_feed_is_reproducible_from_the_committed_inputs`
rebuilds it into a temporary file and compares it byte-for-byte with the
committed one (ignoring the generation timestamp).

## The QLM score (Quality - Liquidity - Money)

```
score = 100 x SUM(weight x normalised component) / SUM(weight of available components)
```

| Component | Weight | What it measures | Official source |
|---|---|---|---|
| `move_size` | 0.25 | `|delta|` of the qualifying move, capped at $0.50 | [candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) |
| `fee_efficiency` | 0.15 | `|delta|` ÷ round-trip taker fee for a 10-contract clip | [fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| `depth` | 0.20 | contracts resting within $0.02 of the post-move price | [order book](https://docs.kalshi.com/getting_started/orderbook_responses) |
| `money_behind` | 0.15 | measured 24 h traded notional, log-scaled | [trades](https://docs.kalshi.com/api-reference/market/get-trades) |
| `horizon` | 0.10 | hours to `close_time`, capped at 720 h | [markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| `recency` | 0.15 | hours since the move, `1 / (1 + hours / 6)` | [candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) |

**What the score is not.** It is a ranking heuristic over official API fields.
It is *not* a probability, not a price forecast, and it asserts no cause for
any move. Realised ROI needs the settlement result — a YES holder is paid $1
per contract — which the exchange produces over weeks; that is tracked
separately by the simulation ledger pages.

**Normalisation.** `depth` and `money_behind` are normalised against the
strongest candidate in the same snapshot, so they are relative rankings rather
than absolute values. The absolute input is shown next to every score.

**Missing inputs.** If an official value is absent, its component is dropped,
the remaining weights are re-normalised, and the drop is recorded on the row in
`excluded_inputs` (and shown on the page).

## Sources

* Demo environment and endpoints — https://docs.kalshi.com/getting_started/demo_env
* API environments — https://docs.kalshi.com/getting_started/api_environments
* Market lifecycle — https://docs.kalshi.com/getting_started/market_lifecycle
* Market settlement — https://docs.kalshi.com/getting_started/market_settlement
* Order book responses — https://docs.kalshi.com/getting_started/orderbook_responses
* Get Market Candlesticks — https://docs.kalshi.com/api-reference/market/get-market-candlesticks
* Get Market Orderbook — https://docs.kalshi.com/api-reference/market/get-market-orderbook
* Get Markets — https://docs.kalshi.com/api-reference/market/get-markets
* Get Trades — https://docs.kalshi.com/api-reference/market/get-trades
* Fee schedule — https://kalshi.com/docs/kalshi-fee-schedule.pdf

## Limits (published on the page as well)

1. The demo exchange uses mock funds; Kalshi states its prices and behaviour
   may not reflect real markets.
2. Candle coverage is 10 markets, not the whole five-topic universe.
3. The live poller was not exercised against the real API from the build
   sandbox (no route to `*.kalshi.co` there); it is covered by unit tests and
   the page degrades to the committed feed.
4. No credentials exist in this project, so no balance, position or fill figure
   is shown and no order was ever sent.
5. The fee multiplier is transcribed for the series this feed uses only; other
   series fall back to the published default `M = 1`.
