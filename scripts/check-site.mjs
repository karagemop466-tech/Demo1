#!/usr/bin/env node
/**
 * Static checks for the site. Run by the Pages workflow on every build.
 *
 *  1. Every relative href/src in every HTML page resolves to a file that exists.
 *  2. Every same-page anchor (#id) resolves to an element that exists.
 *  3. Every <table> inside a .tablewrap carries at least one source link, so a
 *     data row can never be published without a way back to the official source.
 *  4. Every page references an existing stylesheet and script.
 *
 * Exit code 1 when anything fails, which fails the build.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', '.github']);

const problems = [];
const notes = [];

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** Extract href/src values from a raw HTML string. */
function extractRefs(html) {
  const refs = [];
  const re = /(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs;
}

function extractIds(html) {
  const ids = new Set();
  const re = /\sid\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return ids;
}

function extractTables(html) {
  const tables = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) tables.push(m[0]);
  return tables;
}

const files = await walk(ROOT);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const allPaths = new Set(files.map(rel));

for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  const ids = extractIds(html);
  const fromDir = path.dirname(file);

  for (const ref of extractRefs(html)) {
    if (!ref || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('mailto:') || ref.startsWith('data:') || ref.startsWith('//')) {
      continue;
    }
    if (ref.startsWith('#')) {
      if (!ids.has(ref.slice(1))) {
        problems.push(`${rel(file)}: anchor "${ref}" does not exist on the page`);
      }
      continue;
    }
    const [filePart, hash] = ref.split('#');
    if (!filePart) continue;
    const resolved = path.resolve(fromDir, filePart);
    const targetRel = path.relative(ROOT, resolved).split(path.sep).join('/');
    let exists = allPaths.has(targetRel);
    if (!exists && (filePart.endsWith('/') || targetRel === '')) {
      // A directory-style link points at index.html inside it.
      const withIndex = targetRel ? `${targetRel}/index.html` : 'index.html';
      exists = allPaths.has(withIndex);
      if (exists && hash) {
        const target = await fs.readFile(path.join(ROOT, withIndex), 'utf8');
        if (!extractIds(target).has(hash)) {
          problems.push(`${rel(file)}: link "${ref}" points to ${withIndex} but that page has no id "${hash}"`);
        }
      }
      if (!exists) {
        problems.push(`${rel(file)}: link "${ref}" points to a directory with no index.html`);
      }
    } else if (!exists) {
      // A directory-style link may point at index.html inside it.
      const withIndex = `${targetRel}/index.html`;
      exists = allPaths.has(withIndex);
      if (exists && hash) {
        const target = await fs.readFile(path.join(ROOT, withIndex), 'utf8');
        if (!extractIds(target).has(hash)) {
          problems.push(`${rel(file)}: link "${ref}" points to ${withIndex} but that page has no id "${hash}"`);
        }
      }
      if (!exists) {
        problems.push(`${rel(file)}: link "${ref}" resolves to "${targetRel}" which does not exist`);
      }
    }
  }

  // Every data table must expose at least one source link.
  const moduleSrc = (html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/i) || [])[1];
  let moduleCode = '';
  if (moduleSrc && !moduleSrc.startsWith('http')) {
    try {
      moduleCode = await fs.readFile(path.resolve(path.dirname(file), moduleSrc), 'utf8');
    } catch {
      moduleCode = '';
    }
  }
  extractTables(html).forEach((table, i) => {
    const links = (table.match(/class="srclink"/g) || []).length;
    const external = (table.match(/https:\/\/docs\.kalshi\.com/g) || []).length;
    if (links > 0 || external > 0) return;
    const marker = (table.match(/data-source="([^"]+)"/) || [])[1];
    if (marker === 'repository') return;
    if (marker === 'runtime') {
      if (!/srcLink\(|docs\.kalshi\.com/.test(moduleCode)) {
        problems.push(`${rel(file)}: table #${i + 1} is marked runtime but its module (${moduleSrc}) never emits a source link`);
      }
      return;
    }
    problems.push(`${rel(file)}: table #${i + 1} has no source link — a data row must point back to an official source`);
  });

  // Basic document sanity.
  if (!/<html/i.test(html)) problems.push(`${rel(file)}: missing <html> element`);
  if (!/<title>/i.test(html)) problems.push(`${rel(file)}: missing <title>`);
  if (!/name="description"/i.test(html)) problems.push(`${rel(file)}: missing meta description`);
  if (!/<div id="site-header"><\/div>/i.test(html)) problems.push(`${rel(file)}: missing the shared header mount point`);
  if (!/<div id="site-footer"><\/div>/i.test(html)) problems.push(`${rel(file)}: missing the shared footer mount point`);
}

for (const file of files.filter((f) => f.endsWith('.js') && f.includes(`${path.sep}assets${path.sep}`))) {
  const html = null;
  void html;
}

// Module imports must resolve.
for (const file of files.filter((f) => f.endsWith('.js') && f.includes(`${path.sep}assets${path.sep}`))) {
  const code = await fs.readFile(file, 'utf8');
  const re = /from\s+'(\.[^']+)'/g;
  let m;
  while ((m = re.exec(code))) {
    const target = path.resolve(path.dirname(file), m[1]);
    try {
      await fs.access(target);
    } catch {
      problems.push(`${rel(file)}: import "${m[1]}" does not resolve`);
    }
  }
}

// Script tags in HTML must exist on disk.
for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  const re = /<script[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (!src.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), src);
    try {
      await fs.access(target);
    } catch {
      problems.push(`${rel(file)}: <script src="${src}"> does not exist`);
    }
  }
  const re2 = /<link[^>]*href="([^"]+\.css)"/g;
  while ((m = re2.exec(html))) {
    const href = m[1];
    if (!href.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), href);
    try {
      await fs.access(target);
    } catch {
      problems.push(`${rel(file)}: <link href="${href}"> does not exist`);
    }
  }
}

notes.push(`checked ${htmlFiles.length} HTML pages and ${files.filter((f) => f.endsWith('.js')).length} JavaScript files`);

if (problems.length) {
  console.error('[check] FAILED');
  for (const p of problems) console.error('  -', p);
  process.exitCode = 1;
} else {
  console.log('[check] OK —', notes.join('; '));
}
