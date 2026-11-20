# Demo1 — Kalshi Demo Dashboard

A static GitHub Pages site (folder `docs/`) that tracks Kalshi prediction markets in five categories (gas prices, golf, crypto, elections, culture), with a source-linked table, a live price chart, an orderbook liquidity view, analysis, open questions, suggestions, and a Flagged for Review page.

- **Live site:** GitHub Pages for this repository, served from the `main` branch, folder `/docs`.
- **Coordination:** see [COORDINATION.md](COORDINATION.md) for task status, sources, verification, and irregularities.

## Structure

| Path | Purpose |
|---|---|
| `docs/index.html` | Landing page |
| `docs/executive-summary.html` | Executive summary, blocked items, decisions needed |
| `docs/markets.html` | Verified market rows, each linked to its API source |
| `docs/dashboard.html` | Live chart (seconds / minutes / hours) and orderbook liquidity |
| `docs/portfolio.html` | Demo-account portfolio and trade log (blocked: no API key) |
| `docs/analysis.html` | Snapshot findings and trade-categorization framework |
| `docs/questions.html` | Questions, answers so far, and missing information |
| `docs/suggestions.html` | Improvement proposals (none implemented; choose first) |
| `docs/flagged.html` | Flagged for Review: unverified items, irregularities, repo findings |
| `docs/sources.html` | Official sources and whether each was read |
| `docs/data/markets.json` | The verified market table (source of truth for the site) |
| `docs/assets/` | Shared CSS, navigation, and dashboard script (no external dependencies) |

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
cd docs && python3 -m http.server 8000
```

Then open <http://localhost:8000/>.
