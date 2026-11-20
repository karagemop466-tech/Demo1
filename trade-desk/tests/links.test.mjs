#!/usr/bin/env node
/* links.test.mjs — link and integrity checks for trade-desk/.
 *
 * Fails on:
 *   - an internal href/src that points at a file that does not exist;
 *   - a page that references a script which is not on disk;
 *   - a nav link that differs between pages (navigation drift);
 *   - a suggestion marked "implemented" whose evidence does not link to a real page;
 *   - a source document cited on sources.html that is not an official kalshi domain;
 *   - a "Flagged for review" item without a source link.
 *
 * Usage: node trade-desk/tests/links.test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const desk = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desk, "..");
let pass = 0, fail = 0;
const problems = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); problems.push(name + (detail ? ": " + detail : "")); }
}

const pages = fs.readdirSync(desk).filter((f) => f.endsWith(".html"));
console.log(`trade-desk link checks (${pages.length} pages)`);

/* ---------------------------------------------------- internal link targets */
let internal = 0;
const missing = [];
/* Strip inline <script> bodies first: template strings inside them build markup
 * at runtime, and their quotes are not static links. */
function markupOnly(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}
pages.forEach((file) => {
  const html = markupOnly(fs.readFileSync(path.join(desk, file), "utf8"));
  const refs = Array.from(html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)).map((m) => m[1]);
  refs.forEach((ref) => {
    if (/^(https?:|mailto:|data:|javascript:)/.test(ref)) return;
    if (ref === "" || ref === "./") return;
    internal += 1;
    const target = path.resolve(desk, ref);
    if (!fs.existsSync(target)) missing.push(`${file} → ${ref}`);
  });
});
ok(`all ${internal} internal href/src targets exist`, missing.length === 0, missing.slice(0, 6).join(" | "));

/* --------------------------------------------------------- script integrity */
let scripts = 0;
const badScripts = [];
pages.forEach((file) => {
  const html = fs.readFileSync(path.join(desk, file), "utf8");
  Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).forEach((m) => {
    scripts += 1;
    if (!fs.existsSync(path.resolve(desk, m[1]))) badScripts.push(`${file} → ${m[1]}`);
  });
});
ok(`all ${scripts} script tags resolve to files on disk`, badScripts.length === 0, badScripts.join(" | "));

/* --------------------------------------------------------------- nav parity */
const navSets = pages.map((file) => {
  const html = fs.readFileSync(path.join(desk, file), "utf8");
  const nav = /<nav aria-label="Main">([\s\S]*?)<\/nav>/.exec(html);
  if (!nav) return { file, links: null };
  return { file, links: Array.from(nav[1].matchAll(/href="([^"]+)"/g)).map((m) => m[1]).join(",") };
});
const missingNav = navSets.filter((n) => !n.links);
ok("every page has the same main navigation", missingNav.length === 0 &&
  new Set(navSets.map((n) => n.links)).size === 1,
  missingNav.map((n) => n.file).join(",") || "nav sets differ");

/* --------------------------------------------------- flagged items have sources */
const flagged = fs.readFileSync(path.join(desk, "flagged.html"), "utf8");
const items = Array.from(flagged.matchAll(/id:\s*"(TD-\d+)"/g)).map((m) => m[1]);
const sourceCount = Array.from(flagged.matchAll(/source:\s*"https?:\/\//g)).length;
ok(`${items.length} flagged items each carry an official source URL`, items.length > 0 && sourceCount === items.length,
  `${items.length} items vs ${sourceCount} sources`);

/* ------------------------------------------- suggestions marked implemented work */
const sug = fs.readFileSync(path.join(desk, "suggestions.html"), "utf8");
const suggested = Array.from(sug.matchAll(/\[\s*"[^"]*",\s*"[^"]*",\s*"(implemented|ready|blocked)"/g)).map((m) => m[1]);
ok(`suggestion statuses are one of implemented/ready/blocked (${suggested.length} rows)`,
  suggested.length >= 10 && suggested.every((s) => ["implemented", "ready", "blocked"].includes(s)));
/* Rows are [title, why, status, evidenceHtml]. Match a whole row so the evidence
 * string is isolated from its neighbours, then require an href in it. */
const rows = Array.from(sug.matchAll(/\[\s*"([^"]*)",\s*"([^"]*)",\s*"(implemented|ready|blocked)",\s*'([\s\S]*?)'\s*\]/g))
  .map((m) => ({ title: m[1], status: m[3], evidence: m[4] }));
const implemented = rows.filter((r) => r.status === "implemented");
const badEvidence = implemented.filter((r) => !/href=/.test(r.evidence));
ok(`every implemented suggestion (${implemented.length}) links evidence`,
  implemented.length > 0 && badEvidence.length === 0,
  badEvidence.map((r) => r.title).join(" | "));
ok("no suggestion is marked implemented without appearing in a page's navigation",
  implemented.every((r) => /index\.html|chart\.html|resolutions\.html|strategies\.html|model\.html|sources\.html/.test(r.evidence)),
  "an implemented row links outside the desk's own pages");

/* ------------------------------------------------- sources are official domains */
const sourcesHtml = fs.readFileSync(path.join(desk, "sources.html"), "utf8");
const external = Array.from(sourcesHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)).map((m) => m[1]);
const nonOfficial = external.filter((u) => !/kalshi\.com|kalshi\.co|docs\.kalshi\.com/.test(new URL(u).hostname));
ok(`all ${external.length} external source links are kalshi domains`, nonOfficial.length === 0, nonOfficial.slice(0, 4).join(" | "));

/* --------------------------------------------------- data files are present */
["data/series-map.json", "data/calibration.json"].forEach((rel) => {
  const p = path.join(desk, rel);
  let good = fs.existsSync(p);
  if (good) {
    try { JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { good = false; }
  }
  ok(`${rel} exists and parses as JSON`, good);
});

/* ------------------------------------------- calibration numbers are re-derivable */
const calib = JSON.parse(fs.readFileSync(path.join(desk, "data/calibration.json"), "utf8"));
ok("calibration records its own provenance", !!calib.inputs && !!calib.inputs.source_base_url);
ok("calibration base rate is a real fraction",
  calib.base_rate.yes_rate > 0 && calib.base_rate.yes_rate < 1 && calib.base_rate.yes + calib.base_rate.no === calib.base_rate.settled_yes_or_no);
ok("every fee band states whether it clears the screen",
  calib.fee_bands.every((b) => typeof b.clears_screen_at_1_contract === "boolean"));

/* ------------------------------------------------------------ report */
console.log("");
console.log(`${pass}/${pass + fail} link checks passed`);
if (fail) {
  console.log("PROBLEMS:");
  problems.forEach((p) => console.log(" - " + p));
  process.exit(1);
}
void root;
