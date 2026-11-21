#!/usr/bin/env python3
"""Check that every shipped HTML page can be reached by following links from index.html.

The brief's rule for the published site is that it must be usable as one dashboard:
a page nobody can navigate to is effectively lost. This walks the real link graph
instead of trusting navigation comments.

Usage:
    python3 tools/check_page_reachability.py           # report, exit 1 on orphans
    python3 tools/check_page_reachability.py --list    # also print every reachable page
"""
from __future__ import annotations

import re
import sys
from collections import deque
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {".git", "node_modules", ".github", ".arena", "site_src"}
HREF = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.I)


def shipped_pages() -> set[Path]:
    pages = set()
    for p in ROOT.rglob("*.html"):
        rel = p.relative_to(ROOT)
        if set(rel.parts) & SKIP_PARTS:
            continue
        pages.add(rel)
    return pages


def local_targets(page: Path) -> list[Path]:
    text = page.read_text(encoding="utf-8", errors="ignore")
    here = (ROOT / page).parent
    out = []
    for raw in HREF.findall(text):
        raw = raw.strip()
        if not raw or raw.startswith(("#", "mailto:", "data:", "javascript:", "//")):
            continue
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", raw):  # http:, etc.
            continue
        if "${" in raw or '" +' in raw or "' +" in raw:  # runtime-built link
            continue
        path = urlsplit(raw).path
        if not path:
            continue
        target = (here / unquote(path)).resolve()
        try:
            rel = target.relative_to(ROOT.resolve())
        except ValueError:
            continue
        if (ROOT / rel).is_dir():
            rel = rel / "index.html"
        if rel.suffix.lower() == ".html" and (ROOT / rel).exists():
            out.append(rel)
    return out


def run() -> int:
    pages = shipped_pages()
    start = Path("index.html")
    if start not in pages:
        print("index.html missing")
        return 1
    seen = {start}
    q = deque([start])
    while q:
        cur = q.popleft()
        for nxt in local_targets(cur):
            if nxt not in seen:
                seen.add(nxt)
                q.append(nxt)
    orphans = sorted(pages - seen)
    print(f"pages shipped: {len(pages)} · reachable from index.html: {len(seen)} · orphans: {len(orphans)}")
    if "--list" in sys.argv:
        for p in sorted(seen):
            print("  ok  " + p.as_posix())
    for p in orphans:
        print("  ORPHAN  " + p.as_posix())
    return 1 if orphans else 0


if __name__ == "__main__":
    sys.exit(run())
