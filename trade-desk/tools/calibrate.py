#!/usr/bin/env python3
"""calibrate.py — measure what the trade-desk screen has to beat.

Inputs are committed official demo data only:
  snapshot/resolved.json   markets with status/result/last_price/settlement fields
  snapshot/markets.json    open markets with quotes
  snapshot/metadata.json   provenance (timestamp, base URL, request log)

Output: trade-desk/data/calibration.json, rendered on trade-desk/model.html.

Why this exists: the high-ROI feed is a screen, and a screen that never gets
scored is marketing. This script reports, from the official records:
  * how often YES actually happens (base rate), which bounds any yes-buying edge;
  * how often "last_price == 0" means "no trade recorded" rather than a price,
    because pricing a backtest off it would buy at zero;
  * the fee drag at each price band, from the official formula;
  * how many markets would even clear the screen's price/ROI bar.

Nothing here is inferred or filled in. Counts are counts of API rows.
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SNAP = os.path.join(ROOT, "snapshot")
OUT = os.path.join(ROOT, "trade-desk", "data", "calibration.json")


def num(v):
    """Parse a fixed-point string or number; return None when the API returned nothing."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def fee(contracts, price, multiplier=1.0):
    """Official taker fee: round UP to the cent of M*0.07*C*P*(1-P)."""
    if not contracts or price is None or price <= 0 or price >= 1:
        return 0.0
    raw = multiplier * 0.07 * contracts * price * (1 - price)
    return math.ceil(raw * 100 - 1e-9) / 100


BANDS = [
    ("$0.00-0.04", 0.00, 0.05),
    ("$0.05-0.14", 0.05, 0.15),
    ("$0.15-0.34", 0.15, 0.35),
    ("$0.35-0.64", 0.35, 0.65),
    ("$0.65-0.84", 0.65, 0.85),
    ("$0.85-1.00", 0.85, 1.0001),
]


def band_of(price):
    for label, lo, hi in BANDS:
        if lo <= price < hi:
            return label
    return None


def quote(row, side, field):
    """Read a quote from either shape the repository stores:
      * snapshot/*.json  -> quotes.yes.ask  (nested, as collected)
      * live API row     -> yes_ask_dollars (flat, as documented)
    Returning None means the field was absent; it is never defaulted to zero.
    """
    q = row.get("quotes")
    if isinstance(q, dict):
        node = q.get(side)
        if isinstance(node, dict) and field in node:
            return num(node.get(field))
    flat = f"{side}_{field}_dollars"
    if flat in row:
        return num(row.get(flat))
    return None


TOPIC_ID = {"gas_prices": "gas", "gas": "gas", "elections": "elections",
            "culture": "culture", "crypto": "crypto", "golf": "golf"}


