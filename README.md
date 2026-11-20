# Kalshi Demo Dashboard

A static, live dashboard over the **Kalshi demo Trade API** — highest dollar-amount live events across five topics
(gas prices · elections · culture · crypto · golf), resolution tracking, portfolio & trade analysis with strategy
categorization, price/liquidity charts (seconds / minutes / hours), a reviewable suggestions section, and a fully
sourced verification trail.

**Live site:** enabled via GitHub Pages from `main` (root) — see the Actions/Pages tab.

## Pages

| Page | Purpose |
|---|---|
| [index.html](index.html) | Landing page |
| [executive-summary.html](executive-summary.html) | Requirement-by-requirement delivery, key official facts, risks |
| [dashboard.html](dashboard.html) | Live top events, price chart (sec/min/hour), liquidity depth |
| [markets.html](markets.html) | Live markets polled until resolution (YES/NO watch log) |
| [portfolio.html](portfolio.html) | Demo-account reads (official) + paper ledger analytics |
| [trades.html](trades.html) | Execute trades (paper / real demo), categorize, strategy tags |
| [suggestions.html](suggestions.html) | Review → accept/reject/defer → choose implementation path |
| [questions.html](questions.html) | Answered / unknown / decision-needed questions + missing info |
| [flagged.html](flagged.html) | Flagged for Review — unverified items with official sources |
| [sources.html](sources.html) | All 25 official sources |

## Data rules (no hallucinations)

- Every table value is either read **live** from an official Kalshi endpoint in the browser, or it is **left blank and flagged**.
- Every table row carries a **source link** to an official site (`docs.kalshi.com` or the live official API URL).
- Verification trail: [`docs/SOURCES.md`](docs/SOURCES.md) · [`docs/VERIFICATION.md`](docs/VERIFICATION.md) · multi-session board [`COORDINATION.md`](COORDINATION.md).

## Endpoints (official)

- REST demo (recommended): `https://external-api.demo.kalshi.co/trade-api/v2`
- REST demo (also supported): `https://demo-api.kalshi.co/trade-api/v2`
- WebSocket demo: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (also `wss://demo-api.kalshi.co/trade-api/ws/v2`)
- Source: https://docs.kalshi.com/getting_started/demo_env

## Local development

No build step — plain HTML/JS/CSS. Serve the repo root with any static server, e.g.:

```bash
python3 -m http.server 8080
```

Link check (run before any merge):

```bash
python3 scripts/check_links.py
```

## Notes

- Demo environment uses mock funds; official warning: demo prices may not reflect real markets.
- Authenticated portfolio/trading requires a demo API key entered locally in the browser (trades.html → Settings).
  Without it, official portfolio cells stay blank (flagged UNVERIFIED-02); a clearly labeled SIMULATED paper ledger
  covers the workflow.
- Not financial advice.
