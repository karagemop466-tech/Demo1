#!/usr/bin/env node
/**
 * ops-desk tests (session 54a39029).
 *
 * 1. health.json schema assertions (every record carries its API URL; nothing inferred).
 * 2. jsdom boot test: the page renders committed evidence (KPIs, workflow table,
 *    data-freshness table, flags).
 * 3. Live re-check happy path: stubbed official-API fetch fills the live table.
 * 4. Live re-check failure path: fetch failure degrades to the committed-evidence banner.
 *
 * Run:  node ops-desk/test_ops_desk.mjs   (requires jsdom; npm install)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const health = JSON.parse(fs.readFileSync(path.join(HERE, "data", "health.json"), "utf8"));

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name + ": " + e.message); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("1. health.json schema");
ok("required top-level keys", () => {
  for (const k of ["schema", "generated_at_utc", "repo", "workflows",
    "workflow_files_declared_triggers", "repo_sample", "data_paths", "irregularities", "docs", "method"]) {
    assert.ok(health[k] !== undefined, "missing key: " + k);
  }
});
ok("workflows carry id/name/path/state and a runs API URL", () => {
  assert.ok(health.workflows.length >= 10, "expected >= 10 workflows, got " + health.workflows.length);
  for (const w of health.workflows) {
    for (const k of ["id", "name", "path", "state"]) assert.ok(w[k] != null, "workflow missing " + k);
    assert.ok(w.runs_api_url && w.runs_api_url.startsWith("https://api.github.com/"),
      "workflow " + w.path + " missing runs_api_url");
  }
});
ok("OPS-01 cross-check is internally consistent and verdict matches the evidence", () => {
  const ev = health.irregularities["OPS-01"].evidence;
  assert.ok(ev.board_claim.matches.length >= 1, "board claim match missing");
  const ships = ev.shipped_triggers.crons.length > 0;
  if (ships) {
    assert.ok(/RESOLVED/.test(ev.verdict), "ships schedule but verdict not RESOLVED: " + ev.verdict);
  } else {
    assert.ok(/MISMATCH/.test(ev.verdict), "no shipped schedule but verdict not MISMATCH: " + ev.verdict);
    assert.equal(ev.shipped_triggers.triggers.includes("schedule"), false);
  }
  assert.ok(ev.git_history.commits_examined >= 1, "git history not examined");
});
ok("repo sample: schedule observed count matches event histogram; expectation arithmetic consistent", () => {
  const rs = health.repo_sample;
  assert.equal(rs.schedule_runs_observed.length, rs.by_event.schedule || 0);
  assert.ok(rs.count >= 100, "repo sample too small");
  const exp = rs.expected_schedule_starts_in_window_computed;
  const sum = Object.values(exp).reduce((a, b) => a + b, 0);
  // arithmetic bound: each */N cron can start at most window/step + 1 times in the window
  const crons = Object.entries(health.workflow_files_declared_triggers)
    .filter(([, t]) => t.crons.length)
    .flatMap(([, t]) => t.crons);
  const bound = crons.reduce((acc, c) => {
    const m = c.match(/^\*\/(\d+)\s+\*/);
    return acc + (m ? Math.floor(rs.window.minutes / parseInt(m[1], 10)) + 1 : 0);
  }, 0);
  assert.ok(sum <= bound, "computed expectation exceeds arithmetic bound: " + sum + " > " + bound);
  assert.ok(sum >= crons.length, "computed expectation implausibly low: " + sum);
});
ok("every data path record carries its API URL; no inferred values", () => {
  for (const d of health.data_paths) {
    assert.ok(d.api_url && d.api_url.startsWith("https://api.github.com/"), d.path + " missing api_url");
    if (d.last_commit) {
      assert.ok(d.last_commit.sha && d.last_commit.date && d.last_commit.html_url, d.path + " partial commit record");
    } else {
      assert.ok(d.note || d.error, d.path + " has no commit and no note — values must not be invented");
    }
  }
});
ok("declared crons present for the four data pipelines", () => {
  const crons = (f) => health.workflow_files_declared_triggers[".github/workflows/" + f].crons;
  assert.deepEqual(crons("desk.yml"), ["*/30 * * * *"]);
  assert.deepEqual(crons("fetch-data.yml"), ["*/15 * * * *"]);
  assert.deepEqual(crons("kalshi-data.yml"), ["*/15 * * * *"]);
  assert.deepEqual(crons("engine-refresh.yml"), ["*/15 * * * *"]);
});
ok("pages deploy record present with API source (OPS-03 evidence)", () => {
  const pd = health.pages_deploys;
  assert.ok(pd && pd.api_url && pd.api_url.includes("/actions/workflows/pages.yml/runs"), "pages_deploys missing api_url");
  assert.ok(Array.isArray(pd.recent) && pd.recent.length >= 1, "recent pages runs missing");
  for (const r of pd.recent) assert.ok(r.html_url && r.created_at, "pages run record incomplete");
});

