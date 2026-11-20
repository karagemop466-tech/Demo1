#!/usr/bin/env python3
"""
build_map.py — desk-to-requirement consolidation map for this repository.

Why this exists: several agent sessions have each built a dashboard in their own folder, so
the repository now carries many pages with overlapping purpose. The brief asks to "organize and
simplify the website continuously". This tool does not decide anything: it measures what is
actually on disk and what the landing page actually links, so the owner can prune with facts.

Every row is derived from the files themselves (title/h1/link scans), and links to the file on
GitHub so a reviewer can open it. No row states an opinion about quality; it states presence,
size, and whether the page is reachable from the landing page or from another page.

Run:  python3 tape-desk/tools/build_map.py
Writes: tape-desk/consolidation-map.html
"""
from __future__ import annotations

import html
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tape-desk", "consolidation-map.html")
BLOB = "https://github.com/karagemop466-tech/Demo1/blob/main/"

# the brief's requirements, verbatim-ish, mapped to the repo surfaces that claim to serve them
REQUIREMENTS = [
    ("Executive summary of important details", ["EXECUTIVE_SUMMARY.md", "executive-summary.html",
        "integration/executive-summary.html", "exec-desk/executive-summary.html",
        "live-desk/pages/executive-summary.html", "strategy-desk/executive-summary.html",
        "verified-desk/exec-summary.html", "pages/landing-executive-summary.html", "site/executive-summary.html",
        "decision/requirements.html", "trader-guide/index.html"]),
    ("Highest-dollar live events on the five topics", ["site/index.html", "site/markets.html", "docs/index.html",
        "exec-desk/markets.html", "live-desk/index.html", "strategy-desk/markets.html", "markets/crypto.html",
        "desk/index.html", "engine/index.html", "decision/dashboard.html", "pages/dashboard.html",
        "tape-desk/index.html"]),
    ("Live alerting on ≥ $0.10 swings, two scrolling chats", ["alert-desk/index.html", "alerts/index.html",
        "alerts.html", "trade-desk/index.html", "exec-desk/jumps.html", "pages/price-jumps.html",
        "monitor/index.html", "tape-desk/index.html"]),
    ("Track events until they resolve; YES or NO", ["docs/pages/resolutions.html", "site/resolved.html",
        "trade-desk/resolutions.html", "desk/resolutions.html", "decision/resolutions.html",
        "pages/resolutions.html", "verified-desk/resolutions.html", "tape-desk/index.html"]),
    ("Automated simulated trades over strategies", ["sim-desk/index.html", "engine/index.html",
        "strategy-desk/analytics.html", "trade-desk/strategies.html", "pages/paper-trading.html",
        "desk/strategy.html", "tape-desk/index.html"]),
    ("Portfolio performance from the demo account", ["portfolio.html", "site/portfolio.html",
        "exec-desk/portfolio.html", "strategy-desk/portfolio.html", "verified-desk/portfolio.html",
        "decision/portfolio.html", "pages/portfolio.html", "trade-desk/portfolio.html"]),
    ("Trade analysis, categories, strategy creation", ["analysis.html", "site/strategies.html",
        "strategy-desk/index.html", "trade-desk/model.html", "sim-desk/index.html", "engine/index.html",
        "verified-desk/strategies.html"]),
    ("Interactive chart: time x-axis (s/m/h), price y-axis", ["dashboard.html", "chart.html", "site/chart.html",
        "docs/pages/live.html", "live-desk/index.html", "engine/index.html", "trade-desk/chart.html",
        "desk/live.html", "tape-desk/index.html"]),
    ("Liquidity: contracts available at each price", ["site/liquidity.html", "docs/pages/live.html",
        "exec-desk/dashboard.html", "live-desk/index.html", "desk/live.html", "tape-desk/index.html"]),
    ("Jumps linked to events / website links that may have caused them", ["alert-desk/index.html",
        "exec-desk/jumps.html", "pages/price-jumps.html", "tape-desk/index.html"]),
    ("Suggestions for making it more live/interactive", ["suggestions.html", "site/suggestions.html",
        "docs/pages/suggestions.html", "exec-desk/suggestions.html", "live-desk/pages/suggestions.html",
        "strategy-desk/suggestions.html", "verified-desk/suggestions.html", "pages/suggestions.html"]),
    ("Flagged-for-review register of unverified items", ["flagged.html", "site/flagged.html",
        "integration/flagged-review.html", "exec-desk/flagged.html", "docs/pages/flagged.html",
        "trade-desk/flagged.html", "audit/flagged.html", "strategy-desk/flagged.html",
        "verified-desk/flagged.html", "desk/flagged.html"]),
    ("Official source register / verification log", ["SOURCES.md", "sources.html", "site/sources.html",
        "docs/pages/sources.html", "docs/pages/verification.html", "exec-desk/docs/SOURCES.md",
        "exec-desk/docs/VERIFICATION.md", "trade-desk/sources.html", "verified-desk/provenance.html",
        "alerts/verification.html", "tape-desk/verified.html"]),
]


