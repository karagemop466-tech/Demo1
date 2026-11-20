# desk/ — Kalshi demo trading desk (consolidated)

One dashboard for gas prices, elections, culture, crypto and golf on Kalshi's **demo** Trade API,
with resolution tracking, an automated paper-trading simulation and a published review register.

Open `desk/index.html` (or `/desk/` on the published site).

## Why this exists

The repository already held several independent desks (`site/`, `docs/`, `exec-desk/`, `decision/`,
`verified-desk/`, `pages/`, `monitor/`). They disagreed on basics — for example `site/` labels all 2,469
collected closed records "Resolved" when only 2,117 carry a YES/NO `result`. This desk consolidates the
requirement list into one place, states what is verified and what is blank, and adds the two pieces that
were missing: a deterministic simulated-trading engine with fees, and a single line-by-line
requirements matrix.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Executive overview: what is live, what is blocked, pipeline status |
| `live.html` | Live ranking by traded dollars, price chart (minutes → days + live ticks), depth ladder, ≥ $0.10 jump scanner |
| `markets.html` | All topics in one table plus per-topic coverage |
| `gas-prices.html`, `elections.html`, `culture.html`, `crypto.html`, `golf.html` | One topic per page, events grouped, resolved outcomes, pending results |
| `resolutions.html` | Append-only YES/NO log with settlement values and sources |
| `strategy.html` | Eight published rules, full paper ledger, win rate / P&L / ROI per strategy |
| `portfolio.html` | Why the demo account is blank without a key, and the unblock path |
| `requirements.html` | Every line of the brief → implementation → status → official source |
| `sources.html` | Official documents, what each establishes, where it is used |
| `flagged.html` | Unverified values, data irregularities, improvement proposals |

## Tooling

| File | Role |
|---|---|
| `tools/collect.py` | Collects markets by status, order books, candles, 24 h traded notional, watch list (GitHub runner) |
| `tools/paper_trader.py` | Eight strategies, fee-charged paper fills, grading against the exchange `result` |
| `tools/track_resolutions.py` | Append-only resolution log |
| `tools/desk_data.py` | Transcribes `snapshot/*.json` into `data/snapshot-slim.json` (no computation beyond formatting) |
| `tools/kalshi_fees.py` | Fee arithmetic; asserts all 21 published fee rows |
| `tools/build_pages.py` | Renders the site; fails on broken links |
| `tools/dom_test.mjs` | 100+ headless checks (jsdom) over pages, chart, jump logic, ledger and log |

## Verification rules used here

1. Every numeric table row links to the exact API request that produced it.
2. A value the API does not return is rendered as an em dash and badged **unverified** — never filled in.
3. `result ∈ {yes,no}` on a finalized market is the only thing counted as resolved; `closed` without a
   result is tracked separately as *awaiting determination* (per `docs.kalshi.com/getting_started/market_lifecycle`).
4. Fees are charged on every paper fill using the published schedule.
5. Jump alerts link to a Kalshi market page and a news search, and are explicitly labelled *cause unverified*.

## Local run

```bash
python3 desk/tools/desk_data.py          # snapshot -> desk/data
python3 desk/tools/track_resolutions.py
python3 desk/tools/paper_trader.py --max-new 40
python3 desk/tools/build_pages.py        # renders pages, link check
node desk/tools/dom_test.mjs             # headless checks
python3 -m http.server 8000              # then open /desk/
```

`tools/collect.py` needs outbound access to `external-api.demo.kalshi.co`, which the GitHub-hosted
runner has and the authoring sandbox does not; the site therefore ships with the committed snapshot and
fetches live data in the browser.
