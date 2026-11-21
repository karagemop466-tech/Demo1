#!/usr/bin/env python3
"""build_series_index.py — the five-topic series list the live dashboard queries.

Why this file exists
--------------------
`desk/live.html` used to ask the official demo API for
`GET /markets?status=open&limit=1000` and then keyword-match the rows. On
2026-11-21 that scan returned 1,000 rows and **zero** topic matches, because the
demo exchange's newest open markets are dominated by multivariate combo markets
(`event_ticker` = `KXMVECROSSCATEGORY-…`). The official Get Markets reference
documents a query parameter for exactly this case:

    mve_filter — "Filter by multivariate events (combos). 'only' returns only
    multivariate events, 'exclude' excludes multivariate events."
    https://docs.kalshi.com/api-reference/market/get-markets

Excluding combos is necessary but not sufficient: the newest non-combo page is
then dominated by one high-churn series (weather thresholds), so a newest-first
page is still not a topic sample. The documented `series_ticker` filter is
therefore used per series, with the series list taken from the committed
collection (`snapshot/markets.json`) rather than guessed.

Nothing here is inferred: every series listed came back from the API inside a
topic-matched market record, and each entry keeps the exact request URL that
will be used to refresh it.

Usage:
  python3 desk/tools/build_series_index.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "snapshot" / "markets.json"
OUT = ROOT / "desk" / "data" / "series-index.json"

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
DOCS_MARKETS = "https://docs.kalshi.com/api-reference/market/get-markets"

# Series the collection filed under a topic that the venue does not agree with.
# KXWTI is a crude-oil price series; the snapshot's elections rule matched it.
# Documented in desk/flagged.html (FL-05) and excluded here as well.
EXCLUDED = {
    "KXWTI": "Crude-oil price series — not an election market.",
}

TOPIC_LABEL = {
    "gas_prices": "Gas prices",
    "elections": "Elections",
    "culture": "Culture",
    "crypto": "Crypto",
    "golf": "Golf",
}

# How many series per topic the live page refreshes on each pass. Six keeps the
# fan-out at 30 public requests per refresh while covering every series that has
# open markets for gas, culture, crypto and golf.
MAX_SERIES_PER_TOPIC = 6


def source_url(series: str) -> str:
    return (f"{BASE}/markets?series_ticker={series}&status=open"
            f"&mve_filter=exclude&limit=100")


def main() -> int:
    payload = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    markets = payload.get("markets") or []
    collected = payload.get("generated_utc") or ""

    counts: dict[str, dict[str, int]] = {k: {} for k in TOPIC_LABEL}
    for m in markets:
        topic = m.get("topic")
        series = m.get("series_ticker")
        if topic not in counts or not series or series in EXCLUDED:
            continue
        counts[topic][series] = counts[topic].get(series, 0) + 1

    topics = {}
    for key, label in TOPIC_LABEL.items():
        ranked = sorted(counts[key].items(), key=lambda kv: (-kv[1], kv[0]))
        chosen = ranked[:MAX_SERIES_PER_TOPIC]
        topics[key] = {
            "label": label,
            "open_markets_in_snapshot": sum(counts[key].values()),
            "series_count_in_snapshot": len(ranked),
            "series": [
                {"series_ticker": s, "open_markets_in_snapshot": n, "source": source_url(s)}
                for s, n in chosen
            ],
            "omitted_series": [s for s, _ in ranked[MAX_SERIES_PER_TOPIC:]],
        }

    out = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "basis": {
            "snapshot": "snapshot/markets.json",
            "snapshot_collected_utc": collected,
            "rule": ("series tickers that the committed collection returned inside markets "
                     "the desk's published topic rules matched; ranked by open markets"),
            "docs": DOCS_MARKETS,
            "why_mve_filter": ("official Get Markets parameter mve_filter=exclude removes "
                               "multivariate combo markets, which otherwise fill the newest "
                               "open-market pages"),
        },
        "max_series_per_topic": MAX_SERIES_PER_TOPIC,
        "excluded_series": EXCLUDED,
        "topics": topics,
        "requests_per_refresh": sum(len(v["series"]) for v in topics.values()),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    total = out["requests_per_refresh"]
    print(f"wrote {OUT.relative_to(ROOT)}: {total} series across "
          f"{len(topics)} topics (snapshot {collected or 'undated'})")
    for key, t in topics.items():
        print(f"  {key:12s} {len(t['series'])} of {t['series_count_in_snapshot']} series, "
              f"{t['open_markets_in_snapshot']} open markets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
