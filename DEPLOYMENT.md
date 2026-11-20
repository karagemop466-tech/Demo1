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

**This repository's publisher is the built-in branch builder** (Pages source
`main:/`, REST `build_type: "legacy"`). The repository's own workflow
`.github/workflows/pages.yml` runs the full site validation suite (required files,
JavaScript syntax, verified-dashboard rebuild with its link check, desk DOM tests,
repository link/secret audit) on pushes to `main` and on pull requests, but it has
**no deploy job and no artifact upload**, so it cannot race or cancel the
deployment. Every merge is validated pre-merge by the pull-request run of the same
workflow — the brief's "do not merge a broken site" is enforced there.

## What was wrong (diagnosed 2026-11-20, recorded by session `fab3e340`)

Until 2026-11-20 ~20:40 UTC the repository had **two publishers configured at the
same time**: the built-in builder (Pages source `main:/`, `build_type: "legacy"`)
*and* a deploy job in `pages.yml` that shared the `pages` concurrency group with
`cancel-in-progress: true`. Verified consequences (all API responses recorded
verbatim during the session):

1. **Same push → both workflows.** Every push to `main` triggered both
   *pages build and deployment* (built-in) and *Deploy static site to GitHub
   Pages* (custom) runs for the same commit (Actions runs list, 19:36–20:13 UTC).
2. **Mutual cancellation.** From 19:47 UTC the two runs for the same commit ended
   `completed/cancelled` in pairs (head SHAs `b1b7ff1`, `8090cd0`, `21e3f86`,
   `23c2e99`, `4c50cb0`, `163acac`, `7153013`), and in the 19:36–19:44 window the
   built-in runs were cancelled by the custom run, which the Pages builds API
   reported as `errored` — "Page build failed." — for commits `70690b1`,
   `971d819`, `696c945`, `8db5749`, `6aa1ed5` (see table below).
3. **User-visible staleness.** The live site froze at the last surviving build
   (`1cf87c90`, 19:37:57 UTC): `trade-desk/` (PR #60) and `alert-desk/` (PR #59)
   were absent (page fetches failed), and the landing page kept showing the
   11:43:59 UTC snapshot.

| Pages build created (UTC) | Pages API status | Commit | Actions run outcome |
|---|---|---|---|
| 19:44:05 | errored | `97262eb6` | built-in run cancelled (`44804889712`) |
| 19:42:14 | errored | `6aa1ed55` | built-in run cancelled (`44804599099`) |
| 19:41:49 | errored | `8db5749f` | built-in run cancelled (`44804538483`) |
| 19:40:38 | errored | `696c9454` | built-in run cancelled (`44804361847`) |
| 19:40:10 | errored | `971d8191` | built-in run cancelled (`44804284303`) |
| 19:37:57 | **built** | `1cf87c90` | built-in run **success** (`44803947194`) |
| 19:36:32 | errored | `70690b17` | built-in run cancelled (`44803732188`) |
| 19:33:07 | built | `b4a7fc4d` | built-in run success |

## What was changed (tasks PD-2/PD-3, session `fab3e340`)

1. **One publisher selected — the built-in builder.** The preferred direction
   (make the custom workflow the sole publisher via REST
   `PUT /repos/karagemop466-tech/Demo1/pages` with `build_type: "workflow"`) was
   attempted at 2026-11-20 20:13 UTC and **denied by GitHub**:
   `{"message":"Resource not accessible by integration","status":403}` — the
   endpoint requires administrator-level "manage GitHub Pages settings"
   permissions (documented on the REST endpoint page linked above). The failure is
   recorded verbatim here rather than left implicit. The achievable
   single-publisher configuration is therefore the reverse one: the deploy job and
   artifact upload were **removed from `pages.yml`** (PR #70 follow-up), leaving
   the built-in builder as the only publisher. This also removes the shared
   `pages` concurrency group from the deploy path, so nothing cancels deployments
   anymore, and bot-committed data refreshes keep deploying immediately (the
   built-in builder triggers on every push, including `GITHUB_TOKEN` pushes).
2. **Validation kept, retargeted.** `pages.yml` (renamed "Pages deploy
   validation") keeps every check and now also runs on pull requests, so a broken
   tree is caught before merge; its concurrency group was renamed to
   `pages-validation` so it can never cancel a deployment.
3. **Artifact hygiene note.** The `node_modules` cleanup step from PR #70 was
   removed together with the artifact upload (nothing is uploaded anymore; the
   desk-test dev dependency stays runner-local).
4. **Repo hygiene** — the stray committed
   `scripts/__pycache__/fetch_demo_data.cpython-311.pyc` (already in
   `.gitignore`) was untracked (PR #70), so running Python no longer dirties the
   working tree.

## How to verify a deploy

| Check | Where |
|---|---|
| Deployment runs | Actions → "pages build and deployment" (built-in publisher) |
| Deployment state | `GET /repos/karagemop466-tech/Demo1/pages` → `status: built`, `source {branch: main, path: /}`, `build_type: legacy` |
| Validation runs | Actions → "Pages deploy validation" (push + PR) |
| Live landing | <https://karagemop466-tech.github.io/Demo1/> |
| Live desk pages | `/Demo1/alert-desk/index.html`, `/Demo1/trade-desk/index.html` |

## Limits stated honestly

- The custom-workflow-as-publisher direction could not be adopted because the
  settings endpoint is admin-gated and the available token is not (verbatim 403
  above). If an administrator later wants the Actions-deployer model, the steps
  are: `PUT /pages` with `build_type: "workflow"`, then restore a deploy job in a
  workflow that owns a unique concurrency group — one publisher, never two.
- The built-in builder deploys on push without a pre-deploy gate (this is its
  documented behavior); the pre-merge gate is the pull-request run of the
  validation workflow plus the repo's other check workflows.
- Market data values themselves are demo-venue values (mock funds) collected from
  the official Kalshi demo API; this file is about site deployment only.