def main():
    for name in ("resolved.json", "markets.json", "metadata.json"):
        p = os.path.join(SNAP, name)
        if not os.path.exists(p):
            print(f"missing input: {p}", file=sys.stderr)
            return 1

    resolved = json.load(open(os.path.join(SNAP, "resolved.json")))
    openm = json.load(open(os.path.join(SNAP, "markets.json")))
    meta = json.load(open(os.path.join(SNAP, "metadata.json")))

    rrows = resolved.get("markets", resolved if isinstance(resolved, list) else [])
    orows = openm.get("markets", openm if isinstance(openm, list) else [])

    # ---------------------------------------------------------------- base rate
    settled = [r for r in rrows if (r.get("result") in ("yes", "no"))]
    yes = [r for r in settled if r.get("result") == "yes"]
    no = [r for r in settled if r.get("result") == "no"]
    scalar = [r for r in rrows if r.get("result") == "scalar"]

    by_topic = defaultdict(lambda: {"settled": 0, "yes": 0, "no": 0})
    for r in settled:
        t = TOPIC_ID.get(r.get("topic") or "", r.get("topic") or "unclassified")
        by_topic[t]["settled"] += 1
        by_topic[t][r["result"]] += 1

    # ------------------------------------------------- zero last_price semantics
    zero_last = [r for r in settled if num(r.get("last_price")) == 0]
    zero_last_yes = [r for r in zero_last if r.get("result") == "yes"]
    no_trade = [r for r in settled if num(r.get("volume_contracts")) == 0]

    # -------------------------------------------------------------- fee drag
    # Per-contract fee and the win-case net ROI at each band midpoint. The fee is
    # rounded up to the cent per order, so a single cheap contract is charged at
    # least one cent — that floor, not the percentage, is what kills cheap entries.
    fee_bands = []
    for label, lo, hi in BANDS:
        mid = (lo + min(hi, 1.0)) / 2
        per1 = fee(1, mid)
        net1 = ((1 - mid) - per1) / (mid + per1) if 0 < mid < 1 else None
        per100 = fee(100, mid)
        net100 = ((1 - mid) - per100 / 100) / (mid + per100 / 100) if 0 < mid < 1 else None
        fee_bands.append({
            "band": label,
            "mid_price": round(mid, 4),
            "fee_per_1_contract": round(per1, 4),
            "net_roi_on_win_1_contract": None if net1 is None else round(net1, 4),
            "fee_per_100_contracts": round(per100, 2),
            "net_roi_on_win_100_contracts": None if net100 is None else round(net100, 4),
            "max_roi": None if mid <= 0 else round(1 / mid - 1, 4),
            "clears_screen_at_1_contract": bool(net1 is not None and net1 >= 0.25 and mid <= 0.85),
        })

    # Break-even entry price for the 25% net-ROI bar at the typical single-contract
    # fee. Solved numerically over the same fee function the ledger uses, so the
    # number cannot drift from the implementation.
    def net_roi(p, contracts=10):
        f = fee(contracts, p) / contracts
        return ((1 - p) - f) / (p + f)

    breakeven = None
    p = 0.01
    while p < 0.995:
        if net_roi(p) >= 0.25:
            breakeven = p
            p += 0.005
        else:
            break
    last_clearing = None
    p = 0.01
    while p < 0.995:
        if net_roi(p) >= 0.25:
            last_clearing = p
        p = round(p + 0.005, 4)

    # ------------------------------------------- how many open markets qualify
    open_with_ask = []
    would_clear = []
    two_sided = 0
    one_sided = 0
    for m in orows:
        ask = quote(m, "yes", "ask")
        bid = quote(m, "yes", "bid")
        if ask is None or not (0 < ask < 1):
            continue
        open_with_ask.append(m)
        if bid is not None and bid > 0:
            two_sided += 1
        else:
            one_sided += 1
        per = fee(10, ask) / 10
        net = ((1 - ask) - per) / (ask + per)
        if net >= 0.25 and ask <= 0.85:
            would_clear.append(m)

    payload = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": {
            "resolved": "snapshot/resolved.json",
            "open": "snapshot/markets.json",
            "provenance": "snapshot/metadata.json",
            "source_base_url": meta.get("rest_base"),
            "snapshot_generated_utc": meta.get("generated_utc"),
        },
        "base_rate": {
            "settled_yes_or_no": len(settled),
            "yes": len(yes),
            "no": len(no),
            "yes_rate": round(len(yes) / len(settled), 4) if settled else None,
            "scalar_results": len(scalar),
        },
        "by_topic": {k: v for k, v in sorted(by_topic.items())},
        "zero_last_price": {
            "settled_markets_with_zero_last_price": len(zero_last),
            "of_which_resolved_yes": len(zero_last_yes),
            "settled_markets_with_zero_volume": len(no_trade),
            "note": ("A last_price of $0.00 means no trade was recorded, not a fillable $0.00 price. "
                     "Any backtest that uses last_price as an entry price silently buys at zero."),
        },
        "fee_bands": fee_bands,
        "break_even": {
            "roi_bar": 0.25,
            "max_price_clearing_bar": last_clearing,
            "note": ("At the demo's cent tick, a single contract is charged at least 1 cent, so the 25% net-ROI bar "
                     "runs out of room as the entry price approaches $1. Computed with the ledger's own fee function."),
        },
        "open_markets": {
            "with_a_tradable_ask": len(open_with_ask),
            "with_a_two_sided_quote": two_sided,
            "with_a_one_sided_quote": one_sided,
            "clearing_price_and_roi_bar": len(would_clear),
            "share_clearing": round(len(would_clear) / len(open_with_ask), 4) if open_with_ask else None,
        },
        "limits": [
            "Demo venue only: test exchange, thin books, prices that need not match real markets.",
            "The screen's ROI figures are the WIN case, not an expected value.",
            "Base rate is measured on settled demo markets and is not a forecast of open ones.",
            "No live order was placed, so no slippage evidence exists.",
        ],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)

    print(f"settled yes/no: {len(settled)}  yes {len(yes)} / no {len(no)}  yes-rate {payload['base_rate']['yes_rate']}")
    print(f"zero last_price: {len(zero_last)} (of which {len(zero_last_yes)} resolved YES)")
    print(f"open markets with tradable ask: {len(open_with_ask)} (two-sided {two_sided}); clearing price+ROI bar: {len(would_clear)}")
    print(f"highest entry price still clearing the 25% bar: {last_clearing}")
    print(f"wrote {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
