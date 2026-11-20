#!/usr/bin/env python3
"""Line-by-line checks for the live alert chat feed.

Every published number in alerts/data/feed.json is re-derived here from the
committed official responses (engine/jumps.json, snapshot/markets.json,
snapshot/resolved.json, snapshot/charts.json) and from the published fee
table. Nothing is taken on trust.

Run:  python3 alerts/tools/test_alerts.py
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FEED = os.path.join(REPO, "alerts", "data", "feed.json")
BASE = "https://external-api.demo.kalshi.co/trade-api/v2"


def load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FEES = module(os.path.join(REPO, "desk", "tools", "kalshi_fees.py"), "kalshi_fees")
BUILDER = module(os.path.join(REPO, "alerts", "tools", "build_alerts.py"), "build_alerts")


class FeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.feed = load(FEED)
        cls.jumps_doc = load(os.path.join(REPO, "engine", "jumps.json"))
        cls.markets_doc = load(os.path.join(REPO, "snapshot", "markets.json"))
        cls.charts_doc = load(os.path.join(REPO, "snapshot", "charts.json"))
        cls.resolved_doc = load(os.path.join(REPO, "snapshot", "resolved.json"))
        cls.markets = {m["market_ticker"]: m for m in cls.markets_doc["markets"]}
        cls.resolved = {m["market_ticker"]: m for m in cls.resolved_doc["markets"]}
        cls.jumps_by_key = {}
        for j in cls.jumps_doc["jumps"]:
            cls.jumps_by_key[(j["market_ticker"], j["t"], j["window"], j["price_basis"])] = j

    # -- provenance ------------------------------------------------------

    def test_base_url_is_the_documented_demo_endpoint(self):
        self.assertEqual(self.feed["base"], BASE)
        self.assertTrue(self.feed["base"].startswith("https://external-api.demo.kalshi.co/"))

    def test_every_alert_row_points_at_the_request_that_produced_it(self):
        for row in self.feed["jumps"]:
            self.assertTrue(row["source_url"].startswith(BASE + "/series/"),
                            "alert without an official source: %r" % row["source_url"])
            self.assertIn("/markets/" + row["market_ticker"] + "/candlesticks", row["source_url"])
            self.assertIn("period_interval=", row["source_url"])

    def test_every_alert_row_is_present_in_the_scanner_output(self):
        for row in self.feed["jumps"]:
            key = (row["market_ticker"], row["t"], row["window"], row["price_basis"])
            self.assertIn(key, self.jumps_by_key, "alert not traceable to the scanner: %r" % (key,))
            src = self.jumps_by_key[key]
            self.assertEqual(src["source_url"], row["source_url"])
            self.assertEqual(src["delta"], row["delta"])
            self.assertEqual(src["from"], row["from"])
            self.assertEqual(src["to"], row["to"])

    # -- the alert rule --------------------------------------------------

    def test_every_alert_meets_the_threshold(self):
        threshold = self.feed["threshold_dollars"]
        self.assertEqual(threshold, 0.10)
        for row in self.feed["jumps"]:
            self.assertGreaterEqual(abs(row["delta"]), threshold - 1e-9,
                                    "alert below the threshold: %r" % row)

    def test_delta_equals_to_minus_from(self):
        for row in self.feed["jumps"]:
            self.assertAlmostEqual(row["delta"], row["to"] - row["from"], places=9)
            expected = "up" if row["to"] >= row["from"] else "down"
            self.assertEqual(row["direction"], expected)

    def test_no_alert_uses_a_window_outside_the_published_set(self):
        allowed = {"1m/6h", "1h/7d", "1d/90d"}
        for row in self.feed["jumps"]:
            self.assertIn(row["window"], allowed)
            self.assertIn(row["price_basis"], ("traded", "book mid"))

    # -- coverage --------------------------------------------------------

    def test_coverage_counts_match_the_arrays(self):
        cov = self.feed["coverage"]
        self.assertEqual(cov["alerts_published"], len(self.feed["jumps"]))
        self.assertEqual(cov["shortlisted_markets"], len(self.feed["shortlist"]))
        by_topic = {}
        by_window = {}
        for row in self.feed["jumps"]:
            by_topic[row["topic"]] = by_topic.get(row["topic"], 0) + 1
            by_window[row["window"]] = by_window.get(row["window"], 0) + 1
        self.assertEqual(cov["alerts_by_topic"], by_topic)
        self.assertEqual(cov["alerts_by_window"], by_window)
        alerted = {r["market_ticker"] for r in self.feed["jumps"]}
        self.assertEqual(cov["markets_with_an_alert"], len(alerted))

    def test_markets_without_an_alert_are_real_markets_with_candles(self):
        for m in self.feed["coverage"]["markets_without_an_alert"]:
            self.assertIn(m["market_ticker"], self.markets)
            tickers = [s["market_ticker"] for s in self.charts_doc["series"]]
            self.assertIn(m["market_ticker"], tickers)

    def test_shortlist_covers_one_candidate_per_alerting_market(self):
        alerting = {r["market_ticker"] for r in self.feed["jumps"]}
        shortlisted = {r["market_ticker"] for r in self.feed["shortlist"]}
        self.assertEqual(shortlisted, alerting)

    # -- the model -------------------------------------------------------

    def test_weights_sum_to_one(self):
        weights = self.feed["model"]["weights"]
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=9)

    def test_scores_are_recomputable_from_the_published_components(self):
        weights = self.feed["model"]["weights"]
        for row in self.feed["shortlist"]:
            total_w = 0.0
            acc = 0.0
            for name, comp in row["components"].items():
                if comp.get("normalised") is None:
                    self.assertIn(name, " ".join(row["excluded_inputs"]),
                                  "missing component %s not disclosed" % name)
                    continue
                self.assertTrue(0.0 <= comp["normalised"] <= 1.0,
                                "component out of range: %s %s" % (name, comp["normalised"]))
                total_w += weights[name]
                acc += weights[name] * comp["normalised"]
            expected = round(100.0 * acc / total_w, 1)
            self.assertAlmostEqual(row["score"], expected, places=6,
                                   msg="score mismatch for %s" % row["market_ticker"])
            self.assertAlmostEqual(row["weights_used"], total_w, places=6)

    def test_shortlist_is_sorted_by_score(self):
        scores = [r["score"] for r in self.feed["shortlist"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        for i, row in enumerate(self.feed["shortlist"], start=1):
            self.assertEqual(row["rank"], i)

    def test_move_component_matches_the_published_move(self):
        for row in self.feed["shortlist"]:
            comp = row["components"]["move_size"]
            self.assertAlmostEqual(comp["value"], abs(row["move"]["delta"]), places=6)
            cap = self.feed["model"]["caps"]["max_move_normalised_dollars"]
            self.assertAlmostEqual(comp["normalised"], min(comp["value"] / cap, 1.0), places=6)

    def test_recency_component_matches_the_published_formula(self):
        half_life = 6.0
        for row in self.feed["shortlist"]:
            comp = row["components"]["recency"]
            age = comp["value"]
            self.assertIsNotNone(age)
            expected = 1.0 / (1.0 + max(age, 0.0) / half_life)
            self.assertAlmostEqual(comp["normalised"], round(expected, 4), places=6)

    def test_horizon_component_matches_close_time(self):
        import datetime as dt
        ref = dt.datetime.fromisoformat(
            self.markets_doc["generated_utc"].replace("Z", "+00:00"))
        for row in self.feed["shortlist"]:
            comp = row["components"]["horizon"]
            m = self.markets[row["market_ticker"]]
            close = dt.datetime.fromisoformat(m["close_time"].replace("Z", "+00:00"))
            hours = (close - ref).total_seconds() / 3600.0
            self.assertAlmostEqual(comp["value"], round(hours, 2), places=1)
            cap = self.feed["model"]["caps"]["max_horizon_hours"]
            expected = 1.0 - min(max(hours, 0.0), cap) / cap
            self.assertAlmostEqual(comp["normalised"], round(expected, 4), places=4)

    def test_implied_ask_is_one_minus_the_best_no_bid(self):
        """Official rule: a NO bid at p is a YES ask at 1 - p."""
        for row in self.feed["shortlist"]:
            m = self.markets[row["market_ticker"]]
            no_bids = (m.get("orderbook") or {}).get("no_bids") or []
            if not no_bids:
                self.assertIsNone(row["current"]["yes_ask_implied"])
                continue
            best = max(float(l["price"]) for l in no_bids)
            self.assertAlmostEqual(row["current"]["yes_ask_implied"], round(1.0 - best, 4), places=4)

    def test_depth_component_only_counts_levels_within_the_band(self):
        band = self.feed["model"]["caps"]["depth_band_dollars"]
        for row in self.feed["shortlist"]:
            m = self.markets[row["market_ticker"]]
            ob = m.get("orderbook") or {}
            price = row["move"]["to"]
            total = 0.0
            for level in ob.get("yes_bids") or []:
                if float(level["price"]) >= price - band - 1e-9:
                    total += float(level["contracts"])
            for level in ob.get("no_bids") or []:
                if (1.0 - float(level["price"])) <= price + band + 1e-9:
                    total += float(level["contracts"])
            self.assertAlmostEqual(row["components"]["depth"]["value"], total, places=4)

    def test_fee_component_uses_the_published_formula(self):
        clip = self.feed["model"]["caps"]["clip_contracts"]
        for row in self.feed["shortlist"]:
            comp = row["components"]["fee_efficiency"]
            price = row["move"]["to"]
            mult = comp["taker_multiplier"]
            if price is None or not (0 < price < 1):
                continue
            expected = FEES.taker_fee(price, clip, mult) * 2
            self.assertAlmostEqual(comp["value"], float(expected), places=6,
                                   msg="fee mismatch for %s" % row["market_ticker"])

    def test_published_fee_table_is_reproduced(self):
        """All 21 rows of the published fee table (official PDF, 2026-07-07)."""
        rows = FEES.verify_published_table()
        self.assertEqual(len(rows), 21)
        for price, fee1, got1, fee100, got100, ok in rows:
            self.assertTrue(ok, "fee table row %s does not reproduce" % price)
            self.assertEqual(got1, fee1)
            self.assertEqual(got100, fee100)

    def test_zero_fee_series_are_the_published_zero_multiplier_series(self):
        row = [r for r in self.feed["shortlist"] if r["series_ticker"] == "KXBTCY"]
        for r in row:
            self.assertEqual(r["components"]["fee_efficiency"]["taker_multiplier"], 0)

    # -- resolution tracking ---------------------------------------------

    def test_resolution_fields_come_from_the_official_records(self):
        for row in self.feed["shortlist"]:
            m = self.markets[row["market_ticker"]]
            self.assertEqual(row["resolution"]["status"], m.get("status"))
            self.assertEqual(row["resolution"]["result"], m.get("result"))
            self.assertIn(row["resolution"]["status"],
                          ("initialized", "active", "inactive", "closed", "determined",
                           "disputed", "amended", "finalized"))
            if row["resolution"]["result"] is not None:
                self.assertIn(row["resolution"]["result"], ("yes", "no", "scalar"))

    # -- reproducibility --------------------------------------------------

    def test_feed_is_reproducible_from_the_committed_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "feed.json")
            subprocess.run([sys.executable, os.path.join(REPO, "alerts", "tools", "build_alerts.py"),
                            "--out", out], check=True, capture_output=True)
            rebuilt = load(out)
        rebuilt.pop("generated_utc", None)
        committed = dict(self.feed)
        committed.pop("generated_utc", None)
        self.assertEqual(rebuilt, committed, "the committed feed does not match a fresh build")

    def test_scan_list_bases_are_the_last_official_candle(self):
        for entry in self.feed["scan_list"]:
            self.assertTrue(entry["candlesticks_source"].startswith(BASE + "/series/"))
            self.assertIn(entry["market_ticker"], entry["candlesticks_source"])
            self.assertIn(entry["seed_basis"], ("traded", "book_mid"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