/* ---------- jsdom boot ---------- */
const html = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const healthText = fs.readFileSync(path.join(HERE, "data", "health.json"), "utf8");

function makeDom({ stubFetch } = {}) {
  const dom = new JSDOM(html, {
    url: "https://karagemop466-tech.github.io/Demo1/ops-desk/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = stubFetch
        ? stubFetch.bind(window)
        : async () => { throw new Error("network disabled in test"); };
    },
  });
  return dom;
}
const jsonResp = (data, headers = {}) => Promise.resolve({
  ok: true, status: 200,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => data,
});

async function waitFor(fn, what, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return; } catch { /* keep waiting */ }
    await sleep(25);
  }
  throw new Error("timeout waiting for " + what);
}

console.log("2. jsdom boot from committed evidence");
const dom = makeDom({
  stubFetch(url) {
    if (String(url).endsWith("data/health.json")) return jsonResp(JSON.parse(healthText));
    throw new Error("unexpected fetch in boot test: " + url);
  },
});
const { window } = dom;
await waitFor(() => window.document.querySelectorAll("#kpis .kpi").length === 4, "4 KPI cards");
okAsync("KPI cards render (4)", async () => {
  assert.equal(window.document.querySelectorAll("#kpis .kpi").length, 4);
});
await waitFor(() => window.document.querySelectorAll("#wfBody tr").length === health.workflows.length, "workflow rows");
okAsync("workflow table rows == workflows in evidence", async () => {
  assert.equal(window.document.querySelectorAll("#wfBody tr").length, health.workflows.length);
  assert.ok(window.document.querySelectorAll("#wfBody a[href*='api.github.com']").length >= health.workflows.length,
    "each workflow row needs an API source link");
});
okAsync("data freshness table rows == monitored paths", async () => {
  assert.equal(window.document.querySelectorAll("#dataBody tr").length, health.data_paths.length);
});
okAsync("flags render OPS-01, OPS-02 and OPS-03 with board/evidence links", async () => {
  const flags = window.document.getElementById("flags").textContent;
  assert.ok(flags.includes("OPS-01") && flags.includes("OPS-02") && flags.includes("OPS-03"), "flag IDs missing");
  assert.ok(window.document.querySelector("#flags a[href*='COORDINATION.md']"), "board link missing");
  assert.ok(window.document.querySelector("#flags a[href*='/actions/runs/']"), "ops run-page evidence link missing");
});
okAsync("sim-strategies row shows zero schedule runs in sample", async () => {
  const row = [...window.document.querySelectorAll("#wfBody tr")]
    .find((r) => r.textContent.includes("sim-desk strategy runner"));
  assert.ok(row, "sim-desk row missing");
  assert.ok(row.textContent.includes("0 in sample"), "schedule cell should read 0 in sample");
});

