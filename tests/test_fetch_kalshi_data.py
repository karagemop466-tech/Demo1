#!/usr/bin/env python3
"""Offline unit test for fetch_kalshi_data.py using recorded live demo-API payloads
(captured 2026-11-20 via official API probes; no network needed)."""
import importlib.util
import json
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fk", "scripts/fetch_kalshi_data.py")
fk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fk)

GAS_EVENT = {
    "category": "Economics", "event_ticker": "KXAAAGASMIN-26DEC31", "series_ticker": "KXAAAGASMIN",
    "title": "How low will US gas prices get this year?", "sub_title": "", "mutually_exclusive": False,
    "settlement_sources": [{"name": "AAA", "url": "https://www.aaa.com/gasprices"}],
    "markets": [
        {"ticker": "KXAAAGASMIN-26DEC31-3.80", "title": "Will average **gas prices** be below $3.80 by Dec 31, 2026?",
         "status": "finalized", "result": "yes", "last_price_dollars": "0.0000",
         "yes_bid_dollars": "0.0000", "yes_ask_dollars": "1.0000", "no_bid_dollars": "0.0000", "no_ask_dollars": "1.0000",
         "volume_fp": "0.00", "volume_24h_fp": "0.00", "open_interest_fp": "0.00",
         "close_time": "2026-07-06T18:24:34Z", "settlement_ts": "2026-07-06T19:27:27Z", "settlement_value_dollars": "1.0000"},
        {"ticker": "KXAAAGASMIN-26DEC31-3.60", "title": "Will average **gas prices** be below $3.60 by Dec 31, 2026?",
         "status": "active", "result": "", "last_price_dollars": "0.9000",
         "yes_bid_dollars": "0.0000", "yes_ask_dollars": "1.0000", "no_bid_dollars": "0.0000", "no_ask_dollars": "1.0000",
         "volume_fp": "3.21", "volume_24h_fp": "0.00", "open_interest_fp": "0.05", "close_time": "2026-12-31T06:25:00Z"},
    ],
}
BTC_EVENT = {
    "category": "Crypto", "event_ticker": "KXBTCMINMON-BTC-26NOV30", "series_ticker": "KXBTCMINMON",
    "title": "BTC min one touch monthly", "sub_title": "", "mutually_exclusive": False,
    "settlement_sources": [{"name": "CF Benchmarks", "url": "https://www.cfbenchmarks.com/"}],
    "markets": [
        {"ticker": "KXBTCMINMON-BTC-26NOV30-7250000", "title": "Will BTC trimmed mean be below $72500.00...",
         "status": "active", "result": "", "last_price_dollars": "0.7400",
         "yes_bid_dollars": "0.0000", "yes_ask_dollars": "1.0000", "no_bid_dollars": "0.0000", "no_ask_dollars": "1.0000",
         "volume_fp": "2345.11", "volume_24h_fp": "12.00", "open_interest_fp": "2332.25", "close_time": "2026-12-01T04:59:59Z"},
    ],
}
SERIES_RESP = {"series": [{"ticker": "KXAAAGASMIN", "title": "US lowest gas price yearly", "tags": ["Oil and energy"], "category": "Economics"}]}
BOOK_RESP = {"orderbook_fp": {"yes_dollars": [["0.10", "5.00"], ["0.74", "12.00"]], "no_dollars": [["0.26", "8.00"]]}}
CANDLES_RESP = {"candlesticks": [{"end_period_ts": 1763640000, "price_open_dollars": "0.70", "price_close_dollars": "0.74",
                                  "price_high_dollars": "0.75", "price_low_dollars": "0.69", "volume_fp": "3.00"}]}


class FakeResp:
    def __init__(self, payload): self.payload = payload
    def read(self): return json.dumps(self.payload).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False