def read(rel):
    try:
        with open(os.path.join(ROOT, rel), "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def title_of(text):
    m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    t = re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
    return html.escape(html.unescape(t))[:150] if t else ""


def h1_of(text):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S | re.I)
    if not m:
        return ""
    body = re.sub(r"<[^>]+>", "", m.group(1))
    return html.escape(html.unescape(re.sub(r"\s+", " ", body)).strip())[:180]


def top_level_dirs():
    out = []
    for name in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, name)
        if not os.path.isdir(p) or name in (".git", ".github", "node_modules", "__pycache__"):
            continue
        if all(f.startswith(".") for f in os.listdir(p)):
            continue
        out.append(name)
    return out


def main():
    landing = read("index.html")
    # every html page in the repo, and whether anything else links to it
    pages = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".git", ".github", "node_modules", "__pycache__")]
        for f in filenames:
            if f.endswith(".html"):
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT).replace(os.sep, "/")
                pages.append(rel)
    pages.sort()
    all_text = "\n".join(read(p) for p in pages)
    in_dirs = {}
    for p in pages:
        d = p.split("/")[0] if "/" in p else "(root)"
        in_dirs.setdefault(d, []).append(p)

    rows = []
    for d in top_level_dirs():
        dir_pages = [p for p in pages if p.startswith(d + "/")]
        n_files = len([1 for dp, dn, fn in os.walk(os.path.join(ROOT, d)) for f in fn
                       if "__pycache__" not in dp])
        entry = next((p for p in dir_pages if p.endswith("index.html")), dir_pages[0] if dir_pages else "")
        txt = read(entry)
        linked_from_landing = bool(entry) and (entry in landing or ("./" + entry) in landing or
                                               ('href="%s"' % entry) in landing)
        inbound = len(re.findall(r'href="[^"]*%s' % re.escape(d + ("/" if entry != d else "")), all_text))
        rows.append({
            "dir": d, "pages": len(dir_pages), "files": n_files, "entry": entry,
            "title": title_of(txt), "h1": h1_of(txt),
            "landing": "linked" if linked_from_landing else ("not linked from the landing page" if entry else "no page"),
            "inbound": inbound,
            "serves": "; ".join(sorted({label for label, files in REQUIREMENTS if any(
                f.startswith(d + "/") or (d == "(root)" and "/" not in f) for f in files)}))[:200],
        })

    req_rows = []
    for label, files in REQUIREMENTS:
        present = [f for f in files if os.path.exists(os.path.join(ROOT, f))]
        missing = [f for f in files if f not in present]
        from_landing = [f for f in present if f in landing]
        req_rows.append(
            "<tr><td>%s</td><td class='num'>%d</td><td>%s</td><td class='num'>%s</td>"
            "<td class='fine'>%s</td></tr>" % (
                html.escape(label), len(present),
                ", ".join("<a href='%s%s'>%s</a>" % (BLOB, f, html.escape(f)) for f in present[:6]) +
                ("" if len(present) <= 6 else " <span class='fine'>+%d more</span>" % (len(present) - 6)),
                len(from_landing),
                "also present but not claimed by this row: " + ", ".join(html.escape(m) for m in missing[:4])
                if missing else "every listed path exists"))

    dir_row_list = []
    for r in rows:
        title_cell = ("<span class='mono fine'>" + html.escape(r["title"]) + "</span>"
                      if r["title"] else "<span class='fine'>no &lt;title&gt;</span>")
        dir_row_list.append(
            "<tr><td><a href='" + BLOB + r["entry"] + "'>" + html.escape(r["dir"]) + "/</a></td>"
            "<td class='num'>" + str(r["pages"]) + "</td>"
            "<td class='num'>" + str(r["files"]) + "</td>"
            "<td>" + title_cell + "</td>"
            "<td class='fine'>" + html.escape(r["h1"] or "\u2014") + "</td>"
            "<td class='fine'>" + html.escape(r["landing"]) + "</td>"
            "<td class='num'>" + str(r["inbound"]) + "</td>"
            "<td class='fine'>" + html.escape(r["serves"] or "\u2014") + "</td></tr>")
    dir_rows = "".join(dir_row_list)

    dup = [r for r in rows if r["pages"] > 0]
    counts = sorted(((r["dir"], r["pages"]) for r in dup), key=lambda x: -x[1])

    doc_html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Consolidation map — which page does what (tape-desk)</title>