console.log("3. live re-check — happy path");
const runsCanned = {
  workflow_runs: [
    { id: 1, event: "push", conclusion: "success", created_at: "2026-11-20T19:30:00Z", html_url: "https://github.com/karagemop466-tech/Demo1/actions/runs/1" },
    { id: 2, event: "schedule", conclusion: "success", created_at: "2026-11-20T19:11:55Z", html_url: "https://github.com/karagemop466-tech/Demo1/actions/runs/2" },
    { id: 3, event: "push", conclusion: "failure", created_at: "2026-11-20T19:05:00Z", html_url: "https://github.com/karagemop466-tech/Demo1/actions/runs/3" },
  ],
};
const commitsCanned = {
  0: { sha: "a".repeat(40), commit: { committer: { date: "2026-11-20T19:12:50Z" }, message: "chore(data): refresh snapshot" }, html_url: "https://github.com/karagemop466-tech/Demo1/commit/" + "a".repeat(40) },
  1: { sha: "b".repeat(40), commit: { committer: { date: "2026-11-20T13:40:48Z" }, message: "sim-desk: run strategies" }, html_url: "https://github.com/karagemop466-tech/Demo1/commit/" + "b".repeat(40) },
  2: { sha: "c".repeat(40), commit: { committer: { date: "2026-11-20T13:29:50Z" }, message: "engine: regenerate outputs" }, html_url: "https://github.com/karagemop466-tech/Demo1/commit/" + "c".repeat(40) },
};
let apiCalls = 0;
const liveDom = makeDom({
  stubFetch(url) {
    url = String(url);
    if (url.endsWith("data/health.json")) return jsonResp(JSON.parse(healthText));
    if (url.includes("/actions/runs?per_page=100")) {
      apiCalls++;
      return jsonResp(runsCanned, { "x-ratelimit-remaining": "58", "x-ratelimit-limit": "60" });
    }
    if (url.includes("/commits?path=")) {
      apiCalls++;
      const i = ["data", "sim-desk%2Fdata", "sim-desk/data", "engine"].findIndex((p) => url.includes("path=" + p));
      return jsonResp([commitsCanned[Math.max(0, i) % 3]], { "x-ratelimit-remaining": "54", "x-ratelimit-limit": "60" });
    }
    throw new Error("unexpected fetch: " + url);
  },
});
await waitFor(() => liveDom.window.document.querySelectorAll("#wfBody tr").length === health.workflows.length, "live dom boot");
liveDom.window.document.getElementById("liveBtn").click();
await waitFor(() => liveDom.window.document.querySelectorAll("#liveResults tbody tr").length === 4, "live table rows");
okAsync("live check renders 4 result rows with API links", async () => {
  const rows = [...liveDom.window.document.querySelectorAll("#liveResults tbody tr")];
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.textContent.includes("Last commit on")).length, 3);
  assert.ok(liveDom.window.document.getElementById("rateStatus").textContent.includes("remaining"), "rate limit not displayed");
  assert.equal(liveDom.window.document.getElementById("degrade").style.display, "none", "degrade banner must stay hidden on success");
});
okAsync("live check never overwrites committed evidence", async () => {
  assert.ok(liveDom.window.document.getElementById("wfBody").children.length === health.workflows.length);
});

console.log("4. live re-check — failure path degrades to committed evidence");
const failDom = makeDom({
  stubFetch(url) {
    if (String(url).endsWith("data/health.json")) return jsonResp(JSON.parse(healthText));
    return Promise.reject(new Error("HTTP 403 (rate limited)"));
  },
});
await waitFor(() => failDom.window.document.querySelectorAll("#wfBody tr").length === health.workflows.length, "fail dom boot");
failDom.window.document.getElementById("liveBtn").click();
await waitFor(() => failDom.window.document.getElementById("degrade").style.display === "block", "degrade banner");
okAsync("degrade banner shows committed timestamp and keeps tables intact", async () => {
  const banner = failDom.window.document.getElementById("degrade").textContent;
  assert.ok(banner.includes("generated"), "banner should reference committed evidence");
  assert.ok(banner.includes(health.generated_at_utc), "banner must cite the committed generated_at_utc");
  assert.ok(failDom.window.document.querySelectorAll("#wfBody tr").length === health.workflows.length, "committed tables must remain");
  assert.ok(failDom.window.document.getElementById("liveStatus").textContent.includes("failed"), "failure must be reported");
});

console.log("\n" + passed + " checks passed" + (process.exitCode ? " (WITH FAILURES)" : ""));
process.exit(process.exitCode || 0);
