# Demo1 — Kalshi Demo Dashboard

A static GitHub Pages site (repository root, served from `main` at `/`) that tracks Kalshi prediction markets in five categories (gas prices, golf, crypto, elections, culture), with a source-linked table, a live price chart, an orderbook liquidity view, analysis, open questions, suggestions, and a Flagged for Review page.

- **Live site:** GitHub Pages for this repository, served from the `main` branch, root folder (`/`).
- **Coordination:** see [COORDINATION.md](COORDINATION.md) for task status, sources, verification, and irregularities.

## Verified dashboard (this session)

`site/` is a separate, fully source-linked dashboard built from a single, logged collection run against the
**official Kalshi demo Trade API** (`snapshot/`). Open it at `/site/index.html`.

| Path | Purpose |
|---|---|
| `tools/collect_kalshi.py` | Collector: series, markets (`open`/`settled`/`closed`), events, order books, candlesticks, public trades |
| `snapshot/*.json`, `snapshot/collect-log.txt` | The verified snapshot + request-by-request log (485 requests, 0 failures) |
| `build_site.py` | Renders `site/` from `snapshot/` only; fails on any broken internal link |
| `tools/account_worker.py` | Optional **read-only** signed client for demo portfolio data (no write path, no orders) |
| `tools/verify_site.py` | Automated line-by-line verifier: re-derives every rendered value from `snapshot/*.json` and audits every data row's official source link; writes `site/verification-report.json` |
| `site/` | Overview, live markets, 5 topic pages, resolved outcomes, liquidity + chart, data browser, portfolio, strategies, suggestions, questions, flagged, sources, **verification** |

Definitions used: dollar ranking = computed 24 h traded notional (Σ `yes_price_dollars` × `count_fp`, trade count
shown); liquidity = order-book bids with contract counts (asks derived as 1.00 − opposite bid); resolution =
API `result` field on settled markets; history = documented 1/60/1440-minute candlesticks only. Absent values are
blank and listed on the Flagged for Review page.

## Structure

| Path | Purpose |
|---|---|
| `index.html` | Landing page |
| `executive-summary.html` | Executive summary, blocked items, decisions needed |
| `markets.html` | Verified market rows, each linked to its API source |
| `dashboard.html` | Live chart (seconds / minutes / hours) with ≥ $0.10 sharp-move markers, and orderbook liquidity |
| `portfolio.html` | Demo-account portfolio and trade log (blocked: no API key) |
| `analysis.html` | Snapshot findings and trade-categorization framework |
| `questions.html` | Questions, answers so far, and missing information |
| `suggestions.html` | Improvement proposals (none implemented; choose first) |
| `flagged.html` | Flagged for Review: unverified items, irregularities, repo findings |
| `sources.html` | Official sources and whether each was read |
| `data/markets.json` | The verified market table (source of truth for the site) |
| `assets/` | Shared CSS, navigation, and dashboard script (no external dependencies) |

## Data hub, CI pipeline & audit trail (session arena-6aa291e9-demo1)

A second, CORS-proof data path plus the audit layer lives under `docs/`:

| Path | Purpose |
|---|---|
| `docs/index.html` | Data hub landing — top-USD events across all topics, pipeline status |
| `docs/pages/live.html` | Dashboard: est. USD ranking, price chart (15 min → 7-day windows, 1m/60m official candles), order-book depth with contracts at each price |
| `docs/pages/resolutions.html` | Events tracked by CI until they resolve YES/NO (with `settlement_ts`, `settlement_value_dollars`) |
| `docs/pages/portfolio.html` | Demo-account portfolio/trade analysis (credential-gated; `scripts/demo_trader.py`) |
| `docs/pages/verification.html` | Line-by-line verification log — every claim linked to official sources |
| `docs/pages/flagged.html` | Flagged for Review register (F1–F14) with evidence links |
| `docs/pages/repo-review.html` | Line-by-line repository review |
| `docs/pages/suggestions.html` | Suggestions queue + questions/information/answers matrix |
| `docs/pages/sources.html` | Full source register (mirrors `SOURCES.md`) |
| `docs/data/*.json` | Provenance-stamped pipeline output (`snapshot.json`, `history.json` — 1m/60m candles, `resolutions.json`, `series_map.json`, `run_log.json`) |
| `scripts/fetch_kalshi_data.py` | CI pipeline (`.github/workflows/kalshi-data.yml`, every 15 min; commits data on `main`) |
| `scripts/demo_trader.py` | Signed demo-account client (order V2); disabled strategies in `scripts/strategies.json` |
| `tests/test_fetch_kalshi_data.py` | Offline unit tests using recorded live payloads |
| `EXECUTIVE_SUMMARY.md`, `SOURCES.md`, `REVIEW.md` | Executive summary, verified sources register, repo review |

