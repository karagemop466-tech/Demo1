#!/usr/bin/env python3
"""Collect official Kalshi demo data specified for the desk, on a GitHub runner.

Why a runner: this repo's agent sandboxes cannot reach kalshi.co (egress allowlist),
GitHub-hosted runners can. Every number this script writes carries the exact request
URL that produced it; anything the API does not return stays null.

Endpoints used (all PUBLIC, no credentials):
  GET /exchange/status
  GET /markets?status=open&limit=1000 (+cursor)      open markets, all categories
  GET /markets?status=settled&limit=1000 (+cursor)   finalised markets (result set)
  GET /markets?status=closed&limit=1000 (+cursor)    closed, awaiting determination
  GET /markets/{ticker}                              single-market refresh (watch list)
  GET /markets/{ticker}/orderbook                    bids only (see docs)
  GET /markets/trades?ticker=...[&min_ts&max_ts&cursor&limit]
  GET /series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=1|60|1440

Official references (fetched 2026-11-20):
  https://docs.kalshi.com/getting_started/api_environments
  https://docs.kalshi.com/getting_started/demo_env
  https://docs.kalshi.com/getting_started/market_lifecycle
  https://docs.kalshi.com/getting_started/orderbook_responses
  https://docs.kalshi.com/api-reference/market/get-markets
  https://docs.kalshi.com/api-reference/market/get-market-orderbook
  https://docs.kalshi.com/api-reference/market/get-market-candlesticks   (1/60/1440 min, <=5000 periods)
  https://docs.kalshi.com/api-reference/market/get-trades
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
UA = "kalshi-desk/1.0 (+github.com/karagemop466-tech/Demo1; public demo market data only)"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "desk" / "data"

TOPIC_RULES = {
    "gas_prices": {
        "label": "Gas prices",
        "slug": "gas-prices",
        "test": lambda s: s.lower().startswith("kxaaagas") or "gas price" in s.lower(),
    },
    "elections": {
        "label": "Elections",
        "slug": "elections",
        "test": lambda s: any(k in s.lower() for k in (
            "kxpres", "kxgov", "kxsenate", "kxhouse", "kxmayor", "election", "nominee")),
    },
    "culture": {
        "label": "Culture",
        "slug": "culture",
        "test": lambda s: any(k in s.lower() for k in (
            "kxoscar", "kxrt", "kxemmy", "kxgrammy", "kxalbum", "kxboxoffice", "kxspotify",
            "kxbillboard", "kxnetflix", "rotten tomatoes", "best picture", "box office")),
    },
    "crypto": {
        "label": "Crypto",
        "slug": "crypto",
        "test": lambda s: any(k in s.lower() for k in (
            "kxbtc", "kxeth", "kxsol", "kxxrp", "kxdoge", "bitcoin", "ethereum", "crypto")),
    },
    "golf": {
        "label": "Golf",
        "slug": "golf",
        "test": lambda s: any(k in s.lower() for k in (
            "kxpgatour", "kxlpgatour", "kxgolf", "pga tour", "lpga", "golf")),
    },
}

REQUEST_LOG = []


def log(msg: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)


def get_json(url: str, params: dict | None = None, retries: int = 3, timeout: int = 45):
    """GET a JSON document. Returns (url, payload, error). Never raises."""
    if params:
        clean = {k: v for k, v in params.items() if v not in (None, "")}
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(clean)
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
            REQUEST_LOG.append({"url": url, "status": 200, "at": now_iso()})
            return url, json.loads(body), None
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            REQUEST_LOG.append({"url": url, "status": e.code, "at": now_iso()})
            return url, None, last
        except Exception as e:  # network, timeout, bad JSON
            last = f"{type(e).__name__}: {e}"
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
    REQUEST_LOG.append({"url": url, "status": None, "error": last, "at": now_iso()})
    return url, None, last


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dec(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None


def num(v, places=4) -> str | None:
    d = dec(v)
    if d is None:
        return None
    return str(d.quantize(Decimal(10) ** -places))


def topic_of(text: str) -> str | None:
    for key, rule in TOPIC_RULES.items():
        if rule["test"](text or ""):
            return key
    return None


def fetch_markets_by_status(status: str, cap: int, limit: int = 1000):
    """Page through /markets?status=... . Returns (rows, pages, error)."""
    rows, cursor, pages, url0, err = [], None, 0, None, None
    while pages < cap:
        params = {"status": status, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        url, payload, e = get_json(f"{BASE}/markets", params)
        url0 = url0 or url
        pages += 1
        if e or not payload:
            err = e or "no payload"
            break
        batch = payload.get("markets") or []
        rows.extend(batch)
        cursor = payload.get("cursor") or ""
        if not cursor or not batch:
            break
        time.sleep(0.15)
    return rows, pages, url0, err


def shape_market(m: dict, topic: str, source_url: str) -> dict:
    yes_bid = dec(m.get("yes_bid_dollars"))
    yes_ask = dec(m.get("yes_ask_dollars"))
    no_bid = dec(m.get("no_bid_dollars"))
    no_ask = dec(m.get("no_ask_dollars"))
    last = dec(m.get("last_price_dollars"))
    mid = None
    if yes_bid is not None and yes_ask is not None and yes_ask > 0:
        mid = (yes_bid + yes_ask) / 2
    return {
        "topic": topic,
        "series_ticker": m.get("series_ticker") or (m.get("ticker") or "").split("-")[0],
        "event_ticker": m.get("event_ticker"),
        "event_title": m.get("event_title"),
        "market_ticker": m.get("ticker"),
        "title": m.get("title"),
        "subtitle": m.get("subtitle") or m.get("yes_sub_title"),
        "status": m.get("status"),
        "result": m.get("result"),
        "yes": {
            "bid": num(m.get("yes_bid_dollars")),
            "ask": num(m.get("yes_ask_dollars")),
            "bid_size": num(m.get("yes_bid_size_fp")),
            "ask_size": num(m.get("yes_ask_size_fp")),
        },
        "no": {
            "bid": num(m.get("no_bid_dollars")),
            "ask": num(m.get("no_ask_dollars")),
            "bid_size": num(m.get("no_bid_size_fp")),
            "ask_size": num(m.get("no_ask_size_fp")),
        },
        "last_price": num(m.get("last_price_dollars")),
        "previous_price": num(m.get("previous_price_dollars")),
        "mid": num(mid) if mid is not None else None,
        "volume": num(m.get("volume_fp")),
        "volume_24h": num(m.get("volume_24h_fp")),
        "open_interest": num(m.get("open_interest_fp")),
        # liquidity_dollars is not part of the documented Get Markets example, so it is
        # carried through only when the exchange actually returns it (never filled in).
        "liquidity_dollars": num(m.get("liquidity_dollars")),
        "notional_value_dollars": num(m.get("notional_value_dollars")),
        "open_time": m.get("open_time"),
        "close_time": m.get("close_time"),
        "expected_expiration_time": m.get("expected_expiration_time"),
        "settlement_ts": m.get("settlement_ts"),
        "settlement_value_dollars": num(m.get("settlement_value_dollars")),
        "expiration_value": m.get("expiration_value"),
        "rules_primary": m.get("rules_primary"),
        "settlement_sources": m.get("settlement_sources") or [],
        "source_url": source_url,
        "kalshi_page": "https://kalshi.com/markets/" + (m.get("series_ticker") or "").lower(),
    }


def fetch_orderbook(ticker: str, level_cap: int = 12):
    url, payload, err = get_json(f"{BASE}/markets/{urllib.parse.quote(ticker)}/orderbook")
    if err or not payload:
        return {"source_url": url, "error": err or "no payload", "yes_bids": [], "no_bids": []}
    # Documented response shape (verified 2026-11-20):
    #   {"orderbook_fp": {"yes_dollars": [["0.1500","100.00"], ...], "no_dollars": [...]}}
    #   see https://docs.kalshi.com/api-reference/market/get-market-orderbook
    book = payload.get("orderbook_fp") or payload.get("orderbook") or payload

    def side(variants, cap):
        for name in variants:
            levels = book.get(name)
            if isinstance(levels, list) and levels:
                out = []
                for lv in levels:
                    if isinstance(lv, (list, tuple)) and len(lv) >= 2:
                        out.append({"price": num(lv[0], 4), "contracts": num(lv[1], 2)})
                    elif isinstance(lv, dict):
                        out.append({
                            "price": num(lv.get("price") or lv.get("price_dollars"), 4),
                            "contracts": num(lv.get("count") or lv.get("count_fp") or lv.get("contracts"), 2),
                        })
                out = sorted(out, key=lambda x: dec(x["price"]) or Decimal(0), reverse=True)
                return out[:cap]
        return []

    yes_bids = side(("yes_dollars", "yes"), level_cap)
    no_bids = side(("no_dollars", "no"), level_cap)
    return {
        "source_url": url,
        "error": None,
        "yes_bids": yes_bids,
        "no_bids": no_bids,
        "implied_yes_ask": (num(Decimal(1) - dec(no_bids[0]["price"]), 4)
                            if no_bids and dec(no_bids[0]["price"]) is not None else None),
        "implied_no_ask": (num(Decimal(1) - dec(yes_bids[0]["price"]), 4)
                           if yes_bids and dec(yes_bids[0]["price"]) is not None else None),
        "note": "Bids only; Kalshi publishes implied asks as 1 - best opposite bid "
                "(docs.kalshi.com/getting_started/orderbook_responses).",
    }


def traded_notional(ticker: str, hours: int = 24, max_pages: int = 12, span=None, depth: int = 0):
    """SUM(yes_price_dollars * count_fp) over public trades in the window."""
    now = int(time.time())
    start, end = span or (now - hours * 3600, now)
    cursor, total, n, pages, first_url = None, Decimal(0), 0, 0, None
    while pages < max_pages:
        params = {"ticker": ticker, "min_ts": start, "max_ts": end, "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        url, payload, err = get_json(f"{BASE}/markets/trades", params, retries=1)
        first_url = first_url or url
        pages += 1
        if err or not payload:
            return None, n, first_url, err or "no payload", False
        trades = payload.get("trades") or []
        for t in trades:
            p, c = dec(t.get("yes_price_dollars")), dec(t.get("count_fp"))
            if p is None or c is None:
                continue
            total += p * c
            n += 1
        cursor = payload.get("cursor") or ""
        if not cursor or not trades:
            return total, n, first_url, None, True
    mid = start + (end - start) // 2
    if depth >= 3 or end - start <= 120:
        return total, n, first_url, f"incomplete: >{max_pages} pages, total is a lower bound", False
    a, an, _, ae, aok = traded_notional(ticker, span=(start, mid), depth=depth + 1)
    b, bn, _, be, bok = traded_notional(ticker, span=(mid, end), depth=depth + 1)
    if not (aok and bok):
        return total, n + an + bn, first_url, f"incomplete: {ae or be}", False
    return a + b, an + bn, first_url, None, True


def fetch_candles(ticker: str, series: str, period: int, hours: int):
    end = int(time.time())
    start = end - hours * 3600
    url, payload, err = get_json(
        f"{BASE}/series/{urllib.parse.quote(series)}/markets/{urllib.parse.quote(ticker)}/candlesticks",
        {"start_ts": start, "end_ts": end, "period_interval": period})
    if err or not payload:
        return {"period": period, "source_url": url, "error": err or "no payload", "points": []}
    pts = []
    for c in payload.get("candlesticks") or []:
        price = c.get("price") or {}
        ybid = c.get("yes_bid") or {}
        yask = c.get("yes_ask") or {}
        pts.append({
            "t": c.get("end_period_ts"),
            "close": num(price.get("close_dollars")),
            "open": num(price.get("open_dollars")),
            "high": num(price.get("high_dollars")),
            "low": num(price.get("low_dollars")),
            "yes_bid": num(ybid.get("close_dollars")),
            "yes_ask": num(yask.get("close_dollars")),
            "volume": num(c.get("volume_fp")),
            "open_interest": num(c.get("open_interest_fp")),
        })
    return {"period": period, "source_url": url, "error": None, "points": pts}


def taker_fee(price, count, multiplier=1) -> Decimal:
    p, c = dec(price), dec(count)
    if p is None or c is None or c <= 0:
        return Decimal("0")
    raw = Decimal(multiplier) * Decimal("0.07") * c * p * (Decimal(1) - p)
    step = Decimal("0.0001")
    return (raw / step).to_integral_value(rounding=ROUND_CEILING) * step


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--limit", type=int, default=1000, help="page size")
    ap.add_argument("--pages", type=int, default=10, help="page cap per status")
    ap.add_argument("--books", type=int, default=14, help="order books to fetch")
    ap.add_argument("--candles", type=int, default=10, help="markets to fetch candles for")
    ap.add_argument("--trades", type=int, default=10, help="markets to price 24h notional for")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = now_iso()
    errors = []

    log("exchange/status")
    status_url, status_payload, status_err = get_json(f"{BASE}/exchange/status")
    if status_err:
        errors.append(f"exchange/status: {status_err}")

    buckets = {}
    for status in ("open", "settled", "closed"):
        rows, pages, url, err = fetch_markets_by_status(status, args.pages, args.limit)
        log(f"{status}: {len(rows)} rows in {pages} page(s) err={err}")
        if err:
            errors.append(f"markets?status={status}: {err}")
        buckets[status] = {"rows": rows, "pages": pages, "url": url}

    shaped = {"open": [], "settled": [], "closed": []}
    for status, bucket in buckets.items():
        for m in bucket["rows"]:
            probe = " ".join(str(m.get(k) or "") for k in
                             ("series_ticker", "ticker", "event_title", "title", "category"))
            topic = topic_of(probe)
            if not topic:
                continue
            shaped[status].append(shape_market(m, topic, bucket["url"]))

    counts = {}
    for key in TOPIC_RULES:
        counts[key] = {
            "open": sum(1 for m in shaped["open"] if m["topic"] == key),
            "settled_with_result": sum(1 for m in shaped["settled"] if m["topic"] == key),
            "closed_awaiting_result": sum(1 for m in shaped["closed"] if m["topic"] == key),
        }
    log(f"topic counts: {json.dumps(counts)}")

    def dollar_key(m):
        return dec(m.get("volume_24h")) or Decimal(-1)

    # --- order books: highest 24h-volume open markets, topic-aware ---
    by_topic = {}
    for m in shaped["open"]:
        by_topic.setdefault(m["topic"], []).append(m)
    books = {}
    per_topic_books = max(2, args.books // len(TOPIC_RULES))
    for topic, rows in by_topic.items():
        rows.sort(key=dollar_key, reverse=True)
        for m in rows[:per_topic_books]:
            books[m["market_ticker"]] = fetch_orderbook(m["market_ticker"])
            time.sleep(0.2)
    log(f"order books: {len(books)}")

    # --- 24h traded notional for the same set (helps rank by dollars traded) ---
    notional = {}
    for topic, rows in by_topic.items():
        for m in rows[:2]:
            if m["market_ticker"] in notional:
                continue
            total, n, url, err, complete = traded_notional(m["market_ticker"])
            notional[m["market_ticker"]] = {
                "value": num(total, 2), "trades": n, "complete": complete,
                "error": err, "source_url": url,
                "formula": "SUM(yes_price_dollars * count_fp) over GET /markets/trades min_ts=now-24h",
            }
            if err:
                errors.append(f"trades {m['market_ticker']}: {err}")
            time.sleep(0.2)
    log(f"24h notional: {len(notional)} markets")

    # --- candles for the highest-24h-$ market per topic (two windows each) ---
    charts = []
    for topic, rows in by_topic.items():
        rows.sort(key=dollar_key, reverse=True)
        for m in rows[:2]:
            series = m["series_ticker"] or ""
            entry = {
                "topic": topic,
                "market_ticker": m["market_ticker"],
                "series_ticker": series,
                "windows": {},
            }
            for period, hours, name in ((1, 6, "1m/6h"), (60, 168, "1h/7d"), (1440, 2160, "1d/90d")):
                entry["windows"][name] = fetch_candles(m["market_ticker"], series, period, hours)
                time.sleep(0.2)
            charts.append(entry)
    log(f"candle series: {len(charts)}")

    # --- watch list: open markets, polled by later runs until they resolve ---
    def close_key(m):
        return m.get("close_time") or "9999"

    watch = sorted([m for m in shaped["open"]],
                   key=lambda m: (close_key(m), ...))[:60] if shaped["open"] else []
    watch_rows = [{"market_ticker": m["market_ticker"], "series_ticker": m["series_ticker"],
                   "event_ticker": m["event_ticker"], "topic": m["topic"],
                   "close_time": m["close_time"], "last_seen_result": m.get("result")} for m in watch]

    payload = {
        "generated_utc": started,
        "completed_utc": now_iso(),
        "base_url": BASE,
        "environment": "demo",
        "docs": {
            "api_environments": "https://docs.kalshi.com/getting_started/api_environments",
            "demo_env": "https://docs.kalshi.com/getting_started/demo_env",
            "market_lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
            "orderbook": "https://docs.kalshi.com/getting_started/orderbook_responses",
            "candlesticks": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
            "markets": "https://docs.kalshi.com/api-reference/market/get-markets",
            "trades": "https://docs.kalshi.com/api-reference/market/get-trades",
            "fees": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
        },
        "exchange_status": status_payload.get("exchange_active") if status_payload else None,
        "exchange_status_url": status_url,
        "topic_rules": {k: {"label": v["label"], "slug": v["slug"]} for k, v in TOPIC_RULES.items()},
        "counts": counts,
        "pagination": {s: {"pages": b["pages"], "url": b["url"]} for s, b in buckets.items()},
        "open": shaped["open"],
        "settled": shaped["settled"][:3000],
        "closed": shaped["closed"][:3000],
        "books": books,
        "notional": notional,
        "charts": charts,
        "watch": watch_rows,
        "errors": errors,
        "request_count": len(REQUEST_LOG),
        "request_log": REQUEST_LOG[-400:],
        "method_note": "Ranking uses 24h traded notional (dollars traded), not a Kalshi 'dollar amount' "
                       "field: Kalshi's market object has no such field. See docs/methods.",
    }
    dest = out / "markets-live.json"
    dest.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    log(f"wrote {dest} ({dest.stat().st_size/1024:.0f} KiB), requests={len(REQUEST_LOG)}, errors={len(errors)}")
    return 0 if not errors else 0  # partial data still publishes; errors are recorded in the file


if __name__ == "__main__":
    sys.exit(main())
