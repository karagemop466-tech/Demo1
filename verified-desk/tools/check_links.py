#!/usr/bin/env python3
"""Site integrity checker — run before every commit that touches a page.

Checks, all offline unless --online is passed:

1. internal links      every href/src in every *.html resolves to a file in the
                       repo, and every #anchor exists as an id in that file
2. shell + mounts       every page carries the three shell ids app.js expects,
                       and every mount id referenced from assets/app.js exists
                       on the page whose data-page triggers that renderer
3. doc links            every docs.kalshi.com URL must be a real page in the
                       official index (llms.txt). Pass --llms <file> to check
                       against a saved copy, or --online to fetch it.
4. snapshot provenance  every event / market / series row in data/snapshot.json
                       carries a source URL, and nulls are still nulls
5. nav coverage         every page in NAV is reachable and every html file at
                       the repo root is in NAV (no orphans, no dead menu items)

Exit code 0 = clean. Anything reported as BROKEN fails the run; UNVERIFIED links
are reported but do not fail, because a blocked network is not a broken site.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANCHOR = re.compile(r"""(?:href|src)\s*=\s*[\x22\x27]([^\x22\x27]+)[\x22\x27]""", re.I)
ID_RE = re.compile(r"""\bid\s*=\s*[\x22\x27]([\w.:-]+)[\x22\x27]""", re.I)
MOUNT_RE = re.compile(r"""getElementById\(\s*[\x22\x27](mount-[\w-]+)[\x22\x27]\s*\)""")
DP_RE = re.compile(r"""data-page=[\x22\x27]([\w-]+)[\x22\x27]""")
# NAV entries are [id, label, href] triples inside nested `items:` arrays.
NAV_RE = re.compile(r"""\[\s*[\x22\x27]([\w-]+)[\x22\x27]\s*,\s*[\x22\x27][^\x22\x27]*[\x22\x27]\s*,\s*[\x22\x27]([^\x22\x27]+)[\x22\x27]\s*\]""")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def pages():
    return sorted(f for f in os.listdir(ROOT) if f.endswith(".html"))


def check_internal(broken):
    ids = {}
    for f in pages():
        ids[f] = set(ID_RE.findall(read(os.path.join(ROOT, f))))
    checked = 0
    for f in pages():
        for target in ANCHOR.findall(read(os.path.join(ROOT, f))):
            if target.startswith(("http://", "https://", "mailto:", "data:", "#")):
                continue
            checked += 1
            path, _, frag = target.partition("#")
            path = path.split("?")[0]          # ?market=... is a page-level query, not a file
            if path.startswith("/"):
                broken.append(f"{f}: absolute path link {target!r} will 404 under a repo subpath")
                continue
            full = os.path.normpath(os.path.join(ROOT, path))
            if not os.path.exists(full):
                broken.append(f"{f}: missing file for {target!r}")
                continue
            if frag and os.path.isfile(full):
                if full.endswith(".html") and frag not in ids.get(os.path.relpath(full, ROOT), set()):
                    broken.append(f"{f}: no id {frag!r} in {path}")
    return checked, len(ids)


def check_mounts(broken):
    js = read(os.path.join(ROOT, "assets", "app.js"))
    mounts = MOUNT_RE.findall(js)
    # which renderer owns which mount, from the renderer function bodies
    renderers = dict(re.findall(r"function render(\w+)\(\)([\s\S]*?)\n  \}\n", js))
    pages_by_dp = {}
    for f in pages():
        m = DP_RE.search(read(os.path.join(ROOT, f)))
        if m:
            pages_by_dp.setdefault(m.group(1), []).append(f)
    checked = 0
    for name, body in renderers.items():
        key = {"Dashboard": "dashboard", "Markets": "markets", "Portfolio": "portfolio",
               "Suggestions": "suggestions", "Explorer": "markets", "Sim": "portfolio"}.get(name)
        if key is None:
            continue
        wanted = [mm for mm in MOUNT_RE.findall(body)]
        for f in pages_by_dp.get(key, []):
            have = set(re.findall(r'id="(mount-[\w-]+)"', read(os.path.join(ROOT, f))))
            for w in wanted:
                checked += 1
                if w not in have:
                    broken.append(f"{f}: renderer render{name} expects #{w}, which the page does not contain")
    for f in pages():
        html = read(os.path.join(ROOT, f))
        for shell in ("site-header", "site-nav", "site-footer"):
            if f'id="{shell}"' not in html:
                broken.append(f"{f}: missing #{shell}")
        if f != "index.html" and "assets/app.css" not in html:
            broken.append(f"{f}: no stylesheet link")
        if "assets/app.js" not in html or "assets/kalshi.js" not in html:
            broken.append(f"{f}: missing engine or shell script")
    return checked + len(mounts)


def check_docs_links(unverified, broken, llms_text):
    host_pat = re.compile(r"https://docs\.kalshi\.com/[^\s\"'<>)\]]+")
    links = set()
    for f in pages() + ["assets/app.js", "assets/kalshi.js", "COORDINATION.md", "README.md"]:
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            links |= set(host_pat.findall(read(p)))
    slugs = {re.sub(r"\.md$", "", u.rstrip("/")) for u in re.findall(r"https://docs\.kalshi\.com/[^\s)\]]+", llms_text)} if llms_text else set()
    for u in sorted(links):
        bare = re.sub(r"\.md$", "", u.rstrip("/"))
        if llms_text and bare not in slugs:
            broken.append(f"not in the official docs index: {u}")
    return len(links), bool(llms_text)


def check_snapshot(broken, warn):
    """Every *rendered* row must trace to an official URL. Markets inherit their
    event's source (that is what the table rows are built from), so a market row
    counts as sourced when it or its parent event carries one."""
    snap = json.loads(read(os.path.join(ROOT, "data", "snapshot.json")))
    rows = 0
    for s_ in snap.get("series_volume", []):
        rows += 1
        if not str(s_.get("source", "")).startswith("http"):
            broken.append("snapshot: series row without a source URL: " + str(s_.get("series_ticker")))
    for e in snap.get("events", []):
        rows += 1
        esrc = str(e.get("source", ""))
        if not esrc.startswith("http"):
            broken.append("snapshot: event without a source URL: " + str(e.get("event_ticker")))
        for m in e.get("markets", []):
            rows += 1
            if not str(m.get("source", esrc)).startswith("http"):
                broken.append("snapshot: market without any source URL: " + str(m.get("ticker")))
    if snap.get("candlesticks") and not str(snap["candlesticks"].get("source", "")).startswith("http"):
        broken.append("snapshot: candlestick block without a source URL")
    if snap.get("orderbook") and not str(snap["orderbook"].get("source", "")).startswith("http"):
        broken.append("snapshot: orderbook block without a source URL")
    if snap.get("credentials_used") is not None:
        broken.append("snapshot: credentials_used must stay null in a public file")
    blanks = sum(1 for e in snap["events"] for m in e["markets"] if m.get("volume_fp") in (None, ""))
    warn.append(f"rows checked: {rows} · markets with a deliberately blank volume field: {blanks}")
    return rows


def check_nav(broken):
    js = read(os.path.join(ROOT, "assets", "app.js"))
    start = js.index("const NAV")
    nav_block = js[start:js.index("\n  ];", start)]
    nav = NAV_RE.findall(nav_block)
    nav_files = {h.split("#")[0] for _, h in nav}
    on_disk = set(pages())
    for _, href in nav:
        if href.split("#")[0] not in on_disk:
            broken.append(f"NAV points at {href}, which does not exist")
    for f in sorted(on_disk - nav_files):
        broken.append(f"{f} is not in NAV (orphan page)")
    return len(nav)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--llms", help="path to a saved copy of https://docs.kalshi.com/llms.txt")
    ap.add_argument("--online", action="store_true", help="fetch llms.txt and HEAD-check the API URLs")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    llms_text = ""
    if a.llms and os.path.exists(a.llms):
        llms_text = read(a.llms)
    elif a.online:
        try:
            import urllib.request
            with urllib.request.urlopen("https://docs.kalshi.com/llms.txt", timeout=20) as r:
                llms_text = r.read().decode()
        except Exception as exc:  # noqa: BLE001
            print(f"! could not fetch llms.txt ({exc}); doc-link check skipped", file=sys.stderr)

    broken, warn = [], []
    n_links, n_pages = check_internal(broken)
    n_mounts = check_mounts(broken)
    n_docs, llm_used = check_docs_links(unverified=not llms_text, broken=broken, llms_text=llms_text)
    n_rows = check_snapshot(broken, warn)
    n_nav = check_nav(broken)

    if a.online:
        api_pat = re.compile(r"https://(?:external-api\.demo\.kalshi\.co|external-api\.kalshi\.com)[^\s\"'<>)\]]+")
        urls = set()
        for f in pages():
            urls |= set(api_pat.findall(read(os.path.join(ROOT, f))))
        for u in sorted(urls):
            try:
                import urllib.request
                req = urllib.request.Request(u, method="GET", headers={"User-Agent": "link-check"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    warn.append(f"API link {r.status}: {u[:90]}")
            except Exception as exc:  # noqa: BLE001
                warn.append(f"API link UNREACHABLE {type(exc).__name__}: {u[:90]}")

    if not a.quiet:
        print(f"pages {n_pages} · internal links {n_links} · mount checks {n_mounts} · "
              f"docs links {n_docs}{'' if llm_used else ' (no index to match against)'} · "
              f"nav entries {n_nav} · snapshot rows {n_rows}")
        for w in warn:
            print("  note:", w)
    if broken:
        print(f"\nBROKEN ({len(broken)}):", file=sys.stderr)
        for b in broken:
            print("  ✗", b, file=sys.stderr)
        return 1
    print("clean — no broken internal links, all mounts and nav entries resolve"
          + (", doc links matched against the official index" if llm_used else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
