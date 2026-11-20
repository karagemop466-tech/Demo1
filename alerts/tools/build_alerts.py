#!/usr/bin/env python3
"""Build the live dual-chat alert feed for the Kalshi demo desk.

Inputs (all committed in this repository, all produced by official Kalshi demo
API requests):

  engine/jumps.json      - every >= $0.10 move between adjacent official
                            candlesticks, each row carrying the exact
                            candlesticks request URL that produced it.
                            Written by tools/jump_scan.py (session 05e53528).
  snapshot/markets.json  - the official market state for the five tracked
                            topics: quotes, order book, 24 h traded notional,
                            open interest, close time, settlement fields and
                            the request URL for each of those values.
  snapshot/resolved.json - the resolved/closed market records (status +
                            result) used to label whether an event has already
                            been determined.

Output:

  alerts/data/feed.json  - the two chat feeds the page renders:
                             * "jumps"     : every >= $0.10 move (all events)
                             * "shortlist" : the same events filtered and ranked
                                             by the published QLM model score
                           plus the model card, the coverage statement and
                           the source list.

Every number written here is either (a) copied verbatim from an official API
response committed in this repository, or (b) computed from such a number by a
formula that is published on the page and asserted in the unit tests.

Official sources used (re-read 2026-11-20):
  https://docs.kalshi.com/getting_started/demo_env
  https://docs.kalshi.com/getting_started/api_environments
  https://docs.kalshi.com/getting_started/market_lifecycle
  https://docs.kalshi.com/getting_started/market_settlement
  https://docs.kalshi.com/getting_started/orderbook_responses
  https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  https://docs.kalshi.com/api-reference/market/get-market-orderbook
  https://docs.kalshi.com/api-reference/market/get-markets
  https://docs.kalshi.com/api-reference/market/get-trades
  https://kalshi.com/docs/kalshi-fee-schedule.pdf
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import sys
from decimal import Decimal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = "https://external-api.demo.kalshi.co/trade-api/v2"

# ---------------------------------------------------------------------------
# Published model card. These weights and caps are shown on the page, so a
# reader can recompute every score by hand.
# ---------------------------------------------------------------------------

THRESHOLD_DOLLARS = 0.10      # the alert threshold required by the brief
CLIP_CONTRACTS = 10            # standard clip used for the fee comparison
MAX_MOVE_NORMALISED = 0.50    # a $0.50 move scores 1.0 on the move component
MAX_HORIZON_HOURS = 720.0     # 30 days; nearer closes score higher
DEPTH_BAND = 0.02             # contracts within 2c of the post-move price
RECENCY_HALF_LIFE_HOURS = 6.0  # a move 6 h old scores 0.5 on the recency component

WEIGHTS = {
    "move_size": 0.25,        # how big the qualifying move was
    "fee_efficiency": 0.15,   # how many times the move covers a round-trip fee
    "depth": 0.20,            # contracts resting near the new price
    "money_behind": 0.15,     # measured 24 h traded notional
    "horizon": 0.10,          # hours to close (nearer is better)
    "recency": 0.15,          # how long ago the move happened (fresher is better)
}

# Per-series fee multipliers, transcribed from the "Non-Standard Fees" table
# of https://kalshi.com/docs/kalshi-fee-schedule.pdf (fetched 2026-11-20).
#
# Only the series actually used by this feed are transcribed: KXBTCY is the
# one with a zero multiplier. Any other series falls back to the document's
# stated default of 1, which is disclosed as an assumption in the model limits.
NON_STANDARD_FEES = {
    "KXAAAGASM": (1, 1),   # US gas price
    "KXBTCY": (0, 0),      # BTC price range EOY
}


def load_fees():
    """Import the fee arithmetic that ships with the desk (single source)."""
    path = os.path.join(REPO, "desk", "tools", "kalshi_fees.py")
    if not os.path.exists(path):
        raise SystemExit(
            "alerts/tools/build_alerts.py needs desk/tools/kalshi_fees.py "
            "(fee arithmetic verified against the published fee table)."
        )
    spec = importlib.util.spec_from_file_location("kalshi_fees", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FEES = load_fees()


def taker_multiplier(series_ticker):
    """Taker fee multiplier for a series: published value, else the default 1."""
    if series_ticker in NON_STANDARD_FEES:
        return NON_STANDARD_FEES[series_ticker][1], "listed in the published non-standard fee table"
    return 1, "default M=1 (series is not listed in the non-standard fee table)"


def num(value):
    if value is None or value == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def iso(ts):
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def market_map(snapshot_markets):
    return {m["market_ticker"]: m for m in snapshot_markets.get("markets", [])}


def resolved_map(snapshot_resolved):
    return {m["market_ticker"]: m for m in snapshot_resolved.get("markets", [])}


def level_price_contracts(level):
    """Normalise one order-book level.

    The official endpoint returns `[price_dollars, count_fp]` pairs; the
    committed snapshot stores the same two values as an object.
    """
    if isinstance(level, dict):
        return num(level.get("price")), num(level.get("contracts"))
    if isinstance(level, (list, tuple)) and len(level) >= 2:
        return num(level[0]), num(level[1])
    return None, None


def best_bid(levels):
    """Highest resting bid from an official order-book side."""
    best = None
    for level in levels or []:
        price, contracts = level_price_contracts(level)
        if price is None:
            continue
        if best is None or price > best[0]:
            best = (price, contracts or 0.0)
    return best


def depth_near(yes_bids, no_bids, yes_price, band=DEPTH_BAND):
    """Contracts resting within `band` of `yes_price`, on either side.

    YES bids are quoted directly. A NO bid at p is a YES ask at (1 - p), per
    https://docs.kalshi.com/getting_started/orderbook_responses
    """
    if yes_price is None:
        return None
    total = 0.0
    hit = False
    for level in yes_bids or []:
        price, contracts = level_price_contracts(level)
        if price is None:
            continue
        if price >= yes_price - band - 1e-9:
            total += contracts or 0.0
            hit = True
    for level in no_bids or []:
        price, contracts = level_price_contracts(level)
        if price is None:
            continue
        implied_yes_ask = 1.0 - price
        if implied_yes_ask <= yes_price + band + 1e-9:
            total += contracts or 0.0
            hit = True
    return total if hit else 0.0


def build_shortlist(jumps, markets, resolved, reference_dt):
    """One candidate per market: its most recent qualifying move, scored."""
    # Most recent qualifying move per market, traded close preferred.
    newest = {}
    for j in jumps:
        key = j["market_ticker"]
        current = newest.get(key)
        rank = (j["t"], 1 if j.get("price_basis") == "traded" else 0)
        if current is None:
            newest[key] = (rank, j)
        else:
            best = current[0]
            if rank > best or (rank[0] == best[0] and rank[1] > best[1]):
                newest[key] = (rank, j)

    candidates = []
    for ticker, (_, jump) in newest.items():
        m = markets.get(ticker)
        if m is None:
            continue
        ob = m.get("orderbook") or {}
        yes_bids = ob.get("yes_bids") or []
        no_bids = ob.get("no_bids") or []
        yes_bid = best_bid(yes_bids)
        no_bid = best_bid(no_bids)
        # Implied ask for YES = 1 - best NO bid (official reciprocal rule).
        yes_ask = (1.0 - no_bid[0]) if no_bid else None
        yes_ask_contracts = no_bid[1] if no_bid else None
        yes_bid_price = yes_bid[0] if yes_bid else None
        yes_bid_contracts = yes_bid[1] if yes_bid else None

        post_price = jump.get("to")
        m_series = m.get("series_ticker") or jump.get("series_ticker")
        mult, mult_reason = taker_multiplier(m_series)

        excluded = []
        components = {}
        reasons = []

        # --- 1. move size -------------------------------------------------
        delta = abs(num(jump.get("delta")) or 0.0)
        n_move = min(delta / MAX_MOVE_NORMALISED, 1.0) if delta else 0.0
        components["move_size"] = {
            "weight": WEIGHTS["move_size"],
            "value": round(delta, 4),
            "normalised": round(n_move, 4),
            "formula": "min(|delta| / %s, 1)" % MAX_MOVE_NORMALISED,
        }

        # --- 2. fee efficiency --------------------------------------------
        entry_price = post_price
        fee = None
        if entry_price is not None and 0 < entry_price < 1:
            fee = FEES.taker_fee(entry_price, CLIP_CONTRACTS, mult)
            round_trip = fee * 2
            if round_trip > 0:
                n_fee = min(delta / float(round_trip), 1.0)
                fee_formula = "|delta| / (2 x taker fee for %d contracts at $%.4f)" % (
                    CLIP_CONTRACTS, entry_price)
            else:
                n_fee = 1.0
                fee_formula = "taker fee is $0.00 on this series, so the move covers the fee"
        else:
            n_fee = None
            fee_formula = "no usable post-move price"
            excluded.append("fee_efficiency: no usable post-move price")
        components["fee_efficiency"] = {
            "weight": WEIGHTS["fee_efficiency"],
            "value": float(fee * 2) if fee is not None else None,
            "normalised": round(n_fee, 4) if n_fee is not None else None,
            "formula": fee_formula,
            "taker_multiplier": mult,
            "taker_multiplier_reason": mult_reason,
        }

        # --- 3. depth ------------------------------------------------------
        d = depth_near(yes_bids, no_bids, post_price)
        components["depth"] = {
            "weight": WEIGHTS["depth"],
            "value": d,
            "normalised": None,  # filled in after the relative maximum is known
            "formula": "contracts resting within $%.2f of the post-move price (YES bids + implied YES asks)" % DEPTH_BAND,
        }
        if d is None:
            excluded.append("depth: no post-move price")

        # --- 4. money behind it -------------------------------------------
        notional = (m.get("dollar_notional_24h") or {})
        n_val = num(notional.get("value"))
        components["money_behind"] = {
            "weight": WEIGHTS["money_behind"],
            "value": n_val,
            "normalised": None,
            "formula": "measured 24 h traded notional = SUM(yes_price_dollars * count_fp) over public trades",
            "complete": notional.get("complete"),
            "source": notional.get("source"),
        }
        if n_val is None:
            excluded.append("money_behind: no measured 24 h notional in the snapshot")

        # --- 5. horizon ----------------------------------------------------
        close_dt = parse_iso(m.get("close_time"))
        hours = None
        if close_dt:
            hours = (close_dt - reference_dt).total_seconds() / 3600.0
            n_h = max(0.0, 1.0 - min(max(hours, 0.0), MAX_HORIZON_HOURS) / MAX_HORIZON_HOURS)
        else:
            n_h = None
            excluded.append("horizon: no close_time in the snapshot")
        components["horizon"] = {
            "weight": WEIGHTS["horizon"],
            "value": round(hours, 2) if hours is not None else None,
            "normalised": round(n_h, 4) if n_h is not None else None,
            "formula": "1 - min(hours to close, %s) / %s" % (MAX_HORIZON_HOURS, MAX_HORIZON_HOURS),
        }

        # --- 6. recency ----------------------------------------------------
        move_dt = parse_iso(jump.get("time_utc")) or (dt.datetime.fromtimestamp(
            int(jump["t"]), dt.timezone.utc) if jump.get("t") else None)
        age_hours = None
        if move_dt:
            # Rounded first so the published component can be recomputed exactly.
            age_hours = round((reference_dt - move_dt).total_seconds() / 3600.0, 3)
            n_r = 1.0 / (1.0 + max(age_hours, 0.0) / RECENCY_HALF_LIFE_HOURS)
        else:
            n_r = None
            excluded.append("recency: the move has no timestamp")
        components["recency"] = {
            "weight": WEIGHTS["recency"],
            "value": round(age_hours, 3) if age_hours is not None else None,
            "normalised": round(n_r, 4) if n_r is not None else None,
            "formula": "1 / (1 + hours since the move / %s)" % RECENCY_HALF_LIFE_HOURS,
        }

        res = resolved.get(ticker) or {}
        row = {
            "market_ticker": ticker,
            "series_ticker": m_series,
            "event_ticker": m.get("event_ticker"),
            "topic": m.get("topic"),
            "title": m.get("title"),
            "event_title": m.get("event_title"),
            "move": {
                "time_utc": jump.get("time_utc") or iso(jump["t"]),
                "t": jump.get("t"),
                "from": jump.get("from"),
                "to": jump.get("to"),
                "delta": jump.get("delta"),
                "direction": jump.get("direction"),
                "window": jump.get("window"),
                "period_minutes": jump.get("period_minutes"),
                "price_basis": jump.get("price_basis"),
                "source_url": jump.get("source_url"),
                "age_hours_at_snapshot": round(age_hours, 3) if age_hours is not None else None,
            },
            "current": {
                "snapshot_utc": m.get("_snapshot_utc"),
                "yes_bid": yes_bid_price,
                "yes_bid_contracts": yes_bid_contracts,
                "yes_ask_implied": round(yes_ask, 4) if yes_ask is not None else None,
                "yes_ask_contracts": yes_ask_contracts,
                "no_bid": no_bid[0] if no_bid else None,
                "no_bid_contracts": no_bid[1] if no_bid else None,
                "last_price": num(m.get("last_price")),
                "volume_24h_contracts": num(m.get("volume_24h_contracts")),
                "open_interest_contracts": num(m.get("open_interest_contracts")),
                "close_time": m.get("close_time"),
                "expected_expiration_time": m.get("expected_expiration_time"),
                "orderbook_source": ob.get("source"),
                "market_source": (m.get("sources") or {}).get("market"),
            },
            "resolution": {
                "status": m.get("status"),
                "result": m.get("result"),
                "settlement_value_dollars": m.get("settlement_value_dollars"),
                "settlement_ts": m.get("settlement_ts"),
                "resolved_record_status": res.get("status"),
                "resolved_record_result": res.get("result"),
            },
            "components": components,
            "excluded_inputs": excluded,
            "sources": {
                "markets": (m.get("sources") or {}).get("markets"),
                "market": (m.get("sources") or {}).get("market"),
                "event": (m.get("sources") or {}).get("event"),
                "orderbook": ob.get("source"),
                "trades": notional.get("source"),
                "candlesticks": jump.get("source_url"),
            },
            "market_page": "https://kalshi.com/markets/%s" % ticker,
            "news_search_url": jump.get("news_search_url"),
        }
        candidates.append(row)

    # Relative normalisation: depth and notional are ranked against the
    # strongest candidate in this snapshot, which is stated on the page.
    max_depth = max([c["components"]["depth"]["value"] for c in candidates
                      if c["components"]["depth"]["value"] is not None] or [0]) or 0
    max_notional = max([c["components"]["money_behind"]["value"] for c in candidates
                        if c["components"]["money_behind"]["value"] is not None] or [0]) or 0
    for c in candidates:
        depth = c["components"]["depth"]
        if depth["value"] is not None and max_depth > 0:
            depth["normalised"] = round(depth["value"] / max_depth, 4)
            depth["normalisation"] = "depth / max depth in this snapshot (%s contracts)" % max_depth
        money = c["components"]["money_behind"]
        if money["value"] is not None and max_notional > 0:
            money["normalised"] = round(
                math.log10(1 + max(money["value"], 0)) / math.log10(1 + max_notional), 4)
            money["normalisation"] = "log10(1 + notional) / log10(1 + max notional in this snapshot) ($%s)" % max_notional

        total_w = 0.0
        acc = 0.0
        for name, comp in c["components"].items():
            if comp.get("normalised") is None:
                continue
            total_w += comp["weight"]
            acc += comp["weight"] * comp["normalised"]
        c["score"] = round(100.0 * acc / total_w, 1) if total_w else None
        c["score_formula"] = ("100 x SUM(weight x normalised component) / SUM(weight of available "
                              "components); components with a missing official value are dropped and the "
                              "reason is listed in excluded_inputs")
        c["weights_used"] = round(total_w, 4)

        # Human-readable reasons, derived only from the numbers above.
        reasons = []
        if c["components"]["move_size"]["normalised"] >= 0.5:
            reasons.append("move of $%.2f is large relative to the $0.10 alert floor" %
                           c["components"]["move_size"]["value"])
        if c["components"]["fee_efficiency"]["normalised"] == 1.0:
            if c["components"]["fee_efficiency"]["value"] == 0:
                reasons.append("no taker fee on this series in the published fee table")
            else:
                reasons.append("move covers the round-trip fee %.1fx" % (
                    c["components"]["move_size"]["value"] / c["components"]["fee_efficiency"]["value"]))
        if c["components"]["depth"]["value"]:
            reasons.append("%s contracts resting within $%.2f of $%.2f" % (
                f'{c["components"]["depth"]["value"]:,.0f}', DEPTH_BAND, c["move"]["to"]))
        if c["components"]["money_behind"]["value"]:
            reasons.append("$%s traded in the last 24 h (measured)" % f'{c["components"]["money_behind"]["value"]:,.0f}')
        if c["components"]["horizon"]["value"] is not None:
            reasons.append("%s hours to close" % f'{c["components"]["horizon"]["value"]:,.0f}')
        if c["current"]["yes_ask_implied"] in (None, 0.0):
            reasons.append("one-sided book: no live YES ask in the snapshot")
        c["reasons"] = reasons

    candidates.sort(key=lambda c: (c["score"] is None, -(c["score"] or 0)))
    for i, c in enumerate(candidates, start=1):
        c["rank"] = i
    return candidates


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--jumps", default=os.path.join(REPO, "engine", "jumps.json"))
    ap.add_argument("--charts", default=os.path.join(REPO, "snapshot", "charts.json"))
    ap.add_argument("--markets", default=os.path.join(REPO, "snapshot", "markets.json"))
    ap.add_argument("--resolved", default=os.path.join(REPO, "snapshot", "resolved.json"))
    ap.add_argument("--out", default=os.path.join(REPO, "alerts", "data", "feed.json"))
    ap.add_argument("--threshold", type=float, default=THRESHOLD_DOLLARS)
    args = ap.parse_args()

    jumps_doc = load(args.jumps)
    charts_doc = load(args.charts)
    markets_doc = load(args.markets)
    resolved_doc = load(args.resolved)

    markets = market_map(markets_doc)
    resolved = resolved_map(resolved_doc)
    for m in markets_doc.get("markets", []):
        m["_snapshot_utc"] = markets_doc.get("generated_utc")
    for m in resolved_doc.get("markets", []):
        m["_snapshot_utc"] = resolved_doc.get("generated_utc")

    threshold = args.threshold
    jumps = [j for j in jumps_doc.get("jumps", [])
             if abs(num(j.get("delta")) or 0.0) >= threshold - 1e-9]
    jumps.sort(key=lambda j: j.get("t") or 0, reverse=True)

    reference_dt = parse_iso(markets_doc.get("generated_utc")) or dt.datetime.now(dt.timezone.utc)

    rows = []
    for j in jumps:
        m = markets.get(j["market_ticker"]) or {}
        ob = m.get("orderbook") or {}
        yb = best_bid(ob.get("yes_bids"))
        nb = best_bid(ob.get("no_bids"))
        rows.append({
            "t": j.get("t"),
            "time_utc": j.get("time_utc") or (iso(j["t"]) if j.get("t") else None),
            "topic": j.get("topic"),
            "market_ticker": j.get("market_ticker"),
            "series_ticker": j.get("series_ticker"),
            "event_ticker": j.get("event_ticker"),
            "title": j.get("title") or m.get("title"),
            "event_title": j.get("event_title") or m.get("event_title"),
            "from": j.get("from"),
            "to": j.get("to"),
            "delta": j.get("delta"),
            "direction": j.get("direction"),
            "window": j.get("window"),
            "period_minutes": j.get("period_minutes"),
            "price_basis": j.get("price_basis"),
            "candle_yes_bid": j.get("yes_bid"),
            "candle_yes_ask": j.get("yes_ask"),
            "candle_volume": j.get("volume"),
            "gap_seconds": j.get("gap_seconds"),
            "source_url": j.get("source_url"),
            "market_page": "https://kalshi.com/markets/%s" % j.get("market_ticker"),
            "news_search_url": j.get("news_search_url"),
            "market_source": (m.get("sources") or {}).get("market"),
            "orderbook_source": ob.get("source"),
        })

    shortlist = build_shortlist(jumps, markets, resolved, reference_dt)
    chart_tickers = [s_["market_ticker"] for s_ in charts_doc.get("series", [])]

    # The list the browser polls when "poll the live API" is switched on, with the
    # last official 1-minute close as the baseline so a poll only reports moves
    # that happened after the committed snapshot.
    window_sources = {}
    for w in jumps_doc.get("windows", []):
        window_sources[(w.get("market_ticker"), w.get("window"))] = w.get("source_url")

    def close_of(point):
        """Traded close, else the mid of the book's bid/ask close (never invented)."""
        if not point:
            return None
        if point.get("price_close") is not None:
            return point["price_close"]
        bid = point.get("yes_bid_close")
        ask = point.get("yes_ask_close")
        if bid is not None and ask is not None:
            return (bid + ask) / 2.0
        return None

    scan_list = []
    for series in charts_doc.get("series", []):
        ticker = series.get("market_ticker")
        windows = series.get("windows") or {}
        win = windows.get("1m/6h") or {}
        points = [p for p in (win.get("points") or []) if close_of(p) is not None]
        points.sort(key=lambda p: p.get("t") or 0)
        seed = points[-1] if points else None
        m = markets.get(ticker) or {}
        scan_list.append({
            "market_ticker": ticker,
            "series_ticker": series.get("series_ticker"),
            "topic": m.get("topic"),
            "title": m.get("title"),
            "event_title": m.get("event_title"),
            "seed_close": close_of(seed),
            "seed_basis": ("traded" if (seed or {}).get("price_close") is not None else "book_mid"),
            "seed_t": seed.get("t") if seed else None,
            "candlesticks_source": window_sources.get((ticker, "1m/6h")),
        })

    by_window = {}
    by_topic = {}
    for r in rows:
        by_window[r["window"]] = by_window.get(r["window"], 0) + 1
        by_topic[r["topic"]] = by_topic.get(r["topic"], 0) + 1

    feed = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "base": BASE,
        "threshold_dollars": threshold,
        "clip_contracts": CLIP_CONTRACTS,
        "inputs": {
            "charts": {
                "path": "snapshot/charts.json",
                "generated_utc": charts_doc.get("generated_utc"),
                "markets": len(charts_doc.get("series", [])),
                "note": charts_doc.get("note"),
            },
            "jumps": {
                "path": "engine/jumps.json",
                "generated_utc": jumps_doc.get("generated_utc"),
                "method": jumps_doc.get("method"),
                "coverage": jumps_doc.get("coverage"),
                "threshold_dollars": jumps_doc.get("threshold_dollars"),
            },
            "markets": {
                "path": "snapshot/markets.json",
                "generated_utc": markets_doc.get("generated_utc"),
                "count": len(markets),
            },
            "resolved": {
                "path": "snapshot/resolved.json",
                "generated_utc": resolved_doc.get("generated_utc"),
                "count": len(resolved),
            },
        },
        "coverage": {
            "markets_with_candles": jumps_doc.get("coverage", {}).get("markets_with_candles"),
            "markets_with_an_alert": len({r["market_ticker"] for r in rows}),
            "markets_without_an_alert": [
                {
                    "market_ticker": ticker,
                    "topic": (markets.get(ticker) or {}).get("topic"),
                    "title": (markets.get(ticker) or {}).get("title"),
                    "reason": "no move of $%.2f or more between adjacent candles in the scanned windows"
                              % threshold,
                }
                for ticker in sorted(chart_tickers)
                if ticker not in {r["market_ticker"] for r in rows}
            ],
            "windows_scanned": jumps_doc.get("coverage", {}).get("windows"),
            "candles_scanned": jumps_doc.get("coverage", {}).get("candles_scanned"),
            "alerts_published": len(rows),
            "alerts_by_window": by_window,
            "alerts_by_topic": by_topic,
            "shortlisted_markets": len(shortlist),
        },
        "model": {
            "name": "QLM score (Quality - Liquidity - Money)",
            "version": "1.0",
            "purpose": ("Ranks the qualifying events by how tradeable and how quickly resolvable they "
                        "are. It is a ranking heuristic built only from official API fields. It is not "
                        "a probability of winning, it is not a price forecast, and it does not assert "
                        "a cause for any move."),
            "formula": "score = 100 x SUM(weight x normalised component) / SUM(weight of available components)",
            "weights": WEIGHTS,
            "caps": {
                "max_move_normalised_dollars": MAX_MOVE_NORMALISED,
                "max_horizon_hours": MAX_HORIZON_HOURS,
                "depth_band_dollars": DEPTH_BAND,
                "clip_contracts": CLIP_CONTRACTS,
            },
            "components": {
                "move_size": "|delta| of the qualifying move, capped at $%.2f" % MAX_MOVE_NORMALISED,
                "fee_efficiency": "|delta| divided by the round-trip taker fee for a %d-contract clip at the post-move price" % CLIP_CONTRACTS,
                "depth": "contracts resting within $%.2f of the post-move price, ranked against the strongest candidate in this snapshot" % DEPTH_BAND,
                "money_behind": "measured 24 h traded notional, log-scaled against the strongest candidate in this snapshot",
                "horizon": "hours to close_time, capped at %d hours" % int(MAX_HORIZON_HOURS),
                "recency": "hours since the move, decayed as 1 / (1 + hours / %s)" % RECENCY_HALF_LIFE_HOURS,
            },
            "field_sources": {
                "delta": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
                "fees": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
                "depth": "https://docs.kalshi.com/getting_started/orderbook_responses",
                "notional": "https://docs.kalshi.com/api-reference/market/get-trades",
                "close_time": "https://docs.kalshi.com/api-reference/market/get-markets",
                "result": "https://docs.kalshi.com/getting_started/market_lifecycle",
            },
            "limits": [
                "The score ranks tradeable, liquid, fast-resolving candidates. It does not estimate the "
                "probability that an event resolves YES.",
                "Realised ROI needs the settlement result (YES pays $1 per contract, NO pays $0) and is "
                "tracked separately by the simulation ledger pages.",
                "Depth and traded notional are normalised against the other candidates in this snapshot, "
                "so the score is a relative ranking, not an absolute value.",
                "Every input is a demo-environment value; Kalshi states demo prices may not reflect real markets.",
            ],
        },
        "scan_list": scan_list,
        "jumps": rows,
        "shortlist": shortlist,
        "sources": [
            {"label": "Demo environment and endpoints",
             "url": "https://docs.kalshi.com/getting_started/demo_env"},
            {"label": "API environments and endpoints",
             "url": "https://docs.kalshi.com/getting_started/api_environments"},
            {"label": "Market lifecycle (status, result)",
             "url": "https://docs.kalshi.com/getting_started/market_lifecycle"},
            {"label": "Market settlement ($1 per winning contract)",
             "url": "https://docs.kalshi.com/getting_started/market_settlement"},
            {"label": "Order book responses (bids only, implied asks)",
             "url": "https://docs.kalshi.com/getting_started/orderbook_responses"},
            {"label": "Get Market Candlesticks",
             "url": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"},
            {"label": "Get Market Orderbook",
             "url": "https://docs.kalshi.com/api-reference/market/get-market-orderbook"},
            {"label": "Get Markets",
             "url": "https://docs.kalshi.com/api-reference/market/get-markets"},
            {"label": "Get Trades",
             "url": "https://docs.kalshi.com/api-reference/market/get-trades"},
            {"label": "Fee schedule",
             "url": "https://kalshi.com/docs/kalshi-fee-schedule.pdf"},
        ],
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, indent=1, sort_keys=False)
        fh.write("\n")

    print("wrote %s" % args.out)
    print("  alerts published : %d" % len(rows))
    print("  shortlist        : %d markets" % len(shortlist))
    print("  by window        : %s" % json.dumps(by_window, sort_keys=True))
    print("  by topic         : %s" % json.dumps(by_topic, sort_keys=True))
    for c in shortlist[:5]:
        print("   #%d %-9s score=%s  %s" % (c["rank"], c["topic"], c["score"],
                                           (c["title"] or "")[:58]))


if __name__ == "__main__":
    main()
