#!/usr/bin/env python3
"""Build alert-desk/data/seed.json from the committed official snapshot.

The seed gives the dual chat feeds content when the browser cannot reach the
official demo API (offline reviewers, tests) and records exactly which official
request produced every value.

Inputs (committed, produced by tools/collect_kalshi.py from the official demo API):
    snapshot/markets.json    open markets, five topics, per-row source URLs
    snapshot/resolved.json   closed/settled markets with result + settlement

Rules (published on the page; every threshold is a model design choice, disclosed):
    swing      |after - before| >= 0.10 and before > 0 and after > 0
               before = previous_price  (official field: last traded YES price
                                          a day ago — docs.kalshi.com Get Market)
               after  = last_price      (official field: last traded YES price)
               last_price 0.00 means "no trade recorded" (repo finding from the
               engine session, verified against snapshot/resolved.json) so zero
               prices are excluded rather than treated as a $0 trade.
    model      R1 swing (always true for a feed entry)
               R2 volume_24h >= 100 contracts
               R3 spread = yes_ask - yes_bid <= 0.05 (both sides quoted)
               R4 0.05 <= after <= 0.90 (not already decided)
               R5 open_interest >= 100 contracts
               pick = score >= 4 of 5   (design choice; pass counts printed below)

Resolutions: most recent markets whose result is yes/no (scalar is possible per
docs.kalshi.com/getting_started/market_lifecycle and is kept as returned).

Usage:  python3 alert-desk/tools/build_seed.py
Writes: alert-desk/data/seed.json  (deterministic; no network)
"""

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SNAP = ROOT / "snapshot"
OUT = ROOT / "alert-desk" / "data" / "seed.json"

THRESHOLD = 0.10
# Series the repo already published as false topic matches (COORDINATION FL-05;
# desk/assets/core.js carries the same exclusion): KXWTI is a crude-oil market
# whose title contains the word "election". Never re-filed as an election.
EXCLUDED_SERIES = {"KXWTI"}
MIN_VOL_24H = 100.0
MAX_SPREAD = 0.05
BAND_LO, BAND_HI = 0.05, 0.90
MIN_OI = 100.0
MAX_RESOLUTIONS = 12


def f(v):
    """Official fixed-point string -> float; None when absent (never guessed)."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def model_rules(after, vol24h, spread, oi):
    """Return (score, per-rule bools). Rule ids match the page's rules table."""
    r = {
        "R1": True,  # caller only invokes after the swing test passed
        "R2": vol24h is not None and vol24h >= MIN_VOL_24H,
        "R3": spread is not None and 0 < spread <= MAX_SPREAD,
        "R4": after is not None and BAND_LO <= after <= BAND_HI,
        "R5": oi is not None and oi >= MIN_OI,
    }
    return sum(1 for v in r.values() if v), r


