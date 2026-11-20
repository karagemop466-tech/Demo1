# Executive Summary — Kalshi Demo Market Data, Dashboard & Trading Project

**Project:** Collect, organize, and analyze live Kalshi **demo** market data for five topics only —
**gas prices, elections, culture, crypto, golf** — track events until they resolve (YES/NO), rank live
events by dollar activity, enable demo-account portfolio tracking and trade execution, and publish a
clean, verifiable GitHub Pages dashboard.

**Date:** 2026-11-20 · **Repo:** `karagemop466-tech/Demo1` · **Live site:** https://karagemop466-tech.github.io/Demo1/
**Session:** `arena-6aa291e9-demo1` (third of three parallel sessions; board in [COORDINATION.md](COORDINATION.md))

---

## 1. Environment & endpoints (verified against official docs)

| Surface | Value | Source |
|---|---|---|
| Demo REST (recommended) | `https://external-api.demo.kalshi.co/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments.md) |
| Demo REST (also supported) | `https://demo-api.kalshi.co/trade-api/v2` | same |
| Demo WebSocket | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (alt: `wss://demo-api.kalshi.co/trade-api/ws/v2`) | same |
| Demo account / keys | https://demo.kalshi.co → Account & security → API Keys; credentials NOT shared with production | [Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md) |

Key verified facts:
- **Public market data needs no authentication** (series, events, markets, orderbook, candlesticks, trades).
- **Portfolio & order writes require signed API-key requests** (`KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP`;
  RSA-PSS SHA-256 or Ed25519 over `timestamp+METHOD+path`).
- **Order placement uses `POST /portfolio/events/orders` (V2)** with fixed-point strings and
  `side: bid|ask`; legacy `/portfolio/orders` write endpoints are removed (HTTP 410 Gone).
- **WebSocket handshake requires authentication even for public channels** — a static site cannot
  stream ticks; second-level data on the site comes from browser polling (if CORS allows) or CI snapshots.
- **Settlement:** YES resolves → $1.00 per YES contract; NO resolves → $1.00 per NO contract.
  Settled demo markets expose `result`, `settlement_ts`, `settlement_value_dollars` (verified live).

## 2. What was built

1. **CI data pipeline** ([`scripts/fetch_kalshi_data.py`](scripts/fetch_kalshi_data.py) + scheduled workflow,
   every 15 min): scans open demo events, maps topics via the verified category taxonomy
   (`/series?category=` + `/search/tags_by_categories`), ranks events by **est. USD activity**
   (volume × last price) and **notional at stake** (open interest × $1.00), captures **order books**
   and **1-min/1-hour candlesticks** for top markets, and **tracks events until they resolve**
   (`resolutions.json`), writing provenance-stamped JSON under `docs/data/`.
2. **Data hub site** (`docs/`, linked from the root landing page): live dashboard (topic tabs, ranked
   events table, price chart with selectable windows from seconds-scale to 7 days, order-book depth with
   contracts at each price, implied asks/spread, bid liquidity), resolutions tracker (YES/NO with payout),
   portfolio & trades page (credential-gated), suggestions queue, decision questions table, flagged-items
   register, verification log, repo review, and sources.
3. **Demo trading scaffold** ([`scripts/demo_trader.py`](scripts/demo_trader.py) + disabled
   [`scripts/strategies.json`](scripts/strategies.json)): signed reads (`status`), single-order placement
   (`trade`, requires `KALSHI_ALLOW_TRADING=1`), cancellation, and a disabled strategy runner with
   conservative caps; writes `docs/data/portfolio.json` + `docs/data/trades.json` when credentials exist.

## 3. Verified findings (all five topics present on demo, 2026-11-20)

| Topic | Verified live example | Notes |
|---|---|---|
| Gas prices | `KXAAAGASMIN-26DEC31` ladder (AAA-settled); strike −$3.80 **settled YES** ($1.00, 2026-07-06) | volumes tiny (≤3.21 contracts) — demo books are thin |
| Elections | `KXNEXTNATOSECGEN-99` (NATO Secretary General, MEC) | open, settlement source NATO |
| Culture | `KXOSCARSUPACTO-27` (99th Academy Awards) | Kalshi's "Entertainment" category = our "culture" (mapping flagged) |
| Crypto | `KXBTCMINMON-BTC-26NOV30` — strike −$72,500: last $0.74, vol 2,345.11, OI 2,332.25 | **most active demo books found**; BTC ladder via CF Benchmarks |
| Golf | `KXPGAPLAYOFF-THRC26` (The RSM Classic playoff) | volume 0 on demo |

