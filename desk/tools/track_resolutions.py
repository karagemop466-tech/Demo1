#!/usr/bin/env python3
"""Maintain an append-only, source-linked resolution log for the five topics.

A market is logged the first time it is *observed* with a terminal exchange state:
  status=finalized (the REST form of settled)  AND  result in {yes, no}
according to https://docs.kalshi.com/getting_started/market_lifecycle .
Markets that are `closed` but not yet determined are tracked as "awaiting result";
they are never assumed to be a NO. First-seen timestamps are the only added field,
and they say when this repository observed the state, not when Kalshi determined it
(the exchange's own settlement_ts is stored alongside, unmodified).

Inputs:  snapshot/resolved.json  (committed, official demo API collection)
         desk/data/markets-live.json (optional fresher run, same schema lineage)
Output:  desk/data/resolutions-log.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "desk" / "data"
LOG = DATA / "resolutions-log.json"

TOPICS = ("gas_prices", "elections", "culture", "crypto", "golf")
EXCLUDED_SERIES_PREFIX = ("KXWTI",)  # see desk/tools/paper_trader.py EXCLUDED_SERIES


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def excluded(series: str) -> bool:
    s = (series or "").upper()
    return any(s == p or s.startswith(p + "-") for p in EXCLUDED_SERIES_PREFIX)


def rows_from_committed() -> list:
    payload = load(ROOT / "snapshot" / "resolved.json", {})
    out = []
    for m in payload.get("markets") or []:
        if m.get("topic") not in TOPICS or excluded(m.get("series_ticker")):
            continue
        out.append({
            "ticker": m.get("market_ticker"),
            "topic": m.get("topic"),
            "series": m.get("series_ticker"),
            "event_ticker": m.get("event_ticker"),
            "event_title": m.get("event_title"),
            "title": m.get("title"),
            "status": m.get("status"),
            "result": m.get("result"),
            "settlement_ts": m.get("settlement_ts"),
            "settlement_value_dollars": m.get("settlement_value_dollars"),
            "close_time": m.get("close_time"),
            "source_url": (m.get("sources") or {}).get("markets"),
            "observed_in": "snapshot/resolved.json",
        })
    return out


def rows_from_live() -> list:
    payload = load(DATA / "markets-live.json", {})
    out = []
    for bucket in ("settled", "closed"):
        for m in payload.get(bucket) or []:
            if m.get("topic") not in TOPICS or excluded(m.get("series_ticker")):
                continue
            out.append({
                "ticker": m.get("market_ticker"),
                "topic": m.get("topic"),
                "series": m.get("series_ticker"),
                "event_ticker": m.get("event_ticker"),
                "event_title": m.get("event_title"),
                "title": m.get("title"),
                "status": m.get("status"),
                "result": m.get("result"),
                "settlement_ts": m.get("settlement_ts"),
                "settlement_value_dollars": m.get("settlement_value_dollars"),
                "close_time": m.get("close_time"),
                "source_url": m.get("source_url"),
                "observed_in": "desk/data/markets-live.json",
            })
    return out


def main() -> int:
    existing = load(LOG, {})
    entries = {e["ticker"]: e for e in existing.get("entries", []) if e.get("ticker")}
    first_seen_count = 0
    observed_at = now_iso()

    for row in rows_from_committed() + rows_from_live():
        if not row["ticker"]:
            continue
        prev = entries.get(row["ticker"])
        resolved_now = (row.get("result") or "").lower() in ("yes", "no")
        if prev is None:
            entries[row["ticker"]] = {
                **row,
                "outcome": (row.get("result") or "").lower() or None,
                "state": "resolved" if resolved_now else "awaiting_result",
                "first_observed_utc": observed_at,
                "last_observed_utc": observed_at,
            }
            first_seen_count += 1
        else:
            was = prev.get("state")
            now_state = "resolved" if resolved_now else "awaiting_result"
            prev.update({
                "status": row.get("status") or prev.get("status"),
                "result": row.get("result") if resolved_now else prev.get("result"),
                "outcome": (row.get("result") or "").lower() if resolved_now else prev.get("outcome"),
                "settlement_ts": row.get("settlement_ts") or prev.get("settlement_ts"),
                "settlement_value_dollars": row.get("settlement_value_dollars")
                or prev.get("settlement_value_dollars"),
                "source_url": row.get("source_url") or prev.get("source_url"),
                "last_observed_utc": observed_at,
            })
            if was != now_state:
                prev["state"] = now_state
                prev["state_changed_utc"] = observed_at
                prev.setdefault("transitions", []).append(
                    {"from": was, "to": now_state, "at": observed_at})

    items = sorted(entries.values(),
                   key=lambda e: (e.get("settlement_ts") or e.get("close_time") or ""), reverse=True)

    by_topic = {}
    for t in TOPICS:
        rows = [e for e in items if e.get("topic") == t]
        by_topic[t] = {
            "tracked": len(rows),
            "resolved": sum(1 for e in rows if e["state"] == "resolved"),
            "yes": sum(1 for e in rows if e.get("outcome") == "yes"),
            "no": sum(1 for e in rows if e.get("outcome") == "no"),
            "awaiting": sum(1 for e in rows if e["state"] == "awaiting_result"),
        }

    out = {
        "generated_utc": observed_at,
        "docs": {
            "lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
            "markets": "https://docs.kalshi.com/api-reference/market/get-markets",
        },
        "rule": "A market counts as resolved only when the exchange returns result in "
                "{yes,no} (status finalized in REST). 'closed' without a result means the "
                "exchange is still determining the outcome and is tracked as awaiting_result.",
        "totals": {
            "tracked": len(items),
            "resolved": sum(1 for e in items if e["state"] == "resolved"),
            "yes": sum(1 for e in items if e.get("outcome") == "yes"),
            "no": sum(1 for e in items if e.get("outcome") == "no"),
            "awaiting": sum(1 for e in items if e["state"] == "awaiting_result"),
        },
        "by_topic": by_topic,
        "first_seen_this_run": first_seen_count,
        "entries": items,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"tracked={out['totals']['tracked']} resolved={out['totals']['resolved']} "
          f"yes={out['totals']['yes']} no={out['totals']['no']} awaiting={out['totals']['awaiting']} "
          f"new_this_run={first_seen_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
