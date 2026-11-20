#!/usr/bin/env python3
"""
jump_scan.py — find sharp contract-price moves in captured Kalshi candlesticks.

Read-only over `snapshot/charts.json` (written by tools/collect_kalshi.py from the
official demo Trade API). It never invents a price: every point it reads and every
jump it reports carries the exact request URL that returned it.

Why candles and not client polling: the official candlestick endpoint is the only
public REST source of price history (period_interval 1 / 60 / 1440 minutes), so a
"jump" here means two adjacent candles whose recorded close prices differ by at
least the threshold. Nothing is interpolated between candles.

Price field used (deliberate, and disclosed on the page):
  `price_close` — the last *traded* price of the candle. Kalshi returns null for
  candles with no trade, so those candles are skipped rather than filled from the
  book. A jump therefore always means real trades moved the price, not a quote
  flicker. A second series (`mid`) built from yes_bid_close / yes_ask_close is also
  scanned, labelled "book mid", because on thin demo markets traded prices can be
  hours apart.

Official sources for the fields and semantics used:
  https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  https://docs.kalshi.com/getting_started/orderbook_responses   (bids only; ask = 1 - opposite bid)
  https://docs.kalshi.com/getting_started/market_lifecycle     (status / result semantics)

Usage:
  python3 tools/jump_scan.py [--threshold 0.10] [--charts snapshot/charts.json] [--out engine/jumps.json]
"""

from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timezone

# Google News search URL builder. This is a *search*, not a source: it is never used
# to attribute a cause to a jump, only to give a reader somewhere to look.
NEWS_URL = "https://news.google.com/search?q={q}"


