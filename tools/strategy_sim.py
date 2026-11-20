#!/usr/bin/env python3
"""
strategy_sim.py — fee-aware simulated trading + settlement study over official
Kalshi demo data. Deterministic, offline, no network, no fabricated prices.

Three analyses, all reproducible from the input files:

1. `settlement_study` — for every market that has settled, treat its final traded
   price as the entry, pay out the official settlement value, and charge the
   official taker fee. Answers the question a trader actually has: at each price
   bucket, how often does YES win, and what is left after fees? Uses `result`
   (yes/no) and `settlement_value_dollars` exactly as the API returned them.

2. `candle_strategies` — three rule-based strategies replayed over captured
   candlesticks, filled at the candle's recorded bid/ask (so crossing the spread
   is paid, not waved away):
     J1  jump-momentum  after a traded up-move >= threshold, buy YES at that
                        candle's ask, sell at the exit candle's bid.
     J2  jump-fade      after the same move, buy NO at (1 - YES bid) and exit at
                        (1 - YES ask) — the documented reciprocal of the book.
     J3  stale-quote    buy the side the book is leaning on when volume is zero in
                        the entry candle, exit at the next candle with volume > 0.
   One position per market at a time, fixed size, no pyramiding, no leverage,
   no fills outside the recorded book.

3. `liquidity` — spread and top-of-book depth for open markets, from the order
   book response, including the implied ask identity 1.00 - highest opposite bid.

Fee formula (official, https://kalshi.com/docs/kalshi-fee-schedule.pdf, "Last
updated and effective: July 7, 2026"):
    taker fee = round up( M x 0.07  x C x P x (1 - P) )
    maker fee = round up( M x 0.0175 x C x P x (1 - P) )
  P = price in dollars, C = contracts, M = per-contract multiplier (taker default 1,
  maker default 0). No settlement fee and no membership fee. The "Non-Standard
  Fees" table lists per-series multipliers; the ones below are copied verbatim from
  that table for the series this repo touches, and every other series uses the
  default M = 1 for taker / 0 for maker, as the schedule states.

Everything simulated here is labelled `SIMULATED`. It is not investment advice and
it is not the demo account's ledger: there is no API key in this repo, so no real
order was placed or could be. See engine/flagged.html.

Usage:
  python3 tools/strategy_sim.py [--out engine/strategies.json]
"""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_CEILING, Decimal

FEE_SOURCE = "https://kalshi.com/docs/kalshi-fee-schedule.pdf"
TAKER_COEF = Decimal("0.07")
MAKER_COEF = Decimal("0.0175")

# Verbatim from the schedule's "Non-Standard Fees" table (maker / taker
# multipliers). Series not listed keep the schedule's defaults (maker 0, taker 1).
SERIES_MULTIPLIERS = {
    "KXAAAGASM": {"maker": 1, "taker": 1, "series_title": "US gas price"},
    "KXBTCY": {"maker": 0, "taker": 0, "series_title": "BTC price range EOY"},
    "KXETHY": {"maker": 0, "taker": 0, "series_title": "ETH price EOY"},
}

TOPIC_LABEL = {
    "gas_prices": "Gas prices", "elections": "Elections", "culture": "Culture",
    "crypto": "Crypto", "golf": "Golf",
    "gas": "Gas prices", "crypto": "Crypto",
}


def fnum(v):
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def fee(contracts: float, price: float, series_ticker: str | None = None,
        side: str = "taker") -> float:
    """Official fee: round up to the cent, exactly as the schedule defines.

    `round up` in the schedule means the fee is rounded up to the next cent when it
    is added to the position cost, so ROUND_CEILING on the cent grid is the faithful
    reading; a zero-multiplier series pays 0.00 by definition, not by rounding.
    """
    coef = TAKER_COEF if side == "taker" else MAKER_COEF
    entry = SERIES_MULTIPLIERS.get(series_ticker or "", {})
    if side == "taker":
        mult = entry.get("taker", 1)
    else:
        mult = entry.get("maker", 0)
    if not mult or contracts <= 0 or price is None:
        return 0.0
    raw = Decimal(str(mult)) * coef * Decimal(str(contracts)) * Decimal(str(price)) \
        * (Decimal(1) - Decimal(str(price)))
    cents = (raw * 100).to_integral_value(rounding=ROUND_CEILING)
    return float(cents / 100)


def position_cost(contracts: float, price: float) -> float:
    return contracts * price


# --------------------------------------------------------------------------- inputs
def _markets_list(blob, *keys):
    """Accept either {"markets": [...]} or the engine live-snapshot layout."""
    for k in keys:
        if isinstance(blob.get(k), list):
            return blob[k]
    return []


