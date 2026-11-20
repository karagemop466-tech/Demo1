# Kalshi demo desk — engine notes (session `05e53528`)

Open **`index.html`** (published at
<https://karagemop466-tech.github.io/Demo1/engine/>) — it is the deliverable; this file is
the audit trail for what it computes and how each number was checked.

Everything here is **derived from official Kalshi demo-API responses that were captured by
this repository** (`snapshot/`, written by `tools/collect_kalshi.py`), plus a narrow live pull
(`tools/engine_refresh.py`). Nothing is entered by hand, nothing is inferred, and no order has
been placed: there is no demo API key in this repo, so the trade log is **SIMULATED** and is
labelled that way everywhere it appears.

## What was verified line by line, and against what

| Claim used by the code | Official source it was checked against | How |
|---|---|---|
| Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2`, demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, and the `demo-api.kalshi.co` alternates | <https://docs.kalshi.com/getting_started/api_environments> | endpoint tables read directly; matches the brief exactly |
| Demo runs on mock funds and "the price and behavior of markets in the demo environment may not be reflective of those in real markets" | <https://docs.kalshi.com/getting_started/demo_env> | quoted verbatim; shown in the page's warning bar |
| Taker fee `round up(M × 0.07 × C × P × (1 − P))`; maker `round up(M × 0.0175 × C × P × (1 − P))`; no settlement fee; no membership fee; per-series multiplier table | <https://kalshi.com/docs/kalshi-fee-schedule.pdf> (footer "Last updated and effective: July 7, 2026") | re-implemented from the PDF and **asserted against the PDF's own General Trading Fees Table**, all 21 price rows (`engine/test_engine.py::test_fee_matches_official_table`) |
| Multipliers copied for series this repo touches: `KXAAAGASM` 1/1, `KXBTCY` 0/0, `KXETHY` 0/0; defaults elsewhere | same PDF, "Non-Standard Fees" | a zero-multiplier series is charged 0.00 by rule, not by rounding |
| The REST book returns **bids only**; a YES ask is `1.00 − highest NO bid`; arrays are ascending so the last element is best; an empty book is a valid 200 with empty arrays | <https://docs.kalshi.com/getting_started/orderbook_responses> | the depth ladder states the identity instead of pretending the API returned an ask |
| `GET /events` documented page size is `limit=200` | <https://docs.kalshi.com/api-reference/events/get-events> | the repo's own `data/meta.json` shows the earlier `limit=1000` call answered **HTTP 400 `bad_request`**, and `scripts/fetch_demo_data.py` now uses 200 |
| Statuses `initialized/active/inactive/closed/determined/disputed/amended/finalized`, `settled` filter ⇒ `finalized`, `result` set to `yes`/`no`/**`scalar`** at determination, `settlement_ts` on payout | <https://docs.kalshi.com/getting_started/market_lifecycle> | the resolution tab uses those fields only; it never predicts |
| Public unauthenticated requests have their own limits; back off on 429 | <https://docs.kalshi.com/getting_started/rate_limits> | poll cadence ≥ 5 s, doubling backoff on failure |
| Candlesticks are 1 / 60 / 1440 minutes | <https://docs.kalshi.com/api-reference/market/get-market-candlesticks> | no sub-minute series is claimed; "seconds" mode is client-sampled and labelled as such |

## What the desk computed (all reproducible: `python3 tools/jump_scan.py --emit-charts engine/charts.json && python3 tools/strategy_sim.py`)

Capture: `snapshot/` generated 2026-11-20T11:43:59Z, 1,399 open and 2,469 resolved markets.

1. **Sharp moves ≥ $0.10.** 662 of them over 4,768 captured candles in 30 windows
   (10 markets × 3 windows). 639 appear on the book mid, only **23 on the traded close** — and
   **74 % of them sit on a candle with zero volume**. Largest single move in the capture:
   $0.996. *Reading: on this demo tape a "$0.10 jump" is usually one stray print against a wide
   book, not news. The page therefore shows volume next to every jump and links a news
   **search** (never a claimed cause).*
2. **Settled-market outcomes.** 2,469 resolved markets examined; **1,471 report a last price of
   exactly $0.00** (60 %, including 141 that resolved YES) and 352 have no result yet. Those
   1,471 are excluded from the P&L study as unfillable, and the exclusion is printed on the
   page rather than buried. The remaining rows are bucketed by price: buying YES at 90–100¢
   paid **−40.8 %** net (avg entry $0.974, only 57.8 % resolved YES), while the cheap tail shows
   a positive figure the desk explicitly refuses to call an edge (a stale 2¢ print is not an
   executable price).
3. **Three simulated rules** (jump-momentum, jump-fade, stale-quote) on captured candles,
   100 contracts a leg, spread crossed both legs, taker fee per the schedule:
   16 round trips, 4 winners, gross −$362.80, fees $24.40, **net −$387.20 (−50.4 %)**.
   Broken out by topic (Gas −43.24, Culture −148.87, Elections −97.09, Crypto −98.00, Golf 0 —
   no golf market printed a traded ≥$0.10 move in the captured windows) and by trade type.
4. **Liquidity reality check.** Books were captured for 3–6 markets per topic (the collector's
   sample, not a market statistic), with median spreads of $0.02 (Culture), $0.002 (Elections),
   $0.004 (Golf) and $0.50 (Gas). The page labels this "books captured for", so a small number
   reads as thin coverage rather than as "no liquidity".

## Flagged for review (also published in the page's *Sources & flags* tab)

- **ENG-01** Demo venue: mock funds, prices may not reflect real markets — every figure is test-venue data.
- **ENG-02** No API key in this repo ⇒ no real account, no fills, no portfolio numbers; those cells are blank by design, never estimated.
- **ENG-03** Candle capture covers 10 markets; a missing chart is a coverage gap, not a quiet market. `tools/engine_refresh.py` widens this to the top-dollar market per topic on every CI run.
- **ENG-04** The settlement study's entry is the API's own `last_price`, which on thin books can be far from the close ⇒ bucket ROI overstates realism.
- **ENG-05** Dollar ranking is **computed**, not returned: `GET /markets` has no USD-volume field, so the
  capture ranks by the collector's `SUM(yes_price_dollars × count_fp)` over `GET /markets/trades` for the
  last 24 h (formula and request URL printed per row), while `tools/engine_refresh.py` ranks by
  `volume_24h_fp × notional_value_dollars`. The two agree on order for the markets shown but are different
  measures; the page names which one each row used rather than pretending either is official.
- **ENG-06** Topic assignment is a published keyword rule; rows matched on series ticker only are marked "weak match".
- **ENG-07** Seconds resolution on the chart is client-sampled polling, labelled; the official finest interval is 1 minute.
- **ENG-08** The public `kalshi.com/market/…` URL pattern could not be verified from this environment, so rows link the API request (always correct) and a news search, and no guessed web link is shown.
- **ENG-09** Repo finding, not a defect of this desk: as at 13:16Z the repo has **zero** `schedule`-event
  Actions runs, and `fetch-data.yml` only reached `main` at 12:52:26Z (authored 11:20Z on
  `arena/bc250043-demo1`, merged in PR #32 / `f9fab19`). GitHub only creates scheduled runs from the default
  branch, so "refreshed every 15 minutes" was true of the *design* but could not yet be true of the
  *history* — the earlier 11:2x–11:3x refreshes were manual `workflow_dispatch` runs on a session branch.
  Anyone judging freshness should read the run list, not the cron string. `engine-refresh.yml` is written
  to the same rule, and only starts scheduling once it is on `main`.

## Tests

- `python3 engine/test_engine.py` → 11 tests: fee table equality, zero-multiplier series,
  rounding direction, adjacent-candle jump rule, no-mid-from-a-one-sided-book, unfillable-price
  exclusion, no-invented-spread, both input layouts, and a **self-consistency audit of the
  committed JSON** (every jump must cite a URL present in the capture; rollups must equal the
  sum of their trades; every board row must carry provenance; bucket counts + skips must
  reconcile to the markets examined).
- `node engine/test_boot.mjs` → 37 assertions over the real `index.html` + `app.js` in jsdom,
  in both the offline (snapshot) and the live-poll path, including topic grouping, per-row
  source links, chart axis labels, the "uncaptured book ≠ empty book" distinction, filters,
  and SIMULATED wording.

## Files

| File | Role |
|---|---|
| `index.html`, `style.css`, `app.js` | the desk: board → chart + depth ladder → jumps → resolutions → strategies → sources/flags |
| `strategies.json`, `jumps.json`, `charts.json` | committed computed inputs the page renders offline |
| `test_engine.py`, `test_boot.mjs` | the two suites above |
| `../tools/engine_refresh.py` | narrow live pull from four public endpoints; writes `data/live-snapshot.json` |
| `../tools/jump_scan.py`, `../tools/strategy_sim.py` | the computations, with the sources in their docstrings |
| `../.github/workflows/engine-refresh.yml` | runs the tests, refreshes every 15 min, commits only `data/` |

Not investment advice. Not a live-money feed. A verified measurement of what the Kalshi demo
tape did, and what it costs to trade it.