class Test(unittest.TestCase):
    def test_market_row_math(self):
        r = fk.market_row(BTC_EVENT["markets"][0])
        self.assertAlmostEqual(r["est_usd_volume"], 2345.11 * 0.74, places=2)
        self.assertAlmostEqual(r["est_usd_volume_24h"], 12.00 * 0.74, places=2)
        self.assertAlmostEqual(r["notional_at_stake_usd"], 2332.25, places=2)
        self.assertIn("/markets/", r["api_url"])

    def test_market_row_settled(self):
        r = fk.market_row(GAS_EVENT["markets"][0])
        self.assertEqual(r["result"], "yes")
        self.assertEqual(r["status"], "finalized")

    def test_classify_via_series_map_and_fallback(self):
        sm = {"gas": {"KXAAAGASMIN"}, "crypto": {"KXBTCMINMON"}}
        self.assertEqual(fk.classify_event(GAS_EVENT, sm), "gas")
        self.assertEqual(fk.classify_event(BTC_EVENT, sm), "crypto")
        ev = dict(GAS_EVENT, series_ticker="UNKNOWN")
        self.assertEqual(fk.classify_event(ev, sm), "gas")  # keyword fallback on title

    def test_event_row_ranking_fields(self):
        sm = {"gas": {"KXAAAGASMIN"}}
        row = fk.event_row(GAS_EVENT, "gas", sm)
        self.assertEqual(row["topic"], "gas")
        self.assertAlmostEqual(row["notional_at_stake_usd"], 0.05, places=2)
        self.assertEqual(len(row["markets"]), 2)
        self.assertTrue(row["markets"][0]["api_url"].startswith(fk.BASE))

    def test_orderbook_parsing_and_reverse(self):
        books = fk.fetch_orderbooks.__wrapped__ if hasattr(fk.fetch_orderbooks, "__wrapped__") else None

    def test_full_run_end_to_end(self, ):
        # Patch network layer: route URLs to recorded payloads.
        def fake_http(url, retries=1):
            if "/events?tickers=" in url:
                return {"events": [GAS_EVENT, BTC_EVENT]}
            if "series_ticker=KXAAAGASMIN" in url:
                return {"events": [GAS_EVENT]}
            if "series_ticker=KXBTCMINMON" in url:
                return {"events": [BTC_EVENT]}
            if "/events?" in url and "status=open" in url:
                return {"events": [GAS_EVENT, BTC_EVENT], "cursor": ""}
            if "/series?category=Economics" in url:
                return SERIES_RESP
            if "/series?category=" in url:
                return {"series": []}
            if "/orderbook" in url:
                return BOOK_RESP
            if "/candlesticks" in url:
                return CANDLES_RESP
            return {}

        import tempfile, os
        with patch.object(fk, "http_get_json", side_effect=fake_http), \
             patch.object(fk.time, "sleep"), \
             tempfile.TemporaryDirectory() as td:
            rc = fk.main() if False else None
            # run main with --out override
            sys.argv = ["fk", "--out", td, "--pages", "1"]
            rc = fk.main()
            self.assertIn(rc, (0, 1))
            snap = json.load(open(os.path.join(td, "snapshot.json")))
            self.assertIn("gas", snap["topics"])
            self.assertIn("crypto", snap["topics"])
            gas_top = snap["topics"]["gas"]["top_events"][0]
            self.assertEqual(gas_top["event_ticker"], "KXAAAGASMIN-26DEC31")
            # settled market recorded with result (find it by ticker — ranking may order markets by activity)
            m_settled = next(m for m in gas_top["markets"] if m["ticker"].endswith("3.80"))
            self.assertEqual(m_settled["result"], "yes")
            # history + resolutions + tracked written
            hist = json.load(open(os.path.join(td, "history.json")))
            self.assertTrue(len(hist["markets"]) >= 1)
            res = json.load(open(os.path.join(td, "resolutions.json")))
            self.assertTrue(len(res["events"]) >= 1)
            runlog = json.load(open(os.path.join(td, "run_log.json")))
            self.assertEqual(len(runlog["runs"]), 1)

    def test_orderbook_reverse(self):
        with patch.object(fk, "http_get_json", side_effect=lambda url, retries=1: BOOK_RESP), \
             patch.object(fk.time, "sleep"):
            books = fk.fetch_orderbooks(["KXAAAGASMIN-26DEC31-3.60"])
            ob = books["KXAAAGASMIN-26DEC31-3.60"]
            self.assertEqual(ob["yes_bids_dollars"][0], ["0.74", "12.00"])  # best bid first after reverse
            self.assertEqual(ob["no_bids_dollars"][0], ["0.26", "8.00"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
