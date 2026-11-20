# sim-desk — automated simulated-trading strategy runner

A piece of the Kalshi demo project that no other desk in this repo covers: an **unattended,
rule-based simulated trader**. It runs on GitHub Actions every 30 minutes, reads only the
official Kalshi **demo** Trade API public endpoints (no credentials, **no orders are ever
placed**), evaluates three disclosed strategies, simulates fills, and commits an append-only
ledger back to the repo. The static page at [`index.html`](index.html) renders the ledger:
bankroll equity over runs, open positions tracked **until each market resolves YES/NO**,
settled trades with the official result, and per-strategy / per-topic / per-price-band
performance rollups for categorizing and refining strategies.

| File | Purpose |
|---|---|
| `engine.py` | The runner: universe → classify → rank → signals → simulated fills → mark → settle → ledger |
| `config.json` | Every rule, threshold, cap and caveat, disclosed |
| `index.html`, `assets/` | Static dashboard (no dependencies; renders only committed JSON values) |
| `data/ledger.json` | Append-only ledger: cash, open positions, settled trades, per-run records |
| `data/performance.json` | Computed rollups + equity curve |
| `data/run_log.json` | Request-by-request provenance (exact official URL behind every number) |
| `tests/test_engine.py` | 26 offline tests: fee formula vs the official fee table, implied-ask rule, classification, strategy rules, settlement math, two-run lifecycle replay |
| `tests/make_fixtures.py` | Regenerates the recorded official-API-shaped fixtures |
| `../../.github/workflows/sim-strategies.yml` | CI: tests → live run → validate → commit ledger (push/PR/schedule/manual) |

## Strategies (deterministic, in `config.json`)

1. **momentum-tape** — YES trade-price trend over the last 6 trades ≥ +$0.05 → buy YES; ≤ −$0.05 → buy NO. Entry band $0.30–$0.85.
2. **mean-revert-tape** — fade when the last trade deviates ≥ $0.10 from the mean of the most recent 20 trades. Entry band $0.10–$0.60.
3. **longshot-value** — buy NO when its implied ask ≤ $0.20 on markets with ≥ 5,000 contracts traded in 24h.

Signals run on the official **public trades tape** (`GET /markets/trades?ticker=…`), because the demo
candlesticks endpoint currently returns empty arrays for most markets even when trades occurred minutes
earlier — captured and flagged by this repo's other desks (`decision/data/snapshot-orderbook-candlesticks.json`;
`docs/data/history.json`: 15/15 markets, zero candles).

Sizing: 10 contracts/trade, max 15 open positions (4 per topic), max 3 new trades per run,
starting bankroll $1,000 simulated demo dollars. Priority: momentum → mean-revert → longshot.

## Verified official rules the engine implements

| Rule | Source |
|---|---|
| Orderbook returns bids only, ascending, best bid = last; best YES ask = 1 − best NO bid | https://docs.kalshi.com/getting_started/orderbook_responses |
| Settlement pays $1 per contract to the holders of the `result` side | https://docs.kalshi.com/getting_started/market_settlement |
| Candlesticks: `period_interval` 1/60/1440; OHLC in `price.close_dollars` | https://docs.kalshi.com/api-reference/market/get-market-candlesticks |
| Markets: `status` enum incl. `settled`; `limit` ≤ 1000; `tickers` filter; demo hosts | https://docs.kalshi.com/api-reference/market/get-markets |
| Taker fee = roundup(M × 0.07 × C × P × (1−P)); no settlement fee | https://kalshi.com/docs/kalshi-fee-schedule.pdf |
| Demo environment = mock funds; prices may not reflect real markets | https://docs.kalshi.com/getting_started/demo_env |

## Honest limits (also published on the page)

- All fills are **simulated**: entry at the implied best ask derived from the bids-only book; ask-side depth is implied, not observed, and a simulated fill does not move the market. Demo books are thin (official warning).
- Marks use official `last_price_dollars` (API listing responses are cached for a short time).
- "Highest dollar amount" ranking is computed 24h traded notional (`volume_24h × last_price_dollars`) — Kalshi publishes no official dollar-volume field.
- Taker multiplier M=1 confirmed for KXAAAGASM / KXBTCMAX150 in the official table; the rest of the non-standard-fee table is not machine-readable from the PDF, so M=1 is assumed and disclosed.
- Candlestick-based signals are not used: the demo candlesticks endpoint currently returns empty arrays (flagged); signals run on the trades tape instead.

## Run locally

```bash
python3 sim-desk/tests/make_fixtures.py && python3 sim-desk/tests/test_engine.py   # offline
python3 sim-desk/engine.py --out sim-desk/data                                     # live (needs kalshi.co egress)
python3 sim-desk/engine.py --out /tmp/x --recorded sim-desk/tests/fixtures         # replay recorded payloads
```
