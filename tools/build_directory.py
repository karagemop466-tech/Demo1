#!/usr/bin/env python3
"""Generate integration/page-directory.html from the HTML pages that ship in this repo.

Why this exists
---------------
The site grew to many parallel desks built by separate sessions. A trader needs one
place that lists every page without anyone hand-typing an index that can drift from
reality. This script therefore derives every row from the page file itself:

  * the label is the page's own <title>
  * the description is the page's own <meta name="description">, or, when a page has
    no description tag, the first paragraph of the page body (marked "page text")
  * the link is the page's real path, relative to integration/page-directory.html

Nothing is invented, and no page is described unless its file exists. Pages without
any usable description text are listed as "— no description in the page" and counted
in the summary, rather than described by guesswork.

Usage
-----
    python3 tools/build_directory.py            # write integration/page-directory.html
    python3 tools/build_directory.py --check    # verify the committed file is current
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "integration" / "page-directory.html"
SKIP_PARTS = {".git", "node_modules", ".github", "site_src", ".arena"}

# Group labels for the first path segment. A directory that is not listed here still
# gets a row: its label falls back to the directory name, so a new desk cannot be lost.
GROUPS = [
    ("", "Landing and root pages"),
    ("integration", "Integration, executive summary and review"),
    ("trade-desk", "Primary trader desk (canonical)"),
    ("site", "Verified topic data (generated from the official snapshot)"),
    ("sim-desk", "Automated simulated strategies"),
    ("engine", "Strategy engine and candle study"),
    ("alert-desk", "Alert desks"),
    ("alerts", "Alert desk (generated feed)"),
    ("tape-desk", "Tape desk"),
    ("exec-desk", "Exec desk"),
    ("desk", "Consolidated desk"),
    ("verified-desk", "Verified desk"),
    ("live-desk", "Live desk (research)"),
    ("strategy-desk", "Strategy desk"),
    ("decision", "Decision desk"),
    ("pages", "Earlier session pages"),
    ("markets", "Markets pages"),
    ("docs", "Docs, methodology and verification logs"),
    ("monitor", "Single-page monitor"),
    ("ops-desk", "Ops desk"),
    ("audit", "Audit snapshots"),
    ("verification", "Repository verification record"),
    ("trader-guide", "Trader guide"),
    ("archive", "Archive (superseded pages, keep for history)"),
    ("handoff", "Handoff notes"),
]

# The pages this session designates as the working path. Paths are checked against the
# filesystem below, so a stale entry is an error rather than a broken link.
PRIMARY = [
    ("trade-desk/index.html", "Trader desk — two alert chats, ranked events, chart, depth"),
    ("trade-desk/chart.html", "Chart and order-book depth, seconds/minutes/hours windows"),
    ("trade-desk/resolutions.html", "Resolution tracker — how each event ended, YES or NO"),
    ("trade-desk/strategies.html", "Paper trades, fees, settlement and strategy analytics"),
    ("site/index.html", "Topic tables built from the official snapshot"),
]

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
DESC_RE = re.compile(
    r"<meta\s+[^>]*name=[\"']description[\"'][^>]*content=[\"'](.*?)[\"']", re.S | re.I)
DESC_RE_ALT = re.compile(
    r"<meta\s+[^>]*content=[\"'](.*?)[\"'][^>]*name=[\"']description[\"']", re.S | re.I)
PARA_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")


def clean(text: str) -> str:
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def page_rows() -> list[dict]:
    rows = []
    for path in sorted(ROOT.rglob("*.html")):
        rel = path.relative_to(ROOT)
        if set(rel.parts) & SKIP_PARTS:
            continue
        if rel.parts[:1] == ("integration",) and rel.name == OUT.name:
            continue  # never list the directory inside itself
        text = path.read_text(encoding="utf-8", errors="ignore")
        title = clean(TITLE_RE.search(text).group(1)) if TITLE_RE.search(text) else rel.name
        desc, source = "", ""
        m = DESC_RE.search(text) or DESC_RE_ALT.search(text)
        if m and clean(m.group(1)):
            desc, source = clean(m.group(1)), "meta"
        else:
            for body in text.split("<body", 1)[1:]:
                for para in PARA_RE.findall(body):
                    cand = clean(para)
                    if len(cand) >= 40:
                        desc, source = cand, "page text"
                        break
                if desc:
                    break
        if len(desc) > 260:
            desc = desc[:257].rstrip() + "…"
        rows.append({
            "rel": rel.as_posix(),
            "group": rel.parts[0] if len(rel.parts) > 1 else "",
            "title": title,
            "desc": desc,
            "desc_source": source,
        })
    return rows


def href_for(rel: str) -> str:
    return "../" + rel if not rel.startswith("../") else rel


def build(rows: list[dict]) -> str:
    known_dirs = {g for g, _ in GROUPS}
    labels = dict(GROUPS)
    extra = []
    for r in rows:
        if r["group"] and r["group"] not in known_dirs:
            extra.append(r["group"])
            labels.setdefault(r["group"], r["group"] + " (directory)")
            known_dirs.add(r["group"])

    by_group: dict[str, list[dict]] = {}
    for r in rows:
        by_group.setdefault(r["group"], []).append(r)

    no_desc = [r for r in rows if not r["desc"]]
    primary_missing = [p for p, _ in PRIMARY if not (ROOT / p).exists()]
    if primary_missing:
        raise SystemExit("primary page listed but missing: " + ", ".join(primary_missing))

    e = html.escape
    out = []
    out.append("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every page on this site — Kalshi Demo Dashboard</title>
<meta name="description" content="Complete index of every HTML page in this repository, grouped by desk. Titles and descriptions are extracted from the pages themselves by tools/build_directory.py.">
<link rel="stylesheet" href="../site/assets/style.css">
<style>
  .dirhead{margin:22px 0 6px}
  .primary{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:14px 0 22px}
  .primary a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 15px;color:var(--ink)}
  .primary a:hover{border-color:var(--accent2);text-decoration:none}
  .primary b{display:block;margin-bottom:3px}
  .primary span{color:var(--muted);font-size:.86rem}
  table.dir{width:100%;border-collapse:collapse;font-size:.88rem}
  table.dir th,table.dir td{border-bottom:1px solid var(--line);padding:7px 9px;vertical-align:top;text-align:left}
  table.dir th{color:var(--muted);font-weight:600;white-space:nowrap}
  table.dir td.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;color:var(--muted);white-space:nowrap}
  .tag{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:1px 7px;color:var(--muted);white-space:nowrap}
  .note{color:var(--muted);font-size:.86rem}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="../index.html">Kalshi Demo Dashboard</a>
    <nav class="nav">
      <a href="../index.html">Home</a>
      <a href="../trade-desk/index.html">Trader desk</a>
      <a href="../trade-desk/chart.html">Chart &amp; depth</a>
      <a href="../trade-desk/resolutions.html">Resolutions</a>
      <a href="../trade-desk/strategies.html">Paper trades</a>
      <a href="../site/index.html">Topics</a>
      <a href="page-directory.html" class="on">All pages</a>
      <a href="executive-summary.html">Executive summary</a>
      <a href="flagged-review.html">Flagged for review</a>
      <a href="../site/sources.html">Sources</a>
    </nav>
  </div>
</header>
<main class="wrap">
  <h1>Every page on this site</h1>
  <p class="lede">The site was built by many parallel sessions against one brief, so several desks
  solve the same requirement in different ways. This page is the complete map. It is generated by
  <code>tools/build_directory.py</code>: each title and description below is read straight out of the
  page file, so this index cannot describe a page that does not exist.</p>
  <p class="note">Pages listed: <b>__TOTAL__</b> in <b>__GROUPS__</b> groups (this directory page is the
  extra one, so the shipped total is __TOTAL1__). Pages shipped without any
  description text in the file itself: <b>__NODESC__</b> (listed as “—” rather than described by guesswork).
  This is a page index, not a market-data table, so rows link the page itself; market values live on the
  topic pages, where every row carries the official API request that produced it.</p>

  <h2 class="dirhead">Start here</h2>
  <div class="primary">""".replace("__TOTAL__", str(len(rows))).replace("__GROUPS__", str(len(by_group))).replace("__NODESC__", str(len(no_desc))).replace("__TOTAL1__", str(len(rows) + 1)))

    for path, label in PRIMARY:
        r = next((x for x in rows if x["rel"] == path), None)
        out.append(f'    <a href="{e(href_for(path))}"><b>{e(label)}</b>'
                   f'<span>{e(path)} · {e(r["title"]) if r else ""}</span></a>')
    out.append("  </div>")

    for group_key, label in GROUPS:
        members = by_group.get(group_key)
        if not members:
            continue
        out.append(f'  <h2 class="dirhead">{e(label)} <span class="tag">{len(members)} pages</span></h2>')
        out.append('  <div class="tablewrap"><table class="dir">')
        out.append("    <thead><tr><th>Page</th><th>Title</th><th>What the page says it is</th><th>File</th></tr></thead>")
        out.append("    <tbody>")
        for r in members:
            badge = ' <span class="tag">primary</span>' if r["rel"] in dict(PRIMARY) else ""
            desc = e(r["desc"]) if r["desc"] else "— <i>no description in the page</i>"
            if r["desc"] and r["desc_source"] == "page text":
                desc += ' <span class="tag">page text</span>'
            out.append(
                f'      <tr><td><a href="{e(href_for(r["rel"]))}">{e(r["title"])}</a>{badge}</td>'
                f'<td>{e(r["title"])}</td><td>{desc}</td>'
                f'<td class="path">{e(r["rel"])}</td></tr>')
        out.append("    </tbody></table></div>")

    # any group key that existed at build time but is not in the ordered list
    for group_key in sorted(set(by_group) - {g for g, _ in GROUPS}):
        members = by_group[group_key]
        out.append(f'  <h2 class="dirhead">{e(labels[group_key])} <span class="tag">{len(members)} pages</span></h2>')
        out.append('  <div class="tablewrap"><table class="dir"><thead><tr><th>Page</th><th>Title</th>'
                   '<th>What the page says it is</th><th>File</th></tr></thead><tbody>')
        for r in members:
            out.append(f'      <tr><td><a href="{e(href_for(r["rel"]))}">{e(r["title"])}</a></td>'
                       f'<td>{e(r["title"])}</td><td>{e(r["desc"]) or "—"}</td>'
                       f'<td class="path">{e(r["rel"])}</td></tr>')
        out.append("    </tbody></table></div>")

    out.append("""
  <h2 class="dirhead">Official sources</h2>
  <ul class="plain">
    <li><a href="https://docs.kalshi.com/getting_started/api_environments">Kalshi API environments</a> — demo REST base <code>https://external-api.demo.kalshi.co/trade-api/v2</code>.</li>
    <li><a href="https://docs.kalshi.com/getting_started/demo_env">Kalshi demo environment</a> — mock funds; prices may not reflect real markets.</li>
    <li><a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages">GitHub Pages</a> — this site is served as static files from the repository.</li>
  </ul>
</main>
<footer class="wrap small">
  Generated by <code>tools/build_directory.py</code>. Regenerate with
  <code>python3 tools/build_directory.py</code>; <code>--check</code> fails if this file is stale.
</footer>
</body>
</html>
""")
    return "\n".join(out)


def main() -> int:
    rows = page_rows()
    page = build(rows)
    if "--check" in sys.argv:
        if not OUT.exists():
            print("page-directory.html is missing")
            return 1
        if OUT.read_text(encoding="utf-8") != page:
            print("page-directory.html is stale — run python3 tools/build_directory.py")
            return 1
        print(f"page-directory.html is current ({len(rows)} pages)")
        return 0
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {len(rows)} pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
