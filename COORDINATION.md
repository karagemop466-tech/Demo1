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
* Consequence: no sandbox script can refresh `data/*.json`. `tools/refresh_snapshot.py` and
  `tools/kalshi_sign.py` are in the repo and their **failure paths are what has been exercised here**
  (`--check` and `--dry-run` both exit with a clean "demo host unreachable" message and write nothing).
  `tools/kalshi_sign.py --self-test` passes with no network: its built-in Ed25519 reproduces RFC 8032
  TEST 1 and TEST 2 byte-for-byte. `tools/check_links.py` runs fully offline and is the pre-commit gate.
* jsdom (`npm i --no-save jsdom`, node_modules is git-ignored) lets the pages actually be booted here:
  `node --test tests/browser_boot.test.mjs` loads every page in a DOM with the real snapshot and fails
  on any script error, empty mount or row-less table. It found two real defects (a nested-array child
  in `el()` and a missing `renderStrategies`), both fixed. `node --test` does not accept a directory
  here — pass file paths.

## Tasks

| # | Task | Status | Owner | Scope (files) | Notes |
| - | ---- | ------ | ----- | ------------- | ----- |
| 1 | Coordination board + repo audit | done | s-8344abc8 | `COORDINATION.md`, `README.md`, `.nojekyll`, `.gitignore` | Base commit had only `README.md` ("# Demo1"); Pages is a legacy Jekyll build from `main` at `/`, so `.nojekyll` is required |
| 2 | Verified Kalshi API reference (REST + WS, hosts, params, rate limits) | done | s-8344abc8 | `api-reference.html` | 13 endpoints + WS channels + limits; each row marked exercised / documented-only / unverified against this session |
| 3 | Live market-data collection (5 topics, dollar-volume ranking, resolutions) | done | s-8344abc8 | `data/snapshot.json`, `tools/refresh_snapshot.py`, `assets/kalshi.js`, `tests/kalshi.test.mjs` | 27 logged requests, 8 events / 20 markets / 17 series rows, 16 one-minute candles; every row carries its source URL |
| 4 | Dashboard: highest-dollar-volume events, topic filter, resolution tracking | done | s-8344abc8 | `dashboard.html`, `assets/app.js`, `assets/app.css` | Ranking is client-side (no sort param); snapshot/scan/stream modes; resolution tracking is market-level |
| 5 | Price + liquidity view (candlesticks, depth ladder, time axis) | done | s-8344abc8 | `markets.html`, `assets/kalshi.js` (`ladder`/`walkBook`/`resample`) | Granularity floor is 1 min — "seconds" is labelled 60-s buckets, see IR-4; bid-only ladder with the NO-bid→YES-ask conversion printed |
| 6 | Portfolio + trade tracking + strategy categorisation | done (design + replay), trades blocked on IR-9 | s-8344abc8 | `portfolio.html`, `strategies.html`, `assets/kalshi.js` (`categorizeTrade`/`replaySim`) | No fabricated balances: the account table is 10 rows of endpoint specs; `replaySim` runs the captured candles |
| 7 | Executive summary | done | s-8344abc8 | `exec-summary.html` | Written after 3–6; every figure re-derived from `data/snapshot.json` in the same commit |
| 8 | Suggestions register | done | s-8344abc8 | `suggestions.html`, `assets/app.js` (`SUGGESTIONS`) | S-1…S-10 with approve/defer/reject + note, persisted in localStorage, JSON export |
| 9 | Open questions / missing-information register | done | s-8344abc8 | `questions.html` | 9 answered from sources, 12 open with owner + discovery action |
| 10 | Flagged-for-review page | done | s-8344abc8 | `flagged.html` | FL-1…FL-12, each with evidence link and "what clears this"; blanks table for every deliberate null |
| 11 | Site shell: landing page, nav, styles, GitHub Pages build | done | s-8344abc8 | `index.html`, `assets/app.css`, `assets/app.js`, `.nojekyll` | 12-page IA in `NAV`; no build step, no CDN, no fonts, no images |
| 12 | Final integration: merge, re-verify, link check, publish, PR → main | in progress | s-8344abc8 | all | `check_links.py` + `node --test tests/*.test.mjs` are the gate; see Handoff Log |

