#!/usr/bin/env python3
"""Internal link checker for the static site.
Usage: python3 scripts/check_links.py
- Verifies every relative href/src in *.html and docs/*.md resolves to a real file.
- Reports external links (not fetched here; they were sourced from official docs).
Exit code 1 if any internal link is broken."""
import os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATTR = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
MDLINK = re.compile(r'\[[^\]]*\]\(([^)]+)\)')

def collect():
    targets = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules", ".github"}]
        for fn in filenames:
            if fn.endswith(".html") or (fn.endswith(".md") and "node_modules" not in dirpath):
                targets.append(os.path.join(dirpath, fn))
    return targets

def main():
    broken, external, checked = [], [], 0
    for path in collect():
        with open(path, encoding="utf-8") as f:
            text = f.read()
        links = ATTR.findall(text) + MDLINK.findall(text)
        for link in links:
            link = link.strip()
            if not link or link.startswith(("#", "mailto:", "javascript:", "data:")):
                continue
            if re.match(r'^[a-z][a-z0-9+.-]*:', link, re.I) or link.startswith("//"):
                external.append((os.path.relpath(path, ROOT), link))
                continue
            # strip fragment / query
            rel = urllib.parse.urlsplit(link).path
            if not rel:
                continue
            base = os.path.dirname(path)
            dest = os.path.normpath(os.path.join(base, urllib.parse.unquote(rel)))
            checked += 1
            if not os.path.exists(dest):
                broken.append((os.path.relpath(path, ROOT), link))
    print(f"internal links checked: {checked}")
    print(f"external links (sourced, not fetched): {len(external)}")
    if broken:
        print("BROKEN:")
        for src, link in broken:
            print(f"  {src} -> {link}")
        return 1
    print("OK: no broken internal links")
    return 0

if __name__ == "__main__":
    sys.exit(main())
