#!/usr/bin/env python3
"""Offline end-to-end smoke test of the data pipeline (scripts/fetch_kalshi_data.py).

The transport is stubbed, so this file needs no network: every "response" below is shaped
like the documented demo-API payload (fields per docs.kalshi.com/api-reference/*) and the
test asserts what the pipeline writes into docs/data/*.json.

It pins the three defects this session fixed:
  1. "Las Vegas" no longer lands in the gas topic (word-boundary keyword matching);
  2. events whose series is listed without the legacy KX prefix still classify (prefix-insensitive key);
  3. each topic's busiest series is fetched directly, so the highest-dollar events of a
     topic are the ones with volume, not whichever series happened to survive the page cap.

Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = importlib.util.spec_from_file_location("fetch_kalshi_data_smoke", os.path.join(ROOT, "scripts", "fetch_kalshi_data.py"))
fk = importlib.util.module_from_spec(SPEC)
sys.modules["fetch_kalshi_data_smoke"] = fk
SPEC.loader.exec_module(fk)

FAR_FUTURE = "2099-01-08T00:00:00Z"


def nested_market(ticker, last, vol24):
    return {
        "ticker": ticker, "title": "Market " + ticker, "status": "active", "result": "",
        "yes_sub_title": "Yes", "no_sub_title": "No",
        "close_time": FAR_FUTURE, "expected_expiration_time": FAR_FUTURE,
        "last_price_dollars": last, "volume_fp": vol24, "volume_24h_fp": vol24, "open_interest_fp": "10.00",
        "yes_bid_dollars": "0.4000", "yes_ask_dollars": "0.6000", "no_bid_dollars": "0.4000", "no_ask_dollars": "0.6000",
        "notional_value_dollars": "1.0000", "market_ticker": ticker,
    }


SERIES = [
    # Legacy-style tickers WITHOUT the KX prefix, as the demo /series list returns them.
    {"ticker": "AAAGASW", "title": "US gas price up", "category": "Economics", "categories": ["Economics"],
     "tags": ["Oil and energy"], "volume_fp": "94711078.00"},
    {"ticker": "KXNBACITYEXPAND", "title": "Pro basketball expansion", "category": "Sports", "categories": ["Economics"],
     "tags": ["NBA", "Las Vegas", "Sports"], "volume_fp": "50.00"},
    {"ticker": "KXBTC", "title": "Bitcoin price", "category": "Crypto", "categories": ["Crypto"],
     "tags": ["Crypto"], "volume_fp": "80000000.00"},
    {"ticker": "KXSMALLGAS", "title": "Small state gas price", "category": "Economics", "categories": ["Economics"],
     "tags": ["Oil and energy"], "volume_fp": "5.00"},
]

EVENTS = [
    # Reported by the global scan (alphabetical, page-capped): only the small stuff.
    {"event_ticker": "KXSMALLGAS-26NOV21", "series_ticker": "KXSMALLGAS", "title": "Small state gas price on Nov 21, 2026",
     "category": "Economics", "mutually_exclusive": False, "settlement_sources": [{"name": "AAA", "url": "https://gasprices.aaa.com/"}],
     "markets": [nested_market("KXSMALLGAS-26NOV21-3.6000", "0.0200", "3.00")]},
    {"event_ticker": "KXNBACITYEXPAND-01JAN30", "series_ticker": "KXNBACITYEXPAND",
     "title": "When will Las Vegas receive a Pro Basketball expansion team?", "category": "Economics",
     "mutually_exclusive": True, "settlement_sources": [], "markets": [nested_market("KXNBACITYEXPAND-01JAN30-15OCT26", "0.0000", "0.00")]},
    # Only reachable through the per-series top-up, because the page cap ends before it.
    {"event_ticker": "KXAAAGASW-26NOV23", "series_ticker": "KXAAAGASW", "title": "US gas prices this week",
     "category": "Economics", "mutually_exclusive": False,
     "settlement_sources": [{"name": "AAA", "url": "https://gasprices.aaa.com/"}],
     "markets": [nested_market("KXAAAGASW-26NOV23-3.6400", "0.0800", "26453.55")]},
    {"event_ticker": "KXBTC-26DEC31", "series_ticker": "KXBTC", "title": "Bitcoin above $100k on Dec 31?",
     "category": "Crypto", "mutually_exclusive": False, "settlement_sources": [],
     "markets": [nested_market("KXBTC-26DEC31-T100000", "0.2500", "5000.00")]},
]

ORDERBOOK = {"orderbook_fp": {"yes_dollars": [["0.0700", "120.00"]], "no_dollars": [["0.9200", "40.00"]]}}
# One candle in the documented nested OHLC shape, one in the flat legacy shape: the reader takes both.
CANDLES = {"ticker": "x", "candlesticks": [
    {"end_period_ts": 1795154700, "price": {"open_dollars": "0.0800", "close_dollars": "0.0800",
                                            "high_dollars": "0.0900", "low_dollars": "0.0700"},
     "yes_bid": {"close_dollars": "0.0700"}, "yes_ask": {"close_dollars": "0.0800"}, "volume_fp": "2.00"},
    {"end_period_ts": 1795154760, "price_open_dollars": "0.1000", "price_close_dollars": "0.2400",
     "price_high_dollars": "0.2500", "price_low_dollars": "0.0900", "volume_fp": "3.00"},
]}
TRADES = {"trades": [{"trade_id": "t1", "ticker": "KXAAAGASW-26NOV23-3.6400", "count_fp": "100.00",
                      "yes_price_dollars": "0.0800", "no_price_dollars": "0.9200",
                      "taker_outcome_side": "yes", "created_time": "2026-11-20T19:00:00Z"}]}


def fake_transport(url):
    from urllib.parse import urlparse, parse_qs
    u = urlparse(url)
    q = parse_qs(u.query)
    path = u.path
    if path.endswith("/series"):
        cat = (q.get("category") or [""])[0]
        return {"series": [s for s in SERIES if cat in (s.get("categories") or [])]}
    if path.endswith("/events"):
        series = (q.get("series_ticker") or [""])[0]
        if series:
            key = fk.norm_series(series)
            return {"events": [e for e in EVENTS if fk.norm_series(e["series_ticker"]) == key], "cursor": ""}
        return {"events": [e for e in EVENTS if e["series_ticker"] != "KXAAAGASW"], "cursor": ""}
    if path.endswith("/orderbook") or path.endswith("/orderbooks"):
        return ORDERBOOK if path.endswith("/orderbook") else {"orderbooks": [{"ticker": "KXAAAGASW-26NOV23-3.6400", **ORDERBOOK}]}
    if path.endswith("/candlesticks"):
        return CANDLES
    if path.endswith("/trades"):
        return TRADES
    if path.endswith("/markets") or "/markets/" in path:
        return {"markets": [m for e in EVENTS for m in e["markets"]]}
    if path.endswith("/exchange/status"):
        return {"status": "available"}
    raise AssertionError("unexpected URL in test: " + url)


class TestPipelineOffline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="kalshi-smoke-")
        cls.real_get = fk.http_get_json
        fk.http_get_json = lambda url, *a, **k: fake_transport(url)
        cls.real_argv = sys.argv
        sys.argv = ["fetch_kalshi_data.py", "--out", cls.dir, "--quick"]
        cls.code = fk.main()

    @classmethod
    def tearDownClass(cls):
        fk.http_get_json = cls.real_get
        sys.argv = cls.real_argv
        shutil.rmtree(cls.dir, ignore_errors=True)

    def load(self, name):
        with open(os.path.join(self.dir, name)) as f:
            return json.load(f)

    def test_exit_code_ok(self):
        self.assertEqual(self.code, 0)

    def test_vegas_event_is_not_gas(self):
        snap = self.load("snapshot.json")
        gas_titles = " | ".join(e["title"] for e in snap["topics"]["gas"]["top_events"])
        self.assertNotIn("Las Vegas", gas_titles)
        self.assertNotIn("Pro Basketball", gas_titles)

    def test_prefix_insensitive_membership_pulls_in_the_busiest_series(self):
        snap = self.load("snapshot.json")
        tickers = [e["event_ticker"] for e in snap["topics"]["gas"]["top_events"]]
        self.assertIn("KXAAAGASW-26NOV23", tickers, tickers)

    def test_ranking_is_by_computed_dollar_volume(self):
        snap = self.load("snapshot.json")
        gas = snap["topics"]["gas"]["top_events"]
        self.assertGreater(gas[0]["est_usd_volume_24h"], 0, "the busiest gas event must not rank behind $0.00 rows")
        dollars = [e["est_usd_volume_24h"] for e in gas]
        self.assertEqual(dollars, sorted(dollars, reverse=True), dollars)
        # 26453.55 contracts x $0.08 = $2116.28, disclosed as an estimate in the methodology
        self.assertAlmostEqual(gas[0]["est_usd_volume_24h"], round(26453.55 * 0.08, 2), places=1)
        self.assertIn("not an official Kalshi metric", snap["methodology"]["est_usd_volume_24h"])

    def test_series_map_records_the_rules_and_the_volume_field(self):
        sm = self.load("series_map.json")
        self.assertIn("include_volume=true", sm["method"])
        rules = sm["classification_rules"]
        self.assertEqual(rules["keyword_matching"], "word boundaries on titles/tags, substring on the series ticker (tickers concatenate words)")
        self.assertEqual(rules["note"], "Topic membership is this repository's heuristic, not an official Kalshi taxonomy.")
        gas_top = sm["top_series_by_topic"]["gas"][0]
        self.assertEqual(gas_top["ticker"], "AAAGASW")
        self.assertEqual(gas_top["volume_contracts"], 94711078.0)
        self.assertTrue(gas_top["api_url"].startswith("https://external-api.demo.kalshi.co/trade-api/v2/series?category="))

    def test_every_event_row_carries_an_official_source_url(self):
        snap = self.load("snapshot.json")
        for topic, blob in snap["topics"].items():
            for ev in blob["top_events"]:
                self.assertTrue(ev["api_url"].startswith(fk.BASE + "/events/"), ev["api_url"])
                for m in ev["markets"]:
                    self.assertTrue(m["api_url"].startswith(fk.BASE + "/markets/"), m["api_url"])

    def test_tracked_events_and_resolutions_are_written(self):
        for name in ("tracked_events.json", "resolutions.json", "run_log.json"):
            self.assertTrue(os.path.exists(os.path.join(self.dir, name)), name)
        res = self.load("resolutions.json")
        self.assertIn("events", res)

    def test_run_log_records_topic_match_counts(self):
        run = self.load("run_log.json")["runs"][-1]
        self.assertTrue(run["ok"], run["errors"])
        self.assertGreaterEqual(run["matched_by_topic"]["gas"], 2)

    def test_candle_reader_accepts_both_documented_shapes(self):
        hist = self.load("history.json")
        rows = [c for k in hist["markets"] for iv in ("1m", "60m") for c in hist["markets"][k][iv]["candles"]]
        self.assertTrue(rows, "at least one candle should be parsed")
        closes = sorted({c["c"] for c in rows})
        self.assertEqual(closes, ["0.0800", "0.2400"], closes)   # nested and flat, both read
        self.assertTrue(all(c["h"] is not None and c["l"] is not None for c in rows), rows[:2])
        self.assertIn("yes_bid_c", rows[0])                      # bid/ask closes kept for the mid line


if __name__ == "__main__":
    unittest.main(verbosity=2)
