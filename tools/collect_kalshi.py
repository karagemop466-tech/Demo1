#!/usr/bin/env python3
"""Collect official Kalshi Trade API v2 (demo environment) data.

Every value written by this script comes from a documented, official Kalshi
endpoint and is stored together with the exact request URL that produced it,
so each row of the generated site can link to its own official source.

Usage:
    python tools/collect_kalshi.py explore   # print data landscape, writes nothing
    python tools/collect_kalshi.py collect   # write data/*.json

Docs verified for this script (fetched 2026-11-20):
  https://docs.kalshi.com/getting_started/api_environments.md
  https://docs.kalshi.com/api-reference/market/get-markets.md
  https://docs.kalshi.com/api-reference/market/get-market.md
  https://docs.kalshi.com/api-reference/market/get-market-orderbook.md
  https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md
  https://docs.kalshi.com/api-reference/market/get-trades.md
  https://docs.kalshi.com/api-reference/market/get-series-list.md
  https://docs.kalshi.com/api-reference/events/get-events.md
  https://docs.kalshi.com/getting_started/market_lifecycle.md
  https://docs.kalshi.com/getting_started/orderbook_responses.md
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
PROD = "https://external-api.kalshi.com/trade-api/v2"
UA = "kalshi-demo-research/1.0 (+https://github.com/karagemop466-tech/Demo1)"
DATA = Path(__file__).resolve().parent.parent / "data"

# Focus topics requested by the project brief. A series is assigned to a topic
# only through an explicit, reviewable rule (see TOPIC_RULES); the list of
# series actually matched is published so each assignment can be checked.
TOPIC_RULES = {
    "gas_prices": {
        "label": "Gas prices",
        "categories": ["Economics", "Commodities", "Financials"],
        "any_words": [
            "gas price", "gas prices", "gasoline", "aaa gas", "pump price",
            "national average gas", "retail gas", "fuel price",
        ],
    },
    "elections": {
        "label": "Elections",
        "categories": ["Politics", "Elections"],
        "any_words": ["election", "president", "senate", "governor", "congress",
                      "primary", "ballot", "electoral", "house", "mayor"],
    },
    "culture": {
        "label": "Culture",
        "categories": ["Culture", "Entertainment", "Pop Culture", "Awards"],
        "any_words": ["album", "movie", "film", "box office", "grammy", "oscar",
                      "emmy", "celebrity", "taylor swift", "song", "tv", "netflix",
                      "spotify", "billboard", "award"],
    },
    "crypto": {
        "label": "Crypto",
        "categories": ["Crypto", "Financials"],
        "any_words": ["bitcoin", "btc", "ethereum", "eth", "solana", "sol",
                      "dogecoin", "doge", "xrp", "ripple", "crypto"],
    },
    "golf": {
        "label": "Golf",
        "categories": ["Sports", "Golf"],
        "any_words": ["golf", "pga", "lpga", "masters", "ryder cup", "open championship",
                      "world golf", "tour championship", "liv golf"],
    },
}

LOG = []


def log(msg):
    LOG.append(msg)
    print(msg, flush=True)


def get_json(url, params=None, retries=3, timeout=25):
    """GET a JSON document, returning (url_with_query, payload, error)."""
    if params:
        url = url + "?" + urllib.parse.urlencode(params, doseq=True)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
                return url, json.loads(body), None
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            last_err = f"HTTP {e.code} {detail}".strip()
            if e.code in (400, 401, 403, 404):
                return url, None, last_err
        except Exception as e:  # network, JSON, timeout
            last_err = f"{type(e).__name__}: {e}"
        time.sleep(1.5 * (attempt + 1))
    return url, None, last_err


def dec(value):
    """Convert a fixed-point string to Decimal, or None. Never guesses a value."""
    if value is None or value == "" or value == "null":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def fnum(value):
    d = dec(value)
    return None if d is None else float(d)


def first_present(d, keys, default=""):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return default


# --------------------------------------------------------------------------
# topic matching
# --------------------------------------------------------------------------
def series_matches(series, rule):
    """Explicit, auditable matching rule. Returns (matched: bool, why: str)."""
    title = (series.get("title") or "").lower()
    ticker = (series.get("ticker") or "").lower()
    cats = [str(c).lower() for c in (series.get("categories") or [])]
    if series.get("category"):
        cats.append(str(series["category"]).lower())
    tags = [str(t).lower() for t in (series.get("tags") or [])]
    hay = " ".join([title, ticker] + tags)
    for word in rule["any_words"]:
        if word in hay:
            return True, f'title/ticker/tags contain "{word}"'
    for cat in rule["categories"]:
        if cat.lower() in cats:
            return True, f'category is "{cat}"'
    return False, ""


def distinct_categories(series_list):
    counts = {}
    for s in series_list:
        for c in (s.get("categories") or [s.get("category") or "—"]):
            counts[c] = counts.get(c, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def fetch_series():
    url, payload, err = get_json(f"{BASE}/series", {"include_volume": "true"})
    if err:
        log(f"SERIES: FAILED {err} ({url})")
        return [], url, err
    series = payload.get("series", [])
    log(f"SERIES: {len(series)} series returned from {url}")
    return series, url, None


def explore():
    series, series_url, err = fetch_series()
    if err:
        print("cannot explore without series list")
        return 1
    cats = distinct_categories(series)
    log("CATEGORIES: " + json.dumps(cats, indent=1))
    for key, rule in TOPIC_RULES.items():
        matched = [(s["ticker"], s.get("title"), s.get("category"))
                   for s in series if series_matches(s, rule)[0]]
        log(f"\nTOPIC {key} ({rule['label']}): {len(matched)} series")
        for t, title, cat in matched[:40]:
            log(f"   {t} | {title} | {cat}")
    # how many markets exist at all
    for status in ("open", "settled"):
        url, payload, e = get_json(f"{BASE}/markets", {"status": status, "limit": 200})
        n = len(payload.get("markets", [])) if payload else 0
        log(f"\nMARKETS status={status}: page1={n} err={e} url={url}")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "explore"
    if mode == "explore":
        sys.exit(explore())
    print("unknown mode", mode)
    sys.exit(2)
