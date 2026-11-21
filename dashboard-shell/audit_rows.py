#!/usr/bin/env python3
"""Report static tbody rows without a direct Kalshi or GitHub Docs hyperlink.

This is a triage aid, not an accuracy verdict or an exhaustive source audit:
process/empty states count, other official publishers are not in the allowlist,
and JavaScript-generated rows are not visible to this static parser. Existing
repository findings are non-blocking; the dashboard's own rendered-row source
checks are enforced by test_dashboard.mjs instead.
"""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", ".arena", "site_src"}
HOSTS = {
    "docs.kalshi.com", "kalshi.com", "external-api.demo.kalshi.co",
    "demo-api.kalshi.co", "external-api.kalshi.com", "docs.github.com",
}


class Rows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = 0
        self.row = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "tbody":
            self.in_body += 1
        if tag == "tr" and self.in_body and self.row is None:
            self.row = {"text": [], "hrefs": []}
        elif tag == "a" and self.row is not None:
            self.row["hrefs"].append(dict(attrs).get("href", ""))

    def handle_endtag(self, tag):
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        if tag == "tbody" and self.in_body:
            self.in_body -= 1

    def handle_data(self, data):
        if self.row is not None:
            self.row["text"].append(data)


def audit():
    pages, total = Counter(), 0
    for path in ROOT.rglob("*.html"):
        rel = path.relative_to(ROOT)
        if set(rel.parts) & SKIP:
            continue
        parser = Rows()
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
        for row in parser.rows:
            if not " ".join(" ".join(row["text"]).split()):
                continue
            total += 1
            if not any(urlsplit(href).hostname in HOSTS for href in row["hrefs"]):
                pages[rel.as_posix()] += 1
    return total, pages


def main():
    total, pages = audit()
    print(f"Static nonempty tbody rows: {total}; without a direct Kalshi/GitHub Docs link: {sum(pages.values())} across {len(pages)} pages")
    for page, count in pages.most_common(15):
        print(f"  {count:5d}  {page}")
    print("Review signal only: includes process rows; excludes runtime-rendered rows; other official publishers are not counted.")


if __name__ == "__main__":
    main()
