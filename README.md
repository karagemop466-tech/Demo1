# Demo1 — Kalshi Demo Dashboard

A static GitHub Pages site (repository root, served from `main` at `/`) that tracks Kalshi prediction markets in five categories (gas prices, golf, crypto, elections, culture), with a source-linked table, a live price chart, an orderbook liquidity view, analysis, open questions, suggestions, and a Flagged for Review page.

- **Live site:** GitHub Pages for this repository, served from the `main` branch, root folder (`/`).
- **Coordination:** see [COORDINATION.md](COORDINATION.md) for task status, sources, verification, and irregularities.

## Structure

| Path | Purpose |
|---|---|
| `index.html` | Landing page |
| `executive-summary.html` | Executive summary, blocked items, decisions needed |
| `markets.html` | Verified market rows, each linked to its API source |
| `dashboard.html` | Live chart (seconds / minutes / hours) and orderbook liquidity |
| `portfolio.html` | Demo-account portfolio and trade log (blocked: no API key) |
| `analysis.html` | Snapshot findings and trade-categorization framework |
| `questions.html` | Questions, answers so far, and missing information |
| `suggestions.html` | Improvement proposals (none implemented; choose first) |
| `flagged.html` | Flagged for Review: unverified items, irregularities, repo findings |
| `sources.html` | Official sources and whether each was read |
| `data/markets.json` | The verified market table (source of truth for the site) |
| `assets/` | Shared CSS, navigation, and dashboard script (no external dependencies) |

## Data sources

All market values come from Kalshi's public REST API (no key needed for market data):

- Production: `https://external-api.kalshi.com/trade-api/v2`
- Demo: `https://external-api.demo.kalshi.co/trade-api/v2`

Documentation: <https://docs.kalshi.com/llms.txt>. Gas settlement input: <https://gasprices.aaa.com/>.

## Limits

- The table is a sample (15 verified rows), not a full market list.
- Culture has no verified open market; that row is blank and flagged.
- Portfolio tracking and trading need a Kalshi API key, which is not stored in this repository.
- Live browser requests to Kalshi were not verified from the build environment.

## Local preview

No build step. Serve the folder with any static server:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.