## Live trade desk (`trade-desk/`, session arena/87015421-demo1)

A live, interactive desk built directly on the official Kalshi demo Trade API. It is plain HTML/JS/CSS with
no build step and no dependency at runtime, so it runs unchanged on GitHub Pages and in a local server.

| Page | What it does |
|---|---|
| `trade-desk/index.html` | **Two scrolling alert chats**: Feed A = every contract move of at least **$0.10** in either direction on the five topics; Feed B = the subset that clears a published fee-aware screen. Plus the largest events ranked by traded dollars, a live price chart, an order-book depth ladder and a market picker. |
| `trade-desk/chart.html` | One market in detail: x = time (30s / 2m / 15m / 1h / 6h / 24h), y = YES price, jump markers, the full depth ladder and the cost to buy 10 contracts by walking the real asks with the official fee. |
| `trade-desk/resolutions.html` | Follows markets until the API returns a result (`yes`, `no`, or `scalar`), with the API's own settlement fields and a local watch list. |
| `trade-desk/strategies.html` | Automated **paper** trading: four disclosed strategies, equity curve, and performance by strategy, topic, side and entry-price band. |
| `trade-desk/model.html` | The exact screen behind Feed B, both ROI definitions, the fee formula checked against all 21 rows of the official schedule, and measured calibration from the committed snapshot. |
| `trade-desk/sources.html` | Every official document and API response this desk depends on, with what each verified. |
| `trade-desk/flagged.html` | 14 disclosed irregularities and limits (TD-01 … TD-14), each with evidence and an official source. |
| `trade-desk/suggestions.html` | Prioritised suggestions, each marked implemented / ready / blocked with the reason. |

### What is verified, and how

- **Fee formula**: asserted against all 21 rows of the published Kalshi fee table
  ([PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf)) in `trade-desk/tests/engine.test.mjs`.
- **Jump threshold**: inclusive at exactly $0.10 and exclusive below it, compared on the API's own fixed-point
  strings so IEEE-754 rounding cannot drop a real $0.10 move.
- **Topic assignment**: from official `GET /series` category and tags (never guessed), with the deciding field
  recorded per series in `trade-desk/data/series-map.json`. Energy series that are not retail gasoline are
  excluded explicitly.
- **Paper P&L**: fills at the implied YES ask, official taker fee, $1/$0 settlement per the official settlement
  page, `scalar` value when the API returns one. Markets with no result are never settled by assumption.

```bash
node trade-desk/tests/engine.test.mjs     # 45 checks: fees, threshold, ledger, rollups
node trade-desk/tests/page_boot.test.mjs  # 24 checks: every page in jsdom on mocked official payloads
node trade-desk/tests/links.test.mjs      # 13 checks: links, scripts, nav parity, sources
python3 trade-desk/tools/calibrate.py     # regenerates trade-desk/data/calibration.json
node trade-desk/tools/build_series_map.mjs
```

CI: `.github/workflows/trade-desk.yml` reruns all of the above and regenerates both data files.

### Limits stated on the pages themselves

- Polls the REST API; the official WebSocket needs a signed key a public page must not hold.
- Seconds windows come from the **trades tape**, because the candlestick endpoint only supports
  1/60/1440-minute periods and returned empty arrays for the demo markets checked.
