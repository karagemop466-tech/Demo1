#!/usr/bin/env python3
"""sim-desk offline tests — stdlib unittest. No network access required.

Two layers:
  1. Unit tests of the deterministic pieces (fee formula vs the official fee
     schedule's published table, implied-ask rule vs the official orderbook doc,
     classification, strategy rules on trades-tape closes, settlement math, rollups).
  2. A two-run integration replay against recorded official-API-shaped payloads
     (tests/fixtures = run 1, tests/fixtures2 = run 2 with a settled market)
     exercising the full lifecycle: open universe -> trades-tape signals ->
     simulated fill with fee -> mark to market -> settle YES/NO -> rollups.

Run: python3 -m unittest discover -s sim-desk/tests -t . (from repo root) or
     python3 sim-desk/tests/test_engine.py
"""

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "sim-desk"))

import engine  # noqa: E402

CONFIG = json.load(open(os.path.join(ROOT, "sim-desk", "config.json"), encoding="utf-8"))
RULES = engine.compile_topic_rules(CONFIG)


def mk_market(ticker, series, event, title, vol24, last, close_time="2028-11-07T15:00:00Z"):
    return {"ticker": ticker, "series_ticker": series, "event_ticker": event,
            "title": title, "volume_24h": vol24, "volume": vol24,
            "last_price_dollars": last, "close_time": close_time, "status": "open"}


class TestFeeFormula(unittest.TestCase):
    """fee = roundup(M x 0.07 x C x P x (1-P)), M=1.
    Expected values are read from the official fee schedule's own table
    (https://kalshi.com/docs/kalshi-fee-schedule.pdf, fetched 2026-11-20)."""

    def test_matches_official_table(self):
        official = {(0.10, 1): 1, (0.50, 1): 2, (0.55, 1): 2, (0.20, 1): 2, (0.85, 1): 1,
                    (0.10, 100): 63, (0.50, 100): 175, (0.45, 100): 174, (0.20, 100): 112,
                    (0.85, 100): 90, (0.99, 100): 7}
        for (p, c), expected_cents in official.items():
            self.assertEqual(engine.fee_cents(c, p), expected_cents, f"P={p} C={c}")

    def test_entry_price_examples_from_fixture_trades(self):
        self.assertEqual(engine.fee_cents(10, 0.49), 18)
        self.assertEqual(engine.fee_cents(10, 0.45), 18)
        self.assertEqual(engine.fee_cents(10, 0.17), 10)


class TestOrderbookRules(unittest.TestCase):
    """Official rule (docs.kalshi.com/getting_started/orderbook_responses):
    bids only, ascending, best bid = last; best YES ask = 1 - best NO bid."""

    def test_implied_asks_official_example(self):
        # The official doc's worked example: best YES bid 0.42, best NO bid 0.56
        # -> best YES ask $0.44; spread $0.02.
        yes_ask, no_ask = engine.implied_asks(0.42, 0.56)
        self.assertEqual(yes_ask, 0.44)
        self.assertEqual(no_ask, 0.58)

    def test_best_bid_is_last_element(self):
        book = {"orderbook_fp": {
            "yes_dollars": [["0.0100", "200.00"], ["0.4200", "13.00"]],
            "no_dollars": [["0.0100", "100.00"], ["0.5600", "17.00"]],
        }}
        by, bn, yl, nl = engine.parse_orderbook_best_bids(book)
        self.assertEqual(by, 0.42)
        self.assertEqual(bn, 0.56)
        self.assertEqual(yl[-1]["contracts"], 13.0)
        self.assertEqual(len(nl), 2)

    def test_empty_book_returns_no_bids(self):
        by, bn, yl, nl = engine.parse_orderbook_best_bids({"orderbook_fp": {"yes_dollars": [], "no_dollars": []}})
        self.assertIsNone(by)
        self.assertIsNone(bn)