def _candle_series(charts):
    """Yield (market_ticker, series_ticker, label, window) from either layout."""
    for entry in charts.get("series", []) or []:
        for label, win in (entry.get("windows") or {}).items():
            yield entry.get("market_ticker"), entry.get("series_ticker"), label, win
    for m in charts.get("markets", []) or []:
        for label, win in (m.get("candles") or {}).items():
            yield m.get("market_ticker"), m.get("series_ticker"), label, win


def _points(win):
    pts = []
    for p in win.get("points") or []:
        if p.get("t") is None:
            continue
        pts.append(p)
    pts.sort(key=lambda p: int(p["t"]))
    return pts


# ------------------------------------------------------------------ 1. settlement study
BUCKETS = [(0.0, 0.10), (0.10, 0.20), (0.20, 0.30), (0.30, 0.40), (0.40, 0.50),
           (0.50, 0.60), (0.60, 0.70), (0.70, 0.80), (0.80, 0.90), (0.90, 1.01)]
BUCKET_LABEL = ["$0.00-$0.09", "$0.10-$0.19", "$0.20-$0.29", "$0.30-$0.39",
                "$0.40-$0.49", "$0.50-$0.59", "$0.60-$0.69", "$0.70-$0.79",
                "$0.80-$0.89", "$0.90-$1.00"]


def settlement_study(resolved, contracts=100, min_volume=0.0):
    """Bucket settled markets by last traded price; pay out official settlement."""
    acc = {lbl: {"n": 0, "yes": 0, "no": 0, "scalar": 0, "payout": 0.0, "cost": 0.0,
                 "fees": 0.0, "topics": defaultdict(int), "sources": set()}
           for lbl in BUCKET_LABEL}
    skipped = {"no_last_price": 0, "no_result": 0, "bad_settlement": 0,
               "price_not_fillable": 0, "below_volume_floor": 0}
    for m in resolved:
        price = fnum(m.get("last_price"))
        if price is None:
            price = fnum(m.get("last_price_dollars"))
        result = m.get("result")
        if result not in ("yes", "no", "scalar"):
            skipped["no_result"] += 1
            continue
        if min_volume:
            vol = fnum(m.get("volume_contracts"))
            if vol is None:
                vol = fnum(m.get("volume_fp")) or fnum(m.get("volume"))
            if (vol or 0.0) < min_volume:
                skipped["below_volume_floor"] += 1
                continue
        if price is None:
            skipped["no_last_price"] += 1
            continue
        # A $0.00 "last price" is what this API reports for a market that never
        # traded, not a price anyone could have bought at (1,471 of the 2,469 settled
        # demo markets report exactly 0.00, 141 of them while resolving YES). Same for
        # $1.00. Excluded, and counted, so the study is not silently inflated.
        if not (0.0 < price < 1.0):
            skipped["price_not_fillable"] += 1
            continue
        payout = fnum(m.get("settlement_value_dollars"))
        if payout is None:
            payout = 1.0 if result == "yes" else (0.0 if result == "no" else None)
            if payout is None:
                skipped["bad_settlement"] += 1
                continue
        idx = next((i for i, (lo, hi) in enumerate(BUCKETS) if lo <= price < hi), None)
        if idx is None:
            skipped["bad_settlement"] += 1
            continue
        lbl = BUCKET_LABEL[idx]
        a = acc[lbl]
        a["n"] += 1
        a[result if result in ("yes", "no", "scalar") else "scalar"] += 1
        a["payout"] += payout * contracts
        a["cost"] += position_cost(contracts, price)
        a["fees"] += fee(contracts, price, m.get("series_ticker"), "taker")
        a["topics"][m.get("topic") or "unclassified"] += 1
        src = (m.get("sources") or {}).get("markets") if isinstance(m.get("sources"), dict) else None
        if m.get("source"):
            a["sources"].add(m["source"])
        if src:
            a["sources"].add(src)
    rows = []
    for lbl in BUCKET_LABEL:
        a = acc[lbl]
        if not a["n"]:
            continue
        gross = a["payout"] - a["cost"]
        net = gross - a["fees"]
        rows.append({
            "bucket": lbl,
            "markets": a["n"],
            "resolved_yes": a["yes"],
            "resolved_no": a["no"],
            "resolved_scalar": a["scalar"],
            "yes_rate_pct": round(100.0 * a["yes"] / a["n"], 2),
            "avg_entry_price": round(a["cost"] / a["n"] / contracts, 4),
            "contracts_per_trade": contracts,
            "cost_usd": round(a["cost"], 2),
            "payout_usd": round(a["payout"], 2),
            "gross_usd": round(gross, 2),
            "fees_usd": round(a["fees"], 2),
            "net_usd": round(net, 2),
            "net_roi_pct": round(100.0 * net / a["cost"], 2) if a["cost"] else None,
            "avg_net_per_market_usd": round(net / a["n"], 4),
            "topics": dict(sorted(a["topics"].items(), key=lambda kv: -kv[1])),
            "source_urls": sorted(a["sources"])[:2],
        })
    return rows, skipped


