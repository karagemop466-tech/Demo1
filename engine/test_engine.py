#!/usr/bin/env python3
"""
engine/test_engine.py — unit tests for the arithmetic the desk publishes.

Covers the two places a wrong number would silently mislead a trader: the fee
formula (must match the published schedule to the cent) and the jump rule (must
use only the two adjacent candles it cites). Also pins the reciprocal-book
identity used by the depth ladder and the strategy fills.

Run:  python3 engine/test_engine.py     (or: pytest engine/test_engine.py -q)

Fee reference: https://kalshi.com/docs/kalshi-fee-schedule.pdf
  taker = round up(M x 0.07 x C x P x (1-P)); maker = round up(M x 0.0175 x C x P x (1-P))
  "Last updated and effective: July 7, 2026"; no settlement fee; no membership fee.
The PDF's own General Trading Fees Table (fee for 100 contracts) is reproduced below
verbatim, so a drift in the formula fails against Kalshi's printed numbers, not
against my arithmetic.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "tools"))

from strategy_sim import fee, position_cost, settlement_study, liquidity  # noqa: E402
from jump_scan import find_jumps, normalize_charts, to_float  # noqa: E402

# From the schedule's "General Trading Fees Table", right-hand column (fee for 100
# contracts), copied verbatim from the PDF.
OFFICIAL_TABLE_100 = {  # right-hand pair of columns of the schedule's table
    0.01: 0.07, 0.05: 0.34, 0.10: 0.63, 0.15: 0.90, 0.20: 1.12, 0.25: 1.32,
    0.30: 1.47, 0.35: 1.60, 0.40: 1.68, 0.45: 1.74, 0.50: 1.75, 0.55: 1.74,
    0.60: 1.68, 0.65: 1.60, 0.70: 1.47, 0.75: 1.32, 0.80: 1.12, 0.85: 0.90,
    0.90: 0.63, 0.95: 0.34, 0.99: 0.07,
}


def test_fee_matches_official_table():
    for price, expected in OFFICIAL_TABLE_100.items():
        got = fee(100, price)
        assert abs(got - expected) < 1e-9, f"P={price}: got {got}, schedule says {expected}"


def test_fee_single_contract_cases():
    # The schedule's "Fee for 1 contract" column, copied from the same PDF table:
    # $0.01 -> $0.01, $0.45 -> $0.02, $0.50 -> $0.02, $0.99 -> $0.01
    assert fee(1, 0.01) == 0.01
    assert fee(1, 0.45) == 0.02
    assert fee(1, 0.50) == 0.02
    assert fee(1, 0.99) == 0.01


def test_zero_multiplier_series_charges_nothing():
    # KXBTCY and KXETHY are listed with taker multiplier 0 in the schedule
    assert fee(100, 0.50, "KXBTCY") == 0.0
    assert fee(100, 0.50, "KXETHY") == 0.0
    # KXAAAGASM is listed 1/1, so it pays the general rate
    assert abs(fee(100, 0.50, "KXAAAGASM") - 1.75) < 1e-9
    # an unlisted series uses the default taker multiplier 1
    assert abs(fee(100, 0.50, "KXUNLISTED") - 1.75) < 1e-9


def test_maker_default_is_free():
    assert fee(100, 0.50, None, "maker") == 0.0
    assert abs(fee(100, 0.50, "KXAAAGASM", "maker") - 0.44) < 1e-9  # 0.0175 rate, rounded up


def test_position_cost_and_rounding_direction():
    assert position_cost(100, 0.455) == 45.5
    # round *up*, never nearest: 0.07*3*0.30*0.70 = 0.0441 -> $0.05 (5 cents)
    assert abs(fee(3, 0.30) - 0.05) < 1e-9


def test_jump_rule_uses_adjacent_candles_only():
    pts = [
        {"t": 0, "price_close": 0.40},
        {"t": 60, "price_close": None},      # no trade: must be skipped, not filled
        {"t": 120, "price_close": 0.52},    # +0.12 vs the previous *traded* close
        {"t": 180, "price_close": 0.55},     # +0.03: below threshold
    ]
    js = find_jumps(pts, "price_close", 0.10)
    assert len(js) == 1
    j = js[0]
    assert j["from"] == 0.40 and j["to"] == 0.52 and j["delta"] == 0.12
    assert j["gap_seconds"] == 120, "the skipped empty candle is counted in the gap, honestly"


def test_book_mid_requires_both_sides():
    pts = [{"t": 0, "yes_bid_close": 0.4, "yes_ask_close": None},
           {"t": 60, "yes_bid_close": 0.5, "yes_ask_close": 0.6}]
    js = find_jumps(pts, "mid", 0.05)
    assert js == [], "a one-sided book must not produce a mid price"
    pts2 = [{"t": 0, "yes_bid_close": 0.40, "yes_ask_close": 0.44},
            {"t": 60, "yes_bid_close": 0.56, "yes_ask_close": 0.60}]
    js2 = find_jumps(pts2, "mid", 0.10)
    assert len(js2) == 1 and js2[0]["from"] == 0.42 and js2[0]["to"] == 0.58


def test_settlement_study_skips_unfillable_prices():
    """A $0.00 last price means 'never traded' on this API — it cannot be an entry."""
    resolved = [
        {"market_ticker": "A", "result": "no", "last_price": "0.0000",
         "settlement_value_dollars": "0.0000", "series_ticker": "KXTEST"},
        {"market_ticker": "B", "result": "yes", "last_price": "0.2000",
         "settlement_value_dollars": "1.0000", "series_ticker": "KXTEST"},
        {"market_ticker": "C", "result": None, "last_price": "0.5000",
         "settlement_value_dollars": None, "series_ticker": "KXTEST"},
    ]
    rows, skipped = settlement_study(resolved, contracts=100)
    assert skipped["price_not_fillable"] == 1, skipped
    assert skipped["no_result"] == 1, skipped
    assert len(rows) == 1 and rows[0]["bucket"] == "$0.20-$0.29"
    b = rows[0]
    # 100 contracts at $0.20 = $20 cost, $100 payout, one taker fee at entry
    assert b["cost_usd"] == 20.0 and b["payout_usd"] == 100.0
    assert b["fees_usd"] == round(fee(100, 0.20, "KXTEST"), 2) == 1.12
    assert b["net_usd"] == round(100.0 - 20.0 - 1.12, 2)


def test_liquidity_does_not_invent_a_spread():
    markets = [
        {"market_ticker": "A", "topic": "crypto", "orderbook": {
            "yes_bids": [{"price": "0.4000", "contracts": "10.00"}],
            "no_bids": [{"price": "0.5800", "contracts": "5.00"}],
            "implied_yes_ask": "0.4200", "source": "u"}},
        {"market_ticker": "B", "topic": "crypto", "orderbook": {}},
    ]
    rows, top = liquidity(markets)
    a = [r for r in rows if r["topic_key"] == "crypto"][0]
    assert a["open_markets"] == 2 and a["books_captured_for"] == 1
    assert a["median_spread"] == 0.02, "spread = 1 - highest NO bid - best YES bid"
    assert len(top) == 1 and top[0]["spread"] == 0.02


def test_normalize_charts_accepts_both_layouts():
    snap = {"series": [{"market_ticker": "T", "series_ticker": "S",
                       "windows": {"1m/6h": {"period_interval_minutes": 1, "points": []}}}]}
    live = {"markets": [{"market_ticker": "T", "series_ticker": "S",
                        "candles": {"1m": {"period_minutes": 1, "points": []}}}]}
    assert normalize_charts(snap)[0]["windows"]["1m/6h"]["points"] == []
    assert normalize_charts(live)[0]["windows"]["1m"]["points"] == []


def test_committed_outputs_are_self_consistent():
    """The published JSON must not contain a number the page could not have derived."""
    st = json.load(open(os.path.join(HERE, "strategies.json"), encoding="utf-8"))
    jp = json.load(open(os.path.join(HERE, "jumps.json"), encoding="utf-8"))
    ch = json.load(open(os.path.join(HERE, "charts.json"), encoding="utf-8"))

    # every jump clears the threshold and cites a URL from the capture it came from
    urls = {w["source"] for s in ch["series"] for w in s["windows"].values() if w.get("source")}
    thr = jp["threshold_dollars"]
    assert jp["jumps"], "the committed capture does contain jumps at $0.10"
    for j in jp["jumps"]:
        assert abs(j["delta"]) + 1e-9 >= thr, j
        assert j["direction"] == ("up" if j["delta"] > 0 else "down"), j
        if j.get("source_url"):
            assert j["source_url"] in urls, "jump cites a URL that is not in the capture"

    # strategy rollups must equal the sum of their trades
    trades = st["strategies"]["trades"]
    o = st["strategies"]["summary"]["overall"]
    assert o["trades"] == len(trades)
    assert abs(o["net_usd"] - round(sum(t["net_usd"] for t in trades), 2)) < 0.02, o
    assert abs(o["fees_usd"] - round(sum(t["fees_usd"] for t in trades), 2)) < 0.02
    for t in trades:
        leg = fee(t["contracts"], t["entry_price"], t["book"]["series_ticker"], "taker")
        assert leg >= 0
        assert abs(t["net_usd"] - (t["proceeds_usd"] - t["cost_usd"] - t["fees_usd"])) < 1e-6, t
        assert t["cost_usd"] > 0

    # board rows are ranked by a value that exists, and carry a source
    for r in st["board"]:
        assert r.get("market_ticker")
        assert r.get("sources"), f"row without provenance: {r['market_ticker']}"
    # settlement buckets must add up to the markets examined, minus disclosed skips
    s = st["settlement_study"]
    total = sum(b["markets"] for b in s["buckets"])
    assert total + sum(s["rows_skipped"].values()) == s["markets_examined"], (
        total, s["rows_skipped"], s["markets_examined"])
    assert to_float("0.5") == 0.5 and to_float(None) is None and to_float("nope") is None


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok   {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ERR  {t.__name__}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} engine unit tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
