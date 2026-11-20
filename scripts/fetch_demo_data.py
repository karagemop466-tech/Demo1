#!/usr/bin/env python3
"""
Kalshi demo data ingestion for the Demo1 dashboard.

Every value written by this script comes from an official Kalshi demo Trade API
response. Nothing is estimated, interpolated or invented. When an endpoint
fails, the failure is recorded in data/meta.json and the affected section is
simply left empty on the site.

Official endpoints used (all unauthenticated / public):
  GET {base}/exchange/status
  GET {base}/series
  GET {base}/markets?status=open
  GET {base}/markets?status=closed
  GET {base}/events
  GET {base}/markets/{ticker}/orderbook
  GET {base}/markets/trades?ticker={ticker}
  GET {base}/series/{series_ticker}/markets/{ticker}/candlesticks

Usage:
  python3 scripts/fetch_demo_data.py [--base URL] [--out data] [--max-pages N]
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
# Topic rules.
#
# A market is only shown under a topic when one of these rules fires. Each rule
# records *why* the market was classified so the site can show the evidence.
# Rules are matched against official series metadata (category / tags / title),
# event titles and market titles returned by the API.
# ---------------------------------------------------------------------------

TOPICS = {
    "gas": {
        "label": "Gas prices",
        "categories": [],
        "tags": ["gas", "gasoline", "fuel", "crude oil", "oil", "energy", "petroleum", "diesel"],
        "title_terms": [
            "gas price", "gasoline", "natural gas", "crude oil", "oil price", "fuel price",
            "heating oil", "diesel", "pump price", "gas prices", "gasoline price",
            "retail gasoline", "wti", "brent",
        ],
        "ticker_patterns": [r"GASPRICE", r"GASOLINE", r"NATGAS", r"CRUDEOIL", r"OILPRICE",
                            r"FUELPRICE", r"DIESEL", r"HEATINGOIL", r"KXGAS"],
    },
    "elections": {
        "label": "Elections",
        "categories": ["Politics"],
        "tags": ["elections", "election", "politics", "elections & political"],
        "title_terms": [
            "election", "president", "senate", "governor", "congress", "house of representatives",
            "primary", "nominee", "parliament", "ballot", "electoral", "vote share",
            "speaker of the house", "candidate", "campaign trail", "midterms", "midterm",
            "republican nominee", "democratic nominee", "prime minister", "referendum",
        ],
        "ticker_patterns": [r"ELECTION", r"PRESIDENT", r"SENATE", r"GOVERNOR", r"CONGRESS",
                            r"PRIMARY", r"NOMINEE", r"PARLIAMENT", r"PRES", r"SPEAKER",
                            r"BALLOT", r"POLL", r"VOTE", r"HOTECONTROL"],
    },
    "culture": {
        "label": "Culture",
        "categories": ["Culture", "Entertainment", "Arts"],
        "tags": ["movies", "music", "tv", "television", "books", "celebrity", "awards", "streaming",
                 "music charts", "film", "entertainment", "art", "comedy", "gaming"],
        "title_terms": [
            "movie", "film", "album", "music", "grammy", "oscar", "emmy", "netflix", "spotify",
            "billboard", "box office", "rotten tomatoes", "celebrity", "actor", "actress",
            "director", "tv show", "season", "novel", "best picture", "award", "bestseller",
            "spotify", "taylor swift", "beyonce", "kendrick", "olivia rodriguez", "album of the year",
        ],
        "ticker_patterns": [r"OSCAR", r"GRAMMY", r"EMMY", r"MOVIE", r"FILM", r"ALBUM", r"BILLBOARD",
                            r"NUMBERS", r"NETFLIX", r"SPOTIFY", r"BOXOFFICE", r"TOMATOMATO",
                            r"RTACOMPLETE", r"TOPSONG", r"BESTSELLER", r"ACTOR", r"CELEBRITY",
                            r"KULTURE", r"ENTERTAINMENT", r"CELEBRITY"],
    },
    "crypto": {
        "label": "Crypto",
        "categories": ["Crypto", "Cryptocurrency", "Cryptocurrency & Crypto"],
        "tags": ["crypto", "bitcoin", "ethereum", "solana", "digital assets", "crypto price"],
        "title_terms": [
            "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "dogecoin", "doge",
            "crypto", "stablecoin", "litecoin", "cardano", "polkadot", "chainlink", "monero",
            "bitcoin price", "crypto price", "market cap", "halving",
        ],
        "ticker_patterns": [r"KXBTC", r"KXETH", r"BTC", r"ETHEREUM", r"SOLANA", r"CRYPTO",
                            r"KXSOL", r"COIN"],
    },
    "golf": {
        "label": "Golf",
        "categories": [],
        "tags": ["golf", "pga", "lpga", "golfers", "golf tour"],
        "title_terms": [
            "golf", "pga", "lpga", "masters", "ryder cup", "us open", "the open championship",
            "wimbledon golf", "world golf", "golfers",
        ],
        "ticker_patterns": [r"GOLF", r"PGA", r"LPGA", r"MASTERS", r"RYDER", r"USOPEN",
                            r"KXPGATOUR"],
    },
}


def norm(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Client:
    """Tiny stdlib HTTP client with retries; records every request for provenance."""

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
                        "url": url,
                        "status": resp.status,
                        "bytes": len(body),
                        "fetched_at": now_iso(),
                        "cors_allow_origin": resp.headers.get("Access-Control-Allow-Origin"),
                    })
                    try:
                        return json.loads(body), resp.headers
                    except json.JSONDecodeError as exc:
                        last_err = f"invalid json: {exc}"
            except urllib.error.HTTPError as exc:  # noqa: PERF203
                detail = ""
                try:
                    detail = exc.read().decode("utf-8", "replace")[:400]
                except Exception:  # pragma: no cover - defensive
                    pass
                last_err = f"HTTP {exc.code}: {detail}"
                self.requests.append({"url": url, "status": exc.code, "error": last_err,
                                      "fetched_at": now_iso()})
                if exc.code in (400, 404, 422):
                    break
            except Exception as exc:  # network/DNS/timeout
                last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"GET {url} failed -> {last_err}")

    def paginate(self, path: str, params: dict, key: str, max_pages: int = 60,
                 max_items: int = 250000):
        """Cursor pagination. Stops on a repeated cursor, an empty page or a
        page that clearly ignored the requested limit."""
        items: list = []
        cursor = None
        pages = 0
        seen_cursors: set[str] = set()
        while pages < max_pages:
            page_params = dict(params)
            if cursor:
                page_params["cursor"] = cursor
            data, _ = self.get(path, page_params)
            pages += 1
            batch = data.get(key) or []
            items.extend(batch)
            new_cursor = data.get("cursor") or ""
            if not batch or not new_cursor or new_cursor in seen_cursors:
                break
            if len(batch) > 5000:
                # The endpoint ignored `limit`; one page already holds everything.
                break
            if len(items) >= max_items:
                break
            seen_cursors.add(new_cursor)
            cursor = new_cursor
        return items, pages


def classify_series(series: dict) -> dict:
    """Return {topic: reason} for a series record."""
    ticker = str(series.get("ticker", ""))
    title = norm(series.get("title"))
    category = norm(series.get("category"))
    categories = [norm(c) for c in (series.get("categories") or [])]
    tags = [norm(t) for t in (series.get("tags") or [])]
    hay_category = " ".join([category] + categories)
    hay_tags = " ".join(tags)
    hay_title = title
    out: dict[str, str] = {}
    for topic, rule in TOPICS.items():
        reason = None
        if rule["categories"] and hay_category and any(c in hay_category for c in rule["categories"]):
            reason = f'series category "{series.get("category")}"'
        elif rule["tags"] and hay_tags and any(t and t in hay_tags for t in rule["tags"]):
            hit = next(t for t in rule["tags"] if t and t in hay_tags)
            reason = f'series tag "{hit}"'
        elif any(term in hay_title for term in rule["title_terms"]):
            hit = next(term for term in rule["title_terms"] if term in hay_title)
            reason = f'series title contains "{hit}"'
        elif any(re.search(pat, ticker) for pat in rule["ticker_patterns"]):
            hit = next(pat for pat in rule["ticker_patterns"] if re.search(pat, ticker))
            reason = f"series ticker matches /{hit}/"
        if reason and topic not in out:
            out[topic] = reason
    return out


def classify_market(market: dict, series_meta: dict) -> dict:
    """Classify a market using its series metadata, then event/market text."""
    series = series_meta.get(str(market.get("series_ticker", "")), {})
    hits = classify_series(series) if series else {}

    m_title = norm(market.get("title"))
    m_ticker = str(market.get("ticker", ""))
    e_title = norm(market.get("event_title"))
    hay = " ".join(x for x in (m_title, e_title) if x)

    for topic, rule in TOPICS.items():
        if topic in hits:
            continue
        if any(term in hay for term in rule["title_terms"]):
            hit = next(term for term in rule["title_terms"] if term in hay)
            hits[topic] = f'market/event title contains "{hit}"'
            continue
        if any(re.search(pat, m_ticker) for pat in rule["ticker_patterns"]):
            hit = next(pat for pat in rule["ticker_patterns"] if re.search(pat, m_ticker))
            hits[topic] = f"market ticker matches /{hit}/"
    return hits


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("KALSHI_DEMO_BASE", DEFAULT_BASE))
    ap.add_argument("--out", default="data")
    ap.add_argument("--max-pages", type=int, default=60)
    ap.add_argument("--origin", default="https://karagemop466-tech.github.io")
    ap.add_argument("--candles-top", type=int, default=6, help="markets per topic with candles")
    ap.add_argument("--orderbook-top", type=int, default=10, help="markets per topic with order books")
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out)
    candles_dir = os.path.join(out_dir, "candles")
    os.makedirs(candles_dir, exist_ok=True)

    client = Client(args.base)
    errors: list[dict] = []
    started = now_iso()

    def record(label, fn):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - record and continue
            errors.append({"step": label, "error": str(exc)[:500]})
            print(f"!! {label} failed: {exc}", file=sys.stderr)
            return None

    # 1. exchange status -----------------------------------------------------
    status = record("exchange/status", lambda: client.get("/exchange/status")[0])

    # 2. CORS probe ----------------------------------------------------------
    cors = record("cors-probe", lambda: client.get(
        "/markets", {"status": "open", "limit": 1}, origin=args.origin)[1])
    cors_info = {
        "origin_tested": args.origin,
        "access_control_allow_origin": (cors.get("Access-Control-Allow-Origin") if cors else None),
        "access_control_allow_methods": (cors.get("Access-Control-Allow-Methods") if cors else None),
        "access_control_allow_headers": (cors.get("Access-Control-Allow-Headers") if cors else None),
        "checked_at": now_iso(),
        "method": "HTTP GET with Origin header, response headers read from the official demo API",
    }

    # 3. series --------------------------------------------------------------
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
            "settlement_sources": s.get("settlement_sources") or [],
            "source": f"{args.base}/series",
        }

    # 4. markets (open + closed) --------------------------------------------
    open_markets, open_pages = record("markets/open", lambda: client.paginate(
        "/markets", {"status": "open", "limit": 1000}, "markets", args.max_pages)) or ([], 0)
    closed_markets, closed_pages = record("markets/closed", lambda: client.paginate(
        "/markets", {"status": "closed", "limit": 1000}, "markets",
        min(args.max_pages, 20))) or ([], 0)
    all_markets = list(open_markets) + list(closed_markets)

    # 5. events --------------------------------------------------------------
    events, event_pages = record("events", lambda: client.paginate(
        "/events", {"limit": 1000, "with_nested_markets": "false"}, "events", args.max_pages)) or ([], 0)
    event_by_ticker: dict[str, dict] = {}
    for ev in events:
        tick = str(ev.get("event_ticker", ""))
        if tick:
            event_by_ticker[tick] = {
                "event_ticker": tick,
                "title": ev.get("title", ""),
                "category": ev.get("category", ""),
                "status": ev.get("status", ""),
                "volume_fp": ev.get("volume_fp"),
                "open_interest_fp": ev.get("open_interest_fp"),
                "notional_value_dollars": ev.get("notional_value_dollars"),
                "close_time": ev.get("close_time"),
                "source": f"{args.base}/events",
            }

    # 6. classify ------------------------------------------------------------
    topic_markets: list[dict] = []
    counts_by_topic: dict[str, int] = {t: 0 for t in TOPICS}
    unmatched_sample: list[str] = []
    for m in all_markets:
        m = dict(m)
        ev = event_by_ticker.get(str(m.get("event_ticker", "")), {})
        m["event_title"] = ev.get("title", "")
        hits = classify_market(m, series_meta)
        if not hits:
            if len(unmatched_sample) < 15:
                unmatched_sample.append(f"{m.get('ticker','')} | {m.get('title','')[:70]}")
            continue
        topic = sorted(hits.keys())[0]
        notional = to_float(m.get("notional_value_dollars"))
        volume = to_float(m.get("volume_fp"))
        oi = to_float(m.get("open_interest_fp"))
        traded_notional = None
        if volume is not None and notional is not None:
            traded_notional = round(volume * notional, 4)
        open_exposure = None
        if oi is not None and notional is not None:
            open_exposure = round(oi * notional, 4)
        last_price = to_float(m.get("last_price_dollars"))
        yes_bid = to_float(m.get("yes_bid_dollars"))
        yes_ask = to_float(m.get("yes_ask_dollars"))
        ser = series_meta.get(str(m.get("series_ticker", "")), {})
        m_out = {
            "ticker": m.get("ticker"),
            "event_ticker": m.get("event_ticker"),
            "series_ticker": m.get("series_ticker"),
            "title": m.get("title"),
            "sub_title": m.get("yes_sub_title") or m.get("sub_title") or "",
            "event_title": ev.get("title", ""),
            "status": m.get("status"),
            "result": m.get("result"),
            "close_time": m.get("close_time"),
            "expected_expiration_time": m.get("expected_expiration_time"),
            "updated_time": m.get("updated_time"),
            "volume_fp": m.get("volume_fp"),
            "volume_24h_fp": m.get("volume_24h_fp"),
            "open_interest_fp": m.get("open_interest_fp"),
            "notional_value_dollars": m.get("notional_value_dollars"),
            "last_price_dollars": m.get("last_price_dollars"),
            "yes_bid_dollars": m.get("yes_bid_dollars"),
            "yes_ask_dollars": m.get("yes_ask_dollars"),
            "no_bid_dollars": m.get("no_bid_dollars"),
            "no_ask_dollars": m.get("no_ask_dollars"),
            "yes_bid_size_fp": m.get("yes_bid_size_fp"),
            "yes_ask_size_fp": m.get("yes_ask_size_fp"),
            "topic": topic,
            "topic_reason": hits[topic],
            "all_topics": sorted(hits.keys()),
            "series_title": ser.get("title", ""),
            "series_category": ser.get("category", ""),
            "series_tags": ser.get("tags", []),
            "traded_notional_usd": traded_notional,
            "open_exposure_usd": open_exposure,
            "market_url": f"https://kalshi.com/markets/{m.get('event_ticker') or m.get('ticker')}",
            "source_markets": f"{args.base}/markets?status=open|closed",
            "source_series": f"{args.base}/series" if ser else None,
            "source_event": ev.get("source"),
        }
        topic_markets.append(m_out)
        counts_by_topic[topic] += 1

    # 7. order books + candlesticks for the largest markets per topic ---------
    def sort_key(m):
        return (m.get("traded_notional_usd") or 0, m.get("open_exposure_usd") or 0)

    by_topic: dict[str, list[dict]] = {t: [] for t in TOPICS}
    for m in topic_markets:
        by_topic.setdefault(m["topic"], []).append(m)

    book_targets: list[dict] = []
    candle_targets: list[dict] = []
    for topic, items in by_topic.items():
        items.sort(key=sort_key, reverse=True)
        book_targets.extend(items[: args.orderbook_top])
        candle_targets.extend(items[: args.candles_top])

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
        yes_dollars = sum(to_float(p) * to_float(q) for p, q in yes if to_float(p) is not None and to_float(q) is not None)
        no_dollars = sum(to_float(p) * to_float(q) for p, q in no if to_float(p) is not None and to_float(q) is not None)
        orderbooks[ticker] = {
            "ticker": ticker,
            "title": m.get("title"),
            "topic": m.get("topic"),
            "yes_bids": yes,
            "no_bids": no,
            "yes_bid_depth_usd": round(yes_dollars, 4),
            "no_bid_depth_usd": round(no_dollars, 4),
            "fetched_at": now_iso(),
            "source": f"{args.base}/markets/{ticker}/orderbook",
            "note": "Order book returns bids only; the implied ask is 1 - best opposite bid.",
        }

    now_ts = int(time.time())
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
        raw = data.get("candlesticks") or []
        points = []
        for c in raw:
            ts = c.get("end_period_ts")
            close = (c.get("price") or {}).get("close_dollars")
            bid = (c.get("yes_bid") or {}).get("close_dollars")
            ask = (c.get("yes_ask") or {}).get("close_dollars")
            points.append([ts, close, bid, ask, c.get("volume_fp"), c.get("open_interest_fp")])
        payload = {
            "ticker": ticker,
            "title": m.get("title"),
            "topic": m.get("topic"),
            "period_interval_minutes": 1,
            "start_ts": now_ts - window,
            "end_ts": now_ts,
            "point_fields": ["end_period_ts", "price.close_dollars", "yes_bid.close_dollars",
                             "yes_ask.close_dollars", "volume_fp", "open_interest_fp"],
            "points": points,
            "fetched_at": now_iso(),
            "source": f"{args.base}{path}?start_ts={now_ts - window}&end_ts={now_ts}&period_interval=1",
        }
        with open(os.path.join(candles_dir, f"{ticker}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"))
        candle_index.append({"ticker": ticker, "topic": m.get("topic"),
                             "points": len(points), "file": f"candles/{ticker}.json"})

    # 8. write files ---------------------------------------------------------
    def write(name, obj):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=1, sort_keys=False)
        return path

    write("meta.json", {
        "generated_at": started,
        "completed_at": now_iso(),
        "base_url": args.base,
        "environment": "demo",
        "public_endpoints_used": [
            f"{args.base}/exchange/status",
            f"{args.base}/series",
            f"{args.base}/markets?status=open",
            f"{args.base}/markets?status=closed",
            f"{args.base}/events",
            f"{args.base}/markets/{{ticker}}/orderbook",
            f"{args.base}/series/{{series}}/markets/{{ticker}}/candlesticks",
        ],
        "counts": {
            "series_returned": len(series_meta),
            "markets_returned": len(all_markets),
            "open_markets_returned": len(open_markets),
            "closed_markets_returned": len(closed_markets),
            "events_returned": len(event_by_ticker),
            "topic_markets": len(topic_markets),
            "topic_counts": counts_by_topic,
            "orderbooks": len(orderbooks),
            "candle_series": len(candle_index),
        },
        "pagination_pages": {"series": series_pages, "markets_open": open_pages,
                             "markets_closed": closed_pages, "events": event_pages},
        "errors": errors,
        "requests": client.requests,
        "unmatched_topic_sample": unmatched_sample,
    })
    write("series.json", {"base_url": args.base, "fetched_at": now_iso(),
                          "source": f"{args.base}/series",
                          "series": sorted(series_meta.values(), key=lambda s: s["ticker"])})
    write("markets.json", {"base_url": args.base, "fetched_at": now_iso(),
                           "source": f"{args.base}/markets",
                           "counts": counts_by_topic,
                           "markets": topic_markets})
    write("events.json", {"base_url": args.base, "fetched_at": now_iso(),
                          "source": f"{args.base}/events",
                          "events": sorted(event_by_ticker.values(), key=lambda e: e["event_ticker"])})
    write("orderbooks.json", {"base_url": args.base, "fetched_at": now_iso(),
                               "source": f"{args.base}/markets/{{ticker}}/orderbook",
                               "orderbooks": orderbooks})
    write("candles.json", {"base_url": args.base, "fetched_at": now_iso(),
                           "source": f"{args.base}/series/{{series}}/markets/{{ticker}}/candlesticks",
                           "series": candle_index})
    write("cors.json", cors_info)

    print(json.dumps({
        "series": len(series_meta),
        "markets_total": len(all_markets),
        "topic_markets": len(topic_markets),
        "topic_counts": counts_by_topic,
        "orderbooks": len(orderbooks),
        "candles": len(candle_index),
        "errors": len(errors),
        "cors_allow_origin": cors_info.get("access_control_allow_origin"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