**Demo-environment caveat (verified):** the demo exchange uses mock funds and thin books — most
non-crypto markets show ~zero volume. Rankings work, but dollar figures are test data, not realism.

## 4. "Highest dollar amount" methodology (decision documented, flagged)

No official USD-volume field exists on the public endpoints. Two verified metrics are published side by side:
- **Est. USD volume** = contracts traded × last traded price (24h and total) — *estimate, flagged*.
- **Notional at stake** = open interest × $1.00 (each binary contract pays $1 at settlement — official).

The Suggestions page (S6) asks the reviewer to pick the headline metric or keep both.

## 5. Portfolio performance & trade execution — status

- Demo credentials do **not** exist in this repo (by policy, keys never enter a static site or chat).
- Portfolio/balance/positions/fills values are **blank and flagged** until demo API-key secrets are
  configured; the enable path is documented on the Portfolio page (3 steps).
- The trade executor is complete but **inert** without `KALSHI_ALLOW_TRADING=1`; strategies ship disabled.
- Categorized analysis (by topic + strategy tag, win rate, notional, YES/NO mix) is implemented and will
  populate automatically once fills exist.

## 6. Open items & flagged irregularities (non-blocking; full register on the site)

1. **CORS — resolved** — a CI header test with `Origin: https://karagemop466-tech.github.io` observed the
   official API reflecting the origin (`data/cors.json`), so browser-side live fetches work; the site still
   falls back to CI snapshots when the API is unreachable (F1 closed 2026-11-20).
2. **USD metric choice** (S6), **series allowlist approval** (S5), **risk limits for auto-trading** (Q6).
3. Root monitor (earlier session) requests `limit=1000` vs documented max 200, and builds possibly-404
   kalshi.com links — logged (F9/F10), not edited (file owned by another session).
4. Two parallel-session merge conflicts occurred and were resolved without discarding work (F11).
5. Seed snapshot is partial (`sample: true`); the first scheduled CI run replaces it with a full scan.

## 7. Verification discipline

Every table row on the site carries a source link to the official API response or documentation page.
Values that could not be confirmed from official sources are **blank and flagged** — never inferred.
Full evidence: [Verification log](https://karagemop466-tech.github.io/Demo1/docs/pages/verification.html),
[SOURCES.md](SOURCES.md), [REVIEW.md](REVIEW.md).

## 8. Final integration session — `arena/5487be47-demo1` (2026-11-20)

This session performed final integration on the merged tree: line-by-line review, empirical
re-verification against the official Kalshi sources, one missing feature, and the publish step.

- **Sharp-move feature (implemented).** The brief required live charts to flag contract-price moves
  of **≥ $0.10 in either direction** with the associated event and source links. This was **not present**
  anywhere in the repo, so it was added to the canonical live dashboard
  ([`dashboard.html`](dashboard.html) + [`assets/dashboard.js`](assets/dashboard.js)): consecutive price
  changes ≥ $0.10 are marked with dashed vertical markers on the price chart and listed in a
  "Sharp moves (≥ $0.10)" table with the time (UTC), direction, before→after price, magnitude, and a
  link to the market's official Kalshi page plus the exact API request URL. Kalshi does not report a
  *cause*, so no cause is asserted — only the official event/source links are shown. Verified by a
  new headless test ([`tests/dashboard-jumps.test.mjs`](tests/dashboard-jumps.test.mjs), 9/9 checks).
- **Live data path re-verified (empirical).** Against `https://external-api.demo.kalshi.co/trade-api/v2`
  on 2026-11-20: `GET /exchange/status`, `GET /markets/{ticker}`, `GET /markets/{ticker}/orderbook`,
  and `GET /series/{series}/markets/{ticker}/candlesticks?period_interval=60` all returned valid
  responses matching the documented schemas (bids-only orderbook; candlestick intervals 1/60/1440).
- **Official docs re-verified.** Demo REST/WS base URLs, the bids-only orderbook + YES-bid/NO-ask
  reciprocity rule, the 1/60/1440-minute candlestick constraint, and the demo = mock-funds warning all
  match [docs.kalshi.com](https://docs.kalshi.com/llms.txt) as documented in section 1.
- **Build & audit green.** `python3 build_site.py` → 16 pages, `link check: OK`; `node tools/check-links.mjs`
  → PASS (238 files, no broken links, no secret material, source-citation audit clean);
  `node --check` clean on all JS.
- **Pre-existing irregularity (not introduced here).** `tests/dashboard.test.mjs` is time-sensitive: its
  fixtures use fixed trade timestamps (2026-11-20 11:11 UTC) that fall outside the page's dynamically
  computed 1-hour window when the suite is run later, so the `pages/live.html` section reports "No trades
  matched." Confirmed it fails identically on the pristine tree; it is not run by the Pages workflow.
  Flagged, not fixed (test owned by an earlier session; left untouched per the coordination protocol).
- **Publish.** PR from `arena/5487be47-demo1` → `main`, merged, GitHub Pages redeploy confirmed.

## 9. Session `arena/b62e8188-demo1` — repo review, verification fixes, dual alert-chat (2026-11-20)

Line-by-line review of the merged tree with re-verification against the official docs, four open
board requests closed, and the one brief requirement still unimplemented anywhere in the repo
implemented. Full evidence: [`docs/verification-b62e8188.html`](docs/verification-b62e8188.html).

- **Dual scrolling-chat alert requirement — covered on main; shipped page repaired and pinned.**
  The brief's "two scrolling chat" alerting (≥ $0.10 swings either direction; one chat with all
  events, one high-ROI filter) was unimplemented on this session's base but was landed concurrently
  by other sessions (root [`alerts.html`](alerts.html) + [`assets/js/alerts.js`](assets/js/alerts.js),
  plus `alerts/`, `alert-desk/`, `trade-desk/`). Per coordination rules this session did **not** add
  a fourth variant. It instead: (1) wrote [`tests/alerts.test.mjs`](tests/alerts.test.mjs) (**23/23**),
  a headless regression suite pinning the shipped page's behaviour (swing detection both directions
  at the threshold, the two scrolling chats and the disclosed high-ROI filter, per-message official
  API + venue + *cause-unverified* links, topic/threshold controls, empty-state honesty); and
  (2) found and fixed **two real bugs in the shipped page** — `loadData()` read the snapshot payload
  one level off, so every visit rendered zero swings and a "—" capture date; and `normalizeCandle()`
  did not accept the official candlesticks schema (`end_period_ts` + `price.close_dollars`), so the
  live overlay never worked and silently fell back to snapshot. Both are acceptance-tested.