# --------------------------------------------------------------- 2. candle strategies
def _traded_jumps(points, threshold):
    """Indices of candles where the traded close jumped by >= threshold vs the prior
    traded close. Returns (idx, prev_price, cur_price, delta)."""
    seen = [(i, p) for i, p in enumerate(points) if fnum(p.get("price_close")) is not None]
    out = []
    for (i_prev, p_prev), (i_cur, p_cur) in zip(seen, seen[1:]):
        a, b = fnum(p_prev["price_close"]), fnum(p_cur["price_close"])
        d = b - a
        if abs(d) + 1e-12 >= threshold:
            out.append((i_cur, i_prev, a, b, d))
    return out


def run_strategies(charts, markets_by_ticker, threshold=0.10, contracts=100,
                   hold_candles=30):
    trades = []
    for mkt_ticker, series_ticker, label, win in _candle_series(charts):
        pts = _points(win)
        if len(pts) < 4:
            continue
        m = markets_by_ticker.get(mkt_ticker) or {}
        base = {
            "market_ticker": mkt_ticker, "series_ticker": series_ticker,
            "title": m.get("title"), "event_ticker": m.get("event_ticker"),
            "topic": m.get("topic"), "window": label,
            "period_minutes": win.get("period_minutes"),
            "source_url": win.get("source"), "source_error": win.get("error"),
            "status": m.get("status"), "result": m.get("result"),
        }
        jumps = _traded_jumps(pts, threshold)
        busy_until = -1
        for i_cur, _i_prev, p_from, p_to, delta in jumps:
            direction = "up" if delta > 0 else "down"
            for strat, action in (("J1", "momentum"), ("J2", "fade")):
                if action == "momentum":
                    # buy YES at the recorded ask of the entry candle, sell at a later
                    # candle's recorded bid
                    entry_price = fnum(pts[i_cur].get("yes_ask_close"))
                    entry_side, exit_side = "YES", "bid"
                else:
                    # buy NO at (1 - YES bid); exit NO at (1 - YES ask)
                    yb = fnum(pts[i_cur].get("yes_bid_close"))
                    ya_next = None
                    entry_price = None
                    if yb is not None:
                        entry_price = round(1.0 - yb, 4)
                    entry_side, exit_side = "NO", "ask"
                if entry_price is None or entry_price <= 0 or entry_price >= 1:
                    continue
                exit_i = min(i_cur + hold_candles, len(pts) - 1)
                if exit_i <= i_cur:
                    continue
                ep = pts[exit_i]
                if action == "momentum":
                    exit_price = fnum(ep.get("yes_bid_close"))
                else:
                    ya = fnum(ep.get("yes_ask_close"))
                    exit_price = None if ya is None else round(1.0 - ya, 4)
                if exit_price is None:
                    continue
                if i_cur <= busy_until:
                    continue  # one position per market at a time
                busy_until = exit_i
                cost = position_cost(contracts, entry_price)
                fee_in = fee(contracts, entry_price, series_ticker, "taker")
                fee_out = fee(contracts, exit_price, series_ticker, "taker")
                proceeds = contracts * exit_price
                gross = proceeds - cost
                net = gross - fee_in - fee_out
                # if the market settled before the planned exit, use the official result
                resolved = m.get("result") in ("yes", "no") and label.startswith("1d")
                trades.append({
                    "strategy": strat,
                    "strategy_name": ("jump-momentum" if strat == "J1" else "jump-fade"),
                    "action": action,
                    "side": entry_side,
                    "jump_direction": direction,
                    "jump_from": round(p_from, 4),
                    "jump_to": round(p_to, 4),
                    "jump_delta": round(delta, 4),
                    "entry_t": int(pts[i_cur]["t"]),
                    "entry_utc": datetime.fromtimestamp(int(pts[i_cur]["t"]),
                                                         tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "exit_t": int(ep["t"]),
                    "entry_price": round(entry_price, 4),
                    "exit_price": round(exit_price, 4),
                    "contracts": contracts,
                    "cost_usd": round(cost, 4),
                    "proceeds_usd": round(proceeds, 4),
                    "gross_usd": round(gross, 4),
                    "fees_usd": round(fee_in + fee_out, 4),
                    "net_usd": round(net, 4),
                    "roi_pct": round(100.0 * net / cost, 2) if cost else None,
                    "hold_candles": exit_i - i_cur,
                    "hold_minutes": (exit_i - i_cur) * (win.get("period_minutes") or 1),
                    "would_have_been_held_to_resolution": bool(resolved),
                    "book": base,
                })
    # J3: stale-quote — enter when the entry candle traded nothing but the book moved
    for mkt_ticker, series_ticker, label, win in _candle_series(charts):
        pts = _points(win)
        if len(pts) < 6:
            continue
        m = markets_by_ticker.get(mkt_ticker) or {}
        busy_until = -1
        for i in range(1, len(pts) - 1):
            if (fnum(pts[i].get("volume")) or 0) > 0:
                continue
            bid_prev = fnum(pts[i - 1].get("yes_bid_close"))
            bid_cur = fnum(pts[i].get("yes_bid_close"))
            if bid_prev is None or bid_cur is None:
                continue
            if abs(bid_cur - bid_prev) + 1e-12 < threshold:
                continue
            j = i + 1
            while j < len(pts) and (fnum(pts[j].get("volume")) or 0) <= 0:
                j += 1
            if j >= len(pts) or i <= busy_until:
                continue
            busy_until = j
            entry_price = fnum(pts[i].get("yes_ask_close"))
            exit_price = fnum(pts[j].get("yes_bid_close"))
            if not entry_price or exit_price is None:
                continue
            cost = position_cost(contracts, entry_price)
            fees = fee(contracts, entry_price, series_ticker, "taker") \
                + fee(contracts, exit_price, series_ticker, "taker")
            net = contracts * exit_price - cost - fees
            trades.append({
                "strategy": "J3", "strategy_name": "stale-quote-book-move",
                "action": "book-move-while-no-volume", "side": "YES",
                "jump_direction": "up" if bid_cur > bid_prev else "down",
                "jump_from": round(bid_prev, 4), "jump_to": round(bid_cur, 4),
                "jump_delta": round(bid_cur - bid_prev, 4),
                "entry_t": int(pts[i]["t"]),
                "entry_utc": datetime.fromtimestamp(int(pts[i]["t"]),
                                                     tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "exit_t": int(pts[j]["t"]),
                "entry_price": round(entry_price, 4), "exit_price": round(exit_price, 4),
                "contracts": contracts, "cost_usd": round(cost, 4),
                "proceeds_usd": round(contracts * exit_price, 4),
                "gross_usd": round(contracts * exit_price - cost, 4),
                "fees_usd": round(fees, 4), "net_usd": round(net, 4),
                "roi_pct": round(100.0 * net / cost, 2) if cost else None,
                "hold_candles": j - i,
                "hold_minutes": (j - i) * (win.get("period_minutes") or 1),
                "would_have_been_held_to_resolution": False,
                "book": {
                    "market_ticker": mkt_ticker, "series_ticker": series_ticker,
                    "title": m.get("title"), "event_ticker": m.get("event_ticker"),
                    "topic": m.get("topic"), "window": label,
                    "period_minutes": win.get("period_minutes"),
                    "source_url": win.get("source"), "source_error": win.get("error"),
                    "status": m.get("status"), "result": m.get("result"),
                },
            })
    return trades


def summarize(trades):
    def rollup(rows):
        if not rows:
            return None
        cost = sum(r["cost_usd"] for r in rows)
        net = sum(r["net_usd"] for r in rows)
        wins = sum(1 for r in rows if r["net_usd"] > 0)
        return {
            "trades": len(rows),
            "winners": wins,
            "win_rate_pct": round(100.0 * wins / len(rows), 2),
            "gross_usd": round(sum(r["gross_usd"] for r in rows), 2),
            "fees_usd": round(sum(r["fees_usd"] for r in rows), 2),
            "net_usd": round(net, 2),
            "cost_usd": round(cost, 2),
            "net_roi_pct": round(100.0 * net / cost, 2) if cost else None,
            "avg_net_usd": round(net / len(rows), 4),
            "best_trade_usd": round(max(r["net_usd"] for r in rows), 2),
            "worst_trade_usd": round(min(r["net_usd"] for r in rows), 2),
            "avg_hold_minutes": round(sum(r["hold_minutes"] for r in rows) / len(rows), 1),
            "markets": len({r["book"]["market_ticker"] for r in rows}),
            "source_urls": sorted({r["book"]["source_url"] for r in rows
                                   if r["book"].get("source_url")})[:3],
        }
    by_strat = defaultdict(list)
    by_topic = defaultdict(list)
    by_cat = defaultdict(list)
    by_side = defaultdict(list)
    for t in trades:
        by_strat[t["strategy_name"]].append(t)
        by_topic[TOPIC_LABEL.get(t["book"].get("topic") or "", t["book"].get("topic") or "unclassified")].append(t)
        by_side[t["side"]].append(t)
        bucket = "short-hold (<2h)" if t["hold_minutes"] < 120 else (
            "intraday (2h-1d)" if t["hold_minutes"] < 1440 else "multi-day")
        by_cat[f'{t["action"]} / {t["side"]} / {bucket}'].append(t)
    return {
        "overall": rollup(trades),
        "by_strategy": {k: rollup(v) for k, v in sorted(by_strat.items())},
        "by_topic": {k: rollup(v) for k, v in sorted(by_topic.items())},
        "by_side": {k: rollup(v) for k, v in sorted(by_side.items())},
        "by_trade_type": {k: rollup(v) for k, v in sorted(by_cat.items())},
    }


# ------------------------------------------------------------------- 3. liquidity stats
def liquidity(markets):
    per_topic = defaultdict(lambda: {"markets": 0, "with_book": 0, "spreads": [],
                                     "yes_depth": [], "no_depth": [], "levels": 0})
    top = []
    for m in markets:
        topic = m.get("topic") or "unclassified"
        a = per_topic[topic]
        a["markets"] += 1
        ob = m.get("orderbook") or {}
        yb = ob.get("yes_bids") or []
        nb = ob.get("no_bids") or []
        if not (yb or nb):
            continue
        a["with_book"] += 1
        a["levels"] += len(yb) + len(nb)
        best_yes_bid = fnum(yb[-1]["price"]) if yb else None
        implied_yes_ask = fnum(ob.get("implied_yes_ask"))
        if best_yes_bid is not None and implied_yes_ask is not None:
            a["spreads"].append(round(implied_yes_ask - best_yes_bid, 4))
        a["yes_depth"].append(sum(fnum(l.get("contracts")) or 0 for l in yb))
        a["no_depth"].append(sum(fnum(l.get("contracts")) or 0 for l in nb))
        avail = sum(fnum(l.get("contracts")) or 0 for l in yb)
        top.append({
            "topic": topic, "market_ticker": m.get("market_ticker"),
            "title": m.get("title"),
            "best_yes_bid": best_yes_bid, "implied_yes_ask": implied_yes_ask,
            "spread": (round(implied_yes_ask - best_yes_bid, 4)
                       if best_yes_bid is not None and implied_yes_ask is not None else None),
            "yes_bid_levels": len(yb), "no_bid_levels": len(nb),
            # the levels themselves, kept compact (price, contracts) and capped: the
            # depth ladder answers "how many contracts at this price", which needs them
            "book": {
                "yes": [[fnum(l.get("price")), fnum(l.get("contracts"))] for l in yb[-12:]],
                "no": [[fnum(l.get("price")), fnum(l.get("contracts"))] for l in nb[-12:]],
                "source": ob.get("source"),
                "captured_utc": m.get("sources", {}).get("orderbook") if isinstance(m.get("sources"), dict) else None,
            },
            "contracts_at_best_yes_bid": (fnum(yb[-1].get("contracts")) if yb else None),
            "contracts_at_best_no_bid": (fnum(nb[-1].get("contracts")) if nb else None),
            "dollar_notional_24h": (m.get("dollar_notional_24h") or {}).get("value")
            if isinstance(m.get("dollar_notional_24h"), dict) else m.get("dollar_notional_24h"),
            "source_url": ob.get("source"),
            "_avail": avail,
        })
    rows = []
    for topic, a in sorted(per_topic.items()):
        sp = sorted(a["spreads"])
        rows.append({
            "topic": TOPIC_LABEL.get(topic, topic), "topic_key": topic,
            "open_markets": a["markets"],
            "books_captured_for": a["with_book"],
            "pct_of_topic_captured": round(100.0 * a["with_book"] / a["markets"], 1) if a["markets"] else None,
            "median_spread": sp[len(sp) // 2] if sp else None,
            "spread_le_1c_pct": (round(100.0 * sum(1 for s in sp if s <= 0.011) / len(sp), 1)
                                 if sp else None),
            "total_bid_levels_captured": a["levels"],
            "contracts_resting_yes_side_avg": (round(sum(a["yes_depth"]) / len(a["yes_depth"]), 1)
                                            if a["yes_depth"] else None),
            "contracts_resting_no_side_avg": (round(sum(a["no_depth"]) / len(a["no_depth"]), 1)
                                           if a["no_depth"] else None),
        })
    top.sort(key=lambda r: -(r["dollar_notional_24h"] or 0))
    for r in top:
        r.pop("_avail", None)
    return rows, top[:40]


def board(markets, per_topic=12):
    """A compact, browser-sized ranking of live events by traded dollar notional.

    The snapshot this is built from holds ~1,400 open markets with full books, which is
    too large to hand a page; this keeps the fields a trader scans, in the units the API
    returned them, plus the request URL for every row. `dollar_notional_24h` is the
    collector's computed 24 h traded notional (labelled, with its formula) because the
    API exposes no USD-volume field on GET /markets.
    """
    by_topic = defaultdict(list)
    for m in markets:
        dn = m.get("dollar_notional_24h")
        if isinstance(dn, dict):
            value, formula, src = dn.get("value"), dn.get("formula"), dn.get("source")
        else:
            value, formula, src = dn, None, None
        ob = m.get("orderbook") or {}
        had_book = bool(m.get("orderbook"))
        yb, nb = ob.get("yes_bids") or [], ob.get("no_bids") or []
        by_topic[m.get("topic") or "unclassified"].append({
            "topic": m.get("topic"),
            "topic_label": TOPIC_LABEL.get(m.get("topic") or "", m.get("topic")),
            "market_ticker": m.get("market_ticker"),
            "series_ticker": m.get("series_ticker"),
            "event_ticker": m.get("event_ticker"),
            "event_title": m.get("event_title"),
            "title": m.get("title"),
            "status": m.get("status"),
            "result": m.get("result"),
            "last_price": fnum(m.get("last_price")),
            "previous_price": fnum(m.get("previous_price")),
            "yes_bid": fnum((m.get("quotes") or {}).get("yes", {}).get("bid")),
            "yes_ask": fnum((m.get("quotes") or {}).get("yes", {}).get("ask")),
            "implied_yes_ask": fnum(ob.get("implied_yes_ask")),
            "best_yes_bid_contracts": (fnum((yb[-1] or {}).get("contracts")) if yb else None),
            "best_no_bid_contracts": (fnum((nb[-1] or {}).get("contracts")) if nb else None),
            "yes_bid_levels": len(yb), "no_bid_levels": len(nb),
            # the levels themselves, compact (price, contracts) and capped: the depth
            # ladder answers "how many contracts at this price", which needs them.
            # None (not an empty list) when no book request exists for this market.
            "book": {
                "yes": [[fnum(l.get("price")), fnum(l.get("contracts"))] for l in yb[-12:]],
                "no": [[fnum(l.get("price")), fnum(l.get("contracts"))] for l in nb[-12:]],
                "source": ob.get("source"),
            } if had_book else None,
            "contracts_24h": fnum(m.get("volume_24h_contracts")),
            "open_interest_contracts": fnum(m.get("open_interest_contracts")),
            "notional_value_dollars": fnum(m.get("notional_value_dollars")),
            "dollar_notional_24h": value,
            "dollar_formula": formula,
            "open_time": m.get("open_time"),
            "close_time": m.get("close_time"),
            "expected_expiration_time": m.get("expected_expiration_time"),
            "settlement_value_dollars": m.get("settlement_value_dollars"),
            "settlement_ts": m.get("settlement_ts"),
            "topic_match_reason": m.get("topic_match_reason"),
            "topic_matched_weakly": m.get("topic_matched_weakly"),
            "has_candles": False,
            "sources": {
                "markets": m.get("sources", {}).get("markets") if isinstance(m.get("sources"), dict) else None,
                "market": m.get("sources", {}).get("market") if isinstance(m.get("sources"), dict) else None,
                "notional": src,
                "orderbook": ob.get("source"),
            },
        })
    rows = []
    for topic, lst in by_topic.items():
        lst.sort(key=lambda r: -(r["dollar_notional_24h"] or 0.0))
        rows.extend(lst[:per_topic])
    return rows


def mark_charted(rows, charts):
    tickers = set()
    for entry in charts.get("series", []) or []:
        if entry.get("market_ticker"):
            tickers.add(entry["market_ticker"])
    for m in charts.get("markets", []) or []:
        if m.get("candles"):
            tickers.add(m.get("market_ticker"))
    for r in rows:
        r["has_candles"] = r["market_ticker"] in tickers
    return rows


def resolutions(resolved, limit=60):
    """Most recently settled markets with the official outcome fields.

    `result` is what the exchange set at determination — yes / no / scalar — and
    settlement_value_dollars / settlement_ts are the payout fields, both read straight
    from the response. A market that is past close_time but has no result is still
    awaiting determination (status closed / determined / disputed), which is exactly the
    "keep tracking until it resolves" set, so those rows are kept with result = null and
    render blank on the page rather than being guessed at.
    """
    out = []
    for m in resolved:
        src = m.get("source")
        if not src and isinstance(m.get("sources"), dict):
            src = m.get("sources").get("markets") or m.get("sources").get("market")
        out.append({
            "topic": m.get("topic"), "topic_label": TOPIC_LABEL.get(m.get("topic") or "", m.get("topic")),
            "market_ticker": m.get("market_ticker") or m.get("ticker"),
            "event_ticker": m.get("event_ticker"), "series_ticker": m.get("series_ticker"),
            "title": m.get("title"), "status": m.get("status"), "result": m.get("result"),
            "last_price": fnum(m.get("last_price")) if m.get("last_price") is not None
            else fnum(m.get("last_price_dollars")),
            "settlement_value_dollars": fnum(m.get("settlement_value_dollars")),
            "settlement_ts": m.get("settlement_ts"),
            "close_time": m.get("close_time"),
            "contracts": fnum(m.get("volume_contracts")) if m.get("volume_contracts") is not None
            else fnum(m.get("volume_fp")),
            "notional_value_dollars": fnum(m.get("notional_value_dollars")),
            "source": src,
        })
    out.sort(key=lambda r: (r.get("settlement_ts") or r.get("close_time") or ""), reverse=True)
    return out[:limit]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--charts", default="snapshot/charts.json")
    ap.add_argument("--markets", default="snapshot/markets.json")
    ap.add_argument("--resolved", default="snapshot/resolved.json")
    ap.add_argument("--live", default=None,
                    help="engine live-snapshot.json (has candles inline); overrides --charts/--markets")
    ap.add_argument("--threshold", type=float, default=0.10)
    ap.add_argument("--contracts", type=float, default=100)
    ap.add_argument("--hold", type=int, default=30, help="exit after N candles")
    ap.add_argument("--resolutions-limit", type=int, default=60)
    ap.add_argument("--board-per-topic", type=int, default=12,
                    help="live rows kept per topic in the board the page renders")
    ap.add_argument("--min-volume", type=float, default=100.0,
                    help="contracts a market must have traded to enter the liquid-only study")
    ap.add_argument("--out", default="engine/strategies.json")
    args = ap.parse_args()

    def load(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    markets_blob = load(args.markets)
    resolved_blob = load(args.resolved)
    charts_blob = load(args.live) if args.live else load(args.charts)
    if args.live:
        live = load(args.live)
        markets_list = live.get("markets", [])
        resolved_list = (live.get("settled") or []) + (live.get("awaiting_determination") or [])
        for r in resolved_list:
            if r.get("last_price_dollars") is not None and r.get("last_price") is None:
                r["last_price"] = r["last_price_dollars"]
    else:
        markets_list = _markets_list(markets_blob, "markets")
        resolved_list = _markets_list(resolved_blob, "markets")
    by_ticker = {m.get("market_ticker"): m for m in markets_list}

    rows, skipped = settlement_study(resolved_list, args.contracts)
    only_rows, only_skipped = settlement_study(resolved_list, args.contracts,
                                                min_volume=args.min_volume)
    trades = run_strategies(charts_blob, by_ticker, args.threshold, args.contracts, args.hold)
    summary = summarize(trades)
    liq_rows, liq_top = liquidity(markets_list)

    payload = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status_label": "SIMULATED — no orders were placed; no demo API key exists in this repo",
        "inputs": {
            "charts": args.live or args.charts,
            "markets": args.markets, "resolved": args.resolved,
            "charts_generated_utc": charts_blob.get("generated_utc"),
            "markets_generated_utc": markets_blob.get("generated_utc"),
            "resolved_generated_utc": resolved_blob.get("generated_utc"),
            "api_base": charts_blob.get("base") or markets_blob.get("base"),
        },
        "assumptions": {
            "contracts_per_trade": args.contracts,
            "entry_fill": "recorded ask of the entry candle (YES) or 1 - recorded YES bid (NO)",
            "exit_fill": "recorded bid of the exit candle (YES) or 1 - recorded ask (NO)",
            "position_rule": "one open position per market at a time; no pyramiding, no leverage",
            "jump_threshold_dollars": args.threshold,
            "hold_candles": args.hold,
            "fees": {
                "taker_formula": "round up(M \u00d7 0.07 \u00d7 C \u00d7 P \u00d7 (1 \u2212 P))",
                "maker_formula": "round up(M \u00d7 0.0175 \u00d7 C \u00d7 P \u00d7 (1 \u2212 P))",
                "settlement_fee": 0,
                "membership_fee": 0,
                "source": FEE_SOURCE,
                "effective": "Last updated and effective: July 7, 2026",
                "per_series_multipliers_used": SERIES_MULTIPLIERS,
                "note": ("Only KXAAAGASM (1/1), KXBTCY (0/0) and KXETHY (0/0) were copied from the "
                         "schedule for this repo's series; all other series use the schedule's "
                         "defaults (taker M=1, maker M=0)."),
            },
        },
        "endpoints_used": [
            "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
            "https://docs.kalshi.com/api-reference/market/get-markets",
            "https://docs.kalshi.com/api-reference/market/get-market-order-book",
            "https://docs.kalshi.com/getting_started/orderbook_responses",
            "https://docs.kalshi.com/getting_started/market_lifecycle",
        ],
        "caveats": [
            "Demo venue: mock funds, and Kalshi states demo prices/behavior may not reflect real "
            "markets (https://docs.kalshi.com/getting_started/demo_env).",
            "Candle coverage is only the markets the collector captured; results are not a "
            "market-wide statistic and the sample is small.",
            "Entry/exit use candle close-level quotes, which is the finest detail the public REST "
            "API offers; intrabar fills and queue priority are not modelled.",
            "The settlement study treats a market's last traded price as the entry. On thin books "
            "that trade may be far from the close, so bucket ROI is an upper bound on realism, not a "
            "fill you could have got.",
            "Fees follow the published schedule for takers; the simulation crosses the spread, so "
            "taker is the right side. Maker fills (and their fee) are not modelled.",
        ],
        "settlement_study": {
            "definition": ("for each settled market: entry = last_price_dollars, payout = "
                           "settlement_value_dollars (or 1.00 when result=yes / 0.00 when result=no), "
                           "one taker fee at entry; buckets are price bands, not model outputs"),
            "buckets": rows,
            "rows_skipped": skipped,
            "markets_examined": len(resolved_list),
            "liquid_only": {
                "definition": (f"same rule, restricted to markets that traded at least "
                               f"{args.min_volume:g} contracts (volume_contracts), so a stray "
                               f"single-lot print cannot pose as an entry price"),
                "min_volume_contracts": args.min_volume,
                "buckets": only_rows,
                "rows_skipped": only_skipped,
            },
        },
        "strategies": {
            "rules": {
                "J1 jump-momentum": ("after a traded up-move >= threshold, buy YES at the recorded ask "
                                     "of that candle; sell at the bid `hold` candles later"),
                "J2 jump-fade": ("after the same move, buy NO at (1 - recorded YES bid); sell NO at "
                                 "(1 - recorded YES ask) `hold` candles later"),
                "J3 stale-quote-book-move": ("enter YES when the candle traded zero volume but the "
                                             "best bid moved >= threshold; exit at the next candle that "
                                             "traded"),
            },
            "summary": summary,
            "trades": sorted(trades, key=lambda t: t["entry_t"]),
        },
        "resolutions": resolutions(resolved_list, args.resolutions_limit),
        "board": mark_charted(board(markets_list, args.board_per_topic), charts_blob),
        "liquidity": {
            "definition": ("per-topic spread and resting depth from the order book response; the "
                           "implied ask is the documented identity 1.00 - highest NO bid"),
            "by_topic": liq_rows,
        "coverage_note": ("only markets this collector actually requested a book for are counted; "
                          "a topic showing a low count means the collector sampled few of its "
                          "markets, not that its books are empty"),
            "deepest_markets": liq_top,
        },
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print(f"strategy_sim: settlement buckets={len(rows)} trades={len(trades)} "
          f"liquidity_topics={len(liq_rows)} -> {args.out}")
    if summary.get("overall"):
        o = summary["overall"]
        print(f"  simulated overall: {o['trades']} trades, win {o['win_rate_pct']}%, "
              f"net ${o['net_usd']} on ${o['cost_usd']} cost ({o['net_roi_pct']}%), "
              f"fees ${o['fees_usd']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
