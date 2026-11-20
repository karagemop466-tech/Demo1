#!/usr/bin/env python3
"""Offline regression tests for topic classification + coverage targeting in
scripts/fetch_kalshi_data.py. No network: these exercise the pure helpers only.

Why these tests exist (all evidence is in this repository):
  * docs/data/snapshot.json (CI run 2026-11-20T13:40:48Z) listed the event
    "When will Las Vegas receive a Pro Basketball expansion team?" as the TOP event of the
    *gas prices* topic, because the keyword rule did a substring match for "gas" and
    "vegas" contains it. Titles/tags now have to match on word boundaries; series tickers
    may still match by substring because tickers concatenate words (KXAAAGASW).
  * docs/data/series_map.json lists the national gas series as "AAAGASW"/"AAAGASW" style
    tickers while events report "KXAAAGASW", so exact membership failed; comparison is now
    done on a KX-prefix-insensitive key.
  * every gas event in that snapshot carried $0.00 estimated 24 h volume because the
    busiest gas series were never fetched at all (the top-up only ran for topics with fewer
    than 5 matches). The busiest series per topic are now always fetched directly.

Run:  python3 -m unittest discover -s tests -p 'test_*.py'   (or this file directly)
"""
import importlib.util
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = importlib.util.spec_from_file_location("fetch_kalshi_data", os.path.join(ROOT, "scripts", "fetch_kalshi_data.py"))
fk = importlib.util.module_from_spec(SPEC)
sys.modules["fetch_kalshi_data"] = fk
SPEC.loader.exec_module(fk)


class TestWordBoundaries(unittest.TestCase):
    def test_las_vegas_is_not_gas(self):
        title = "When will Las Vegas receive a Pro Basketball expansion team?"
        self.assertFalse(fk.keyword_in_text("gas", title))
        self.assertFalse(fk.series_keyword_hit("gas", "KXNBACITYEXPAND", title, ["NBA", "Las Vegas", "Sports"]))

    def test_real_gas_titles_still_match(self):
        for t in ["US gas prices this week", "Will average gas price be above $3.64?", "Gasoline price on Nov 23, 2026"]:
            self.assertTrue(fk.keyword_in_text("gas", t), t)

    def test_multiword_keywords(self):
        self.assertTrue(fk.keyword_in_text("gas", "US energy price index update"))
        self.assertTrue(fk.keyword_in_text("golf", "Ryder Cup odds board"))
        self.assertFalse(fk.keyword_in_text("golf", "Ryder not cup"))

    def test_untouched_topics_take_everything_in_their_category(self):
        self.assertTrue(fk.series_keyword_hit("crypto", "KXBTC", "Bitcoin above $100k?", []))
        self.assertTrue(fk.series_keyword_hit("elections", "KXANY", "Anything", []))


class TestSeriesTickerMatching(unittest.TestCase):
    def test_gas_series_ticker_matches_by_substring(self):
        self.assertTrue(fk.series_keyword_hit("gas", "KXAAAGASW", "US gas price up", ["Oil and energy"]))
        # a ticker-only match is enough even when the title says nothing
        self.assertTrue(fk.series_keyword_hit("gas", "KXAAAGASD", "US gas price up", []))

    def test_norm_series_prefix_insensitive(self):
        self.assertEqual(fk.norm_series("KXAAAGASW"), fk.norm_series("AAAGASW"))
        self.assertEqual(fk.norm_series(" kxaaagasw "), fk.norm_series("KXAAAGASW"))
        self.assertEqual(fk.norm_series(""), "")
        self.assertEqual(fk.norm_series(None), "")
        self.assertNotEqual(fk.norm_series("KXBTC"), fk.norm_series("KXBTCD"))


class TestClassifyEvent(unittest.TestCase):
    SERIES_MAP = {
        "gas": {"AAAGASW", "KXAAAGASD"},
        "elections": {"KXPRESPERSON"},
        "crypto": set(),
        "culture": set(),
        "golf": set(),
    }
    NORM = {t: {fk.norm_series(x) for x in v} for t, v in SERIES_MAP.items()}

    def test_prefixed_event_matches_unprefixed_series_list(self):
        ev = {"event_ticker": "KXAAAGASW-26NOV23", "series_ticker": "KXAAAGASW", "title": "US gas prices this week", "category": "Economics"}
        self.assertEqual(fk.classify_event(ev, self.SERIES_MAP, self.NORM), "gas")

    def test_vegas_expansion_event_is_not_gas(self):
        ev = {"event_ticker": "KXNBACITYEXPAND-01JAN30", "series_ticker": "KXNBACITYEXPAND",
              "title": "When will Las Vegas receive a Pro Basketball expansion team?", "category": "Sports"}
        self.assertIsNone(fk.classify_event(ev, self.SERIES_MAP, self.NORM))

    def test_membership_works_without_the_optional_norm_map(self):
        ev = {"series_ticker": "KXPRESPERSON", "title": "Who wins the presidency?", "category": ""}
        self.assertEqual(fk.classify_event(ev, self.SERIES_MAP), "elections")

    def test_documented_category_fallbacks_still_apply(self):
        self.assertEqual(fk.classify_event({"series_ticker": "KXUNKNOWN", "category": "Crypto", "title": "x"}, self.SERIES_MAP, self.NORM), "crypto")
        self.assertEqual(fk.classify_event({"series_ticker": "KXUNKNOWN", "category": "Entertainment", "title": "x"}, self.SERIES_MAP, self.NORM), "culture")

    def test_unrelated_event_matches_nothing(self):
        ev = {"series_ticker": "KXWEATHER", "title": "Rain in Paris on Nov 25?", "category": "Economics"}
        self.assertIsNone(fk.classify_event(ev, self.SERIES_MAP, self.NORM))


class TestCoverageTargets(unittest.TestCase):
    """The rule that decides which series get fetched directly, by reported volume."""

    def test_busiest_series_are_fetched_first_for_every_topic(self):
        series_volumes = {"AAAGASW": 94_711_078.0, "AAAGASM": 74_918_118.0, "AAAGASCDAL": 12.0}
        avail = ["KXAAAGASCDAL", "KXAAAGASW", "AAAGASM"]
        ranked = sorted(avail, key=lambda x: (-(series_volumes.get(fk.norm_series(x)) or 0), x))
        self.assertEqual(ranked, ["KXAAAGASW", "AAAGASM", "KXAAAGASCDAL"])

    def test_constant_bounds_the_request_budget(self):
        self.assertLessEqual(fk.TOP_SERIES_PER_TOPIC, 20)
        self.assertGreaterEqual(fk.TOP_SERIES_PER_TOPIC, 5)

    def test_series_list_request_asks_for_documented_volume_field(self):
        import inspect
        src = inspect.getsource(fk.build_series_map)
        self.assertIn("include_volume=true", src)


class TestPipelineContract(unittest.TestCase):
    def test_series_map_returns_three_values(self):
        import inspect
        sig = inspect.signature(fk.build_series_map)
        self.assertEqual(len(sig.parameters), 1)          # (session) — the function never uses it
        src = inspect.getsource(fk.build_series_map)
        self.assertIn("return mapping, raw_categories, volumes", src)

    def test_snapshot_topics_keep_honest_metric_names(self):
        import inspect
        src = inspect.getsource(fk.event_row)
        for key in ("est_usd_volume_24h", "notional_at_stake_usd", "api_url"):
            self.assertIn(key, src)

    def test_api_base_is_the_documented_demo_endpoint(self):
        self.assertEqual(fk.BASE, "https://external-api.demo.kalshi.co/trade-api/v2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