## Change Request Log

| Date (UTC) | From | To | Request | Resolution |
| ---------- | ---- | -- | ------- | ---------- |
| 2026-11-20 | s-8344abc8 | user | Demo API key + private key (or a proxy that holds them) — this is the only blocker for real portfolio reads and order placement | open → `questions.html#q-1`, `#q-2`; `tools/kalshi_sign.py` is ready and needs no code change |
| 2026-11-20 | s-8344abc8 | any session | Do not add a second data source or a parallel snapshot schema; `enrichSnapshot`/`mergeEvents` exist so new captures extend `data/snapshot.json` under `schema_version` | open — convention, not a blocker |
| 2026-11-20 | s-8344abc8 | user | Three product definitions are needed before any strategy is built: exact-vs-proxy dollar volume, whether 1-minute granularity is acceptable, and the staleness budget | open → `questions.html#q-4`, `#q-5`, `#q-10` |

## Handoff Log

| Date (UTC) | Task | From session | To session | Reason |
| ---------- | ---- | ------------ | ---------- | ------ |
| 2026-11-20 | 1–12 | s-8344abc8 | s-8344abc8 (integration) | Single-session build: no claim was ever stale, so no takeover occurred. Tasks 2–11 were closed and then re-verified in the integration pass; the board was updated in one commit rather than per task, which is a deviation from rule 1 (small frequent commits) worth knowing about when reading history |
| 2026-11-20 | 12 | s-8344abc8 | next session | Handoff state: pages are complete and boot-tested, but the site has **never been loaded from a real browser**, `flagged.html#fl-2` (CORS) is one click from resolution, and the trade-execution half of task 6 is deliberately unimplemented pending `q-1` |

## Conflict Log

| Date (UTC) | Files | Description | Resolution |
| ---------- | ----- | ----------- | ---------- |
| — | — | No merge conflicts and no rebase conflicts to date. `arena/8344abc8-demo1` is linear on top of `main` @ `4a225ce`; `git pull --rebase` before push is a no-op while this is the only branch writing files | n/a |
| 2026-11-20 | `assets/app.js`, `assets/app.css`, `index.html`, `exec-summary.html` | Latent contention: tasks 4/5/8/9 all needed `assets/app.js` (one shell, one `NAV`, one `dataTable`), which the original per-file scopes did not anticipate. Resolved by treating `assets/*` as integration-owned and having every page carry only its own `.html` | future sessions: touch `assets/app.js` only as the integration session, or land a change-request first |

## Verification Log (append-only)

| Date (UTC) | Session | Task | Claim verified | Official source |
| ---------- | ------- | ---- | -------------- | --------------- |
| 2026-11-20 | s-8344abc8 | 1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` and demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` match the request | https://docs.kalshi.com/getting_started/demo_env |
| 2026-11-20 | s-8344abc8 | 1 | `GET /exchange/status` live: `exchange_active:true`, `trading_active:true`, shards "Demo shard 1/2" | https://external-api.demo.kalshi.co/trade-api/v2/exchange/status |
| 2026-11-20 | s-8344abc8 | 1 | `GET /series` accepts `category`,`tags`,`include_volume`,`min_updated_ts` — **no `limit`/`cursor`**; live call with `limit=5` returned the whole category | https://docs.kalshi.com/api-reference/market/get-series-list.md |
| 2026-11-20 | s-8344abc8 | 1 | `GET /events` limit max 200; filters `status`,`series_ticker`,`tickers`,`min_close_ts`,`min_updated_ts`; **no sort parameter**, so dollar-volume ranking must be computed client-side | https://docs.kalshi.com/api-reference/events/get-events.md |
| 2026-11-20 | s-8344abc8 | 1 | `GET /series/{series}/markets/{ticker}/candlesticks` `period_interval` ∈ {1, 60, 1440} minutes, ≤5000 periods/request, `start_ts`/`end_ts` in **seconds** | https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md |
| 2026-11-20 | s-8344abc8 | 1 | Market payload volume fields are contract counts (`volume_fp`, `volume_24h_fp`, `open_interest_fp`); no dollar-volume field in the demo response | https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=2&status=open |

