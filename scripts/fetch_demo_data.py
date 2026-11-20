#!/usr/bin/env python3
"""
Kalshi demo data ingestion for the Demo1 dashboard.

Every value written by this script is copied from an official Kalshi demo Trade
API response. Nothing is estimated, interpolated or invented. When an endpoint
fails, the failure is recorded in data/meta.json and the affected section is
left empty on the site.

Official endpoints used (all public / unauthenticated):
  GET {base}/exchange/status
  GET {base}/series
  GET {base}/markets?status=open
  GET {base}/markets?status=settled
  GET {base}/events?series_ticker={series}
  GET {base}/markets/{ticker}/orderbook
  GET {base}/markets/trades?ticker={ticker}
  GET {base}/series/{series_ticker}/markets/{ticker}/candlesticks

Topic classification is driven by Kalshi's own series taxonomy (the `category`
and `tags` fields returned by GET /series), not by free-text guessing. Each
classified row records the exact taxonomy value that classified it.

Usage:
  python3 scripts/fetch_demo_data.py [--base URL] [--out data]
"""

from __future__ import annotations

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

DEFAULT_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
USER_AGENT = "Demo1-Kalshi-Dashboard/1.0 (+GitHub Actions; public market data only)"

# ---------------------------------------------------------------------------
# Topic rules, built from the taxonomy values Kalshi itself returns in
# GET /series (`category` and `tags`). The first matching rule wins and the
# matched taxonomy value is stored on the row as `topic_reason`.
# ---------------------------------------------------------------------------

CATEGORY_RULES = {
    "gas": {"Economics", "Commodities"},
    "elections": {"Elections"},
    "culture": {"Entertainment", "Culture", "Arts"},
    "crypto": {"Crypto", "Cryptocurrency"},
    "golf": set(),
}

TAG_RULES = {
    "gas": {"oil and energy", "oil & gas"},
    "elections": {"us elections", "international elections", "foreign elections",
                  "other us elections", "election combos"},
    "culture": {"movies", "music", "television", "awards", "grammys", "oscars",
                "rotten tomatoes", "music charts", "art", "books", "video games"},
    "crypto": {"crypto", "btc", "eth", "solana", "xrp", "doge"},
    "golf": {"golf"},
}

# Title fallbacks use word-boundary regexes so that short tokens (for example
# "eth") cannot match inside unrelated words.
TITLE_RULES = {
    "gas": [r"\bgas prices?\b", r"\bgasoline\b", r"\bdiesel\b", r"\bnatural gas\b",
            r"\bcrude oil\b", r"\boil price\b", r"\bfuel price\b", r"\bheating oil\b",
            r"\bwti\b", r"\bbrent\b", r"\bgasoline price\b"],
    "elections": [r"\belection", r"\bprimary\b", r"\bnominee\b", r"\bballot\b",
                  r"\belectoral\b", r"\breferendum\b", r"\bcandidate\b", r"\bvote share\b"],
    "culture": [r"\bmovie\b", r"\bfilm\b", r"\balbum\b", r"\bgrammy\b", r"\boscar\b",
                r"\bemmy\b", r"\bnetflix\b", r"\bspotify\b", r"\bbillboard\b",
                r"\bbox office\b", r"\bcelebrity\b", r"\bbest picture\b"],
    "crypto": [r"\bbitcoin\b", r"\bbtc\b", r"\bethereum\b", r"\beth\b", r"\bsolana\b",
               r"\bxrp\b", r"\bdogecoin\b", r"\bcrypto\b", r"\bhalving\b"],
    "golf": [r"\bgolf\b", r"\bpga\b", r"\blpga\b", r"\bryder cup\b", r"\bmasters\b"],
}

TOPIC_ORDER = ["gas", "elections", "culture", "crypto", "golf"]