- **V-3/F6 fixed.** `build_site.py` no longer labels all 2,469 closed records "Resolved": the
  snapshot-derived split (2,117 settled with YES/NO result — 222 YES / 1,895 NO — and 352 closed
  awaiting result) now renders on the overview, topic and resolved pages, and
  `tools/verify_site.py` re-derives the split (PASS, 0 errors).
- **CR-1/F-01 fixed.** `strategy-desk/assets/app.js` now normalizes raw REST statuses
  (`active`/`initialized`/`inactive` → open, `determined`/`disputed`/`amended`/`finalized` → settled,
  `closed`/unknown → closed) per the official lifecycle page — live events are no longer mislabelled
  "closed".
- **Audit F-02/F-03 withdrawn as wrong; repo claims confirmed.** The current official
  [create-order-v2](https://docs.kalshi.com/api-reference/orders/create-order-v2) description states
  the legacy `/portfolio/orders` writes "have been removed and now return `410 Gone` with code
  `deprecated_v1_order_endpoint`" — the repo's "410 Gone" wording was correct all along (the audit's
  partial search-index excerpt was stale). The candlestick page confirms "One request can span at
  most 5,000 periods" — `docs/api-verification.md` was correct. Corrected rows are published on
  [`audit/index.html`](audit/index.html).
- **CR-4 fixed.** Root hub now tiles the API audit and its flagged items.
- **Gates (combined tree):** `build_site.py` link check OK · `tools/verify_site.py` PASS ·
  `check-links.mjs` PASS · `tests/alerts.test.mjs` 29/29 · `tests/dashboard.test.mjs` 46/46 ·
  `tests/dashboard-jumps.test.mjs` 9/9 · `npm test` PASS · unittest 7/7 · syntax checks PASS.
- **Carried-forward irregularities:** demo venue only (mock funds); no demo API key → authenticated
  cells blank + flagged; jump causes unverified (no official causal field); sub-minute swings not in
  REST candles; historical-cutoff date unstated in docs (audit F-05); error-code case disagreement
  (audit F-07); multi-desk site fragmentation (consolidation remains the owner's call).
- **Note for reviewers:** the earlier `tests/dashboard.test.mjs` time-sensitive fixture issue
  (section 8) was subsequently fixed by session `arena/358db039-demo1` (time-relative fixtures) and
  the suite passes 46/46 on this tree.