| 2026-11-20 | s-8344abc8 | 3 | `GET /markets/{t}/orderbook` returns **200 with empty arrays** for an unknown ticker, never 404; `yes_dollars`/`no_dollars` are bids only, ascending, best last | https://docs.kalshi.com/getting_started/orderbook_responses |
| 2026-11-20 | s-8344abc8 | 3 | `/series?category=Culture&include_volume=true` → exactly two series, both `volume_fp 0.00` | https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture&include_volume=true |
| 2026-11-20 | s-8344abc8 | 3 | `/events?series_ticker=KXPGATOP40&status=open` → `{"events":[]}` while the settled query returns rows (capture-time state, not an error) | https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXPGATOP40&limit=3&status=open |
| 2026-11-20 | s-8344abc8 | 6 | Taker/maker fee model reproduces all 21 rows of the published General Trading Fees table (100 @ $0.50 = $1.75); asserted in `tests/kalshi.test.mjs` | https://kalshi.com/docs/kalshi-fee-schedule.pdf |
| 2026-11-20 | s-8344abc8 | 11 | Every docs link used by the site is a real page: all 49 `docs.kalshi.com` URLs were matched against the official index by hand this session, and the bare (non-`.md`) form is confirmed to render. `tools/check_links.py` repeats the check mechanically when given a saved index: `--llms <file>` or `--online` | https://docs.kalshi.com/llms.txt |
| 2026-11-20 | s-8344abc8 | 12 | 48 tests pass: `node --test tests/kalshi.test.mjs tests/browser_boot.test.mjs`; `python3 tools/check_links.py` exits 0 (107 internal links, 13 mount checks, 45 snapshot rows sourced) | this repo |

## Irregularities Flagged

See `flagged.html` (task 10) — mirrored here so other sessions can see them without opening the site.

| ID | Item | Severity |
| --- | ---- | -------- |
| IR-1 | Sandbox has no direct network egress to any Kalshi host (TLS exit 35); all live data in this repo came from the agent's fetch tool, so no sandbox-side automated test of the API client is possible | medium |
| IR-2 | Browser↔API CORS behaviour of the demo hosts could not be verified from the sandbox; dashboard live mode must degrade to the bundled snapshot | medium |
| IR-3 | `GET /series?category=Crypto&limit=5` silently ignores `limit` and returns the full category listing — pagination docs only cover cursor-based endpoints | low |
| IR-4 | No Kalshi demo API key was supplied, so no orders were or can be placed; portfolio pages are a documented, credential-ready design | high |
| IR-5 | No open golf *outright* series in demo: `KXPGATOP40&status=open` returned `{"events":[]}` while its settled query returned rows, and there is no Masters-style outright series to replace it, so the golf column is Ryder Cup + settled Open legs only | medium |
| IR-6 | Culture is effectively absent from demo (2 series, both zero volume), so a "culture" ranking cannot be produced honestly — the page says so instead of substituting another category | high |
| IR-7 | `GET /markets/{t}/orderbook` is empty for any market past `close_time`, and empty (not 404) for an unknown ticker; the captured depth is therefore "no resting orders", and depth-based features need an open-market capture window | medium |
| IR-8 | `GET /trades` could not be retrieved in this environment with either `ticker=` or `market_tickers=`, so exact turnover is unimplemented and no tape claim is made anywhere | medium |
| IR-9 | Sub-minute data is structurally unavailable in REST (`period_interval` ∈ {1,60,1440}); the seconds view is a labelled 60-second resample, and real seconds require the authenticated `cfbenchmarks_value_5hz` channel | medium |
| IR-10 | The fee schedule PDF's non-standard-fee table extracts with interleaved columns, so only the formula, maker coefficient, "no settlement fee" line and `KXAAAGASM` 1/1 multipliers are quoted; other series' multipliers are left off the site rather than guessed | low |
| IR-11 | Event status is coarser than market status: `status=open` events contained finalized legs, and reads are cached for seconds, so settlement tracking must key on `result` per market and display `updated_time` | medium |
| IR-12 | Base commit shipped no `.nojekyll`, no README content and a legacy Jekyll Pages build; `.nojekyll` + a real README + `.gitignore` (node_modules) are added in the integration commit | low |
