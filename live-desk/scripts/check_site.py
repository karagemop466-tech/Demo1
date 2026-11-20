#!/usr/bin/env python3
"""Validate local site links and require a source link in each research table data row."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, unquote
import argparse
import sys

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
parser_args = argparse.ArgumentParser()
parser_args.add_argument('--root', type=Path, default=DEFAULT_ROOT, help='site root to validate')
ROOT = parser_args.parse_args().root.resolve()

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = set()
        self.table_rows = []
        self.in_research_table = False
        self.in_tbody = False
        self.in_row = False
        self.row_has_source = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
            if self.in_row:
                self.row_has_source = True
        if tag == 'table' and 'research-table' in attrs.get('class', '').split():
            self.in_research_table = True
        if tag == 'tbody' and self.in_research_table:
            self.in_tbody = True
        if tag == 'tr' and self.in_research_table and self.in_tbody:
            self.in_row = True
            self.row_has_source = False
    def handle_endtag(self, tag):
        if tag == 'tr' and self.in_row:
            self.table_rows.append(self.row_has_source)
            self.in_row = False
        if tag == 'tbody' and self.in_research_table:
            self.in_tbody = False
        if tag == 'table' and self.in_research_table:
            self.in_research_table = False

errors = []
html_files = sorted(ROOT.rglob('*.html'))
source_rows = 0
for page in html_files:
    page_parser = PageParser()
    page_parser.feed(page.read_text(encoding='utf-8'))
    source_rows += len(page_parser.table_rows)
    for index, href in enumerate(page_parser.links, 1):
        parsed = urlparse(href)
        if parsed.scheme or parsed.netloc or href.startswith('mailto:'):
            continue
        target = (page.parent / unquote(parsed.path)).resolve() if parsed.path else page.resolve()
        if not target.exists():
            errors.append(f'{page.relative_to(ROOT)}: broken local link #{index}: {href}')
            continue
        if parsed.fragment and target.suffix.lower() == '.html':
            target_parser = PageParser()
            target_parser.feed(target.read_text(encoding='utf-8'))
            if unquote(parsed.fragment) not in target_parser.ids:
                errors.append(f'{page.relative_to(ROOT)}: missing anchor #{parsed.fragment} in {target.relative_to(ROOT)}')
    if any(not has_source for has_source in page_parser.table_rows):
        errors.append(f'{page.relative_to(ROOT)}: every research table data row must include a source link')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'OK: checked {len(html_files)} HTML pages, local links, anchors, and {source_rows} sourced research rows in {ROOT}')
