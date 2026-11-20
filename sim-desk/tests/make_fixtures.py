#!/usr/bin/env python3
"""Generate recorded fixtures for sim-desk offline tests.
Payload shapes follow the official API docs:
  - /markets rows: ticker, series_ticker, event_ticker, title, volume_24h, last_price_dollars, close_time
  - /markets/{ticker}/orderbook -> {"orderbook_fp": {"yes_dollars": [[price,count],...], ...}} ascending bids
  - /series/{s}/markets/{m}/candlesticks -> {"candlesticks": [{"price": {"close_dollars": ...}}, ...]}
  - /markets?tickers=... -> {"markets": [...]}
"""
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
F1 = os.path.join(HERE, "fixtures")
F2 = os.path.join(HERE, "fixtures2")
for d in (F1, F2):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"

MARKETS_OPEN = {
    "markets": [
        {"ticker": "KXETHMINMON-ETH-26NOV20-2800000", "series_ticker": "KXETHMINMON",
         "event_ticker": "KXETHMINMON-26NOV20", "title": "Will Ethereum be above $2,800 at 8am EST on November 20?",
         "volume_24h": "20000.00", "volume": "20000.00", "last_price_dollars": "0.9000",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
        {"ticker": "KXBTCMINMON-BTC-26NOV20-6750000", "series_ticker": "KXBTCMINMON",
         "event_ticker": "KXBTCMINMON-26NOV20", "title": "Will Bitcoin be above $67,500 at 8am EST on November 20?",
         "volume_24h": "12000.00", "volume": "12000.00", "last_price_dollars": "0.5500",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
        {"ticker": "KXAAAGASM-26DEC31-3.80", "series_ticker": "KXAAAGASM",
         "event_ticker": "KXAAAGASM-26DEC", "title": "Will the US national average gas price be above $3.80 on December 31?",
         "volume_24h": "8000.00", "volume": "8000.00", "last_price_dollars": "0.4000",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
        {"ticker": "KXNEXTNATOSECGEN-NATO-SEC-GEN", "series_ticker": "KXNEXTNATOSECGEN",
         "event_ticker": "KXNEXTNATOSECGEN", "title": "Who will be the next NATO Secretary General?",
         "volume_24h": "5000.00", "volume": "5000.00", "last_price_dollars": "0.3000",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
        {"ticker": "KXBTCMAX150-BTC-150K", "series_ticker": "KXBTCMAX150",
         "event_ticker": "KXBTCMAX150", "title": "Will Bitcoin hit $150K in 2026?",
         "volume_24h": "6000.00", "volume": "6000.00", "last_price_dollars": "0.1800",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
        {"ticker": "KXOTHER-99", "series_ticker": "KXOTHER",
         "event_ticker": "KXOTHER-99", "title": "Something unrelated to tracked topics",
         "volume_24h": "90000.00", "volume": "90000.00", "last_price_dollars": "0.5000",
         "close_time": "2028-11-07T15:00:00Z", "status": "open"},
    ],
    "cursor": "",
}


def candles(closes):
    return {"candlesticks": [
        {"end_period_ts": 1700000000 + i * 3600,
         "price": {"open_dollars": f"{c:.4f}", "low_dollars": f"{c:.4f}",
                   "high_dollars": f"{c:.4f}", "close_dollars": f"{c:.4f}"},
         "volume_fp": "10.00"} for i, c in enumerate(closes)]}


def trades(closes, start_min=90, step_min=10, ticker="T"):
    """Official trades-tape shape: GET /markets/trades rows (newest-first from the
    API; the engine sorts by created_time itself). Times ascend with the closes."""
    rows = []
    for i, c in enumerate(closes):
        hh = 10 + (start_min + i * step_min) // 60
        mm = (start_min + i * step_min) % 60
        rows.append({"ticker": ticker, "created_time": f"2026-11-20T{hh:02d}:{mm:02d}:00.000000Z",
                     "yes_price_dollars": f"{c:.4f}", "count_fp": "10.00"})
    return {"trades": rows, "cursor": ""}


def ob(yes, no):
    return {"orderbook_fp": {
        "yes_dollars": [[f"{float(p):.4f}", f"{float(c):.2f}"] for p, c in yes],
        "no_dollars": [[f"{float(p):.4f}", f"{float(c):.2f}"] for p, c in no],
    }}


PAYLOADS = {
    "markets_open.json": MARKETS_OPEN,
    "series_empty.json": {"markets": [], "cursor": ""},
    "series_btcminmon.json": {"markets": [MARKETS_OPEN["markets"][1]], "cursor": ""},
    "series_gas.json": {"markets": [MARKETS_OPEN["markets"][2]], "cursor": ""},
    "series_nato.json": {"markets": [MARKETS_OPEN["markets"][3]], "cursor": ""},
    "series_eth.json": {"markets": [MARKETS_OPEN["markets"][0]], "cursor": ""},
    "ob_btc.json": ob([("0.10", 5), ("0.30", 8), ("0.44", 6)], [("0.12", 4), ("0.51", 9)]),
    "ob_gas.json": ob([("0.20", 7), ("0.30", 5)], [("0.40", 10), ("0.55", 8)]),
    "ob_max.json": ob([("0.50", 3), ("0.83", 40)], []),
    "ob_nato.json": ob([("0.30", 6)], [("0.55", 4)]),
    "ob_eth.json": ob([("0.85", 10)], [("0.10", 5)]),
    "trades_btc.json": trades([0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56], ticker="KXBTCMINMON-BTC-26NOV20-6750000"),
    "trades_gas.json": trades([0.52] * 14 + [0.42, 0.41, 0.41, 0.40, 0.39, 0.38], ticker="KXAAAGASM-26DEC31-3.80"),
    "trades_max.json": trades([0.82] * 8, ticker="KXBTCMAX150-BTC-150K"),
    "trades_nato.json": trades([0.30, 0.31, 0.30], ticker="KXNEXTNATOSECGEN-NATO-SEC-GEN"),
    "trades_eth.json": {"trades": [], "cursor": ""},
    "markets_tickers_run1.json": {"markets": [
        {"ticker": "KXBTCMINMON-BTC-26NOV20-6750000", "status": "open", "last_price_dollars": "0.5600"},
        {"ticker": "KXAAAGASM-26DEC31-3.80", "status": "open", "last_price_dollars": "0.4000"},
        {"ticker": "KXBTCMAX150-BTC-150K", "status": "open", "last_price_dollars": "0.8200"},
    ]},
    "markets_tickers_run2.json": {"markets": [
        {"ticker": "KXBTCMINMON-BTC-26NOV20-6750000", "status": "settled", "result": "yes",
         "last_price_dollars": "1.0000", "settlement_ts": "2026-11-20T10:00:00Z",
         "settlement_value_dollars": "1.0000"},
        {"ticker": "KXAAAGASM-26DEC31-3.80", "status": "open", "last_price_dollars": "0.3500"},
        {"ticker": "KXBTCMAX150-BTC-150K", "status": "open", "last_price_dollars": "0.9000"},
    ]},
}

KNOWN_SERIES = ["KXAAAGASW", "KXAAAGASMIN", "KXAAAGASMAX", "KXAAAGASM",
                "KXPRESNOMD", "KXPRESNOMR", "KXPRESPERSON", "KXNEXTNATOSECGEN",
                "KXTIME", "KXOSCARSUPACTO", "KXOSCARSONG", "KXEMMYCACTO",
                "KXBTCD", "KXBTCMINMON", "KXETHMINMON", "KXSOLMINMON",
                "KXPGATOUR", "KXPGA", "KXRYDERCUP"]

MANIFEST1 = {
    "/markets?status=open&limit=1000": "markets_open.json",
    "/markets/KXBTCMINMON-BTC-26NOV20-6750000/orderbook?": "ob_btc.json",
    "/markets/KXAAAGASM-26DEC31-3.80/orderbook?": "ob_gas.json",
    "/markets/KXBTCMAX150-BTC-150K/orderbook?": "ob_max.json",
    "/markets/KXNEXTNATOSECGEN-NATO-SEC-GEN/orderbook?": "ob_nato.json",
    "/markets/KXETHMINMON-ETH-26NOV20-2800000/orderbook?": "ob_eth.json",
    "/markets/trades?ticker=KXBTCMINMON-BTC-26NOV20-6750000&limit=200": "trades_btc.json",
    "/markets/trades?ticker=KXAAAGASM-26DEC31-3.80&limit=200": "trades_gas.json",
    "/markets/trades?ticker=KXBTCMAX150-BTC-150K&limit=200": "trades_max.json",
    "/markets/trades?ticker=KXNEXTNATOSECGEN-NATO-SEC-GEN&limit=200": "trades_nato.json",
    "/markets/trades?ticker=KXETHMINMON-ETH-26NOV20-2800000&limit=200": "trades_eth.json",
    "/markets?tickers=": "markets_tickers_run1.json",
}
# targeted series queries (documented series_ticker filter)
for s in KNOWN_SERIES:
    key = f"/markets?series_ticker={s}&status=open&limit=1000"
    if s == "KXBTCMINMON":
        MANIFEST1[key] = "series_btcminmon.json"
    elif s == "KXAAAGASM":
        MANIFEST1[key] = "series_gas.json"
    elif s == "KXNEXTNATOSECGEN":
        MANIFEST1[key] = "series_nato.json"
    elif s == "KXETHMINMON":
        MANIFEST1[key] = "series_eth.json"
    else:
        MANIFEST1[key] = "series_empty.json"
MANIFEST2 = dict(MANIFEST1)
MANIFEST2["/markets?tickers="] = "markets_tickers_run2.json"

for d, manifest, tickers_name in ((F1, MANIFEST1, "markets_tickers_run1.json"),
                                  (F2, MANIFEST2, "markets_tickers_run2.json")):
    for name, payload in PAYLOADS.items():
        with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1)
            fh.write("\n")
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
        fh.write("\n")

print("fixtures written:", F1, F2)
