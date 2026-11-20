# tape-desk — live swing desk (Kalshi demo)

One page that a trader can actually watch: **two scrolling chat feeds** of every contract-price swing
of **≥ $0.10 in either direction** across the five requested topics (gas prices, elections, culture,
crypto, golf), a **fee-aware model-filtered feed** beside them, a **price-over-time chart** with a
seconds/minutes/hours x-axis, an **order-book ladder** showing how many contracts rest at each price,
a **resolution tracker** (YES/NO, reported only at the terminal status), and a **simulated trade
ledger** that books each pick and grades it.

* Open it: <https://karagemop466-tech.github.io/Demo1/tape-desk/>
* It is a static GitHub Pages file. There is no server, no key and no order path: **nothing here
  trades real or demo money** — the ledger is arithmetic on public quotes.
* Demo venue only (mock funds, prices may not reflect real markets):
  <https://docs.kalshi.com/getting_started/demo_env>

## Files

| Path | What it is |
|---|---|
| `index.html` | the desk (chats, chart, ladder, cause panel, board, resolutions, simulated ledger) |
| `core.js` | all rules: swing detection, price bases, band/fee/ROI math, executability, settlement, stats. DOM-free and unit-tested |
| `app.js` | fetch loop + painting only. No arithmetic of its own |
| `style.css` | plain CSS, no framework, no external assets |
| `data/watchlist.json` | the topic-grouped watchlist + model inputs, generated |
| `data/live-check.json` | the snapshot-vs-live verification table, generated |
| `verified.html` | the verification table rendered as a page |
| `consolidation-map.html` | which folder does what, and what the landing page links (generated) |
| `tools/build_watchlist.py` | builds both data files and `verified.html`; refuses to emit a row without an official source URL |
| `tools/build_map.py` | regenerates the consolidation map from the files on disk |
| `test_boot.mjs` | 71 assertions: core rules, build parity, jsdom boot in live and offline modes |

## Where the numbers come from

**Snapshot half** — `data/watchlist.json` is derived from the repository's committed, collector-built
snapshot (`snapshot/markets.json`, `snapshot/resolved.json`, `engine/strategies.json`,
`sim-desk/data/ledger.json`, `engine/jumps.json`). Every market row keeps the API request URL that
produced its values, so a reader can open the same URL.

**Live half** — the page, in the visitor's browser:

| Call | Why it is allowed / documented | Where it shows up |
|---|---|---|
| `GET /exchange/status` | public status; decides LIVE vs SNAPSHOT | status badge, banner |
| `GET /markets/trades?limit=200&min_ts=<s>` | documented tape; `limit` 1–1000, `min_ts`/`max_ts` in **seconds** | both chats (bubbles) |
| `GET /markets/{ticker}` | documented quotes/status/settlement fields | board rows, swing basis `last`, settlement |
| `GET /markets/{ticker}/orderbook` | returns YES bids and NO bids; a NO bid at *x* is a YES ask at $1.00 − *x* | ladder, executability |
| `GET /series/{s}/markets/{t}/candlesticks?...&period_interval=1|60|1440` | the only three intervals the API offers | chart windows 6 h / 3 d / 30 d |
| round-robin, ≤ 7 requests per poll, back-off after 3 failures | unauthenticated market data is documented as needing no key; budgets are published per tier | `#rateNote` |

No sub-minute public candle exists, so the **seconds** windows are built from the points this page
observes itself and are labelled “this session” — the desk never back-fills a finer history than the
API keeps.

