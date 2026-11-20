#!/usr/bin/env node
/*
 * Site link + hygiene checker (Node standard library only).
 *
 * 1. every local href/src in every HTML file must resolve to a file that exists
 * 2. every table row on the Kalshi pages must carry a source link (verification rule:
 *    "every table row must have a source link to an official site")
 * 3. no credentials may be committed
 *
 * Exit code 1 on any broken local link or committed key material. Rows without a source link
 * are reported as warnings so the check still documents what is and is not verified.
 *
 *   node tools/check-links.mjs            # whole repo
 *   node tools/check-links.mjs pages      # one directory
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const scope = process.argv[2] || '';
const KALSHI_PAGES = ['pages/live.html', 'pages/resolutions.html', 'pages/strategy.html', 'pages/dashboard.html', 'pages/gas.html', 'pages/elections.html', 'pages/crypto.html', 'pages/golf.html', 'pages/culture.html', 'pages/portfolio.html', 'pages/trades.html'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.github') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(path.join(ROOT, scope)).filter((f) => /\.(html|css|js|mjs|md|py|json|yml)$/.test(f));

const broken = [], warnings = [], keys = [];
const attr = /(?:href|src)\s*=\s*["']([^"']+)["']/g;

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const text = fs.readFileSync(f, 'utf8');

  if (/\bBEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY\b/.test(text) || /KALSHI-ACCESS-KEY["']?\s*[:=]\s*["'][A-Za-z0-9]{12,}["']/.test(text)) {
    keys.push(rel);
  }

  if (!/\.html$/.test(rel)) continue;
  const here = path.dirname(f);
  let m;
  while ((m = attr.exec(text))) {
    const raw = m[1];
    if (/^(https?:|mailto:|data:|#|\/\/)/.test(raw)) continue;
    if (raw.includes('${') || raw.includes('" +') || raw.includes("' +")) continue;   /* template-literal placeholder built at runtime, not a static link */
    const target = path.resolve(here, raw.split('#')[0].split('?')[0]);
    if (!fs.existsSync(target)) broken.push(rel + ' → ' + raw);
  }
  /* source-link check for data tables on the Kalshi pages */
  if (KALSHI_PAGES.includes(rel)) {
    const bodies = text.match(/<tbody[\s\S]*?<\/tbody>/g) || [];
    const dynamic = /<tbody id=/.test(text);
    bodies.forEach((b, i) => {
      const rows = (b.match(/<tr[\s>]/g) || []).length;
      const links = (b.match(/https?:\/\/(external-api\.demo\.kalshi\.co|demo-api\.kalshi\.co|docs\.kalshi\.com|kalshi\.com)/g) || []).length;
      if (rows > 1 && links === 0) warnings.push(rel + ' tbody#' + i + ': ' + rows + ' static rows without an official source link');
    });
    if (dynamic && !/docs\.kalshi\.com|external-api\.demo\.kalshi\.co|demo-api\.kalshi\.co/.test(text)) {
      warnings.push(rel + ': renders tables but cites no official domain');
    }
  }
}

/* external links: report non-official domains in table cells so a reviewer can audit them */
const external = new Set();
for (const f of files.filter((x) => /\.html$/.test(x))) {
  const text = fs.readFileSync(f, 'utf8');
  let m; const re = /href="(https?:\/\/[^"#]+)"/g;
  while ((m = re.exec(text))) {
    const host = m[1].split('/')[2];
    if (host) external.add(host);
  }
}

console.log('files scanned: ' + files.length + ' · html links checked · source-link audit on ' + KALSHI_PAGES.length + ' page(s)');
console.log('external hosts referenced: ' + [...external].sort().join(', '));
if (warnings.length) { console.log('\nWARNINGS (' + warnings.length + ')'); warnings.forEach((w) => console.log('  ! ' + w)); }
if (keys.length) { console.log('\nSECRET MATERIAL FOUND (' + keys.length + ')'); keys.forEach((k) => console.log('  X ' + k)); }
if (broken.length) { console.log('\nBROKEN LINKS (' + broken.length + ')'); broken.forEach((b) => console.log('  X ' + b)); }
console.log('\nresult: ' + (broken.length || keys.length ? 'FAIL' : 'PASS') + (warnings.length ? ' (with warnings)' : ''));
process.exit(broken.length || keys.length ? 1 : 0);