def norm(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


class Client:
    """Small stdlib HTTP client with retries that records every request."""

    def __init__(self, base: str, timeout: int = 45, retries: int = 3):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self.requests: list[dict] = []

    def get(self, path: str, params: dict | None = None, origin: str | None = None):
        url = self.base + path
        if params:
            clean = {k: v for k, v in params.items() if v is not None and v != ""}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if origin:
            headers["Origin"] = origin
        last_err = None
        for attempt in range(1, self.retries + 1):
            req = urllib.request.Request(url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read().decode("utf-8", "replace")
                    self.requests.append({
                        "url": url, "status": resp.status, "bytes": len(body),
                        "fetched_at": now_iso(),
                        "cors_allow_origin": resp.headers.get("Access-Control-Allow-Origin"),
                    })
                    try:
                        return json.loads(body), resp.headers
                    except json.JSONDecodeError as exc:
                        last_err = f"invalid json: {exc}"
            except urllib.error.HTTPError as exc:
                detail = ""
                try:
                    detail = exc.read().decode("utf-8", "replace")[:300]
                except Exception:  # pragma: no cover
                    pass
                last_err = f"HTTP {exc.code}: {detail}"
                self.requests.append({"url": url, "status": exc.code, "error": last_err,
                                      "fetched_at": now_iso()})
                if exc.code in (400, 404, 422):
                    break
            except Exception as exc:  # network / DNS / timeout
                last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"GET {url} failed -> {last_err}")

    def paginate(self, path: str, params: dict, key: str, max_pages: int = 60,
                 max_items: int = 400000):
        """Cursor pagination with guards for endpoints that ignore `limit`."""
        items: list = []
        cursor = None
        pages = 0
        seen: set[str] = set()
        while pages < max_pages:
            page_params = dict(params)
            if cursor:
                page_params["cursor"] = cursor
            data, _ = self.get(path, page_params)
            pages += 1
            batch = data.get(key) or []
            items.extend(batch)
            new_cursor = data.get("cursor") or ""
            if not batch or not new_cursor or new_cursor in seen:
                break
            if len(batch) > 5000:
                break
            if len(items) >= max_items:
                break
            seen.add(new_cursor)
            cursor = new_cursor
        return items, pages


class SeriesIndex:
    """Maps a market ticker to its Kalshi series ticker.

    Kalshi market tickers are built as <SERIES>-<...>. The longest prefix that
    matches a known series ticker wins; the 'KX' prefix is optional in the
    Kalshi series catalogue, so the prefixed and unprefixed forms are both
    tried. Matches are validated against GET /series, never guessed.
    """

    def __init__(self, series: dict):
        self.by_ticker = series
        self._cache: dict[str, str | None] = {}

    def lookup(self, market_ticker: str):
        if market_ticker in self._cache:
            return self._cache[market_ticker]
        parts = market_ticker.split("-")
        found = None
        for k in range(len(parts), 0, -1):
            candidate = "-".join(parts[:k])
            variants = [candidate]
            if candidate.startswith("KX"):
                variants.append(candidate[2:])
            else:
                variants.append("KX" + candidate)
            for variant in variants:
                if variant in self.by_ticker:
                    found = variant
                    break
            if found:
                break
        self._cache[market_ticker] = found
        return found


def classify_series(series: dict) -> dict:
    """Return {topic: reason} using Kalshi's own category/tag taxonomy."""
    out: dict[str, str] = {}
    category = norm(series.get("category"))
    tags = [norm(t) for t in (series.get("tags") or [])]
    title = str(series.get("title") or "")
    for topic in TOPIC_ORDER:
        reason = None
        if category and category in CATEGORY_RULES[topic]:
            reason = f'series category "{series.get("category")}"'
        else:
            hit = next((t for t in tags if t in TAG_RULES[topic]), None)
            if hit:
                reason = f'series tag "{hit}"'
            else:
                hit = next((p for p in TITLE_RULES[topic]
                            if re.search(p, title, re.IGNORECASE)), None)
                if hit:
                    reason = f'series title matches /{hit}/'
        if reason:
            out[topic] = reason
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("KALSHI_DEMO_BASE", DEFAULT_BASE))
    ap.add_argument("--out", default="data")
    ap.add_argument("--max-pages", type=int, default=80)
    ap.add_argument("--settled-pages", type=int, default=30)
    ap.add_argument("--origin", default="https://karagemop466-tech.github.io")
    ap.add_argument("--keep-open", type=int, default=300, help="open markets kept per topic")
    ap.add_argument("--keep-settled", type=int, default=200, help="settled markets kept per topic")
    ap.add_argument("--orderbook-top", type=int, default=8, help="markets per topic with order books")
    ap.add_argument("--candles-top", type=int, default=4, help="markets per topic with candles")
    ap.add_argument("--trades-top", type=int, default=4, help="markets per topic with trade ticks")
    ap.add_argument("--event-series-top", type=int, default=25, help="series per topic to enrich with events")
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out)
    candles_dir = os.path.join(out_dir, "candles")
    trades_dir = os.path.join(out_dir, "trades")
    os.makedirs(candles_dir, exist_ok=True)
    os.makedirs(trades_dir, exist_ok=True)

    client = Client(args.base)
    errors: list[dict] = []
    started = now_iso()

    def record(label, fn):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - record and continue
            errors.append({"step": label, "error": str(exc)[:400]})
            print(f"!! {label} failed: {exc}", file=sys.stderr)
            return None

    # 1. exchange status -----------------------------------------------------
    status = record("exchange/status", lambda: client.get("/exchange/status")[0])

    # 2. CORS probe ----------------------------------------------------------
    cors_headers = record("cors-probe", lambda: client.get(
        "/markets", {"status": "open", "limit": 1}, origin=args.origin)[1])
    cors_info = {
        "origin_tested": args.origin,
        "access_control_allow_origin": cors_headers.get("Access-Control-Allow-Origin") if cors_headers else None,
        "access_control_allow_methods": cors_headers.get("Access-Control-Allow-Methods") if cors_headers else None,
        "access_control_allow_headers": cors_headers.get("Access-Control-Allow-Headers") if cors_headers else None,
        "checked_at": now_iso(),
        "method": "HTTP GET with an Origin header; response headers read from the official demo API",
    }

    # 3. series catalogue ----------------------------------------------------
    series_raw, series_pages = record("series", lambda: client.paginate(
        "/series", {"limit": 200}, "series", args.max_pages)) or ([], 0)
    series_meta: dict[str, dict] = {}
    for s in series_raw:
        tick = str(s.get("ticker", ""))
        if not tick:
            continue
        series_meta[tick] = {
            "ticker": tick,
            "title": s.get("title", ""),
            "category": s.get("category", ""),
            "categories": s.get("categories") or [],
            "tags": s.get("tags") or [],
            "frequency": s.get("frequency", ""),
            "settlement_sources": [
                {"name": x.get("name", ""), "url": x.get("url", "")}
                for x in (s.get("settlement_sources") or [])
            ],
            "topics": classify_series(s),
            "source": f"{args.base}/series",
        }
    index = SeriesIndex(series_meta)

    # 4. markets (open + settled) --------------------------------------------
    open_markets, open_pages = record("markets/open", lambda: client.paginate(
        "/markets", {"status": "open", "limit": 1000}, "markets", args.max_pages)) or ([], 0)
    settled_markets, settled_pages = record("markets/settled", lambda: client.paginate(
        "/markets", {"status": "settled", "limit": 1000}, "markets", args.settled_pages)) or ([], 0)

    def build_rows(raw_markets, status_label):
        rows = []
        mapped = 0
        for m in raw_markets:
            ticker = str(m.get("ticker", ""))
            if not ticker:
                continue
            series_ticker = index.lookup(ticker)
            if series_ticker:
                mapped += 1
            series = series_meta.get(series_ticker or "", {})
            topics = series.get("topics") or {}
            if not topics:
                continue
            topic = next((t for t in TOPIC_ORDER if t in topics), None)
            if topic is None:
                continue
            notional = to_float(m.get("notional_value_dollars"))
            volume = to_float(m.get("volume_fp"))
            oi = to_float(m.get("open_interest_fp"))
            traded = round(volume * notional, 2) if (volume is not None and notional is not None) else None
            exposure = round(oi * notional, 2) if (oi is not None and notional is not None) else None
            rows.append({
                "ticker": ticker,
                "event_ticker": m.get("event_ticker"),
                "series_ticker": series_ticker,
                "title": m.get("title"),
                "sub_title": m.get("yes_sub_title") or m.get("no_sub_title") or "",
                "status": m.get("status"),
                "result": m.get("result"),
                "close_time": m.get("close_time"),
                "settlement_ts": m.get("settlement_ts"),
                "updated_time": m.get("updated_time"),
                "volume_fp": m.get("volume_fp"),
                "volume_24h_fp": m.get("volume_24h_fp"),
                "open_interest_fp": m.get("open_interest_fp"),
                "notional_value_dollars": m.get("notional_value_dollars"),
                "last_price_dollars": m.get("last_price_dollars"),
                "yes_bid_dollars": m.get("yes_bid_dollars"),
                "yes_ask_dollars": m.get("yes_ask_dollars"),
                "yes_bid_size_fp": m.get("yes_bid_size_fp"),
                "yes_ask_size_fp": m.get("yes_ask_size_fp"),
                "traded_notional_usd": traded,
                "open_exposure_usd": exposure,
                "topic": topic,
                "topic_reason": topics[topic],
                "all_topics": sorted(topics.keys()),
                "series_title": series.get("title", ""),
                "series_category": series.get("category", ""),
                "series_tags": series.get("tags", []),
                "settlement_sources": series.get("settlement_sources", []),
                "rules_primary": m.get("rules_primary") or "",
                "market_url": f"https://kalshi.com/markets/{m.get('event_ticker') or ticker}",
                "source_market": (f"{args.base}/markets?status={status_label}&limit=1000"
                                  f"&series_ticker={series_ticker}" if series_ticker
                                  else f"{args.base}/markets?status={status_label}"),
                "source_series": f"{args.base}/series" if series_ticker else None,
                "source_single_market": f"{args.base}/markets/{ticker}",
            })
        return rows, mapped

    open_rows, open_mapped = build_rows(open_markets, "open")
    settled_rows, settled_mapped = build_rows(settled_markets, "settled")

    def rank(rows):
        return sorted(rows, key=lambda r: (r.get("traded_notional_usd") or 0,
                                           r.get("open_exposure_usd") or 0), reverse=True)

    open_rows = rank(open_rows)
    settled_rows = rank(settled_rows)

    kept_open, kept_settled = [], []
    per_topic_counts = {}
    for topic in TOPIC_ORDER:
        o = [r for r in open_rows if r["topic"] == topic][: args.keep_open]
        s = [r for r in settled_rows if r["topic"] == topic][: args.keep_settled]
        kept_open.extend(o)
        kept_settled.extend(s)
        per_topic_counts[topic] = {
            "open_total": sum(1 for r in open_rows if r["topic"] == topic),
            "settled_total": sum(1 for r in settled_rows if r["topic"] == topic),
            "open_kept": len(o),
            "settled_kept": len(s),
        }

    all_kept = kept_open + kept_settled

    # 5. order books ---------------------------------------------------------
    def top_by_topic(rows, n):
        picked = []
        for topic in TOPIC_ORDER:
            picked.extend([r for r in rows if r["topic"] == topic][:n])
        return picked

    book_targets = top_by_topic(kept_open, args.orderbook_top)
    orderbooks: dict[str, dict] = {}
    for m in book_targets:
        ticker = m.get("ticker")
        if not ticker:
            continue
        data = record(f"orderbook/{ticker}", lambda t=ticker: client.get(f"/markets/{t}/orderbook")[0])
        if not data:
            continue
        book = data.get("orderbook_fp") or data.get("orderbook") or {}
        yes = [[str(p), str(q)] for p, q in (book.get("yes_dollars") or [])]
        no = [[str(p), str(q)] for p, q in (book.get("no_dollars") or [])]
        depth = lambda levels: round(sum((to_float(p) or 0) * (to_float(q) or 0) for p, q in levels), 2)
        best_yes_bid = to_float(yes[-1][0]) if yes else None
        best_no_bid = to_float(no[-1][0]) if no else None
        orderbooks[ticker] = {
            "ticker": ticker,
            "title": m.get("title"),
            "topic": m.get("topic"),
            "yes_bids": yes,
            "no_bids": no,
            "yes_bid_depth_usd": depth(yes),
            "no_bid_depth_usd": depth(no),
            "best_yes_bid_dollars": best_yes_bid,
            "best_no_bid_dollars": best_no_bid,
            "implied_yes_ask_dollars": (round(1 - best_no_bid, 4) if best_no_bid is not None else None),
            "implied_no_ask_dollars": (round(1 - best_yes_bid, 4) if best_yes_bid is not None else None),
            "fetched_at": now_iso(),
            "source": f"{args.base}/markets/{ticker}/orderbook",
            "note": "Kalshi returns bids only; the implied ask is 1 - best opposite bid "
                    "(https://docs.kalshi.com/getting_started/orderbook_responses).",
        }

    # 6. candlesticks + trade ticks -----------------------------------------
    now_ts = int(time.time())
    candle_targets = top_by_topic(kept_open, args.candles_top)
    candle_index = []
    for m in candle_targets:
        ticker = m.get("ticker")
        series_ticker = m.get("series_ticker")
        if not ticker or not series_ticker:
            continue
        path = f"/series/{series_ticker}/markets/{ticker}/candlesticks"
        window = 6 * 3600
        data = record(f"candles/{ticker}", lambda p=path, s=series_ticker, t=ticker, w=window: client.get(
            p, {"start_ts": now_ts - w, "end_ts": now_ts, "period_interval": 1})[0])
        if not data:
            continue
        points = []
        for c in (data.get("candlesticks") or []):
            points.append([
                c.get("end_period_ts"),
                (c.get("price") or {}).get("close_dollars"),
                (c.get("yes_bid") or {}).get("close_dollars"),
                (c.get("yes_ask") or {}).get("close_dollars"),
                c.get("volume_fp"),
                c.get("open_interest_fp"),
            ])
        with open(os.path.join(candles_dir, f"{ticker}.json"), "w", encoding="utf-8") as fh:
            json.dump({
                "ticker": ticker, "title": m.get("title"), "topic": m.get("topic"),
                "period_interval_minutes": 1,
                "start_ts": now_ts - window, "end_ts": now_ts,
                "point_fields": ["end_period_ts", "price.close_dollars", "yes_bid.close_dollars",
                                 "yes_ask.close_dollars", "volume_fp", "open_interest_fp"],
                "points": points,
                "fetched_at": now_iso(),
                "source": f"{args.base}{path}?start_ts={now_ts - window}&end_ts={now_ts}&period_interval=1",
            }, fh, separators=(",", ":"))
        candle_index.append({"ticker": ticker, "topic": m.get("topic"), "points": len(points),
                             "file": f"candles/{ticker}.json", "source":
                             f"{args.base}{path}?start_ts={now_ts - window}&end_ts={now_ts}&period_interval=1"})

    trade_targets = top_by_topic(kept_open, args.trades_top)
    trade_index = []
    for m in trade_targets:
        ticker = m.get("ticker")
        if not ticker:
            continue
        data = record(f"trades/{ticker}", lambda t=ticker: client.get(
            "/markets/trades", {"ticker": t, "limit": 200})[0])
        if not data:
            continue
        trades = []
        for t in (data.get("trades") or []):
            trades.append([
                t.get("created_time"), t.get("yes_price_dollars"), t.get("count_fp"),
                t.get("taker_outcome_side"), t.get("taker_book_side"),
            ])
        with open(os.path.join(trades_dir, f"{ticker}.json"), "w", encoding="utf-8") as fh:
            json.dump({
                "ticker": ticker, "title": m.get("title"), "topic": m.get("topic"),
                "point_fields": ["created_time", "yes_price_dollars", "count_fp",
                                 "taker_outcome_side", "taker_book_side"],
                "trades": trades,
                "fetched_at": now_iso(),
                "source": f"{args.base}/markets/trades?ticker={ticker}&limit=200",
            }, fh, separators=(",", ":"))
        trade_index.append({"ticker": ticker, "topic": m.get("topic"), "trades": len(trades),
                            "file": f"trades/{ticker}.json",
                            "source": f"{args.base}/markets/trades?ticker={ticker}&limit=200"})

    # 7. event metadata for the largest series per topic ---------------------
    series_topic: dict[str, list[str]] = {}
    for tick, s in series_meta.items():
        for topic in (s.get("topics") or {}):
            series_topic.setdefault(topic, []).append(tick)
    events: dict[str, dict] = {}
    for topic in TOPIC_ORDER:
        # Prefer series that actually have open markets in this topic.
        active = sorted({r["series_ticker"] for r in kept_open if r["topic"] == topic and r["series_ticker"]},
                        key=lambda t: -max((r.get("traded_notional_usd") or 0)
                                           for r in kept_open if r["series_ticker"] == t))
        for st in active[: args.event_series_top]:
            data = record(f"events/{st}", lambda s=st: client.get(
                "/events", {"series_ticker": s, "limit": 20})[0])
            if not data:
                continue
            for ev in (data.get("events") or []):
                et = str(ev.get("event_ticker", ""))
                if not et:
                    continue
                events[et] = {
                    "event_ticker": et,
                    "series_ticker": ev.get("series_ticker"),
                    "title": ev.get("title", ""),
                    "sub_title": ev.get("sub_title", ""),
                    "category": ev.get("category", ""),
                    "settlement_sources": [
                        {"name": x.get("name", ""), "url": x.get("url", "")}
                        for x in (ev.get("settlement_sources") or [])
                    ],
                    "source": f"{args.base}/events?series_ticker={st}&limit=20",
                }
    for row in all_kept:
        ev = events.get(str(row.get("event_ticker") or ""))
        if ev:
            row["event_title"] = ev.get("title", "")
            row["event_source"] = ev.get("source")
            row["event_settlement_sources"] = ev.get("settlement_sources", [])

    # 8. write ---------------------------------------------------------------
    def write(name, obj, compact=False):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8") as fh:
            if compact:
                json.dump(obj, fh, separators=(",", ":"))
            else:
                json.dump(obj, fh, indent=1)
        return path

    topic_series = {}
    for tick, s in series_meta.items():
        if s.get("topics"):
            topic_series[tick] = s

    write("meta.json", {
        "generated_at": started,
        "completed_at": now_iso(),
        "base_url": args.base,
        "environment": "demo",
        "exchange_status": status,
        "public_endpoints_used": [
            f"{args.base}/exchange/status",
            f"{args.base}/series",
            f"{args.base}/markets?status=open",
            f"{args.base}/markets?status=settled",
            f"{args.base}/events?series_ticker={{series}}",
            f"{args.base}/markets/{{ticker}}/orderbook",
            f"{args.base}/markets/trades?ticker={{ticker}}",
            f"{args.base}/series/{{series}}/markets/{{ticker}}/candlesticks",
        ],
        "counts": {
            "series_returned": len(series_meta),
            "markets_open_returned": len(open_markets),
            "markets_settled_returned": len(settled_markets),
            "open_markets_mapped_to_series": open_mapped,
            "settled_markets_mapped_to_series": settled_mapped,
            "topic_markets_open": len(open_rows),
            "topic_markets_settled": len(settled_rows),
            "topic_rows_kept": len(all_kept),
            "per_topic": per_topic_counts,
            "orderbooks": len(orderbooks),
            "candle_series": len(candle_index),
            "trade_series": len(trade_index),
            "events_returned": len(events),
        },
        "pagination_pages": {"series": series_pages, "markets_open": open_pages,
                             "markets_settled": settled_pages},
        "errors": errors,
        "requests": client.requests,
    }, compact=False)

    write("markets.json", {
        "base_url": args.base,
        "environment": "demo",
        "fetched_at": now_iso(),
        "source": f"{args.base}/markets",
        "counting_rules": {
            "traded_notional_usd": "volume_fp x notional_value_dollars",
            "open_exposure_usd": "open_interest_fp x notional_value_dollars",
        },
        "per_topic": per_topic_counts,
        "markets": all_kept,
    }, compact=True)

    write("series.json", {
        "base_url": args.base,
        "fetched_at": now_iso(),
        "source": f"{args.base}/series",
        "series": list(topic_series.values()),
    }, compact=True)

    write("orderbooks.json", {
        "base_url": args.base,
        "fetched_at": now_iso(),
        "source": f"{args.base}/markets/{{ticker}}/orderbook",
        "orderbooks": orderbooks,
    }, compact=True)

    write("candles.json", {
        "base_url": args.base,
        "fetched_at": now_iso(),
        "source": f"{args.base}/series/{{series}}/markets/{{ticker}}/candlesticks",
        "series": candle_index,
    }, compact=True)

    write("trades.json", {
        "base_url": args.base,
        "fetched_at": now_iso(),
        "source": f"{args.base}/markets/trades",
        "series": trade_index,
    }, compact=True)

    write("events.json", {
        "base_url": args.base,
        "fetched_at": now_iso(),
        "source": f"{args.base}/events",
        "events": list(events.values()),
    }, compact=True)

    write("cors.json", cors_info, compact=True)

    print(json.dumps({
        "series": len(series_meta),
        "open_returned": len(open_markets),
        "settled_returned": len(settled_markets),
        "topic_open": len(open_rows),
        "topic_settled": len(settled_rows),
        "kept_rows": len(all_kept),
        "per_topic": {t: per_topic_counts[t]["open_total"] for t in TOPIC_ORDER},
        "orderbooks": len(orderbooks),
        "candles": len(candle_index),
        "trades": len(trade_index),
        "events": len(events),
        "errors": len(errors),
        "cors_allow_origin": cors_info.get("access_control_allow_origin"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
