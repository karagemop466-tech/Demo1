# verified-desk — Kalshi demo tracking site (session s-8344abc8)

A static GitHub Pages site plus a pure JavaScript engine for the **Kalshi demo
environment** (`https://external-api.demo.kalshi.co/trade-api/v2`), scoped to five topics
and nothing else: **gas prices · elections · culture · crypto · golf**.

It ranks live events by dollar volume, records how each one resolved (yes/no, with the
settlement fields that say so), charts price movement and order-book depth, categorises
trades along eight axes, and publishes what it could not verify instead of hiding it.

**Live:** <https://karagemop466-tech.github.io/Demo1/verified-desk/> · start at `index.html`.

This directory is one of several independent desks in the repository; the root
`index.html` is the hub. Nothing outside this directory is written by this desk except an
additive link section on that hub and rows in [`../COORDINATION.md`](../COORDINATION.md).

## Pages

| Page | What it answers |
| --- | --- |
| `index.html` | Overview: verified facts, repo map, what this can and cannot do |
| `exec-summary.html` | Requirements vs outcomes, findings F-1…F-8, the phased path |
| `dashboard.html` | Highest-dollar-volume events in scope, refresh modes, resolution tracker |
| `markets.html` | Price history (time on X, contract price on Y) + contracts available at each price level |
| `strategies.html` | Strategy definitions and what each rule actually signals on the capture |
| `portfolio.html` | Account endpoints, signing, order payload, guardrails, a candle-replay simulator |
| `api-reference.html` | Endpoint-by-endpoint record: parameters, semantics, limits, whether it was exercised |
| `provenance.html` | The 27-request capture log, transcription rules, how to refresh |
| `questions.html` | 9 questions answered from sources, 12 open, each with owner + discovery action |
| `suggestions.html` | Ten improvements for the reviewer to approve / defer / reject — nothing implemented beforehand |
| `flagged.html` | FL-1…FL-12 irregularities and every deliberately blank value |

## Data policy (the rule this desk is built around)

* Every table row links to the official page or API response it came from.
* A value that cannot be confirmed from an official source is **left blank and badged
  `unverified`** — never estimated, never inferred, never carried over from memory.
* Anything computed here is labelled (`estimate`, `floor`, `derived`) with its formula
  printed next to it. `volume_fp` is a contract count, so dollar volume is
  `volume × last price`: an estimate, not an exchange figure.
* Captured values live in [`data/snapshot.json`](data/snapshot.json) with per-row source URLs.

## Layout

```
assets/kalshi.js   the engine: money/fee maths, topic classification, ranking, resolution,
                   ladder + book walk, candlestick URLs, resampling, chart scales,
                   portfolio view, replay simulator. Pure functions, no DOM.
assets/app.js      shell, nav, sortable tables, inline SVG chart, page renderers, suggestion UI
assets/app.css     design system. No CDN, no webfonts, no images.
data/snapshot.json verified capture, 2026-11-20 11:11–11:21 UTC
tests/             pure-function suite + a jsdom boot test for every page
tools/             collector, request signer, site integrity checker
```

## Verify and refresh — run from this directory

```bash
node --test tests/kalshi.test.mjs tests/browser_boot.test.mjs   # 48 tests, no dependencies
python3 tools/check_links.py                                    # links, mounts, provenance rows
python3 tools/refresh_snapshot.py --check                        # re-probe the documented API quirks
python3 tools/refresh_snapshot.py --dry-run                      # collect without writing
python3 tools/kalshi_sign.py --self-test                         # Ed25519 vs RFC 8032 vectors
python3 -m http.server 8000                                      # then open http://localhost:8000/verified-desk/
```

`tests/browser_boot.test.mjs` skips unless jsdom is installed (`npm i --no-save jsdom`, from
the repository root). It is what proves the pages render rather than merely parse: it boots
each page in a DOM with the real snapshot and fails on any script error, empty mount or
row-less table.

## What this desk does not do

* **It never sends your key and never commits one.** `tools/kalshi_sign.py` reads the key from
  the environment and refuses to send unless `KALSHI_ALLOW_LIVE=1` is set.
* **No orders are placed from the site.** Trading is specified, simulated and gated on
  credentials plus your own limit rules (`questions.html#q-11`).
* **Demo is not production.** Kalshi's own docs warn that demo prices "may not be reflective of
  those in real markets"; every ranking, edge and liquidity figure here is demo-only.
* Sub-second data is not available from REST (`period_interval` ∈ {1, 60, 1440} minutes), so the
  "seconds" chart is labelled 60-second buckets of 1-minute candles rather than pretending.
* Culture has no demo substance (two series, both zero volume) and the page says so instead of
  substituting another category (`flagged.html#fl-5`).