**WebSockets are deliberately not used.** The official quick start states the WS connection requires a
signed handshake (`KALSHI-ACCESS-KEY` / `-SIGNATURE` / `-TIMESTAMP`) *even for channels carrying public
market data* (<https://docs.kalshi.com/getting_started/quick_start_websockets>), and this repository
holds no key. A static page therefore cannot open that session, so the desk polls REST and says so in
the “How this desk works” panel instead of pretending to stream.

## The pick rule (Chat 2), in full

A swing earns a pick only when all three published tests pass:

1. **side** — YES after an up-jump, NO after a down-jump, entered at the post-jump price *for that side*
   (a NO contract costs $1.00 − YES price; this is where a sloppy rule invents profit);
2. **sample floor** — the YES price falls in a settlement-study band holding ≥ 20 settled demo markets
   (bands: `engine/strategies.json` → `settlement_study.liquid_only.buckets`, falling back to
   `settlement_study.buckets`); a band this small is refused, not smoothed over;
3. **executability** — the side taken must have a live resting quote with non-zero size, otherwise the
   pick is suppressed as `not executable`.

Expected ROI is `(p_win − (entry + fee)) / (entry + fee)` with the official taker fee
`round up(M × 0.07 × C × P × (1 − P))`, M = C = 1
(<https://kalshi.com/docs/kalshi-fee-schedule.pdf>, implemented and asserted against that schedule's
General Trading Fees table by `engine/test_engine.py`). Payout is $1 per winning contract
(<https://docs.kalshi.com/getting_started/market_settlement>). It is a transparent rule over demo
data, **not** a forecast, and the simulated ledger is allowed to show losses.

## Verification performed by this session

* `node tape-desk/test_boot.mjs` — **71/71 PASS**. Hand-computed fee and ROI spot values, the exact
  $0.10 boundary (inclusive), per-basis isolation, dedupe, off-topic drops, band sample floor,
  executability suppression, settlement (win and loss), stats grouping, **parity**: all 40 published
  model rows re-derived from `core.js` and matched against the Python build, and the jsdom boot cases
  (live path and `SNAPSHOT ONLY` fallback). Two fabrication guards run over the rendered page: no
  `undefined`/`NaN` in the body text, and every bubble must carry an `external-api.demo.kalshi.co` link.
* **Live re-check of the committed snapshot from this sandbox** (the tool used here reaches
  `https://external-api.demo.kalshi.co/trade-api/v2` directly, which earlier sessions could not):
  `/exchange/status` → `exchange_active: true, trading_active: true`, four demo shards;
  `/markets/trades` → 200 unauthenticated, newest trade stamped `2026-11-20T19:46:42Z`;
  10 markets re-fetched (5 topic heads by 24 h traded notional + 5 highest-payout settled markets, one
  per topic): **56 of 104 fields identical to the committed snapshot, 33 differ because the market moved,
  15 are snapshot-blank (fields the collector never stored, e.g. `exchange_index`)**. Full table, with
  the request URL and fetch time of every value: `verified.html` / `data/live-check.json`.
  Verified while it was true: gas `KXAAAGASW-26NOV23-3.6200` last $0.97 (snapshot $0.89);
  `KXRT-HUN-72` quoted $0.00/$1.00 with **0 contracts** on both sides while its last print stayed $0.03;
  `KXBTCY-27JAN0100-T149999.99` likewise had an empty book; candlesticks for the gas market returned a
  non-empty 1-minute series at 19:52Z.
* Repository gates re-run after the change (see `COORDINATION.md`, T-5 record).

## Limits and flagged items (none of them blocked by this desk)

1. **43 watchlist rows carry no live re-fetch from this session** — snapshot values only, listed on the
   verification page. No value was inferred to fill them.
2. **`result` is not “resolved”.** Official lifecycle: `result` appears at `determined`, can be
   challenged at `disputed`, and payout happens at `finalized`. This desk prints YES/NO only at
   `finalized`, and it verified a live market sitting at `disputed` **with `result: yes` and a
   $1.00 settlement value** — i.e. exactly the case where a `result != null` check is wrong.
   Cross-session request (logged on the board, not applied here): any page that treats a non-empty
   `result` as final should re-check it against `status`.
3. **A last print is not a fillable price.** Two of the five topic-head markets had an empty book
   ($0.00/$1.00, zero size) while still printing a last price. Any “mark to last price” figure in this
   repository — including this desk's unrealised column — is a mark, not an executable quote; that is
   why picks require the executability test.
4. **`/exchange/status` has no dedicated REST reference page** in the docs index; it is used because the
   committed collector and CI already call it successfully. Reported as “used, not formally documented
   here”, not asserted as documented.
5. **Model picks are rare by construction** (sample floor + executability). An empty Chat 2 is the
   honest state of this rule on this dataset; it is not a bug and is not padded.
6. **Demo venue, mock funds, tiny settled samples.** The one band with a large sample
   ($0.00–$0.09, 380 settled markets) is where positive expected ROI lives, which is the classic
   longshot shape of a small demo exchange — published here so nobody has to rediscover it.

## Refreshing it

```bash
python3 tape-desk/tools/build_watchlist.py   # dataset + verified.html (deterministic; CI checks it)
python3 tape-desk/tools/build_map.py         # consolidation map (repo-dependent, not a CI diff gate)
node tape-desk/test_boot.mjs                 # 71 assertions
```

The live half needs no refresh: it is whatever the demo API answers while the page is open.
