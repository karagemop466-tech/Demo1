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