- The demo venue is a test exchange: prices, depth and fills are not real money.
- Feed B is a screen, not a forecast; its ROI figures are the win case, not an expected value.

## Live alert tapes (`alerts.html`, session arena/65df996f-demo1)

The brief's two scrolling chat feeds, running in the browser against the official demo REST API — no key, no build step, no orders.

| Path | What it is |
|---|---|
| `alerts-live.html` | Tape A = every contract move of ≥ **$0.10** in either direction across gas prices, elections, culture, crypto and golf; Tape B = only the lines that clear a published five-gate high-ROI screen. Auto-starts, polls every 15 s, pauses on hover, and every line carries its own source links. |
| `assets/alerts.js` | The engine: price series from `GET /markets` + `GET /markets/trades` (VWAP) + `GET /markets/orderbooks` (fillable ask and resting size), swing detection, the screen, and the blank-on-missing rule. |
| `assets/alerts-app.js` | Page wiring: chat rendering, click-through sparkline, per-gate pass/fail breakdown, watchlist, 429 backoff. |
| `docs/alerts-model.html` | The model spec: each gate as a formula with its official source, the fee maths (`t = 0.07·P·(1−P)`, rounded up to a centicent), and what the screen cannot see. No win rate or expected value is claimed. |
| `tests/alerts.test.mjs` | 81 jsdom checks over both feeds (threshold both directions, blank cells, pause, source links, no-order rule). |
| `alerts.html` (root) | Session `d973ced5`'s implementation over the committed candlestick capture, kept at the path it was merged to — `tests/alerts.test.mjs` (23 checks, session `b62e8188`) pins that page, so this session moved its own page to `alerts-live.html` instead of overwriting it. |

Topic membership, the `≥ $0.10` baseline and every value on the page are traceable to a request; anything not confirmable is printed as **blank** and listed on `flagged.html` (section E records what this session found in the data pipeline, including the mis-categorised gas topic and the all-`$0.00` gas ranking).

Data pipeline (`scripts/fetch_kalshi_data.py`, `.github/workflows/kalshi-data.yml`): series matching is now word-boundary on titles and KX-prefix-insensitive on tickers, the busiest series per topic are always fetched using the API's own `include_volume=true` volume, candle reading accepts both the documented nested `price.*_dollars` and flat `price_*_dollars` shapes, and the data commit survives a rejected push. Offline regressions: `tests/test_topic_classification.py` (17) and `tests/test_pipeline_offline.py` (8, the whole `main()` run against a stubbed transport).

## Data sources

All market values come from Kalshi's public REST API (no key needed for market data):

- Production: `https://external-api.kalshi.com/trade-api/v2`
- Demo: `https://external-api.demo.kalshi.co/trade-api/v2`

Documentation: <https://docs.kalshi.com/llms.txt>. Gas settlement input: <https://gasprices.aaa.com/>.

## Limits