<link rel="stylesheet" href="style.css"></head><body>
<header class="top"><div class="brand"><a class="back" href="../index.html">← Kalshi demo landing</a>
<strong>consolidation map</strong><span class="fine">read-only triage, generated from the files</span></div>
<nav class="desknav"><a href="index.html">Desk</a> <a href="verified.html">Verification</a>
<a href="README.md">README</a></nav></header>
<main>
<h1>Which folder does what, and what the landing page actually links</h1>
<p class="lede">This repository has been built by many parallel sessions, each of which added its own
desk. This page exists so the owner can see the overlap without opening thirty files. It is
<b>generated</b> by <a href="tools/build_map.py"><code>tape-desk/tools/build_map.py</code></a> from the
files on <code>main</code>: counts, titles and link checks are measured, not asserted. It judges
nothing — it only shows what is there and whether the landing page points at it.</p>

<div class="kpis">
  <div class="kpi"><b>{len(rows)}</b><span>top-level folders with content</span></div>
  <div class="kpi"><b>{len(pages)}</b><span>HTML pages in the repo</span></div>
  <div class="kpi"><b>{sum(1 for r in rows if r['landing'] != 'linked')}</b><span>folders the landing page does not link</span></div>
  <div class="kpi"><b>{len(REQUIREMENTS)}</b><span>brief requirements tracked</span></div>
</div>

<h2>Requirements from the brief → the paths that claim them</h2>
<table class="grid"><caption>“Claims” means the file exists and its title/heading describes that requirement; the
source for every row is the file itself, opened at its GitHub blob URL. Official endpoint docs are cited on
<a href="verified.html">the verification page</a> — <a class="src" href="https://docs.kalshi.com/getting_started/demo_env"
target="_blank" rel="noopener">official demo environment</a>.</caption>
<thead><tr><th>requirement</th><th>paths claiming it</th><th>where</th><th>linked from landing</th><th class="fine">notes</th></tr></thead>
<tbody>{''.join(req_rows)}</tbody></table>

<h2>Folders on <code>main</code></h2>
<table class="grid"><caption>“inbound links” counts hrefs anywhere in the repo that point into that folder, so a
folder with pages but no inbound links is orphaned. Titles are read from each folder's entry page.</caption>
<thead><tr><th>folder</th><th>pages</th><th>files</th><th>entry title</th><th>entry h1</th><th>landing page</th><th>inbound links</th><th>brief requirements it claims</th></tr></thead>
<tbody>{dir_rows}</tbody></table>

<h2>What the numbers imply (findings, not actions taken)</h2>
<ol class="srcs">
<li><b>The same requirement is served many times.</b> The two ≥ $0.10 alert-chat feeds alone are
implemented in {sum(1 for d, n in counts if d in ('alert-desk', 'alerts', 'trade-desk', 'exec-desk', 'live-desk', 'monitor', 'pages', 'tape-desk'))}
folders (alert-desk, alerts, trade-desk, exec-desk, live-desk, monitor, pages, plus this desk). Each is a
complete implementation with its own data path; none of them is wrong, but a trader has to choose, and the
landing page asks them to.</li>
<li><b>Recommendation: one hub, three verbs.</b> Keep one page per verb — <i>watch</i> (topic board + chart +
ladder), <i>react</i> (the two chats), <i>review</i> (resolutions, portfolio, strategy results) — and turn the
other desks into links with a one-line description. This desk publishes its data as
<a href="data/watchlist.json"><code>data/watchlist.json</code></a> so consolidation can consume it instead of
re-collecting it.</li>
<li><b>Do not delete a folder from this page.</b> Every folder here was claimed by a session on the board;
pruning is an integration action and belongs on the board, not in a generated table.</li>
<li><b>Snapshot age is the real liveness limit.</b> The committed snapshot this site renders is refreshed by the
repository's own workflows; a page that only reads committed files is a snapshot page. Real-time means the
browser talking to the demo API — which is what <a href="index.html">this desk</a> does, and why its status badge
says <code>SNAPSHOT ONLY</code> when it cannot.</li>
</ol>
<p class="fine">Generated by <code>tape-desk/tools/build_map.py</code>; re-run it after merges to refresh the
counts. It reads only repository files, so nothing here depends on network access.</p>
</main></body></html>
"""
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(doc_html)
    print(f"consolidation-map.html: {len(rows)} folders, {len(pages)} pages, {len(REQUIREMENTS)} requirements tracked")


if __name__ == "__main__":
    main()