def to_float(value):
    """Return a float for API dollar strings/numbers, or None when absent."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def iso(ts):
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def point_value(p, field):
    """The price for one candle under a basis.

    `price_close` is the official traded close. `mid` is the book mid, computed only
    from the two official close fields of the same candle — (yes_bid_close +
    yes_ask_close) / 2 — and None when either side is missing, so a one-sided book
    never produces a fake mid.
    """
    if field == "mid":
        bid = to_float(p.get("yes_bid_close"))
        ask = to_float(p.get("yes_ask_close"))
        if bid is None or ask is None:
            return None
        return (bid + ask) / 2.0
    return to_float(p.get(field))


def series_from_points(points, field):
    """Ordered (t, value, point) triples where the basis yields a usable number."""
    out = []
    for p in points or []:
        v = point_value(p, field)
        if v is None or p.get("t") is None:
            continue
        out.append((int(p["t"]), v, p))
    out.sort(key=lambda r: r[0])
    return out


def find_jumps(points, field, threshold):
    """Adjacent-candle moves of |delta| >= threshold on one price series.

    Returns one record per move. Only the *previous* and *current* candle values are
    used, so the result is reproducible from the two source URLs on the record.
    """
    rows = series_from_points(points, field)
    jumps = []
    for (t_prev, v_prev, _), (t_cur, v_cur, p_cur) in zip(rows, rows[1:]):
        delta = v_cur - v_prev
        if abs(delta) + 1e-12 < threshold:
            continue
        jumps.append({
            "t": t_cur,
            "time_utc": iso(t_cur),
            "gap_seconds": t_cur - t_prev,
            "from": round(v_prev, 4),
            "to": round(v_cur, 4),
            "delta": round(delta, 4),
            "direction": "up" if delta > 0 else "down",
            "volume": to_float(p_cur.get("volume")),
            "yes_bid": to_float(p_cur.get("yes_bid_close")),
            "yes_ask": to_float(p_cur.get("yes_ask_close")),
        })
    return jumps


def normalize_charts(charts):
    """Return a `series`-style list from either supported layout.

    snapshot/charts.json stores {"series": [{market_ticker, series_ticker, windows}]};
    engine/data/live-snapshot.json stores each market's candles inline under
    {"markets": [{market_ticker, series_ticker, candles}]}. Normalizing here keeps the
    jump math identical whether it runs on the committed snapshot or on a fresh pull.
    """
    if charts.get("series"):
        return charts["series"]
    out = []
    for m in charts.get("markets", []) or []:
        if not m.get("candles"):
            continue
        out.append({
            "market_ticker": m.get("market_ticker"),
            "series_ticker": m.get("series_ticker"),
            "windows": m["candles"],
        })
    return out


def build(charts, markets_by_ticker, resolved_by_ticker, threshold):
    """Scan every captured window of every market and emit jump records + coverage."""
    records = []
    scanned = 0
    windows = []
    for entry in normalize_charts(charts):
        ticker = entry.get("market_ticker")
        for label, win in (entry.get("windows") or {}).items():
            points = win.get("points") or []
            src = win.get("source")
            scanned += len(points)
            per_field = {}
            for field, kind in (("price_close", "traded"), ("mid", "book mid")):
                js = find_jumps(points, field, threshold)
                for j in js:
                    j = dict(j)
                    j.update({
                        "market_ticker": ticker,
                        "series_ticker": entry.get("series_ticker"),
                        "window": label,
                        "period_minutes": win.get("period_interval_minutes") or win.get("period_minutes"),
                        "price_basis": kind,
                        "field": field,
                        "source_url": src,
                        "fetch_error": win.get("error"),
                    })
                    m = markets_by_ticker.get(ticker) or resolved_by_ticker.get(ticker) or {}
                    j["title"] = m.get("title")
                    j["event_ticker"] = m.get("event_ticker")
                    j["event_title"] = m.get("event_title")
                    j["topic"] = m.get("topic")
                    j["status"] = m.get("status")
                    j["result"] = m.get("result")
                    j["news_search_url"] = NEWS_URL.format(
                        q='"' + (m.get("event_title") or m.get("title") or ticker) + '"')
                    records.append(j)
                per_field[kind] = len(js)
            windows.append({
                "market_ticker": ticker,
                "window": label,
                "points": len(points),
                "first_t": (points[0] or {}).get("t") if points else None,
                "last_t": (points[-1] or {}).get("t") if points else None,
                "source_url": src,
                "jumps_traded": per_field["traded"],
                "jumps_book_mid": per_field["book mid"],
            })
    records.sort(key=lambda r: (-abs(r["delta"]), r["time_utc"]))
    return records, windows, scanned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--charts", default="snapshot/charts.json")
    ap.add_argument("--markets", default="snapshot/markets.json")
    ap.add_argument("--resolved", default="snapshot/resolved.json")
    ap.add_argument("--threshold", type=float, default=0.10)
    ap.add_argument("--out", default="engine/jumps.json")
    args = ap.parse_args()

    charts = json.load(open(args.charts, encoding="utf-8"))
    markets = json.load(open(args.markets, encoding="utf-8")).get("markets", [])
    resolved = json.load(open(args.resolved, encoding="utf-8")).get("markets", [])
    by_t = {m.get("market_ticker"): m for m in markets}
    by_r = {m.get("market_ticker"): m for m in resolved}

    records, windows, scanned = build(charts, by_t, by_r, args.threshold)

    payload = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": {
            "charts": args.charts,
            "charts_generated_utc": charts.get("generated_utc"),
            "charts_base": charts.get("base"),
            "markets": args.markets,
            "resolved": args.resolved,
        },
        "threshold_dollars": args.threshold,
        "method": (
            "adjacent candles in the official candlestick response whose recorded close "
            "differs by >= threshold; price_close (traded) and yes/mid (book) scanned "
            "separately; null closes skipped, never filled"
        ),
        "endpoints_used": [
            "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
            "https://docs.kalshi.com/getting_started/orderbook_responses",
        ],
        "coverage": {
            "markets_with_candles": len(charts.get("series", [])),
            "windows": len(windows),
            "candles_scanned": scanned,
            "jumps_found": len(records),
        },
        "windows": windows,
        "jumps": records,
        "caveats": [
            "Demo venue: Kalshi states demo prices and behavior may not reflect real markets "
            "(https://docs.kalshi.com/getting_started/demo_env).",
            "A jump is a price move, not a cause. news_search_url is a search query, not a source.",
            "Only markets that tools/collect_kalshi.py captured candles for are scanned; "
            "uncovered markets are not evidence of no movement.",
        ],
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)
    print(f"jump_scan: {len(records)} jumps >= ${args.threshold:.2f} "
          f"over {scanned} candles / {len(windows)} windows -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