class TestClassification(unittest.TestCase):
    def test_gas_by_ticker(self):
        topic, how = engine.classify(mk_market("KXAAAGASM-26DEC31-3.80", "KXAAAGASM", "KXAAAGASM-26DEC", "gas", "5000.00", "0.40"), RULES)
        self.assertEqual(topic, "gas")
        self.assertIn("KXAAAGAS", how)

    def test_crypto_by_ticker(self):
        topic, _ = engine.classify(mk_market("KXBTCMINMON-BTC-26NOV20-6750000", "KXBTCMINMON", "KXBTCMINMON-26NOV20", "bitcoin up", "5000.00", "0.55"), RULES)
        self.assertEqual(topic, "crypto")

    def test_elections_by_ticker(self):
        topic, _ = engine.classify(mk_market("KXNEXTNATOSECGEN-NATO-SEC-GEN", "KXNEXTNATOSECGEN", "KXNEXTNATOSECGEN", "nato", "5000.00", "0.30"), RULES)
        self.assertEqual(topic, "elections")

    def test_golf_by_ticker(self):
        topic, _ = engine.classify(mk_market("KXPGACUT-PGA-26DEC", "KXPGACUT", "KXPGACUT", "pga", "5000.00", "0.44"), RULES)
        self.assertEqual(topic, "golf")

    def test_culture_by_title_when_ticker_unknown(self):
        m = mk_market("KXUNKNOWN-1", "KXUNKNOWN", "KXUNKNOWN-1", "Who wins Best Picture at the Oscars?", "5000.00", "0.60")
        topic, how = engine.classify(m, RULES)
        self.assertEqual(topic, "culture")
        self.assertTrue(how.startswith("title:"))

    def test_unclassified_markets_are_ignored(self):
        m = mk_market("KXOTHER-1", "KXOTHER", "KXOTHER-1", "Something else entirely", "5000.00", "0.50")
        self.assertIsNone(engine.classify(m, RULES)[0])


class TestStrategyRules(unittest.TestCase):
    def test_momentum_fires_yes(self):
        closes = [0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56]
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, closes, 0.49, 0.56, 1000)
        self.assertEqual((strat, side), ("momentum-tape", "yes"))
        self.assertIn("trend", reason)

    def test_momentum_fires_no(self):
        closes = [0.56, 0.55, 0.54, 0.53, 0.52, 0.51, 0.50]
        strat, side, _ = engine.evaluate_strategies(CONFIG, {}, closes, 0.44, 0.51, 1000)
        self.assertEqual((strat, side), ("momentum-tape", "no"))

    def test_momentum_band_excludes(self):
        closes = [0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56]
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, closes, 0.95, 0.95, 1000)
        self.assertIsNone(strat)
        self.assertIn("band", reason)

    def test_mean_revert_fires_yes(self):
        closes = [0.52] * 20 + [0.42, 0.41, 0.41, 0.40, 0.39, 0.38]
        strat, side, _ = engine.evaluate_strategies(CONFIG, {}, closes, 0.45, 0.62, 1000)
        self.assertEqual((strat, side), ("mean-revert-tape", "yes"))

    def test_mean_revert_fires_no(self):
        closes = [0.48] * 20 + [0.58, 0.59, 0.59, 0.60, 0.61, 0.62]
        strat, side, _ = engine.evaluate_strategies(CONFIG, {}, closes, 0.35, 0.52, 1000)
        self.assertEqual((strat, side), ("mean-revert-tape", "no"))

    def test_longshot_value_requires_volume(self):
        closes = [0.82] * 8
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, closes, 0.83, 0.17, 6000)
        self.assertEqual((strat, side), ("longshot-value", "no"))
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, closes, 0.83, 0.17, 400)
        self.assertIsNone(strat)
        self.assertIn("volume", reason)

    def test_insufficient_history_skips(self):
        # 3 trades: enough for the mean-revert window, but thresholds not met
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, [0.30, 0.31, 0.30], 0.45, 0.55, 1000)
        self.assertIsNone(strat)
        self.assertIn("no strategy fired", reason)
        # 2 trades: below every strategy's minimum
        strat, side, reason = engine.evaluate_strategies(CONFIG, {}, [0.30, 0.31], 0.45, 0.55, 1000)
        self.assertIsNone(strat)
        self.assertIn("insufficient trade history", reason)

    def test_priority_order(self):
        closes = [0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56]  # momentum yes AND mean-revert no (rising)
        strat, side, _ = engine.evaluate_strategies(CONFIG, {}, closes, 0.45, 0.62, 6000)
        self.assertEqual(strat, "momentum-tape")


