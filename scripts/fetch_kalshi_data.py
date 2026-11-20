#!/usr/bin/env python3
"""
fetch_kalshi_data.py — Kalshi DEMO data pipeline for the Demo1 repo.

Collects live market data for the five tracked topics (gas prices, elections,
culture, crypto, golf) from the official Kalshi DEMO Trade API, ranks events by
estimated USD trading activity, captures order-book depth and candlestick price
history, and tracks events until they resolve (YES / NO), writing JSON files
under docs/data/ that the static GitHub Pages site reads.

Official sources (verified 2026-11-20, see SOURCES.md):
  - Base URLs:   https://docs.kalshi.com/getting_started/api_environments
                 https://docs.kalshi.com/getting_started/demo_env
  - Events:      https://docs.kalshi.com/api-reference/events/get-events
                 (status: unopened|open|closed|settled; limit<=200; tickers; series_ticker; with_nested_markets)
  - Series:      https://docs.kalshi.com/api-reference/market/get-series-list
                 (category filter is exact + case-sensitive; matches `categories` list)
  - Tags map:    GET /search/tags_by_categories (live-verified on demo)
  - Orderbook:   https://docs.kalshi.com/getting_started/orderbook_responses
                 (orderbook_fp.yes_dollars / no_dollars = [price_dollars, count_fp],
                  ascending, best bid = last element; asks are implied: ask = 1 - opposite bid)
  - Candlesticks https://docs.kalshi.com/api-reference/market/get-market-candlesticks
                 (period_interval: 1|60|1440 minutes; start_ts/end_ts unix seconds)
  - Fixed point: https://docs.kalshi.com/getting_started/fixed_point_migration
                 (prices `*_dollars` strings; quantities `*_fp` strings)
  - Settlement:  https://docs.kalshi.com/getting_started/market_settlement
                 (yes -> $1 to YES holders; no -> $1 to NO holders)

No authentication is used: every endpoint called here is documented as public
market data (https://docs.kalshi.com/getting_started/quick_start_market_data).

Methodology (documented on the site and in EXECUTIVE_SUMMARY.md):
  - "Est. USD volume" per market = volume (contracts) x last traded price (USD).
    This is an ESTIMATE of traded notional, not an official Kalshi metric.
  - "Notional at stake" per market = open interest (contracts) x $1.00 (each
    binary contract pays exactly $1 at settlement per the official settlement doc).
  - Events are ranked by est. USD volume over the trailing 24h (volume_24h_fp x
    last_price_dollars); total volume is the tiebreaker/fallback.

Usage:
  python3 scripts/fetch_kalshi_data.py [--out docs/data] [--pages N] [--quick]

Exit codes: 0 ok (even with partial topic errors, logged in run_log.json),
            1 total failure (no snapshot written/updated).
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
DOCS_BASE = "https://docs.kalshi.com"

TOPICS = ["gas", "elections", "culture", "crypto", "golf"]

# Authoritative taxonomy (live-verified 2026-11-20 via GET /search/tags_by_categories):
#   Elections category exists ("Elections"), Crypto category exists ("Crypto"),
#   Culture maps to Kalshi's "Entertainment" category (tags: Oscars, Grammys, Music, ...),
#   Gas series live in "Economics" (tag "Oil and energy"; series KXAAAGAS*),
#   Golf series live in "Sports" (tag "Golf").
CATEGORY_FOR_TOPIC = {
    "elections": ["Elections"],
    "crypto": ["Crypto"],
    "culture": ["Entertainment"],
    "gas": ["Economics"],
    "golf": ["Sports"],
}
# Additional keyword filters for topics whose Kalshi category is broader than the topic.
KEYWORDS_FOR_TOPIC = {
    "gas": ["gas", "gasoline", "gasbuddy", "fuel", "petrol", "energy price"],
    "golf": ["golf", "pga", "masters tournament", "lpga", "ryder cup", "liv golf"],
    "elections": [],
    "crypto": [],
    "culture": [],
}
# Keyword rules match on WORD BOUNDARIES in titles/tags, and as a substring in the series
# TICKER (tickers concatenate words: KXAAAGASW). Substring matching on titles is what pulled
# "When will Las Vegas receive a Pro Basketball expansion team?" into the gas topic — "ve**gas**"
# contains "gas". Found in the committed output docs/data/snapshot.json (topic "gas",
# top_events[0]) and fixed by session arena/65df996f-demo1 on 2026-11-20; the regression is
# covered by tests/test_topic_classification.py.
# Series volume is used only to decide which series to fetch directly; it comes from
# GET /series?include_volume=true = "total volume traded across all events in each series"
# (https://docs.kalshi.com/api-reference/market/get-series-list).
TOP_SERIES_PER_TOPIC = 12      # busiest series per topic, always fetched by series_ticker

MAX_PAGES_EVENTS = 25          # 200 events/page -> up to 5000 open events scanned
UNDERCOVER_THRESHOLD = 5       # topics with fewer matches get a targeted per-series fetch
UNDERCOVER_SERIES_CAP = 60     # per-topic series cap for the targeted fetch (bounded runtime)
TOP_EVENTS_PER_TOPIC = 8       # events captured per topic in snapshot
TOP_MARKETS_FOR_BOOK = 4       # orderbooks fetched per topic
TOP_MARKETS_FOR_HISTORY = 3    # candlestick series fetched per topic
CANDLE_1M_SPAN = 12 * 3600     # 12 hours of 1-minute candles
CANDLE_60M_SPAN = 14 * 86400   # 14 days of 1-hour candles
REQUEST_GAP_S = 0.25           # politeness gap; unauthenticated limits apply (see rate_limits.md)
MAX_MARKETS_PER_EVENT = 30     # cap huge mutually-exclusive event boards


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get_json(url, retries=3):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Demo1-kalshi-pipeline/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} {url}"
            if e.code in (429, 500, 502, 503):
                time.sleep(1.5 * (attempt + 1))  # backoff per docs (429 -> back off)
                continue
            raise RuntimeError(last_err) from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = f"{type(e).__name__}: {e} ({url})"
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_err)


def fnum(s):
    """Parse fixed-point strings ('0.4500', '100.00') defensively; None if absent."""
    try:
        if s is None or s == "":
            return None
        return float(s)
    except (TypeError, ValueError):
        return None


def fetch_all_events(session, status, pages_limit):
    """Paginate GET /events (cursor pagination per docs.kalshi.com/getting_started/pagination)."""
    events, cursor, pages = [], "", 0
    while pages < pages_limit:
        q = f"/events?limit=200&status={status}&with_nested_markets=true"
        if cursor:
            q += "&cursor=" + urllib.parse.quote(cursor)
        data = http_get_json(BASE + q)
        events.extend(data.get("events") or [])
        cursor = data.get("cursor") or ""
        pages += 1
        if not cursor:
            break
        time.sleep(REQUEST_GAP_S)
    return events, pages


def norm_series(ticker):
    """Compare series tickers with the legacy KX prefix removed and upper-cased.

    The demo /series list returns some series without the KX prefix (AAAGASW) while events
    report the prefixed form (KXAAAGASW) — both appear in the committed data
    (docs/data/series_map.json vs snapshot/markets.json). Exact-string membership therefore
    dropped the busiest gas series from the topic, so membership is tested on this key.
    """
    t = (ticker or "").strip().upper()
    return t[2:] if t.startswith("KX") else t


def keyword_in_text(topic, text):
    """Word-boundary keyword test used for titles and tags (see KEYWORDS_FOR_TOPIC)."""
    kws = KEYWORDS_FOR_TOPIC.get(topic) or []
    low = (text or "").lower()
    return any(re.search(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", low) for k in kws)


def series_keyword_hit(topic, ticker, title, tags):
    """A series belongs to a keyword-gated topic via its ticker (substring) or its
    title/tags (word boundaries). Tickers are concatenated, so "gas" must match inside
    "KXAAAGASW"; prose must not, so "gas" cannot match inside "Las Vegas"."""
    kws = KEYWORDS_FOR_TOPIC.get(topic) or []
    if not kws:
        return True
    tk = (ticker or "").lower()
    if any(k in tk for k in kws):
        return True
    return keyword_in_text(topic, " ".join([title or "", " ".join(tags or [])]))


def build_series_map(session):
    """Map topic -> set of series tickers using the official category filter.

    GET /series?category=X matches a series' `categories` list exactly and
    case-sensitively (verified: docs get-series-list.md + live probe).
    NOTE: /series returns the full matching list (no documented limit param).
    """
    mapping = {}
    raw_categories = {}
    volumes = {}
    for topic, cats in CATEGORY_FOR_TOPIC.items():
        tickers = set()
        raw_categories[topic] = []
        for cat in cats:
            data = http_get_json(BASE + "/series?category=" + urllib.parse.quote(cat) + "&include_volume=true")
            series = data.get("series") or []
            raw_categories[topic].append({"category": cat, "series_count": len(series)})
            for s in series:
                st = s.get("ticker") or ""
                if not st:
                    continue
                if not series_keyword_hit(topic, st, s.get("title"), s.get("tags")):
                    continue
                tickers.add(st)
                vol = fnum(s.get("volume_fp"))
                if vol is not None:
                    volumes[norm_series(st)] = vol
            time.sleep(REQUEST_GAP_S)
        mapping[topic] = sorted(tickers)
    return mapping, raw_categories, volumes


def classify_event(event, series_map, norm_map=None):
    """Topic of an event: verified series membership first, then the documented fallbacks.

    `series_map` holds real tickers; `norm_map` (optional) holds the same set keyed without
    the legacy KX prefix, which is what makes KXAAAGASW match a series listed as AAAGASW.
    """
    st = event.get("series_ticker") or ""
    key = norm_series(st)
    for topic in TOPICS:
        members = norm_map[topic] if norm_map else {norm_series(x) for x in series_map.get(topic, ())}
        if key and key in members:
            return topic
        if st in series_map.get(topic, ()):
            return topic
    # Fallback: event.category (deprecated per docs but still returned; verified live)
    cat = (event.get("category") or "").lower()
    if cat == "elections":
        return "elections"
    if cat == "crypto":
        return "crypto"
    if cat == "entertainment":
        return "culture"
    title = event.get("title") or ""
    for topic in ("gas", "golf"):
        if keyword_in_text(topic, title):
            return topic
    return None


def market_row(m):
    """Normalize a Market object (fields verified from live demo payload + docs)."""
    last = fnum(m.get("last_price_dollars"))
    vol = fnum(m.get("volume_fp"))
    vol24 = fnum(m.get("volume_24h_fp"))
    oi = fnum(m.get("open_interest_fp"))
    yes_bid = fnum(m.get("yes_bid_dollars"))
    yes_ask = fnum(m.get("yes_ask_dollars"))
    no_bid = fnum(m.get("no_bid_dollars"))
    no_ask = fnum(m.get("no_ask_dollars"))
    est_usd_24h = vol24 * last if (vol24 is not None and last is not None) else None
    est_usd = vol * last if (vol is not None and last is not None) else None
    notional = oi if oi is not None else None  # contracts x $1.00 at settlement
    return {
        "ticker": m.get("ticker") or "",
        "title": m.get("title") or "",
        "yes_sub_title": m.get("yes_sub_title") or "",
        "status": m.get("status") or "",
        "result": m.get("result") or "",
        "last_price_dollars": m.get("last_price_dollars") or "",
        "yes_bid_dollars": m.get("yes_bid_dollars") or "",
        "yes_ask_dollars": m.get("yes_ask_dollars") or "",
        "no_bid_dollars": m.get("no_bid_dollars") or "",
        "no_ask_dollars": m.get("no_ask_dollars") or "",
        "volume_fp": m.get("volume_fp") or "",
        "volume_24h_fp": m.get("volume_24h_fp") or "",
        "open_interest_fp": m.get("open_interest_fp") or "",
        "close_time": m.get("close_time") or m.get("expected_expiration_time") or "",
        "est_usd_volume_24h": round(est_usd_24h, 2) if est_usd_24h is not None else None,
        "est_usd_volume": round(est_usd, 2) if est_usd is not None else None,
        "notional_at_stake_usd": round(notional, 2) if notional is not None else None,
        "api_url": f"{BASE}/markets/{urllib.parse.quote(m.get('ticker') or '')}",
    }


def event_row(event, topic, series_map):
    markets = [market_row(m) for m in (event.get("markets") or [])]
    markets.sort(key=lambda r: (r["est_usd_volume_24h"] or r["est_usd_volume"] or -1), reverse=True)
    total_est_usd_24h = sum(r["est_usd_volume_24h"] or 0.0 for r in markets)
    total_est_usd = sum(r["est_usd_volume"] or 0.0 for r in markets)
    total_notional = sum(r["notional_at_stake_usd"] or 0.0 for r in markets)
    total_vol = sum(fnum(r["volume_fp"]) or 0.0 for r in markets)
    return {
        "event_ticker": event.get("event_ticker") or "",
        "series_ticker": event.get("series_ticker") or "",
        "title": event.get("title") or "",
        "sub_title": event.get("sub_title") or "",
        "topic": topic,
        "mutually_exclusive": bool(event.get("mutually_exclusive")),
        "settlement_sources": [
            {"name": s.get("name"), "url": s.get("url")}
            for s in (event.get("settlement_sources") or [])
            if isinstance(s, dict)
        ],
        "markets_count": len(event.get("markets") or []),
        "total_volume_fp": round(total_vol, 2),
        "est_usd_volume_24h": round(total_est_usd_24h, 2),
        "est_usd_volume": round(total_est_usd, 2),
        "notional_at_stake_usd": round(total_notional, 2),
        "api_url": f"{BASE}/events/{urllib.parse.quote(event.get('event_ticker') or '')}",
        "markets": markets[:MAX_MARKETS_PER_EVENT],
        "markets_truncated": len(event.get("markets") or []) > MAX_MARKETS_PER_EVENT,
    }


def fetch_orderbooks(market_tickers):
    books = {}
    for t in market_tickers:
        try:
            data = http_get_json(f"{BASE}/markets/{urllib.parse.quote(t)}/orderbook")
            ob = data.get("orderbook_fp") or {}
            books[t] = {
                # Arrays ascending; best bid = last element (docs orderbook_responses.md).
                "yes_bids_dollars": (ob.get("yes_dollars") or [])[::-1],
                "no_bids_dollars": (ob.get("no_dollars") or [])[::-1],
                "fetched_at": now_iso(),
                "api_url": f"{BASE}/markets/{urllib.parse.quote(t)}/orderbook",
            }
            time.sleep(REQUEST_GAP_S)
        except Exception as e:  # keep going; record error
            books[t] = {"error": str(e), "fetched_at": now_iso()}
    return books


def fetch_candles(session, series_ticker, market_ticker, span_s, interval):
    end = int(time.time())
    start = end - span_s
    path = f"/series/{urllib.parse.quote(series_ticker)}/markets/{urllib.parse.quote(market_ticker)}/candlesticks"
    q = f"{path}?start_ts={start}&end_ts={end}&period_interval={interval}"
    data = http_get_json(BASE + q)
    out = []
    for c in data.get("candlesticks") or []:
        # The documented response nests OHLC under `price` (price.close_dollars, …) — see
        # https://docs.kalshi.com/api-reference/market/get-market-candlesticks — while older
        # payloads and some tooling expose flat *_dollars keys. Read both, nested first.
        px = c.get("price") or {}
        def pick(nested_key, flat_key):
            if isinstance(px, dict) and px.get(nested_key) is not None:
                return px.get(nested_key)
            return c.get(flat_key)
        out.append({
            "end_ts": c.get("end_period_ts") or c.get("end_period_ts_ms"),
            "o": pick("open_dollars", "price_open_dollars"),
            "c": pick("close_dollars", "price_close_dollars"),
            "h": pick("high_dollars", "price_high_dollars"),
            "l": pick("low_dollars", "price_low_dollars"),
            "yes_bid_c": (c.get("yes_bid") or {}).get("close_dollars") if isinstance(c.get("yes_bid"), dict) else c.get("yes_bid_close_dollars"),
            "yes_ask_c": (c.get("yes_ask") or {}).get("close_dollars") if isinstance(c.get("yes_ask"), dict) else c.get("yes_ask_close_dollars"),
            "vol_fp": c.get("volume_fp"),
        })
    return {"interval_minutes": interval, "candles": out, "api_url": BASE + path}


def load_json(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/data")
    ap.add_argument("--pages", type=int, default=MAX_PAGES_EVENTS)
    ap.add_argument("--quick", action="store_true", help="smaller caps for a smoke test")
    args = ap.parse_args()
    if args.quick:
        global TOP_EVENTS_PER_TOPIC, TOP_MARKETS_FOR_BOOK, TOP_MARKETS_FOR_HISTORY, CANDLE_1M_SPAN, CANDLE_60M_SPAN
        TOP_EVENTS_PER_TOPIC, TOP_MARKETS_FOR_BOOK, TOP_MARKETS_FOR_HISTORY = 3, 2, 1
        CANDLE_1M_SPAN, CANDLE_60M_SPAN = 2 * 3600, 3 * 86400

    errors = []
    started = time.time()

    # 1) Series -> topic map (authoritative category taxonomy)
    try:
        series_map, raw_categories, series_volumes = build_series_map(None)
        norm_map = {t: {norm_series(x) for x in series_map[t]} for t in TOPICS}
        top_by_topic = {}
        for t in TOPICS:
            ranked = sorted(series_map[t], key=lambda x: -(series_volumes.get(norm_series(x)) or 0))
            top_by_topic[t] = [{
                "ticker": x,
                "volume_contracts": series_volumes.get(norm_series(x)),
                "volume_field": "volume_fp from GET /series?include_volume=true (total volume across all events in the series)",
                "api_url": BASE + "/series?category=" + urllib.parse.quote((CATEGORY_FOR_TOPIC[t] or [""])[0]) + "&include_volume=true",
            } for x in ranked[:TOP_SERIES_PER_TOPIC]]
        save_json(os.path.join(args.out, "series_map.json"), {
            "generated_at": now_iso(),
            "method": "GET /series?category=<Kalshi category>&include_volume=true (category match is exact and case-sensitive); "
                      "gas/golf additionally filtered by ticker substring or word-boundary title/tag keywords",
            "classification_rules": {
                "note": "Topic membership is this repository's heuristic, not an official Kalshi taxonomy.",
                "series": "event.series_ticker matched against the category list, comparing tickers with the legacy KX prefix removed",
                "keywords": KEYWORDS_FOR_TOPIC,
                "keyword_matching": "word boundaries on titles/tags, substring on the series ticker (tickers concatenate words)",
                "category_fallback": {"Elections": "elections", "Crypto": "crypto", "Entertainment": "culture"},
            },
            "categories_by_topic": raw_categories,
            "series_map": {t: sorted(series_map[t]) for t in TOPICS},
            "top_series_by_topic": top_by_topic,
            "api_url": BASE + "/series",
        })
    except Exception as e:
        errors.append(f"series_map: {e}")
        series_map = {t: set() for t in TOPICS}
        norm_map = {t: set() for t in TOPICS}
        series_volumes = {}
        raw_categories = {}
        top_by_topic = {}

    # 2) Scan open events (global pagination, then classify)
    try:
        open_events, pages_used = fetch_all_events(None, "open", args.pages)
    except Exception as e:
        errors.append(f"events_scan: {e}")
        open_events, pages_used = [], 0

    by_topic = {t: [] for t in TOPICS}
    for ev in open_events:
        topic = classify_event(ev, series_map, norm_map)
        if topic:
            by_topic[topic].append(ev)

    # Targeted per-series fetch. The global /events scan is bounded by MAX_PAGES_EVENTS, so a
    # topic can be missing its busiest series (that is how every gas event ended up with
    # $0.00 estimated volume while KXAAAGASW/KXAAAGASM were never read). Every topic therefore
    # gets its highest-volume series fetched directly, and an under-covered topic also gets an
    # alphabetical slice. Bounded and throttled.
    covered = set()
    fetch_targets = {}
    for topic in TOPICS:
        avail = series_map.get(topic) or []
        if not avail:
            continue
        ranked = sorted(avail, key=lambda x: (-(series_volumes.get(norm_series(x)) or 0), x))
        take = ranked[:TOP_SERIES_PER_TOPIC]
        if len(by_topic[topic]) < UNDERCOVER_THRESHOLD:
            take = list(dict.fromkeys(take + sorted(avail)[:UNDERCOVER_SERIES_CAP]))
        fetch_targets[topic] = take
    for topic in TOPICS:
        for st in fetch_targets.get(topic, []):
            try:
                q = f"/events?limit=200&status=open&with_nested_markets=true&series_ticker={urllib.parse.quote(st)}"
                data = http_get_json(BASE + q)
                for ev in data.get("events") or []:
                    if ev.get("event_ticker") in covered:
                        continue
                    covered.add(ev.get("event_ticker"))
                    by_topic[topic].append(ev)
                time.sleep(REQUEST_GAP_S)
            except Exception as e:
                errors.append(f"per_series[{topic}/{st}]: {e}")
    for topic in TOPICS:
        # dedupe (global scan + per-series can overlap)
        seen, uniq = set(), []
        for ev in by_topic[topic]:
            t = ev.get("event_ticker")
            if t in seen:
                continue
            seen.add(t)
            uniq.append(ev)
        by_topic[topic] = uniq

    # 3) Rank + build snapshot
    snapshot_topics = {}
    book_targets, candle_targets = [], []
    for topic in TOPICS:
        rows = [event_row(ev, topic, series_map) for ev in by_topic[topic]]
        rows.sort(key=lambda r: (r["est_usd_volume_24h"], r["est_usd_volume"], r["total_volume_fp"]), reverse=True)
        top = rows[:TOP_EVENTS_PER_TOPIC]
        for r in top:
            # collect top markets of this event for book/history
            for m in r["markets"][:2]:
                t = m["ticker"]
                if t and (t, topic) not in book_targets:
                    book_targets.append((t, topic))
                candle_targets.append((r["series_ticker"], t, topic))
        snapshot_topics[topic] = {
            "open_events_matched": len(rows),
            "top_events": top,
        }

    book_targets = book_targets[: TOP_MARKETS_FOR_BOOK * len(TOPICS)]
    candle_targets = candle_targets[: TOP_MARKETS_FOR_HISTORY * len(TOPICS)]
    orderbooks = fetch_orderbooks([t for t, _ in book_targets]) if book_targets else {}

    # 5) Candlestick history for top markets
    history = {}
    for series_ticker, market_ticker, topic in candle_targets:
        if not series_ticker or not market_ticker or market_ticker in history:
            continue
        entry = {"topic": topic, "series_ticker": series_ticker}
        try:
            entry["1m"] = fetch_candles(None, series_ticker, market_ticker, CANDLE_1M_SPAN, 1)
        except Exception as e:
            entry["1m"] = {"error": str(e)}
        time.sleep(REQUEST_GAP_S)
        try:
            entry["60m"] = fetch_candles(None, series_ticker, market_ticker, CANDLE_60M_SPAN, 60)
        except Exception as e:
            entry["60m"] = {"error": str(e)}
        time.sleep(REQUEST_GAP_S)
        history[market_ticker] = entry
    save_json(os.path.join(args.out, "history.json"), {
        "generated_at": now_iso(),
        "note": "Official candlesticks: /series/{series}/markets/{market}/candlesticks (period_interval 1|60; see docs). 1m = trailing hours, 60m = trailing days.",
        "markets": history,
    })

    # 6) Resolution tracking for previously-tracked events
    tracked = load_json(os.path.join(args.out, "tracked_events.json"))
    tracked_list = tracked.get("events") if isinstance(tracked, dict) else None
    if not isinstance(tracked_list, list):
        tracked_list = []
    # add current top events to tracking
    seen = {e["event_ticker"] for e in tracked_list}
    for topic in TOPICS:
        for r in snapshot_topics[topic]["top_events"]:
            if r["event_ticker"] not in seen:
                tracked_list.append({
                    "event_ticker": r["event_ticker"],
                    "series_ticker": r["series_ticker"],
                    "title": r["title"],
                    "topic": topic,
                    "first_tracked": now_iso(),
                })
                seen.add(r["event_ticker"])
    tracked_list = tracked_list[-400:]  # cap
    resolutions = {"generated_at": now_iso(), "events": [], "errors": errors}
    tickers = [e["event_ticker"] for e in tracked_list]
    event_meta = {e["event_ticker"]: e for e in tracked_list}
    # chunk lookups of 25 tickers per call (tickers param is comma-separated)
    for i in range(0, len(tickers), 25):
        chunk = tickers[i:i + 25]
        try:
            q = "/events?tickers=" + urllib.parse.quote(",".join(chunk)) + "&with_nested_markets=true&limit=200"
            data = http_get_json(BASE + q)
            for ev in data.get("events") or []:
                meta = event_meta.get(ev.get("event_ticker"), {})
                markets = []
                for m in ev.get("markets") or []:
                    markets.append({
                        "ticker": m.get("ticker"), "title": m.get("title"),
                        "status": m.get("status"), "result": m.get("result"),
                        "last_price_dollars": m.get("last_price_dollars"),
                    })
                resolutions["events"].append({
                    "event_ticker": ev.get("event_ticker"),
                    "series_ticker": ev.get("series_ticker"),
                    "title": ev.get("title"),
                    "topic": meta.get("topic", ""),
                    "event_status": ev.get("status") if "status" in ev else "",
                    "markets": markets,
                    "api_url": f"{BASE}/events/{urllib.parse.quote(ev.get('event_ticker') or '')}",
                    "checked_at": now_iso(),
                })
            time.sleep(REQUEST_GAP_S)
        except Exception as e:
            resolutions["errors"].append(f"track_lookup[{i}]: {e}")
    save_json(os.path.join(args.out, "tracked_events.json"), {"generated_at": now_iso(), "events": tracked_list})
    save_json(os.path.join(args.out, "resolutions.json"), resolutions)

    # 7) Snapshot
    snapshot = {
        "generated_at": now_iso(),
        "sample": False,
        "base_url": BASE,
        "env_docs": DOCS_BASE + "/getting_started/demo_env.md",
        "methodology": {
            "est_usd_volume_24h": "volume_24h_fp x last_price_dollars (est. traded notional, not an official Kalshi metric)",
            "notional_at_stake_usd": "open_interest_fp x $1.00 (each binary contract pays $1 at settlement per docs.kalshi.com/getting_started/market_settlement.md)",
            "ranking": "events ranked by est_usd_volume_24h, then est_usd_volume, then total contracts",
            "category_taxonomy": "GET /search/tags_by_categories + GET /series?category= (verified 2026-11-20); culture = Kalshi 'Entertainment'",
        },
        "events_scanned": len(open_events),
        "event_pages": pages_used,
        "topics": snapshot_topics,
        "orderbooks": orderbooks,
        "errors": errors,
        "sources": [
            DOCS_BASE + "/getting_started/demo_env.md",
            DOCS_BASE + "/api-reference/events/get-events.md",
            DOCS_BASE + "/api-reference/market/get-series-list.md",
            DOCS_BASE + "/getting_started/orderbook_responses.md",
            DOCS_BASE + "/api-reference/market/get-market-candlesticks.md",
            DOCS_BASE + "/getting_started/fixed_point_migration.md",
        ],
    }
    snap_path = os.path.join(args.out, "snapshot.json")
    prev = load_json(snap_path)
    if errors and not snapshot_topics.get("gas", {}).get("top_events") and prev:
        # keep previous good snapshot if this run fully failed early
        snapshot["generated_at"] = prev.get("generated_at", snapshot["generated_at"])
        snapshot["degraded"] = True
    save_json(snap_path, snapshot)

    # 8) run log (append, cap 200)
    runlog_path = os.path.join(args.out, "run_log.json")
    runlog = load_json(runlog_path)
    runs = runlog.get("runs") if isinstance(runlog, dict) else None
    if not isinstance(runs, list):
        runs = []
    runs.append({
        "at": now_iso(),
        "ok": not errors,
        "events_scanned": len(open_events),
        "matched_by_topic": {t: snapshot_topics[t]["open_events_matched"] for t in TOPICS},
        "books": len(orderbooks),
        "history_markets": len(history),
        "tracked_events": len(tracked_list),
        "errors": errors,
        "duration_s": round(time.time() - started, 1),
    })
    save_json(runlog_path, {"runs": runs[-200:]})

    print(json.dumps({
        "ok": not errors,
        "generated_at": snapshot["generated_at"],
        "events_scanned": len(open_events),
        "matched": {t: snapshot_topics[t]["open_events_matched"] for t in TOPICS},
        "top_event_sample": {t: (snapshot_topics[t]["top_events"][0]["title"] if snapshot_topics[t]["top_events"] else None) for t in TOPICS},
        "errors": errors,
    }, indent=2))
    return 0 if snapshot_topics.get("gas", {}).get("top_events") or snapshot_topics.get("crypto", {}).get("top_events") else 1


if __name__ == "__main__":
    sys.exit(main())
