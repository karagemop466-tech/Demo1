import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
const demoPages = [
  "demo-board.html",
  "gas-prices.html",
  "elections.html",
  "culture.html",
  "crypto.html",
  "golf.html",
  "demo-portfolio.html",
  "demo-analysis.html",
  "requirements.html",
  "demo-suggestions.html",
  "review.html",
  "demo-sources.html",
];
const errors = [];
const officialPrefixes = [
  "https://docs.kalshi.com/",
  "https://external-api.demo.kalshi.co/",
  "https://demo-api.kalshi.co/",
  "https://github.com/Kalshi/",
];

if (htmlFiles.length < 10) errors.push(`Expected the dashboard and subpages; found ${htmlFiles.length} root HTML files.`);
for (const filename of demoPages) {
  if (!fs.existsSync(path.join(root, filename))) errors.push(`Missing demo page: ${filename}`);
}

for (const filename of htmlFiles) {
  const content = fs.readFileSync(path.join(root, filename), "utf8");
  for (const match of content.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const target = match[1];
    if (/^(?:https?:|wss?:|mailto:|tel:|#|data:|javascript:)/i.test(target)) continue;
    const localPath = target.split(/[?#]/, 1)[0];
    if (!localPath) continue;
    if (!fs.existsSync(path.join(root, localPath))) errors.push(`${filename}: missing local target ${target}`);
  }
}

for (const filename of demoPages) {
  if (!fs.existsSync(path.join(root, filename))) continue;
  const content = fs.readFileSync(path.join(root, filename), "utf8");
  for (const bodyMatch of content.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const body = bodyMatch[1];
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowMatch[1];
      const hrefs = [...row.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]);
      if (!hrefs.some((href) => officialPrefixes.some((prefix) => href.startsWith(prefix)))) {
        errors.push(`${filename}: a static data table row has no source link to an official Kalshi source.`);
      }
    }
  }
}

const appPath = "assets/demo-app.js";
const app = fs.existsSync(path.join(root, appPath)) ? fs.readFileSync(path.join(root, appPath), "utf8") : "";
for (const prefix of officialPrefixes.slice(1, 3)) {
  if (!app.includes(prefix)) errors.push(`${appPath} does not include an expected official source prefix: ${prefix}`);
}
for (const requiredFile of ["assets/paper-trader.js", "src/core.js", "src/paper.js", "package.json"]) {
  if (!fs.existsSync(path.join(root, requiredFile))) errors.push(`Missing required demo implementation file: ${requiredFile}`);
}

if (!fs.existsSync(path.join(root, ".github/workflows/pages.yml"))) errors.push("Missing .github/workflows/pages.yml.");
if (!fs.existsSync(path.join(root, ".nojekyll"))) errors.push("Missing .nojekyll for static Pages publishing.");

if (errors.length) {
  console.error("Site check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Site check passed: ${htmlFiles.length} root HTML pages, local links, demo table sources, and Pages files verified.`);
}