- The table is a sample (15 verified rows), not a full market list.
- Culture has no verified open market; that row is blank and flagged.
- Portfolio tracking and trading need a Kalshi API key, which is not stored in this repository.
- Live browser requests to Kalshi: **CORS verified working** on 2026-11-20 (`data/cors.json` — the official API reflects this site's origin).

## Local preview

No build step. Serve the folder with any static server:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Other pages on this site

- `monitor/` — single-page market monitor from session `arena/e41f6700-demo1` (moved here from the repository root; its files are unchanged except link paths).
- `pages/` — multi-page site from session `arena/a443fb8f-demo1` (landing/executive summary, category pages, dashboard, portfolio, trades, suggestions, questions, flagged review). Linked from the landing page.

## Single-page monitor (session arena/e41f6700-demo1)

A static GitHub Pages research dashboard for Kalshi demo public market data, focused on gas prices, elections, culture, crypto and golf. Includes market scanning, order-book inspection, portfolio/strategy requirements, a suggestions review queue and an explicit flagged-unknowns register.

## Executive summary

- **Market discovery:** the page requests open demo markets from `https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=1000`, filters topic keywords, and ranks matching markets by the API-reported contract volume. It refreshes every 30 seconds. It does not label contract volume as dollars or claim it measures the “highest dollar amount.”
- **Depth:** selecting “Inspect book” requests the public market order book and shows returned bid levels and quantities, when available. Displayed bids are not a guarantee of execution.
- **History and resolution:** open market rows display returned status/result values when present. The price-history panel deliberately displays no fabricated graph: historical endpoint integration and timestamp/interval verification remain open work.
- **Account and trading:** portfolio access is authenticated. This static site does not request, store, sign with credentials or submit orders. Secure account reporting and order entry require a server-side signing service, explicit demo account authorization, risk controls and verification.
- **Decision support:** the site lists unanswered questions, source-linked official documentation, reviewable improvement suggestions, and known irregularities. Empty/unavailable data stays blank.

## Use / deploy

Open `monitor/index.html`, or enable GitHub Pages for the repository using the GitHub Actions workflow in `.github/workflows/pages.yml`. This is dependency-free static HTML/CSS/JavaScript. A browser may block API calls because of cross-origin policy or API availability; the dashboard reports that condition without inserting sample records. Deploying the site does not make authenticated endpoints or trade execution safe.

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


---

## Live demo desk (added 2026-11-20, session `8c8d4499`)

The earlier pages in this repository could not read the Kalshi demo API from their build
sandbox, so their tables were blank. That limitation was specific to `bash` egress in the
sandbox — the API itself is public and answered **19 live requests** during this session, and the
new pages use it directly from the browser.

| Page | What it does | Data path |
|---|---|---|
| `pages/live.html` | Ranks live events by **traded notional (USD)** = `volume_fp × notional_value_dollars`, filtered to gas prices, elections, culture, crypto and golf; price chart (time on X, contract price in USD on Y) with `1m/1h/1d` candles or sub-minute trade ticks; order-book ladder with contracts **and dollars at each price**; watch buttons for resolution tracking; a request log showing the exact URL behind every number | `GET /markets/trades` → `GET /markets?tickers=` → `GET /events?tickers=` → `GET /series?category=…&tags=…` → `GET /markets/{ticker}/orderbook` → `GET /series/{series}/markets/{ticker}/candlesticks` |
| `pages/resolutions.html` | Tracks each watched event until the API returns `result = "yes"` / `"no"`, records `settlement_ts` / `settlement_value_dollars`, and keeps an append-only, source-linked resolution log in the browser | `GET /markets?event_ticker=…` |
| `pages/strategy.html` | Fill ledger (official `count_fp` / `yes_price_dollars` / `no_price_dollars` / `fee_cost` / `outcome_side` fields), rule-based strategy tags, realised P&L computed only from resolved markets, CSV/JSON export, and an order **draft** (never a send) | local bridge → `GET /portfolio/balance`, `/positions`, `/fills` |
| `docs/api-verification.md` | 20-row verification table (claim → official source → observed response), 4 environment statements, 8 repo-review findings, 8 explicitly unverified items | `docs.kalshi.com` + live demo responses |
| `tools/kalshi-signer.mjs` | Optional local bridge: signs `timestamp + METHOD + path` with RSA-PSS/SHA-256 or Ed25519 (both round-trip verified locally), adds CORS, allowlists paths, and refuses order writes unless started with `ALLOW_ORDERS=1` on a demo host | account owner's machine |
| `tests/dashboard.test.mjs` | 46 headless checks (jsdom) that the pages call the right endpoints and render only returned values — all passing | — |
| `tools/check-links.mjs` | Broken-link, secret-material and source-citation audit used by CI | — |

**Honest limits.** No Kalshi credentials exist in this repository, so no order was placed and no
account balance, position or fill was read; those cells are blank and flagged. Contract *volume*
is a count, so the dollar column is an explicit `contracts × settlement notional` calculation, not
a measure of money at risk. Sub-minute price history comes from individual trades because the
candlestick endpoint only supports 1, 60 and 1440-minute intervals. Browser-side cross-origin access
to the demo host is detected at view time (see the request log on the page) — if it is blocked, the
page says so and points at the local bridge instead of substituting values.

---

## Verified desk (session s-8344abc8)

A self-contained second implementation lives in [`verified-desk/`](verified-desk/README.md):
11 pages, a pure tested engine (`assets/kalshi.js`, 34 unit tests), a source-linked capture
(`data/snapshot.json`, 27 logged requests), a jsdom boot test for every page, and three
tools (collector, offline-verifiable request signer, site integrity checker).

* Live: <https://karagemop466-tech.github.io/Demo1/verified-desk/>
* Verification: `cd verified-desk && node --test tests/kalshi.test.mjs tests/browser_boot.test.mjs && python3 tools/check_links.py`
* Data policy: every table row carries an official source URL; anything unconfirmable is left
  blank and badged `unverified`, never estimated. Irregularities are published on
  `verified-desk/flagged.html` rather than resolved by inference.

## Exec-desk (session arena-3a5f6f1d) — live trading desk

A second, fully self-contained desk at [`exec-desk/`](exec-desk/index.html) focused on **live interaction with the official demo API**:

- **Live dashboard** — highest dollar-amount events across gas/elections/culture/crypto/golf, price chart with seconds / minutes / hours x-axis, liquidity depth (contracts available at each price).
- **Resolution tracking** — open markets polled until `result = yes/no`, with a resolution watch log.
- **Portfolio & trades** — official `/portfolio/*` reads with a locally stored demo key (blank without one, per no-fabrication rules), plus a clearly labeled SIMULATED paper ledger; REAL demo orders via `POST /portfolio/events/orders` (V2).
- **Trade categorization & strategies** — auto category (topic · side · price band) + named strategy tags with win rate / P&L / ROI rollups.
- **Suggestions** — accept/reject/defer workflow and an implementation path picker; nothing is implemented without a recorded decision.
- **Questions & Flagged** — answered/unknown/decision-needed questions; 7 UNVERIFIED flags + 5 repo/API irregularities, each with a source link and a verification step.
- Sources & line-by-line verification: [`exec-desk/docs/SOURCES.md`](exec-desk/docs/SOURCES.md), [`exec-desk/docs/VERIFICATION.md`](exec-desk/docs/VERIFICATION.md).

Link check for this desk: `python3 exec-desk/scripts/check_links.py`.

---

## Sim-desk (session 9dcbe7d4) — automated simulated-trading strategy runner

An unattended, CI-scheduled simulator that no other desk covers: every 30 minutes `sim-desk/engine.py`
reads the official Kalshi **demo** Trade API public endpoints, ranks open markets in the five tracked
topics by computed 24h traded notional, evaluates three disclosed rule-based strategies
(momentum-1h, mean-revert-24h, longshot-value), **simulates** fills at the implied best ask with the
official taker fee `roundup(M×0.07×C×P×(1−P))`, marks open positions to the official last trade price,
and **settles them automatically when the market resolves YES/NO** at $1 per winning contract.
The append-only ledger is committed back, so `sim-desk/index.html` is a fully static, reproducible
dashboard: equity curve, open positions "awaiting yes/no", settled-trade results, and per-strategy /
per-topic / per-price-band rollups for categorizing trades and refining strategies.

- Page: [`sim-desk/index.html`](sim-desk/index.html) · Engine: [`sim-desk/engine.py`](sim-desk/engine.py) · Rules: [`sim-desk/config.json`](sim-desk/config.json)
- CI: `.github/workflows/sim-strategies.yml` (tests → live run → validate → commit ledger; push/PR/30-min schedule/manual)
- Offline proof: `python3 sim-desk/tests/make_fixtures.py && python3 sim-desk/tests/test_engine.py` — 26 tests including a fee-formula check against the official fee schedule's own table and a two-run lifecycle replay (open → mark → settle YES).
- Honest limits: all fills simulated (no orders, no credentials); demo prices may not reflect real markets (official warning); "highest dollar amount" ranking is a computed estimate (no official dollar-volume field); taker multiplier M=1 confirmed only for the fee-table rows relevant to tracked series.
