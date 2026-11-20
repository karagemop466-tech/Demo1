# Coordination Board — Kalshi Demo Dashboard

Shared task board for parallel agent sessions. Each session claims tasks by writing its session ID and file scope, then commits and pushes immediately. Never start a task another session has claimed. Keep scopes non-overlapping: each session works on its own branch/git worktree and edits only files in its claimed scope. If a task requires changing a file owned by another session, log the request here instead of editing it.

Session ID convention: `arena-a443fb8f-demo1` (this session's branch `arena/a443fb8f-demo1`).

## Task conventions
- Status values: `unclaimed`, `in progress`, `done`, `needs review`
- `needs review` means the item is published on the Flagged for Review page and does not block anything.
- A claim older than 60 minutes with no commits may be taken over by another session; note the handoff in the log below.
- Small, frequent commits. Run `git pull --rebase` before every push.
- On merge conflict: stop, resolve without discarding the other session's work, log what happened.
- When a task is finished: record sources, verification performed, and irregularities here; mark it done.
- Never mark anything verified without checking it against an official source; link that source.
- Shared outputs (table data, site index/navigation) are changed only by the final integration session once all other tasks are done.

## Tasks

| # | Task | Status | Session ID | File scope | Sources | Verification | Irregularities |
|---|------|--------|------------|------------|---------|--------------|----------------|
| 1 | Coordination board setup (this file) | done | arena-a443fb8f-demo1 | COORDINATION.md | — | Self-verified | None |
| 2 | Official Kalshi API source research & verification | in progress | arena-a443fb8f-demo1 | docs/sources.md | https://external-api.demo.kalshi.co/trade-api/v2 ; https://demo-api.kalshi.co/trade-api/v2 ; https://docs.kalshi.io | Pending | User-provided endpoints not yet independently confirmed |
| 3 | Landing page + executive summary | unclaimed | arena-a443fb8f-demo1 | index.html | docs/sources.md | Pending | — |
| 4 | Category subpages: gas prices, elections, culture, crypto, golf (event tables w/ source links) | unclaimed | arena-a443fb8f-demo1 | pages/{gas,elections,culture,crypto,golf}.html | docs/sources.md | Pending | Live market data not reachable from sandbox; values left blank + unverified |
| 5 | Live interactive dashboard: price graph (time X, contract price Y, seconds/minutes/hours zoom), liquidity & contract-availability table | unclaimed | arena-a443fb8f-demo1 | pages/dashboard.html + assets/ | docs/sources.md | Pending | — |
| 6 | Portfolio performance tracking (Kalshi demo account) | unclaimed | arena-a443fb8f-demo1 | pages/portfolio.html | docs/sources.md | Pending | Requires API credentials; no credentials stored or hardcoded |
| 7 | Trade execution interface | unclaimed | arena-a443fb8f-demo1 | pages/trades.html | docs/sources.md | Pending | Requires API credentials; execution not possible from this session |
| 8 | Suggestions section (review before implementing) | unclaimed | arena-a443fb8f-demo1 | pages/suggestions.html | — | n/a | — |
| 9 | Questions / information / answers for decision-making | unclaimed | arena-a443fb8f-demo1 | pages/questions.html | docs/sources.md | Pending | — |
| 10 | Flagged for Review page (unverified items + irregularities) | unclaimed | arena-a443fb8f-demo1 | pages/flagged-review.html | — | n/a | — |
| 11 | GitHub Pages: enable, build check, broken-link check, publish | unclaimed | arena-a443fb8f-demo1 | .github/workflows/pages.yml (or Pages settings) | docs.github.com | Pending | — |
| 12 | Final integration: re-verify combined data line by line, PR to main, merge, record PR link & merge result | unclaimed | arena-a443fb8f-demo1 | all | — | Pending | — |

## Claim log

| Date/time (UTC) | Session ID | Task | Action |
|---|---|---|---|
| 2026-11-20 | arena-a443fb8f-demo1 | All tasks (1–12) | Claimed by sole session; created COORDINATION.md |

## Handoff log

None yet.

## Notes

- Sandbox outbound internet is restricted to github.com / npm / pypi hosts; kalshi.co is NOT reachable from this environment. Live Kalshi API data cannot be fetched or empirically verified here. All market values are therefore left blank and flagged `unverified` with source links to the official Kalshi API docs, per the verification requirement ("never infer or fill in values").
- No Kalshi API credentials exist in this repo and none will be added. Trade execution and portfolio reads require authenticated endpoints; the site documents the official endpoints and leaves execution as a credential-gated, flagged item.