def main():
    markets = json.loads((SNAP / "markets.json").read_text())
    resolved = json.loads((SNAP / "resolved.json").read_text())
    generated = markets.get("generated_utc")

    swings = []
    for m in markets.get("markets", []):
        if (m.get("series_ticker") or "") in EXCLUDED_SERIES:
            continue
        before, after = f(m.get("previous_price")), f(m.get("last_price"))
        if before is None or after is None or before <= 0 or after <= 0:
            continue  # zero/absent = no trade recorded, never a $0 move
        delta = round(after - before, 4)
        if abs(delta) < THRESHOLD:
            continue
        q = m.get("quotes") or {}
        yes = q.get("yes") or {}
        bid, ask = f(yes.get("bid")), f(yes.get("ask"))
        spread = round(ask - bid, 4) if (bid and ask and ask >= bid) else None
        vol24h = f(m.get("volume_24h_contracts"))
        oi = f(m.get("open_interest_contracts"))
        score, rules = model_rules(after, vol24h, spread, oi)
        src = m.get("sources") or {}
        swings.append({
            "kind": "swing",
            "ticker": m.get("market_ticker"),
            "event_ticker": m.get("event_ticker"),
            "title": m.get("title"),
            "topic": m.get("topic"),
            "topic_match_reason": m.get("topic_match_reason"),
            "before": before,
            "after": after,
            "delta": delta,
            "dir": "up" if delta > 0 else "down",
            "ts": generated,
            "vol24h": vol24h,
            "oi": oi,
            "bid": bid,
            "ask": ask,
            "spread": spread,
            "model_score": score,
            "model_rules": rules,
            "src": src.get("market") or src.get("markets"),
            "venue": "https://kalshi.com/events/" + str(m.get("event_ticker") or ""),
        })

    # Deterministic order: biggest absolute move first, ticker tiebreak.
    swings.sort(key=lambda s: (-abs(s["delta"]), s["ticker"] or ""))

    resolutions = []
    for m in resolved.get("markets", []):
        if (m.get("series_ticker") or "") in EXCLUDED_SERIES:
            continue
        if m.get("result") not in ("yes", "no", "scalar"):
            continue
        if not m.get("settlement_ts"):
            continue
        src = m.get("sources") or {}
        resolutions.append({
            "kind": "resolution",
            "ticker": m.get("market_ticker"),
            "event_ticker": m.get("event_ticker"),
            "title": m.get("title"),
            "topic": m.get("topic"),
            "result": m.get("result"),
            "settlement_ts": m.get("settlement_ts"),
            "settlement_value": f(m.get("settlement_value_dollars")),
            "ts": m.get("settlement_ts"),
            "src": src.get("market") or src.get("markets"),
            "venue": "https://kalshi.com/events/" + str(m.get("event_ticker") or ""),
        })

    def parse(ts):
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            return datetime.min

    # Most recent per topic first (keeps the feed representative of all five
    # topics instead of letting one fast-settling series dominate), then round
    # robin across topics up to MAX_RESOLUTIONS.
    resolutions.sort(key=lambda r: (parse(r["settlement_ts"]), r["ticker"] or ""),
                     reverse=True)
    by_topic = {}
    for r in resolutions:
        by_topic.setdefault(r["topic"], []).append(r)
    stratified, i = [], 0
    while len(stratified) < MAX_RESOLUTIONS and any(by_topic.values()):
        for topic in sorted(by_topic):
            bucket = by_topic[topic]
            if i < len(bucket):
                stratified.append(bucket[i])
            if len(stratified) >= MAX_RESOLUTIONS:
                break
        i += 1
        if i >= max((len(v) for v in by_topic.values()), default=0):
            break
    resolutions = stratified

    seed = {
        "generated_utc": generated,
        "base": markets.get("base"),
        "source_files": ["snapshot/markets.json", "snapshot/resolved.json"],
        "threshold": THRESHOLD,
        "model": {
            "rules": {
                "R1": "|delta| >= $0.10 between previous_price and last_price (both > 0)",
                "R2": "volume_24h >= 100 contracts",
                "R3": "yes_ask - yes_bid <= $0.05 with both sides quoted",
                "R4": "resulting price within $0.05 - $0.90",
                "R5": "open_interest >= 100 contracts",
            },
            "pick": "score >= 4 of 5",
        },
        "swings": swings,
        "resolutions": resolutions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(seed, indent=1, sort_keys=False) + "\n")

    picks = [s for s in swings if s["model_score"] >= 4]
    print(f"swings: {len(swings)}  model picks (>=4/5): {len(picks)}  "
          f"resolutions: {len(resolutions)}  generated_utc: {generated}")
    for s in swings:
        mark = "PICK" if s["model_score"] >= 4 else f" {s['model_score']}/5"
        print(f"  {mark} {s['ticker']} {s['delta']:+.2f} "
              f"R2={int(s['model_rules']['R2'])} R3={int(s['model_rules']['R3'])} "
              f"R4={int(s['model_rules']['R4'])} R5={int(s['model_rules']['R5'])}")


if __name__ == "__main__":
    main()
