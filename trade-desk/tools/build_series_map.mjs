#!/usr/bin/env node
/* build_series_map.mjs — turn the official GET /series snapshot into the compact
 * index the trade desk uses to assign markets to the five topics.
 *
 * Input : data/series.json          (official demo snapshot, provenance inside)
 * Output: trade-desk/data/series-map.json
 *
 * The classifier itself lives in trade-desk/assets/util.js so the browser, the
 * tests and this builder can never drift apart. Each entry records the official
 * category/tags that produced the decision, so every assignment is auditable.
 *
 * Usage: node trade-desk/tools/build_series_map.mjs [--pretty]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TD = require("../assets/util.js");

const root = path.resolve(import.meta.dirname, "../..");
const src = path.join(root, "data/series.json");
const out = path.join(root, "trade-desk/data/series-map.json");

const snapshot = JSON.parse(fs.readFileSync(src, "utf8"));
const rows = snapshot.series || [];
if (!rows.length) {
  console.error(`no series records in ${src}`);
  process.exit(1);
}

const map = {};
const counts = { gas: 0, elections: 0, culture: 0, crypto: 0, golf: 0, none: 0 };

for (const s of rows) {
  const hit = TD.classifyBySeries({
    ticker: s.ticker,
    title: s.title,
    category: s.category,
    tags: s.tags,
    categories: s.categories
  });
  const topic = hit ? hit.id : null;
  counts[topic || "none"] += 1;
  /* Compact record: [topic|null, official category, short title, joined tags]
   * Only fields the UI displays or the audit needs; nothing invented. */
  map[s.ticker] = [
    topic,
    s.category || "",
    String(s.title || "").slice(0, 80),
    (s.tags || []).slice(0, 6).join("|")
  ];
}

const payload = {
  generated_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  source: snapshot.source || "https://external-api.demo.kalshi.co/trade-api/v2/series",
  source_snapshot_fetched_at: snapshot.fetched_at || null,
  source_snapshot_base_url: snapshot.base_url || null,
  snapshot_file: "data/series.json",
  classifier: "trade-desk/assets/util.js classifyBySeries()",
  counts,
  total: rows.length,
  /* map[ticker] = [topicId|null, category, title, tags] */
  map
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload));

const bytes = fs.statSync(out).size;
console.log(`series: ${rows.length}`);
console.log(`topics: gas=${counts.gas} elections=${counts.elections} culture=${counts.culture} crypto=${counts.crypto} golf=${counts.golf} none=${counts.none}`);
console.log(`wrote ${path.relative(root, out)} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
