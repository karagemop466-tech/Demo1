#!/usr/bin/env python3
"""Load and shape the committed Kalshi demo snapshot into the desk's data files.

Everything here is a *transcription* of committed snapshot JSON that was itself
collected from the official Kalshi demo Trade API (see snapshot/collect-log.txt).
No value is estimated, inferred or filled in: a missing API field stays null and
is rendered as an em dash by the site.

Official references used for the shape of each field (all fetched 2026-11-20):
  market fields ............ https://docs.kalshi.com/api-reference/market/get-markets
  lifecycle statuses ....... https://docs.kalshi.com/getting_started/market_lifecycle
                               status=closed  -> past close_time, NOT finalised (no result)
                               status=settled -> finalised (result in {yes,no,scalar})
  orderbook (bids only) .... https://docs.kalshi.com/getting_started/orderbook_responses
                               yes ask == 1 - best no bid, no ask == 1 - best yes bid
  demo environment warning . https://docs.kalshi.com/getting_started/demo_env
  fees ..................... https://kalshi.com/docs/kalshi-fee-schedule.pdf
                               taker = ceil(M * 0.07 * C * P * (1-P)) to a centicent
"""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / "snapshot"
DESK = ROOT / "desk"
DATA = DESK / "data"

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
DOC_LIFECYCLE = "https://docs.kalshi.com/getting_started/market_lifecycle"
DOC_DEMO = "https://docs.kalshi.com/getting_started/demo_env"
DOC_FEES = "https://kalshi.com/docs/kalshi-fee-schedule.pdf"
DOC_CANDLES = "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"
DOC_BOOK = "https://docs.kalshi.com/getting_started/orderbook_responses"
DOC_MARKETS = "https://docs.kalshi.com/api-reference/market/get-markets"

# topic key in the snapshot -> (slug, label, one-line scope)
TOPICS = [
    ("gas_prices", "gas-prices", "Gas prices", "AAA retail gasoline thresholds, weekly/monthly/daily"),
    ("elections", "elections", "Elections", "Presidential nominees, governors, mayors, control of chambers"),
    ("culture", "culture", "Culture", "Film, TV, music, awards and streaming"),
    ("crypto", "crypto", "Crypto", "BTC / ETH / SOL price ranges and milestones"),
    ("golf", "golf", "Golf", "PGA Tour winners, majors and golf milestones"),
]
TOPIC_IDS = [t[0] for t in TOPICS]
SLUG_BY_TOPIC = {t[0]: t[1] for t in TOPICS}
LABEL_BY_TOPIC = {t[0]: t[2] for t in TOPICS}


def load(name: str) -> dict:
    p = SNAP / name
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as fh:
        return json.load(fh)


