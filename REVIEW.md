# REVIEW.md — repository review (line-by-line), 2026-11-20

Session `arena-6aa291e9-demo1`. Mirrored at
[docs/pages/repo-review.html](https://karagemop466-tech.github.io/Demo1/docs/pages/repo-review.html).
Flagged items referenced below (F1–F14) are published with sources at
[docs/pages/flagged.html](https://karagemop466-tech.github.io/Demo1/docs/pages/flagged.html).

## 1. Timeline of repo state (verified from git history)

| Commit | Event |
|---|---|
| `4a225ce` | Initial commit — 7-byte stub README only (verified by `ls`/`cat` at session start) |
| PR #1/#2 (`arena/e41f6700-demo1`) | Root single-page monitor: `index.html`, `styles.css`, `app.js`, `.github/workflows/pages.yml`, README; Pages deployed |
| PR #4/#6 (`arena-a443fb8f-demo1`) | Root multipage site: `pages/*.html`, `assets/css/style.css`, `docs/sources.md`; conflict-resolved merge `3a097e0` |
| This branch | Data pipeline, demo trader, `docs/` data hub, verification/review docs; two COORDINATION.md merge conflicts resolved without discarding others' work |

## 2. Findings by file

### Root `index.html` / `app.js` / `styles.css` (owner: e41f6700)
- ✅ Clean structure, escaping correct, honest blank-state messaging, official docs linked throughout.
- ⚠️ **F9:** `app.js` requests `/markets?status=open&limit=1000`; the documented list page size max is 200
  ([Get Events reference](https://docs.kalshi.com/api-reference/events/get-events.md) — markets list page was
  un-fetchable by its owner session and remains linked-only there). Our pipeline paginates at 200.
- ⚠️ **F10:** `cleanURL()` builds `https://kalshi.com/markets/<event_ticker>` — Kalshi market pages use
  series/event slugs, so these may 404. This site links official API URLs instead.
- ⚠️ Topic keywords include "crude oil"/"natural gas" → can match non-gas energy markets (heuristic;
  owner acknowledged). Our pipeline uses the verified category taxonomy instead.
- Per protocol these files were **not edited** (owned by another session); requests logged in COORDINATION.md.

### `pages/*.html` + `assets/css/style.css` (owner: a443fb8f)
- ✅ Category tables ship **blank with source links** (complies with the no-inference rule);
  dashboard's simulated data is explicitly labeled; portfolio/trades pages document official endpoints.
- ⚠️ No real data existed at review time (their sandbox could not reach kalshi.co). This session's
  verified live data + CI pipeline closes that gap; a cross-file request to adopt `docs/data/*.json`
  was logged rather than editing their files.

### `.github/workflows/pages.yml` (owner: e41f6700)
- ✅ Valid; guards (`node --check`, required files). ⚠️ **F12:** redundant with legacy branch publishing
  (Pages API shows build_type=legacy, source=main:/). ⚠️ **F13:** upstream Node 20 deprecation annotations.

### `README.md` (owner: e41f6700, extended by integration)
- ✅ Claims match code (30 s refresh loop present in `app.js`; limitations disclosed, including which
  doc pages were not fetched). Integration adds a "Data hub & pipeline" section.

### This session's files (self-review)
- `scripts/fetch_kalshi_data.py` — stdlib-only; cursor pagination at documented 200; 0.25 s throttle +
  429 backoff; every JSON written carries provenance (base URL, endpoints, methodology); history capped;
  last-good snapshot retained if a run fails early. AST-parsed clean.
- `scripts/demo_trader.py` — refuses to act without demo credentials and `KALSHI_ALLOW_TRADING=1`;
  order body matches verified Create Order V2 schema exactly; cancellation uses verified path with
  market_ticker auto-routing; balance fields read per verified Get Balance schema.
- `.github/workflows/kalshi-data.yml` — artifact on every run; data-only commits on main;
  loop protection via `paths-ignore` + `[skip ci]`; JSON validation step.
- `docs/**` — static, relative paths (works under the `/Demo1` subpath), `.nojekyll` added so JSON is
  served raw; all tables source-linked; blanks preserved.

## 3. Checks performed

- `python3 -m py_compile` / AST parse: pass (both scripts).
- `node --check` on hub JS: pass.
- JSON validity: all `docs/data/*.json` pass.
- Link audit: all internal links relative + depth-correct; all external links https.
- Verification discipline: every data row on site pages carries an official source link;
  unconfirmed values blank + flagged (F-register).

## 4. Irregularities summary (full register with sources on the Flagged page)

F1 CORS unverified · F2 USD metric derived · F3 thin demo books · F4 no credentials ·
F5 WS handshake auth required · F6 event.category deprecated · F7 seed snapshot partial ·
F8 unauthenticated rate limits unpublished · F9 limit=1000 vs 200 · F10 kalshi.com link format ·
F11 parallel merge conflicts (resolved) · F12 dual Pages mechanisms · F13 Node deprecation ·
F14 sandbox egress restriction.
