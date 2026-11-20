# Demo1 — Kalshi Demo Tracker

Live, interactive dashboard for the **official Kalshi demo environment** (mock-funds sandbox):
tracks the highest-dollar live events across **gas prices, elections, culture, crypto, and golf**,
follows each event through **YES/NO resolution**, charts **price movements over time**,
and analyzes a **clearly-labeled simulated portfolio** with strategy tagging.

**Live site:** https://karagemop466-tech.github.io/Demo1/ (after Pages deploys)

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page + executive summary |
| `markets.html` | Live markets by topic, sorted by estimated dollar volume; resolution tracking (YES/NO) |
| `analytics.html` | Price chart (X = time with sec/min/hr windows, Y = contract price in ¢), orderbook depth & liquidity |
| `portfolio.html` | SIMULATED demo portfolio: order ticket, positions, P&L, strategy analyzer |
| `suggestions.html` | Open questions (known / missing / how to discover) + suggestions awaiting review |
| `sources.html` | Every fact with its official source and verification status |
| `flagged.html` | Irregularities & unverified items for review (does not block merges) |

## Data sources (official)

- Demo REST (recommended): `https://external-api.demo.kalshi.co/trade-api/v2` — [docs](https://docs.kalshi.com/getting_started/api_environments)
- Demo REST (alternate): `https://demo-api.kalshi.co/trade-api/v2`
- Demo WebSocket: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`
- Public market data needs **no API key**; trading/portfolio endpoints require **Ed25519/RSA-signed** requests — [docs](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)

## Verification discipline

1. **No invented values.** All market numbers are fetched live from the official demo API at view time; anything unfetchable is blank + flagged.
2. **Runtime verification** of topic→series mapping via `GET /series/{ticker}` (candidates in `data/series-map.json`).
3. **“Est. $ volume”** is explicitly an estimate (Kalshi reports volume in contracts).
4. **Fees** use the official formula `fee = ⌈0.07 × C × P × (1−P)⌉`.
5. Sources & flagged items: see `sources.html` and `flagged.html`.

## Parallel-session coordination

See [COORDINATION.md](COORDINATION.md) — shared task board with claims, scopes, sources, and the handoff log.
Each session works its own branch (`session-<id>/<task>`), commits small & often, and runs `git pull --rebase` before every push.

## Repo review (pre-existing content)

The repository contained **only** a stub `README.md` (`# Demo1`, commit `4a225ce` “Initial commit”).
There was no pre-existing data, code, or table content to audit. All files in this tree were created
and reviewed in this session; flagged items are published on `flagged.html`.

## CI

- **Deploy** (`.github/workflows/deploy.yml`): builds & publishes to GitHub Pages on every push to `main` (requires Settings → Pages → Source: “GitHub Actions”).
- **Link check** (`.github/workflows/link-check.yml`): validates internal links and JS syntax on every push.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no dependencies, no API key required for market data.

---
*Unofficial project. Not affiliated with, or endorsed by, Kalshi. Demo environment uses mock funds. Nothing here is investment advice.*