class TestSettlement(unittest.TestCase):
    def base_pos(self, side="yes", price=0.49, fee=0.18):
        return {"ticker": "T-1", "side": side, "contracts": 10, "entry_price": price,
                "entry_fee": fee, "topic": "crypto", "strategy": "momentum-1h"}

    def test_win_yes(self):
        row = {"status": "settled", "result": "yes", "settlement_ts": "2026-11-20T10:00:00Z",
               "settlement_value_dollars": "1.0000"}
        out = engine.settle_position(self.base_pos(), row, "run-2", "https://example")
        self.assertEqual(out["result"], "yes")
        self.assertEqual(out["payout"], 10.0)
        self.assertAlmostEqual(out["realized_pnl"], 10.0 - 4.90 - 0.18, places=6)

    def test_loss_no_side_mismatch(self):
        row = {"status": "settled", "result": "no", "settlement_ts": "2026-11-20T10:00:00Z",
               "settlement_value_dollars": "0.0000"}
        out = engine.settle_position(self.base_pos(side="yes"), row, "run-2", "https://example")
        self.assertEqual(out["payout"], 0.0)
        self.assertAlmostEqual(out["realized_pnl"], -(4.90 + 0.18), places=6)

    def test_no_side_win(self):
        row = {"status": "settled", "result": "no", "settlement_ts": "2026-11-20T10:00:00Z",
               "settlement_value_dollars": "0.0000"}
        out = engine.settle_position(self.base_pos(side="no", price=0.17, fee=0.10), row, "run-2", "https://example")
        self.assertEqual(out["payout"], 10.0)
        self.assertAlmostEqual(out["realized_pnl"], 10.0 - 1.70 - 0.10, places=6)

    def test_not_settled_returns_none(self):
        self.assertIsNone(engine.settle_position(self.base_pos(), {"status": "open"}, "r", "u"))
        self.assertIsNone(engine.settle_position(self.base_pos(), {"status": "closed"}, "r", "u"))
        self.assertIsNone(engine.settle_position(self.base_pos(), {"status": "settled", "result": ""}, "r", "u"))


class TestBandsAndRollups(unittest.TestCase):
    def test_band_boundaries(self):
        self.assertEqual(engine.band_of(0.05), "0.00-0.20")
        self.assertEqual(engine.band_of(0.20), "0.20-0.40")
        self.assertEqual(engine.band_of(0.39), "0.20-0.40")
        self.assertEqual(engine.band_of(None), "unknown")

    def test_rollup_math(self):
        trades = [
            {"strategy": "s", "topic": "crypto", "band": "0.20-0.40", "contracts": 10, "entry_price": 0.30, "entry_fee": 0.2, "realized_pnl": 5.0},
            {"strategy": "s", "topic": "crypto", "band": "0.20-0.40", "contracts": 10, "entry_price": 0.30, "entry_fee": 0.2, "realized_pnl": -3.2},
            {"strategy": "s", "topic": "gas", "band": "0.40-0.60", "contracts": 10, "entry_price": 0.50, "entry_fee": 0.18},
        ]
        out = engine.rollup(trades, lambda t: t["strategy"])
        s = out["s"]
        self.assertEqual(s["opened"], 3)
        self.assertEqual(s["settled"], 2)
        self.assertEqual(s["wins"], 1)
        self.assertEqual(s["win_rate"], 0.5)
        self.assertAlmostEqual(s["realized_pnl"], 1.8, places=6)
        self.assertAlmostEqual(s["invested"], 11.0, places=6)
        topics = engine.rollup(trades, lambda t: t["topic"])
        self.assertEqual(topics["crypto"]["settled"], 2)
        self.assertEqual(topics["gas"]["opened"], 1)


