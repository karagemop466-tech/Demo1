# Deployment — GitHub Pages single-publisher policy

This repository serves a static site from the `main` branch at
<https://karagemop466-tech.github.io/Demo1/>. This file records how the deployment
pipeline works, the failure that was diagnosed on 2026-11-20, and the fix that was
applied. Every claim below is linked to its evidence: verbatim GitHub API responses
for repository facts, and official documentation for policy facts.

## Policy: exactly one publisher

A GitHub Pages site publishes through **one** of two mechanisms — never both:

1. **Built-in builder** ("Deploy from a branch"): GitHub builds the configured
   branch/folder itself and reports results as *pages build and deployment* runs.
2. **Custom GitHub Actions workflow** (Source = "GitHub Actions", REST
   `build_type: "workflow"`): a repository workflow uploads a site artifact with
   `actions/upload-pages-artifact` and deploys it with `actions/deploy-pages` into
   the `github-pages` environment.

Source: GitHub Docs, *Configuring a publishing source for your GitHub Pages site*
(sections "About publishing sources" and "Publishing with a custom GitHub Actions
workflow") —
<https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>.
The REST parameter is documented as `build_type`, values `legacy` and `workflow` —
GitHub Docs, *REST API endpoints for GitHub Pages* —
<https://docs.github.com/en/rest/pages/pages>.

**This repository's single publisher is `.github/workflows/pages.yml`**
("Deploy static site to GitHub Pages"). Its deploy job runs the site's own
verification first (required-file check, JavaScript syntax checks, the verified
dashboard rebuild `build_site.py` with its internal link check, the desk DOM tests,
and the repository link/secrets audit), so a broken tree cannot be published —
matching the brief's "do not merge a broken site" requirement.

## What was wrong (diagnosed 2026-11-20, recorded by session `fab3e340`)

Until 2026-11-20 ~20:15 UTC the repository had **two publishers configured at the
same time**: the built-in builder (Pages source `main:/`) *and* `pages.yml`.
Evidence, recorded verbatim from the GitHub Pages builds API
(`GET /repos/karagemop466-tech/Demo1/pages/builds`) on 2026-11-20:

| Build created (UTC) | Status | Commit | Error message |
|---|---|---|---|
| 19:44:05 | building | `97262eb6` | — |
| 19:42:14 | **errored** | `6aa1ed55` | Page build failed. |
| 19:41:49 | **errored** | `8db5749f` | Page build failed. |
| 19:40:38 | **errored** | `696c9454` | Page build failed. |
| 19:40:10 | **errored** | `971d8191` | Page build failed. |
| 19:37:57 | built | `1cf87c90` | — |
| 19:36:32 | **errored** | `70690b17` | Page build failed. |
| 19:33:07 | built | `b4a7fc4d` | — |

User-visible consequence: the live site served the last **successful** build
(`1cf87c90`, 19:37:57 UTC). Pages merged afterwards were missing from the live
site — `trade-desk/` (PR #60) and `alert-desk/` (PR #59) returned fetch errors
(not deployed) while the landing page kept showing the 11:43:59 UTC snapshot.

## What was changed (task PD-2, session `fab3e340`)

1. **One publisher selected** — Pages `build_type` switched to `workflow` via
   `PUT /repos/karagemop466-tech/Demo1/pages` (documented values `legacy` /
   `workflow`; link above). The built-in branch builder no longer runs, so the
   "Page build failed." builds above cannot recur.
2. **Timed redeploy added** to `pages.yml` (`schedule` cron
   `9,24,39,54 * * * *`). Reason: the three data pipelines
   (`fetch-data.yml`, `kalshi-data.yml`, `engine-refresh.yml`) commit data
   refreshes to `main` with the repository's `GITHUB_TOKEN` every 15 minutes, and
   pushes made with the `GITHUB_TOKEN` do not trigger `push` events for Actions
   workflows. Without the schedule, bot-committed data refreshes would stop
   reaching the live site. The `schedule` event runs on the latest commit of the
   default branch (minimum interval 5 minutes; may be delayed under high Actions
   load) — GitHub Docs, *Events that trigger workflows*, "schedule" section —
   <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>.
3. **Artifact hygiene** — `pages.yml` now removes `node_modules` (installed for
   the desk DOM tests) before `actions/upload-pages-artifact` uploads the site, so
   dev dependencies are not published.

## How to verify a deploy

| Check | Where |
|---|---|
| Latest deploy run | Actions → "Deploy static site to GitHub Pages" (or `gh run list --workflow=pages.yml`) |
| Deployment state | `GET /repos/karagemop466-tech/Demo1/pages` → `status` (`built`) and `build_type` (`workflow`) |
| Live landing | <https://karagemop466-tech.github.io/Demo1/> |
| Live desk pages | `/Demo1/alert-desk/index.html`, `/Demo1/trade-desk/index.html` |

## Limits stated honestly

- Scheduled deploys can be delayed when GitHub Actions is under high load
  (documented in the schedule-event section linked above); a push-triggered merge
  deploy is never delayed by this.
- `concurrency: group: pages, cancel-in-progress: true` means an intermediate
  commit's deploy is cancelled when a newer deploy for the same commit series
  starts — this is the documented pattern; the newest main tip always wins.
- Market data values themselves are demo-venue values (mock funds) collected from
  the official Kalshi demo API; this file is about site deployment only.
