#!/usr/bin/env python3
"""Regression tests for the integration-layer files this session owns:

  * index.html          — landing page, whose data blocks must match the snapshot
  * assets/common.js    — shared primary navigation
  * integration/page-directory.html — generated page index

The checks here recompute values independently from the committed JSON instead of
calling the generator, so a bug in tools/build_landing.py cannot make its own output
look correct. Everything is offline: no network, no browser.

Run: python3 -m unittest tests.test_landing_directory -v
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import unittest
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {".git", "node_modules", ".github", ".arena", "site_src"}
PRIMARY = [
    "trade-desk/index.html",
    "trade-desk/chart.html",
    "trade-desk/resolutions.html",
    "trade-desk/strategies.html",
    "integration/page-directory.html",
    "integration/executive-summary.html",
    "integration/flagged-review.html",
    "site/index.html",
    "site/sources.html",
]


def snapshot():
    meta = json.loads((ROOT / "snapshot/metadata.json").read_text(encoding="utf-8"))
    markets = json.loads((ROOT / "snapshot/markets.json").read_text(encoding="utf-8"))["markets"]
    resolved = json.loads((ROOT / "snapshot/resolved.json").read_text(encoding="utf-8"))["markets"]
    return meta, markets, resolved


def shipped_pages() -> set[Path]:
    out = set()
    for p in ROOT.rglob("*.html"):
        rel = p.relative_to(ROOT)
        if set(rel.parts) & SKIP_PARTS:
            continue
        out.add(rel)
    return out


class LandingFigures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.meta, cls.markets, cls.resolved = snapshot()

    def test_open_and_closed_counts_match_snapshot(self):
        counts = self.meta["counts"]
        self.assertIn(f'{counts["open_markets"]:,}', self.html,
                      "open-market count from snapshot/metadata.json is not on the landing page")
        self.assertIn(f'{counts["resolved_markets"]:,}', self.html,
                      "closed-record count from snapshot/metadata.json is not on the landing page")

    def test_settled_and_awaiting_are_derived_from_result_field(self):
        settled = sum(1 for r in self.resolved if (r.get("result") or "").lower() in ("yes", "no"))
        awaiting = len(self.resolved) - settled
        self.assertIn(f"{settled:,}", self.html, "settled (result yes/no) count missing or wrong")
        self.assertIn(f"{awaiting:,}", self.html, "awaiting-result count missing or wrong")
        # the definitions must be stated, not implied
        self.assertIn("market lifecycle", self.html)
        self.assertIn("awaiting", self.html)

    def test_snapshot_timestamp_matches_metadata(self):
        self.assertIn(self.meta["generated_utc"], self.html,
                      "the landing page does not show the snapshot timestamp from metadata.json")

    def test_per_topic_counts_reconcile_to_totals(self):
        per_topic = {}
        for key in ("gas_prices", "elections", "culture", "crypto", "golf"):
            per_topic[key] = sum(1 for m in self.markets if m.get("topic") == key)
        self.assertEqual(sum(per_topic.values()), self.meta["counts"]["open_markets"],
                         "per-topic open counts do not add up to the snapshot total")
        body = self.html.split("<!-- TOPICS:START -->")[1].split("<!-- TOPICS:END -->")[0]
        for key, n in per_topic.items():
            self.assertIn(f'class="num">{n:,}</td>', body, f"{key} open count {n} missing from the topic table")

    def test_no_unanchored_claim_of_official_usd_volume(self):
        # The API has no official USD-volume field; the page must not imply otherwise.
        self.assertIn("estimate", self.html.lower())
        self.assertNotIn("official dollar-volume field", self.html.replace("no official dollar-volume field", ""))


class Navigation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.common = (ROOT / "assets" / "common.js").read_text(encoding="utf-8")
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_primary_targets_exist(self):
        for target in PRIMARY:
            self.assertTrue((ROOT / target).exists(), f"primary navigation target missing: {target}")

    def test_shared_nav_is_the_primary_set(self):
        entries = re.findall(r'\["([^"]+)",\s*"([^"]+)"\]', self.common)
        self.assertGreaterEqual(len(entries), 8, "shared nav lost its primary entries")
        self.assertLessEqual(len(entries), 12, "shared nav has grown back into a directory; use the page index")
        listed = [p for p, _ in entries]
        for target in listed:
            self.assertTrue((ROOT / target).exists(), f"shared nav points at a missing file: {target}")
        self.assertIn("integration/page-directory.html", listed,
                      "shared nav must expose the page index")

    def test_root_nav_matches_the_same_primary_set(self):
        for target in PRIMARY:
            self.assertIn(f'href="{target}"', self.html, f"root landing nav/tile does not link {target}")


class PageDirectory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir_html = (ROOT / "integration" / "page-directory.html").read_text(encoding="utf-8")
        cls.linked = set(re.findall(r'<td class="path">([^<]+)</td>', cls.dir_html))

    def test_every_shipped_page_is_listed(self):
        pages = {p.as_posix() for p in shipped_pages()}
        pages.discard("integration/page-directory.html")
        missing = sorted(pages - self.linked)
        self.assertEqual(missing, [], f"pages missing from the directory: {missing[:5]}")

    def test_no_row_points_at_a_missing_file(self):
        for rel in self.linked:
            self.assertTrue((ROOT / rel).exists(), f"directory lists a file that does not exist: {rel}")

    def test_rows_carry_the_pages_own_title(self):
        # Compare on rendered text, not raw markup: the directory escapes titles
        # (e.g. "Trader&#x27;s Guide"), so an escaped-vs-raw comparison is a false
        # failure waiting for a page with an apostrophe or ampersand in its title.
        plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", self.dir_html)))
        for rel in sorted(self.linked):
            text = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
            m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
            if not m:
                continue
            title = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
            self.assertIn(title, plain, f"title of {rel} not reflected in the directory")


class Reachability(unittest.TestCase):
    def test_every_page_is_reachable_from_the_landing_page(self):
        pages = shipped_pages()
        seen = {Path("index.html")}
        queue = deque(seen)
        while queue:
            cur = queue.popleft()
            text = (ROOT / cur).read_text(encoding="utf-8", errors="ignore")
            for raw in re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', text, re.I):
                if not raw or raw.startswith(("#", "mailto:", "data:", "javascript:", "//")):
                    continue
                if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", raw):
                    continue
                path = urlsplit(raw).path
                if not path:
                    continue
                target = ((ROOT / cur).parent / path).resolve()
                try:
                    rel = target.relative_to(ROOT)
                except ValueError:
                    continue
                if (ROOT / rel).is_dir():
                    rel = rel / "index.html"
                if rel.suffix.lower() == ".html" and (ROOT / rel).exists() and rel not in seen:
                    seen.add(rel)
                    queue.append(rel)
        orphans = sorted(p.as_posix() for p in pages - seen)
        self.assertEqual(orphans, [], f"pages not reachable from index.html: {orphans}")


class GeneratorsAreIdempotent(unittest.TestCase):
    def _run(self, script: str, check: str = "--check"):
        out = subprocess.run([sys.executable, str(ROOT / script), check],
                             cwd=ROOT, capture_output=True, text=True)
        return out.returncode, out.stdout + out.stderr

    def test_landing_generator_reports_current(self):
        code, out = self._run("tools/build_landing.py")
        self.assertEqual(code, 0, out)

    def test_directory_generator_reports_current(self):
        code, out = self._run("tools/build_directory.py")
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