class TestIntegrationReplay(unittest.TestCase):
    """Two-run replay against recorded payloads shaped like official responses."""

    maxDiff = None

    def run_engine(self, fixtures, out_dir):
        proc = subprocess.run(
            [sys.executable, os.path.join(ROOT, "sim-desk", "engine.py"),
             "--out", out_dir, "--recorded", fixtures],
            capture_output=True, text=True, timeout=120, cwd=ROOT)
        self.assertEqual(proc.returncode, 0, msg=proc.stderr or proc.stdout)
        return proc

    def test_two_run_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "data")
            self.run_engine(os.path.join(HERE, "fixtures"), out)

            ledger = json.load(open(os.path.join(out, "ledger.json"), encoding="utf-8"))
            perf = json.load(open(os.path.join(out, "performance.json"), encoding="utf-8"))
            runlog = json.load(open(os.path.join(out, "run_log.json"), encoding="utf-8"))

            # Run 1: three simulated fills opened (momentum YES / mean-revert YES / longshot NO)
            self.assertEqual(len(ledger["positions_open"]), 3)
            self.assertEqual(len(ledger["trades_settled"]), 0)
            by_ticker = {p["ticker"]: p for p in ledger["positions_open"]}
            self.assertEqual(by_ticker["KXBTCMINMON-BTC-26NOV20-6750000"]["side"], "yes")
            self.assertEqual(by_ticker["KXBTCMINMON-BTC-26NOV20-6750000"]["strategy"], "momentum-tape")
            self.assertEqual(by_ticker["KXBTCMINMON-BTC-26NOV20-6750000"]["entry_price"], 0.49)
            self.assertEqual(by_ticker["KXAAAGASM-26DEC31-3.80"]["strategy"], "mean-revert-tape")
            self.assertEqual(by_ticker["KXAAAGASM-26DEC31-3.80"]["entry_price"], 0.45)
            self.assertEqual(by_ticker["KXBTCMAX150-BTC-150K"]["side"], "no")
            self.assertEqual(by_ticker["KXBTCMAX150-BTC-150K"]["strategy"], "longshot-value")
            self.assertEqual(by_ticker["KXBTCMAX150-BTC-150K"]["entry_price"], 0.17)

            # fees per the official formula
            self.assertEqual(by_ticker["KXBTCMINMON-BTC-26NOV20-6750000"]["entry_fee"], 0.18)
            self.assertEqual(by_ticker["KXAAAGASM-26DEC31-3.80"]["entry_fee"], 0.18)
            self.assertEqual(by_ticker["KXBTCMAX150-BTC-150K"]["entry_fee"], 0.10)

            # cash: 1000 - (4.90+0.18) - (4.50+0.18) - (1.70+0.10) = 988.44
            self.assertAlmostEqual(ledger["cash"], 988.44, places=2)

            # marks from the official last_price_dollars in the tickers response
            self.assertEqual(by_ticker["KXBTCMINMON-BTC-26NOV20-6750000"]["mark_price"], 0.56)
            self.assertEqual(by_ticker["KXAAAGASM-26DEC31-3.80"]["mark_price"], 0.40)
            self.assertEqual(by_ticker["KXBTCMAX150-BTC-150K"]["mark_price"], 0.18)
            self.assertAlmostEqual(perf["equity"], 988.44 + 5.60 + 4.00 + 1.80, places=2)

            # skipped candidates are logged with reasons; every request URL is recorded
            reasons = " | ".join(s["reason"] for s in runlog["skips"])
            self.assertIn("no strategy fired", reasons)
            self.assertIn("no trade history returned by the official tape", reasons)
            self.assertTrue(all(r["url"].startswith(CONFIG["base_url"]) for r in runlog["requests"]))
            self.assertEqual(runlog["summary"]["api_calls"], 31)

            # every entry carries its official request URL
            for p in ledger["positions_open"]:
                self.assertTrue(p["orderbook_source_url"].startswith(CONFIG["base_url"]))
                self.assertTrue(p["trades_tape_source_url"].startswith(CONFIG["base_url"]))
                self.assertTrue(p["entry_source_url"].startswith(CONFIG["base_url"]))

            # ---- run 2: market A settled YES; B and C carry open
            self.run_engine(os.path.join(HERE, "fixtures2"), out)
            ledger2 = json.load(open(os.path.join(out, "ledger.json"), encoding="utf-8"))
            perf2 = json.load(open(os.path.join(out, "performance.json"), encoding="utf-8"))

            self.assertEqual(len(ledger2["positions_open"]), 2)
            self.assertEqual(len(ledger2["trades_settled"]), 1)
            settled = ledger2["trades_settled"][0]
            self.assertEqual(settled["ticker"], "KXBTCMINMON-BTC-26NOV20-6750000")
            self.assertEqual(settled["result"], "yes")
            self.assertEqual(settled["payout"], 10.0)
            self.assertAlmostEqual(settled["realized_pnl"], 4.92, places=2)

            # cash after payout: 988.44 + 10.00 = 998.44; marks B 0.35 (last), C 1-0.90=0.10
            self.assertAlmostEqual(ledger2["cash"], 998.44, places=2)
            self.assertAlmostEqual(perf2["equity"], 998.44 + 3.50 + 1.00, places=2)
            self.assertEqual(perf2["result_counts"]["yes"], 1)
            self.assertEqual(perf2["result_counts"]["no"], 0)
            self.assertEqual(perf2["by_strategy"]["momentum-tape"]["settled"], 1)
            self.assertEqual(perf2["by_strategy"]["momentum-tape"]["win_rate"], 1.0)
            self.assertAlmostEqual(perf2["by_strategy"]["momentum-tape"]["realized_pnl"], 4.92, places=2)

            # duplicate-position guard: run 2 opened nothing new
            self.assertEqual(len(ledger2["runs"]), 2)
            self.assertEqual(ledger2["runs"][1]["new_trades"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
