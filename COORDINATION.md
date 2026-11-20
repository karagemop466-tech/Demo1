# COORDINATION.md — Shared Task Board

Cross-session coordination file for `karagemop466-tech/Demo1` (Kalshi demo project).
Read this **before** touching any file. Claim work by editing your row, then commit + push
the claim immediately. Never edit files inside another session's claimed scope; log a
request in the Change Request Log instead.

## Rules (agreed baseline)

1. Branch per task: `session-<id>/<task>`. Small, frequent commits.
2. `git pull --rebase` before every push. On conflict: stop, keep the other session's work, log it.
3. A claim older than 60 minutes with no commits may be taken over; record the handoff in the Handoff Log.
4. Never mark a row `done` without listing the official source URL(s) used to verify it.
5. Shared outputs (`index.html`, `assets/nav.js`, `data/*.json`) are touched only by the
   final integration session once all other tasks are `done`.
6. `needs review` = item is published on the *Flagged for Review* page; it does not block other work.

## Session registry

| Session ID  | Branch                      | Base commit | First seen (UTC)     | Notes                                                        |
| ----------- | --------------------------- | ----------- | -------------------- | ------------------------------------------------------------ |
| s-8344abc8  | arena/8344abc8-demo1        | 4a225ce     | 2026-11-20 ~11:15    | Arena agent; sandbox has **no direct egress** to kalshi hosts |
|             |                             |             |                      |                                                              |

## Environment finding that constrains every task

* `curl` from the agent sandbox to `external-api.demo.kalshi.co`, `demo-api.kalshi.co` and
  `api.elections.kalshi.com` all fail with TLS exit 35 — only `github.com`, `registry.npmjs.org`,
  `pypi.org`, `files.pythonhosted.org` are reachable. **API data must therefore be captured with
  the agent's `fetch_page` tool** (which reached the demo API successfully and returned live JSON),
  not with `curl`/`requests` from the sandbox.
* Consequence: no sandbox script can refresh `data/*.json`. `tools/refresh_snapshot.py` exists for
  the user's own machine and is documented as *untested from the sandbox*.

## Tasks

| # | Task | Status | Owner | Scope (files) | Notes |
| - | ---- | ------ | ----- | ------------- | ----- |
| 1 | Coordination board + repo audit | in progress | s-8344abc8 | `COORDINATION.md`, `README.md` | Repo contained only `README.md` ("# Demo1") at base commit |
| 2 | Verified Kalshi API reference (REST + WS, demo/prod hosts, params, rate limits) | unclaimed | | `api-reference.html`, `docs/api-*.md` | Every row needs a docs.kalshi.com link |
| 3 | Live market-data collection (5 topics, dollar-volume ranking, resolutions) | unclaimed | | `data/*.json`, `tools/refresh_snapshot.py` | Data captured via fetch_page; record capture timestamps |
| 4 | Dashboard: highest-dollar-volume events, category filter, resolution tracking | unclaimed | | `dashboard.html`, `assets/dashboard.js` | Consumes `data/`; live-refresh when browser can reach API |
| 5 | Price + liquidity view (candlesticks, order-book depth, time axis) | unclaimed | | `liquidity.html`, `assets/charts.js` | Candlesticks support 1/60/1440-min periods only — seconds needs WebSocket |
| 6 | Portfolio + trade tracking + strategy categorisation | unclaimed | | `portfolio.html`, `assets/portfolio.js` | Blocked on user for demo API credentials |
| 7 | Executive summary | unclaimed | | `exec-summary.html` | Write last, after 3–6 |
| 8 | Suggestions register | unclaimed | | `suggestions.html` | Reviewer can mark accept/defer per suggestion |
| 9 | Open questions / missing-information register | unclaimed | | `questions.html` | Known-knowns + known-unknowns, each with owner |
| 10 | Flagged-for-review page (unverified rows, irregularities) | unclaimed | | `flagged.html` | |
| 11 | Site shell: landing page, nav, styles, GitHub Pages build | unclaimed | | `index.html`, `assets/styles.css`, `assets/nav.js`, `.nojekyll` | Integration session only |
| 12 | Final integration: merge, re-verify, link check, publish, PR → main | unclaimed | | all | Runs last |

## Change Request Log

| Date (UTC) | From | To | Request | Resolution |
| ---------- | ---- | -- | ------- | ---------- |
| — | | | | |

## Handoff Log

| Date (UTC) | Task | From session | To session | Reason |
| ---------- | ---- | ------------ | ---------- | ------ |
| — | | | | |

## Conflict Log

| Date (UTC) | Files | Description | Resolution |
| ---------- | ----- | ----------- | ---------- |
| — | | | | |

## Verification Log (append-only)

| Date (UTC) | Session | Task | Claim verified | Official source |
| ---------- | ------- | ---- | -------------- | --------------- |
| 2026-11-20 | s-8344abc8 | 1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` and demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` match the request | https://docs.kalshi.com/getting_started/demo_env |
| 2026-11-20 | s-8344abc8 | 1 | `GET /exchange/status` live: `exchange_active:true`, `trading_active:true`, shards "Demo shard 1/2" | https://external-api.demo.kalshi.co/trade-api/v2/exchange/status |
| 2026-11-20 | s-8344abc8 | 1 | `GET /series` accepts `category`,`tags`,`include_volume`,`min_updated_ts` — **no `limit`/`cursor`**; live call with `limit=5` returned the whole category | https://docs.kalshi.com/api-reference/market/get-series-list.md |
| 2026-11-20 | s-8344abc8 | 1 | `GET /events` limit max 200; filters `status`,`series_ticker`,`tickers`,`min_close_ts`,`min_updated_ts`; **no sort parameter**, so dollar-volume ranking must be computed client-side | https://docs.kalshi.com/api-reference/events/get-events.md |
| 2026-11-20 | s-8344abc8 | 1 | `GET /series/{series}/markets/{ticker}/candlesticks` `period_interval` ∈ {1, 60, 1440} minutes, ≤5000 periods/request, `start_ts`/`end_ts` in **seconds** | https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md |
| 2026-11-20 | s-8344abc8 | 1 | Market payload volume fields are contract counts (`volume_fp`, `volume_24h_fp`, `open_interest_fp`); no dollar-volume field in the demo response | https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=2&status=open |

## Irregularities Flagged

See `flagged.html` (task 10) — mirrored here so other sessions can see them without opening the site.

| ID | Item | Severity |
| --- | ---- | -------- |
| IR-1 | Sandbox has no direct network egress to any Kalshi host (TLS exit 35); all live data in this repo came from the agent's fetch tool, so no sandbox-side automated test of the API client is possible | medium |
| IR-2 | Browser↔API CORS behaviour of the demo hosts could not be verified from the sandbox; dashboard live mode must degrade to the bundled snapshot | medium |
| IR-3 | `GET /series?category=Crypto&limit=5` silently ignores `limit` and returns the full category listing — pagination docs only cover cursor-based endpoints | low |
| IR-4 | No Kalshi demo API key was supplied, so no orders were or can be placed; portfolio pages are a documented, credential-ready design | high |