def dec(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None


def money(v, places=2):
    """Render an API decimal as a plain number string, or None when absent."""
    d = dec(v)
    if d is None:
        return None
    q = Decimal(10) ** -places
    return str(d.quantize(q))


def contracts(v, places=2):
    return money(v, places)


def topic_subtitle(topic: str) -> str:
    return {t[0]: t[3] for t in TOPICS}.get(topic, "")


OPEN_BY_TOPIC = {}


def classify_counts(resolved: list) -> dict:
    """Split collected closed markets by the official lifecycle meaning.

    status=closed  -> past close_time, awaiting determination  -> no result
    status=settled (finalized in REST) -> result in {yes,no,scalar}
    """
    by_topic = {}
    for t in TOPIC_IDS:
        rows = [r for r in resolved if r.get("topic") == t]
        yes = sum(1 for r in rows if r.get("result") == "yes")
        no = sum(1 for r in rows if r.get("result") == "no")
        scalar = sum(1 for r in rows if r.get("result") == "scalar")
        other = sum(1 for r in rows if r.get("result") in (None, "") )
        by_topic[t] = {
            "open": sum(1 for m in (OPEN_BY_TOPIC.get(t) or [])),
            "collected": len(rows),
            "yes": yes,
            "no": no,
            "scalar": scalar,
            "with_result": yes + no + scalar,
            "awaiting_result": other,
        }
    return by_topic


def build_site_data() -> dict:
    """Shape every number the static pages show, with the URL behind each one."""
    markets_payload = load("markets.json")
    resolved_payload = load("resolved.json")
    charts_payload = load("charts.json")
    meta_payload = load("metadata.json")

    open_markets = [m for m in markets_payload.get("markets", []) if m.get("topic") in TOPIC_IDS]
    resolved = [m for m in resolved_payload.get("markets", []) if m.get("topic") in TOPIC_IDS]
    charts = charts_payload.get("series", [])

    for _m in open_markets:
        OPEN_BY_TOPIC.setdefault(_m.get("topic"), []).append(_m)
    counts = classify_counts(resolved)

    def notional_key(m):
        v = m.get("dollar_notional_24h") or {}
        return dec(v.get("value")) or Decimal("-1")

    out = {
        "generated_utc": markets_payload.get("generated_utc"),
        "resolved_generated_utc": resolved_payload.get("generated_utc"),
        "charts_generated_utc": charts_payload.get("generated_utc"),
        "base": markets_payload.get("base") or BASE,
        "collector_meta": {
            k: meta_payload.get(k)
            for k in ("environment", "rest_base", "production_base", "websocket", "official_docs", "collector")
        },
        "counts": counts,
        "totals": {
            "open": len(open_markets),
            "resolved_collected": len(resolved),
            "with_result": sum(c["with_result"] for c in counts.values()),
            "yes": sum(c["yes"] for c in counts.values()),
            "no": sum(c["no"] for c in counts.values()),
            "awaiting_result": sum(c["awaiting_result"] for c in counts.values()),
            "series": len(meta_payload.get("topics", {}) or {}),
        },
        "topics": {},
    }

    for key in TOPIC_IDS:
        rows = [m for m in open_markets if m.get("topic") == key]
        rows.sort(key=lambda m: notional_key(m), reverse=True)
        selected = rows[:40]

        # group events so category pages keep one event's contracts together
        events = {}
        for m in selected:
            ev = m.get("event_ticker") or m.get("market_ticker")
            events.setdefault(ev, {
                "event_ticker": ev,
                "event_title": m.get("event_title"),
                "markets": [],
            })["markets"].append(m)
        event_list = sorted(
            events.values(),
            key=lambda e: max((notional_key(m) for m in e["markets"]), default=Decimal("-1")),
            reverse=True,
        )

        res_rows = [r for r in resolved if r.get("topic") == key]

        def settled_key(r):
            return r.get("settlement_ts") or ""

        latest_resolved = sorted(
            [r for r in res_rows if r.get("result") in ("yes", "no", "scalar")],
            key=settled_key, reverse=True)[:40]
        awaiting = sorted(
            [r for r in res_rows if r.get("result") in (None, "")],
            key=lambda r: r.get("close_time") or "", reverse=True)[:40]

        out["topics"][key] = {
            "label": LABEL_BY_TOPIC[key],
            "slug": SLUG_BY_TOPIC[key],
            "scope": topic_subtitle(key),
            "open_count": len(rows),
            "counts": counts[key],
            "events": event_list,
            "open_top": selected,
            "latest_resolved": latest_resolved,
            "awaiting": awaiting,
            "chart_tickers": [c.get("market_ticker") for c in charts
                              if (c.get("topic") == key or c.get("market_ticker", "").split("-")[0]
                                  in {m.get("series_ticker") for m in rows})][:6],
        }

    out["charts"] = []
    for c in charts:
        entry = {"market_ticker": c.get("market_ticker"), "series_ticker": c.get("series_ticker"), "windows": {}}
        for wname, w in (c.get("windows") or {}).items():
            pts = []
            for p in (w.get("points") or []):
                if p.get("price_close") is None and p.get("yes_bid_close") is None:
                    continue
                pts.append({
                    "t": p.get("t"),
                    "c": p.get("price_close"),
                    "b": p.get("yes_bid_close"),
                    "a": p.get("yes_ask_close"),
                    "v": p.get("volume"),
                })
            entry["windows"][wname] = {
                "period": w.get("period_interval_minutes"),
                "source": w.get("source"),
                "error": w.get("error"),
                "points": pts,
            }
        out["charts"].append(entry)

    return out


def jump_rows(chart_entry: dict, threshold: Decimal = Decimal("0.10")) -> list:
    """Consecutive 1-minute closes that differ by >= threshold, per official candles."""
    jumps = []
    for wname, w in (chart_entry.get("windows") or {}).items():
        if w.get("period") != 1:
            continue
        pts = [p for p in w.get("points") or [] if p.get("c") is not None]
        for prev, cur in zip(pts, pts[1:]):
            a, b = dec(prev["c"]), dec(cur["c"])
            if a is None or b is None:
                continue
            delta = b - a
            if abs(delta) >= threshold:
                jumps.append({
                    "ticker": chart_entry.get("market_ticker"),
                    "from": str(a), "to": str(b), "delta": str(delta),
                    "at": cur["t"], "window": wname,
                    "source": w.get("source"),
                })
    return jumps


def write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def taker_fee(price, count, multiplier=1) -> Decimal:
    """Official taker fee: ceil(M * 0.07 * C * P * (1-P)) rounded up to a centicent.

    Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf (fetched 2026-11-20):
      fees = roundup(M x 0.07 x C x P x (1-P)), P in dollars, C contracts, M multiplier.
      round up = rounds up such that fee + positionCost is rounded to a centicent.
    """
    p, c = dec(price), dec(count)
    if p is None or c is None or c <= 0:
        return Decimal("0")
    raw = Decimal(multiplier) * Decimal("0.07") * c * p * (Decimal(1) - p)
    cents = Decimal("0.0001")  # centicent
    return (raw / cents).to_integral_value(rounding="ROUND_CEILING") * cents


if __name__ == "__main__":
    data = build_site_data()
    size = write_json(DATA / "snapshot-slim.json", data)
    print(f"wrote desk/data/snapshot-slim.json ({size/1024:.0f} KiB)")
    print(json.dumps(data["totals"], indent=1))
