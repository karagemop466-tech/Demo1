# alert-desk — two scrolling chats of Kalshi demo swings ≥ $0.10

A single self-contained page (`index.html`) with **two side-by-side scrolling chats**:

| Chat | Content |
|---|---|
| **Chat 1 · ALL EVENTS** | Every captured contract-price move ≥ **$0.10** in either direction: historical candle/book-mid jumps from committed `../engine/jumps.json`, plus live bubbles from the official demo trades tape. |
| **Chat 2 · MODEL PICKS · HIGH ROI** | The same swings, filtered to markets the model likes by two disclosed rules (below). Selective by design: 8 of 662 committed jumps passed at publish time. |

## Where the data comes from (official sources only)

- Historical jumps: committed [`engine/jumps.json`](../engine/jumps.json), computed by the engine desk from the documented
  [candlestick endpoint](https://docs.kalshi.com/api-reference/market/get-market-candlesticks). Each bubble carries the exact
  API request URL that produced it.
- Live bubbles: the browser polls the official public trades tape
  [`GET /trade-api/v2/markets/trades`](https://docs.kalshi.com/api-reference/market/get-trades) against the demo base
  `https://external-api.demo.kalshi.co/trade-api/v2`, compares each new trade with the market's previously observed trade
  price, and emits a bubble on a ≥ $0.10 change. A `/markets/{ticker}` call fetches the title for live swings; if that call
  fails the title stays blank — never fabricated. Browser→demo-API CORS was verified for the Pages origin in
  [`data/cors.json`](../data/cors.json). When the API is unreachable the page shows a SNAPSHOT badge and the committed data only.
- Topic tags use this repo's published keyword rules (`TOPIC_RULES` in [`tools/collect_kalshi.py`](../tools/collect_kalshi.py));
  a market matching no rule shows a blank topic, never a guess.

## The "model likes as high ROI" filter (Chat 2)

1. **Rule P — model position.** The market appears in the automated sim-desk ledger
   ([`sim-desk/data/ledger.json`](../sim-desk/data/ledger.json), `positions_open`/`trades_settled`). The badge links to
   [sim-desk](../sim-desk/index.html) where the position and strategy are shown.
2. **Rule B — fee-aware band edge.** Side = YES for an up-jump / NO for a down-jump; entry = the post-jump price;
   probability = the resolved YES-frequency of that price band from the engine settlement study over 2,469 resolved demo
   markets ([`engine/strategies.json`](../engine/strategies.json), band sample size `n` shown on the badge); cost = entry +
   taker fee `ceil(M×0.07×C×P×(1−P))` with M = 1 per the
   [official fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf); settlement pays $1 per winning contract per the
   [official settlement page](https://docs.kalshi.com/getting_started/market_settlement). Expected ROI > 0 flags the bubble.

**Disclosures.** Band frequencies are historical counts on demo data, not predictions; the engine's own fee-aware backtest
currently shows negative net ROI overall (−50.36% over its 16 simulated trades — source in `engine/strategies.json`), so
"model likes" is a transparent rule, not a profit claim. A news-search link is a lead, not proof of cause. Demo venue:
mock funds, prices may not reflect real markets ([official demo-env note](https://docs.kalshi.com/getting_started/demo_env)).
No credentials and no orders exist anywhere in this page.

## Files

| File | Purpose |
|---|---|
| `index.html` | The two-chat page (controls: topic chips, direction, price basis, poll interval, pause, clear-live) |
| `app.js` | Feed logic, filter rules, live tape, test surface `window.__alertDesk` |
| `style.css` | Styles (no external dependencies) |
| `test_boot.mjs` | jsdom boot test: offline snapshot path + live-tape path with documented-shaped payloads |

## Test

```
npm install --no-audit --no-fund --silent jsdom
node alert-desk/test_boot.mjs
```

CI runs the same checks in `.github/workflows/alert-desk-check.yml` (paths-filtered to `alert-desk/**` and the workflow file itself; `workflow_dispatch` can be triggered manually). jsdom 31 depends on undici 8, which needs Node ≥ 22 (`node:zstd`), so the workflow pins `node-version: "22"`.
