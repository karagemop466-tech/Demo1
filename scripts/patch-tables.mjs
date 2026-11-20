#!/usr/bin/env node
/**
 * One-off patch: mark tables as runtime- or repository-sourced and add the
 * missing Source columns. Idempotent — safe to re-run.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFile(path.join(ROOT, p), s, 'utf8');

const runtimeTables = {
  'analysis/index.html': 5,
  'events/index.html': 2,
  'flagged/index.html': 1,
  'index.html': 1,
  'liquidity/index.html': 2,
  'markets/index.html': 1,
  'portfolio/index.html': 3,
  'questions/index.html': 1,
  'suggestions/index.html': 2,
  'trading/index.html': 1,
};

for (const [file, count] of Object.entries(runtimeTables)) {
  let html = await read(file);
  let seen = 0;
  html = html.replace(/<table>/g, () => {
    seen += 1;
    return seen <= count ? '<table data-source="runtime">' : '<table>';
  });
  await write(file, html);
  console.log('patched', file, seen, 'tables');
}

// Tables whose authority is this repository rather than an external page.
for (const file of ['flagged/index.html', 'summary/index.html']) {
  let html = await read(file);
  html = html.replace(/<table>/g, '<table data-source="repository">');
  await write(file, html);
  console.log('marked repository tables in', file);
}
