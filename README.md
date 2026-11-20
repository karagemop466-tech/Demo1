# Kalshi demo dashboard

A static GitHub Pages site plus a pure JavaScript engine for tracking **the Kalshi demo
environment** (`https://external-api.demo.kalshi.co/trade-api/v2`) across five topics only:
**gas prices · elections · culture · crypto · golf**.

It ranks live events by dollar volume, records how each one resolved (yes/no, with the
settlement fields that say so), charts price movement and order-book depth, categorises
trades along eight axes, and publishes what it could not verify instead of hiding it.

**Site:** <https://karagemop466-tech.github.io/Demo1/>

## Pages

| Page | What it answers |
| --- | --- |
| `index.html` | Overview: verified facts, repo map, what this can and cannot do |
| `exec-summary.html` | Requirements vs outcomes, findings F-1…F-8, the phased path |
| `dashboard.html` | Highest-dollar-volume events in scope, refresh modes, resolution tracker |
| `markets.html` | Price history (time on X, contract price on Y) + contracts available at each price level |
| `strategies.html` | Strategy definitions and what each rule signals on the real capture |
| `portfolio.html` | Account endpoints, signing, order payload, guardrails, a candle-replay simulator |
| `api-reference.html` | Endpoint-by-endpoint record: parameters, semantics, limits, and whether it was exercised |
| `provenance.html` | The 27-request capture log, transcription rules, how to refresh |
| `questions.html` | Questions answered from sources (9) and what is still open (12), each with owner + discovery action |
| `suggestions.html` | Ten improvements for the reviewer to approve / defer / reject — nothing is implemented beforehand |
| `flagged.html` | FL-1…FL-12 irregularities and every deliberately blank value |

## Data policy (the rule this repo is built around)

* Every table row links to the official page or API response it came from.
* A value that cannot be confirmed from an official source is **left blank and badged
  `unverified`** — never estimated, never inferred, never carried over from memory.
* Anything computed by this project is labelled (`estimate`, `floor`, `derived`) and its
  formula is printed next to it. `volume_fp` is a contract count, so dollar volume here is
  `volume × last price`, an estimate, not an exchange figure.
* Captured values live in [`data/snapshot.json`](data/snapshot.json) with per-row source URLs.

## Layout

```
assets/kalshi.js     the engine: money/fee maths, topic classification, ranking, ladder,
                     candlestick URLs, resampling, chart scales, portfolio + replay, scan
assets/app.js        shell, nav, sortable tables, SVG chart, page renderers, suggestion UI
assets/app.css       design system (no CDN, no fonts, no images)
data/snapshot.json     verified capture, 2026-11-20 11:11–11:21 UTC
tests/                 pure-function suite + a jsdom boot test for every page
tools/                 collector, request signer, site integrity checker
COORDINATION.md        multi-session task board, logs, irregularities
```

## Verify and refresh

```bash
node --test tests/kalshi.test.mjs tests/browser_boot.test.mjs   # 48 tests, no dependencies
python3 tools/check_links.py                                    # links, mounts, provenance rows
python3 tools/refresh_snapshot.py --check                       # re-probe the documented API quirks
python3 tools/refresh_snapshot.py --dry-run                     # collect without writing
python3 tools/kalshi_sign.py --self-test                        # Ed25519 vs RFC 8032 vectors
python3 -m http.server 8000                                     # then open http://localhost:8000
```

`browser_boot.test.mjs` skips unless jsdom is installed (`npm i --no-save jsdom`); it is what
proved every page renders without a script error.

## What this project does not do

* **It never sends your key and never commits one.** `tools/kalshi_sign.py` reads the key from
  the environment and refuses to send unless `KALSHI_ALLOW_LIVE=1` is set.
* **No orders are placed from the site.** Trading is specified, simulated and gated on
  credentials plus your limit rules (`questions.html#q-11`).
* **Demo is not production.** Kalshi's own docs warn that demo prices "may not be reflective of
  those in real markets"; every ranking, edge and liquidity figure here is demo-only.
* Sub-second data is not available from REST, so the "seconds" chart is labelled 60-second
  buckets of 1-minute candles rather than pretending otherwise.
