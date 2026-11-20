#!/usr/bin/env python3
"""Collect official Kalshi Trade API v2 (demo environment) data.

Design rules:
  * Only documented, official endpoints are used.
  * Every number is stored with the exact request URL that produced it.
  * Values that are absent in the API response are stored as null, never guessed.
  * Derived values (dollar notional, depth) are labelled with the formula used
    and the record count they were computed from, so they can be recomputed.

Modes:
    explore   print the data landscape (writes nothing outside the log)
    collect   write data/*.json + data/collect-log.txt

Official documentation verified for this script (all fetched 2026-11-20):
  https://docs.kalshi.com/getting_started/api_environments            (base URLs)
  https://docs.kalshi.com/api-reference/market/get-markets            (fields)
  https://docs.kalshi.com/api-reference/market/get-market
  https://docs.kalshi.com/api-reference/market/get-market-orderbook   (bid-only book)
  https://docs.kalshi.com/api-reference/market/get-market-candlesticks(period 1/60/1440)
  https://docs.kalshi.com/api-reference/market/get-trades             (price × count)
  https://docs.kalshi.com/api-reference/market/get-series-list        (categories)
  https://docs.kalshi.com/api-reference/events/get-events             (series_ticker)
  https://docs.kalshi.com/getting_started/orderbook_responses        (implied asks)
  https://docs.kalshi.com/getting_started/market_lifecycle            (status/result)
"""

import json
import os
import re
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
UA = "kalshi-demo-research/1.0 (github.com/karagemop466-tech/Demo1)"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

MAX_SERIES_PER_TOPIC = int(os.environ.get("MAX_SERIES_PER_TOPIC", "10"))
MAX_MARKETS_PER_SERIES = int(os.environ.get("MAX_MARKETS_PER_SERIES", "60"))
MAX_DOLLAR_SCAN = int(os.environ.get("MAX_DOLLAR_SCAN", "6"))    # markets per topic
MAX_CANDLE_MARKETS = int(os.environ.get("MAX_CANDLE_MARKETS", "2"))  # per topic
MAX_SERIES_PER_TOPIC_SELECT = MAX_SERIES_PER_TOPIC

TOPIC_RULES = {
    # Each rule is a list of (regex, why) checked against a series' title, ticker
    # and tags. Regexes keep matching precise (e.g. "golf" must not match inside
    # "NFL Golf"-like strings, and "gas" must not match "Vega"). Every matched
    # series is published with the exact reason string below, so the rule can be
    # audited and corrected.
    "gas_prices": {
        "label": "Gas prices",
        "patterns": [
            (r"kxaaagas", "series ticker is a Kalshi AAA gas-price series"),
            (r"gas\s*prices?", "title/tags mention gas prices"),
            (r"gasoline", "title/tags mention gasoline"),
            (r"pump\s*price", "title/tags mention pump price"),
        ],
        "categories": [],
    },
    "elections": {
        "label": "Elections",
        "patterns": [
            (r"election", "title/tags mention election"),
            (r"\bnominee\b", "title/tags mention nominee"),
            (r"\bgovernorship\b", "title/tags mention governorship"),
            (r"\bpresiden(t|cy|tial)\b", "title/tags mention president/presidency"),
            (r"\bsenate\b", "title/tags mention senate"),
            (r"\bhouse\s+of\s+representatives\b", "title/tags mention House of Representatives"),
            (r"\bmayoral\b", "title/tags mention mayoral"),
            (r"kxpres|kxgov|kxsenate|kxhouse|kxmayor", "series ticker is an election series"),
        ],
        "categories": [],
    },
    "culture": {
        "label": "Culture",
        "patterns": [
            (r"\boscar", "title/tags mention Oscar"),
            (r"\bgrammy", "title/tags mention Grammy"),
            (r"\bemmy", "title/tags mention Emmy"),
            (r"box\s*office", "title/tags mention box office"),
            (r"rotten\s*tomatoes|\bmetacritic\b", "title/tags mention a culture review score"),
            (r"\bbillboard\b", "title/tags mention Billboard"),
            (r"\bspotify\b", "title/tags mention Spotify"),
            (r"\bnetflix\b", "title/tags mention Netflix"),
            (r"\bbest\s+(picture|album|actor|actress|director)\b", "title/tags mention a culture award category"),
            (r"\bsurvivor\b|\bbig\s+brother\b|\bmet\s+gala\b", "title/tags mention a named culture event"),
            (r"\bmovie\b|\bfilm\b|\balbum\b", "title/tags mention movie/film/album"),
        ],
        "categories": [],
    },
    "crypto": {
        "label": "Crypto",
        "patterns": [
            (r"\bbitcoin\b|\bbtc\b|kxbtc", "title/tags mention Bitcoin"),
            (r"\bethereum\b|\beth\b|kxeth", "title/tags mention Ethereum"),
            (r"\bsolana\b", "title/tags mention Solana"),
            (r"\bdogecoin\b|\bdoge\b", "title/tags mention Dogecoin"),
            (r"\bxrp\b|\bripple\b", "title/tags mention XRP"),
            (r"\bcrypto", "title/tags mention crypto"),
        ],
        "categories": [],
    },
    "golf": {
        "label": "Golf",
        "patterns": [
            (r"\bgolf\b", "title/tags mention golf"),
            (r"\bpga\b", "title/tags mention the PGA"),
            (r"\blpga\b", "title/tags mention the LPGA"),
            (r"\bmasters\b", "title/tags mention the Masters"),
            (r"ryder\s*cup", "title/tags mention the Ryder Cup"),
            (r"open\s*championship", "title/tags mention the Open Championship"),
            (r"tour\s*championship", "title/tags mention the Tour Championship"),
            (r"kxpgatour|kxpgatop20|kxdpworldtour|kxpgar", "series ticker is a Kalshi golf series"),
        ],
        "categories": [],
    },
}

LOG = []
STATS = {"requests": 0, "failed": 0}


def log(msg):
    line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}"
    LOG.append(line)
    print(line, flush=True)


def get_json(url, params=None, retries=2, timeout=30):
    """GET JSON. Returns (request_url, payload_or_None, error_or_None)."""
    if params:
        url = url + "?" + urllib.parse.urlencode(params, doseq=True)
    last_err = None
    for attempt in range(retries):
        STATS["requests"] += 1
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return url, json.loads(r.read().decode("utf-8", "replace")), None
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            last_err = f"HTTP {e.code} {detail}".strip()
            STATS["failed"] += 1
            if e.code in (400, 401, 403, 404, 422):
                return url, None, last_err
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            STATS["failed"] += 1
        time.sleep(1.2 * (attempt + 1))
    return url, None, last_err


def dec(v):
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def fnum(v, places=6):
    d = dec(v)
    return None if d is None else round(float(d), places)


def post_fixed(d):
    """Format a Decimal for JSON as a string (no float drift in money fields)."""
    return None if d is None else f"{d:.4f}"


# ---------------------------------------------------------------------------
# Explore
# ---------------------------------------------------------------------------
def series_matches(series, rule):
    """Explicit, auditable matching rule. Returns (matched, why)."""
    title = (series.get("title") or "")
    ticker = (series.get("ticker") or "")
    tags = " ".join(str(t) for t in (series.get("tags") or []))
    hay = f"{title} | {ticker} | {tags}"
    low = hay.lower()
    for pattern, why in rule["patterns"]:
        if re.search(pattern, low, re.I):
            return True, f'{why} (pattern "{pattern}")'
    for cat in rule["categories"]:
        cats = [str(c).lower() for c in (series.get("categories") or [])]
        if series.get("category"):
            cats.append(str(series["category"]).lower())
        if cat.lower() in cats:
            return True, f'discovery category "{cat}"'
    return False, ""


def fetch_series():
    url, payload, err = get_json(f"{BASE}/series", {"include_volume": "true"})
    if err or not payload:
        return [], url, err or "no payload"
    series = payload.get("series", [])
    log(f"series: {len(series)} returned")
    return series, url, None


def explore():
    series, url, err = fetch_series()
    if err:
        log(f"series fetch failed: {err}")
        _write_log()
        return 1
    cats = {}
    for s in series:
        for c in (s.get("categories") or [s.get("category") or "(none)"]):
            cats[c] = cats.get(c, 0) + 1
    log("categories: " + json.dumps(dict(sorted(cats.items(), key=lambda kv: -kv[1]))))
    for key, rule in TOPIC_RULES.items():
        hits = [(s.get("ticker"), s.get("title"), s.get("category"))
                for s in series if series_matches(s, rule)[0]]
        log(f"topic {key}: {len(hits)} series")
        for t, title, cat in hits[:50]:
            log(f"    {t} | {title} | {cat}")
    for status in ("open", "settled"):
        _, payload, e = get_json(f"{BASE}/markets", {"status": status, "limit": 10})
        log(f"markets?status={status}: err={e} "
            f"count={len(payload.get('markets', [])) if payload else 0}")
    log(f"requests={STATS['requests']} failed={STATS['failed']}")
    _write_log()
    return 0


def _write_log():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "collect-log.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Collection helpers
# ---------------------------------------------------------------------------
def fetch_markets_for_series(series_ticker, status, cap=MAX_MARKETS_PER_SERIES):
    """Paginate GET /markets for one series + status. Cursor is passed back as-is."""
    collected, cursor, req_url, pages = [], None, None, 0
    while pages < 3 and len(collected) < cap:
        params = {"series_ticker": series_ticker, "status": status,
                  "limit": min(200, cap)}
        if cursor:
            params["cursor"] = cursor
        url, payload, err = get_json(f"{BASE}/markets", params)
        req_url = req_url or url
        pages += 1
        if err or not payload:
            return collected, req_url, err or "no payload"
        batch = payload.get("markets") or []
        collected.extend(batch)
        cursor = payload.get("cursor") or ""
        if not cursor or not batch:
            break
    return collected[:cap], req_url, None


def fetch_event(event_ticker, cache):
    if event_ticker in cache:
        return cache[event_ticker]
    url, payload, err = get_json(f"{BASE}/events/{urllib.parse.quote(event_ticker)}")
    result = (payload or {}).get("event") if payload else None
    cache[event_ticker] = (result, url, err)
    return cache[event_ticker]


def fetch_orderbook(ticker):
    url, payload, err = get_json(
        f"{BASE}/markets/{urllib.parse.quote(ticker)}/orderbook")
    if err or not payload:
        return None, url, err or "no payload"
    return payload.get("orderbook_fp") or payload.get("orderbook"), url, None


def book_side(levels, limit=8):
    """Levels are [price_dollars, count_fp] ascending; best bid is last."""
    out = []
    for entry in (levels or [])[-limit:]:
        try:
            price, count = entry[0], entry[1]
        except (TypeError, IndexError):
            continue
        out.append({"price": str(price), "contracts": str(count)})
    out.reverse()  # best first
    return out


def implied_ask_from_bids(opposite_levels):
    """YES ask = 1.00 - best NO bid (docs: orderbook_responses)."""
    if not opposite_levels:
        return None
    best = dec(opposite_levels[-1][0])
    if best is None:
        return None
    return Decimal("1.00") - best


def _trades_page(ticker, min_ts, max_ts, cursor=None, limit=1000):
    params = {"ticker": ticker, "min_ts": min_ts, "limit": limit}
    if max_ts:
        params["max_ts"] = max_ts
    if cursor:
        params["cursor"] = cursor
    return get_json(f"{BASE}/markets/trades", params, retries=1)


def traded_notional(ticker, hours=24, max_pages=10, depth=0, span=None):
    """Exact dollar notional: SUM(yes_price_dollars * count_fp) over public trades.

    Both operands are documented fields of Get Trades. If the page/limit budget
    is exhausted before the cursor is empty, the time window is split in half and
    each half is summed instead of reporting a truncated (i.e. understated) total.
    When even that is impossible the result is marked incomplete, never guessed.
    """
    now = int(time.time())
    if span:
        start, end = span
    else:
        start, end = now - hours * 3600, now
    cursor, total, n, pages = None, Decimal("0"), 0, 0
    first_url = None
    while pages < max_pages:
        url, payload, err = _trades_page(ticker, start, end, cursor)
        first_url = first_url or url
        pages += 1
        if err or not payload:
            return None, n, first_url, err or "no payload", False
        trades = payload.get("trades") or []
        for t in trades:
            p = dec(t.get("yes_price_dollars"))
            c = dec(t.get("count_fp"))
            if p is None or c is None:
                continue
            total += p * c
            n += 1
        cursor = payload.get("cursor") or ""
        if not cursor or not trades:
            return total, n, first_url, None, True
    # budget exhausted with more data available: split the window
    mid = start + (end - start) // 2
    if depth >= 3 or end - start <= 120:
        return total, n, first_url, (
            f"incomplete: more than {n} trades in the window; "
            "window splitting depth reached, total is a lower bound"), False
    a_total, a_n, _, a_err, a_ok = traded_notional(ticker, depth=depth + 1, span=(start, mid))
    b_total, b_n, _, b_err, b_ok = traded_notional(ticker, depth=depth + 1, span=(mid, end))
    if not (a_ok and b_ok):
        return total, n, first_url, (
            f"incomplete: sub-window failure ({a_err or b_err}); total is a lower bound"), False
    return a_total + b_total, a_n + b_n, first_url, None, True


def fetch_candles(market_ticker, series_ticker, period_min, span_hours):
    """One request window <= 5000 periods (documented limit)."""
    end = int(time.time())
    span_s = span_hours * 3600
    start = end - span_s
    periods = span_s // (period_min * 60)
    if periods > 4900:  # respect the documented 5,000-period cap
        start = end - 4900 * period_min * 60
    url, payload, err = get_json(
        f"{BASE}/series/{urllib.parse.quote(series_ticker)}/markets/"
        f"{urllib.parse.quote(market_ticker)}/candlesticks",
        {"start_ts": start, "end_ts": end, "period_interval": period_min},
        retries=1)
    if err or not payload:
        return None, url, err or "no payload"
    return payload, url, None


def distill_candles(candles):
    """Flatten the documented candlestick object into chart points."""
    out = []
    for c in candles or []:
        price = c.get("price") or {}
        yes_bid = c.get("yes_bid") or {}
        yes_ask = c.get("yes_ask") or {}
        out.append({
            "t": c.get("end_period_ts"),
            "price_close": fnum(first(price, "close_dollars", "close")),
            "price_open": fnum(first(price, "open_dollars", "open")),
            "price_high": fnum(first(price, "high_dollars", "high")),
            "price_low": fnum(first(price, "low_dollars", "low")),
            "yes_bid_close": fnum(first(yes_bid, "close_dollars", "close")),
            "yes_ask_close": fnum(first(yes_ask, "close_dollars", "close")),
            "volume": fnum(c.get("volume_fp")),
            "open_interest": fnum(c.get("open_interest_fp")),
        })
    return out


def first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return None


# ---------------------------------------------------------------------------
# Market shaping — every field traceable
# ---------------------------------------------------------------------------
def shape_market(m, series_ticker, topic, market_url, event_cache, match_reason=""):
    event, event_url, event_err = fetch_event(m.get("event_ticker") or "", event_cache)
    quotes = {}
    for side in ("yes", "no"):
        bid = dec(m.get(f"{side}_bid_dollars"))
        ask = dec(m.get(f"{side}_ask_dollars"))
        bid_sz = dec(m.get(f"{side}_bid_size_fp"))
        ask_sz = dec(m.get(f"{side}_ask_size_fp"))
        quotes[side] = {
            "bid": post_fixed(bid),
            "ask": post_fixed(ask),
            "bid_size_contracts": post_fixed(bid_sz),
            "ask_size_contracts": post_fixed(ask_sz),
            # A 0-size quote is not a tradeable level; flagged rather than shown as real.
            "bid_is_live": bool(bid is not None and bid_sz is not None and bid_sz > 0),
            "ask_is_live": bool(ask is not None and ask_sz is not None and ask_sz > 0),
        }
    settlement_sources = []
    if isinstance(event, dict):
        for s in (event.get("settlement_sources") or []):
            if isinstance(s, dict) and s.get("url"):
                settlement_sources.append({"name": s.get("name") or "", "url": s["url"]})
    return {
        "topic": topic,
        "topic_match_reason": match_reason,
        "topic_matched_by_ticker_only": bool(match_reason and "ticker" in match_reason
                                             and "title" not in match_reason),
        "series_ticker": series_ticker,
        "event_ticker": m.get("event_ticker"),
        "event_title": (event or {}).get("title") if isinstance(event, dict) else None,
        "market_ticker": m.get("ticker"),
        "title": m.get("title"),
        "status": m.get("status"),
        "result": m.get("result") or None,
        "quotes": quotes,
        "last_price": post_fixed(dec(m.get("last_price_dollars"))),
        "previous_price": post_fixed(dec(m.get("previous_price_dollars"))),
        "volume_contracts": post_fixed(dec(m.get("volume_fp"))),
        "volume_24h_contracts": post_fixed(dec(m.get("volume_24h_fp"))),
        "open_interest_contracts": post_fixed(dec(m.get("open_interest_fp"))),
        "notional_value_dollars": post_fixed(dec(m.get("notional_value_dollars"))),
        "open_time": m.get("open_time"),
        "close_time": m.get("close_time"),
        "expected_expiration_time": m.get("expected_expiration_time"),
        "settlement_value_dollars": post_fixed(dec(m.get("settlement_value_dollars"))),
        "settlement_ts": m.get("settlement_ts"),
        "expiration_value": m.get("expiration_value") or None,
        "rules_primary": (m.get("rules_primary") or "")[:600] or None,
        "settlement_sources": settlement_sources,
        "sources": {
            "markets": market_url,
            "market": f"{BASE}/markets/{urllib.parse.quote(m.get('ticker') or '')}",
            "event": event_url,
            "event_error": event_err,
            "orderbook": f"{BASE}/markets/{urllib.parse.quote(m.get('ticker') or '')}/orderbook",
        },
    }


def collect():
    started = datetime.now(timezone.utc)
    DATA.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated_utc": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "environment": "demo",
        "rest_base": BASE,
        "production_base": PROD,
        "websocket": "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
        "official_docs": "https://docs.kalshi.com/",
        "collector": "tools/collect_kalshi.py",
        "topics": {k: {"label": v["label"],
                       "patterns": [{"pattern": p, "why": w} for p, w in v["patterns"]],
                       "categories": v["categories"]}
                   for k, v in TOPIC_RULES.items()},
        "notes": [
            "All values come from the official Kalshi demo Trade API and each row "
            "links to the exact request URL recorded in its 'sources' block.",
            "The demo environment is Kalshi's test exchange: prices, depth and "
            "balances are simulated and are not real-money liquidity.",
            "Absent API fields are stored as null and rendered blank; nothing is "
            "inferred, interpolated or filled in.",
        ],
    }
    exchange_url, exchange, exchange_err = get_json(f"{BASE}/exchange/status")
    meta["exchange_status"] = exchange
    meta["exchange_status_url"] = exchange_url
    meta["exchange_status_error"] = exchange_err
    log(f"exchange/status err={exchange_err} payload={json.dumps(exchange)[:160] if exchange else None}")

    series, series_url, series_err = fetch_series()
    meta["series_list_url"] = series_url
    meta["series_list_error"] = series_err
    meta["series_count"] = len(series)
    cats = {}
    for s in series:
        for c in (s.get("categories") or [s.get("category") or "(none)"]):
            cats[c] = cats.get(c, 0) + 1
    meta["categories"] = dict(sorted(cats.items(), key=lambda kv: -kv[1]))

    topics_out, markets_out, resolved_out, charts_out = {}, [], [], []
    event_cache = {}

    for topic_key, rule in TOPIC_RULES.items():
        matched = []
        for s in series:
            ok, why = series_matches(s, rule)
            if ok:
                matched.append({
                    "ticker": s.get("ticker"),
                    "title": s.get("title"),
                    "category": s.get("category"),
                    "categories": s.get("categories") or [],
                    "volume_contracts": fnum(s.get("volume_fp")),
                    "match_reason": why,
                })
        matched.sort(key=lambda x: -(x["volume_contracts"] or 0))
        selected = matched[:MAX_SERIES_PER_TOPIC]
        log(f"topic {topic_key}: {len(matched)} series matched, "
            f"collecting {len(selected)}")

        open_markets, series_errors = [], []
        for s in selected:
            mkts, murl, err = fetch_markets_for_series(s["ticker"], "open")
            if err:
                series_errors.append({"series": s["ticker"], "error": err, "url": murl})
            for m in mkts:
                shaped = shape_market(m, s["ticker"], topic_key, murl, event_cache,
                                      s.get("match_reason", ""))
                shaped["series_volume_contracts"] = s["volume_contracts"]
                open_markets.append(shaped)
            # resolved tracking: settled == finalized per market_lifecycle docs.
            # "closed" is also requested so markets that closed but are not yet
            # finalized are tracked too (they have no result yet, which matters).
            settled, surl, serr = fetch_markets_for_series(s["ticker"], "settled")
            closed, curl, cerr = fetch_markets_for_series(s["ticker"], "closed")
            if cerr:
                series_errors.append({"series": s["ticker"], "error": cerr, "url": curl})
            for m in closed:
                shaped = shape_market(m, s["ticker"], topic_key, curl, event_cache,
                                      s.get("match_reason", ""))
                shaped["closed_pending"] = True
                resolved_out.append(shaped)
            if serr:
                series_errors.append({"series": s["ticker"], "error": serr, "url": surl})
            for m in settled:
                shaped = shape_market(m, s["ticker"], topic_key, surl, event_cache,
                                      s.get("match_reason", ""))
                resolved_out.append(shaped)
            log(f"  {s['ticker']}: open={len(mkts)} settled={len(settled)} closed={len(closed)}"
                f"{' err=' + str(err) if err else ''}")

        # rank by reported 24h contract volume first; dollar notional computed below
        def vol_key(x):
            # API-reported 24h contract volume: a documented field, not a derived one.
            return -(fnum(x.get("volume_24h_contracts")) or 0)

        open_markets.sort(key=vol_key)
        scan = open_markets[:MAX_DOLLAR_SCAN]
        for m in scan:
            total, n, url, err, complete = traded_notional(m["market_ticker"])
            m["dollar_notional_24h"] = {
                "value": None if total is None else round(float(total), 2),
                "trades_counted": n,
                "complete": complete,
                "formula": "SUM(yes_price_dollars * count_fp) over trades with "
                           "min_ts = now-24h from GET /markets/trades",
                "source": url,
                "error": err,
            }
            log(f"  notional {m['market_ticker']}: "
                f"{m['dollar_notional_24h']['value']} from {n} trades err={err}")

        # order books for the ranked set
        for m in scan:
            ob, ob_url, ob_err = fetch_orderbook(m["market_ticker"])
            entry = {"source": ob_url, "error": ob_err}
            if isinstance(ob, dict):
                yes_levels = ob.get("yes_dollars") or ob.get("yes") or []
                no_levels = ob.get("no_dollars") or ob.get("no") or []
                entry["yes_bids"] = book_side(yes_levels)
                entry["no_bids"] = book_side(no_levels)
                entry["implied_yes_ask"] = post_fixed(implied_ask_from_bids(no_levels))
                entry["implied_no_ask"] = post_fixed(implied_ask_from_bids(yes_levels))
                entry["yes_bid_levels_total"] = len(yes_levels)
                entry["no_bid_levels_total"] = len(no_levels)
            m["orderbook"] = entry
            log(f"  orderbook {m['market_ticker']}: err={ob_err}")

        # price history for the top markets (documented intervals only)
        for m in scan[:MAX_CANDLE_MARKETS]:
            series_m = {"market_ticker": m["market_ticker"],
                        "series_ticker": m["series_ticker"], "windows": {}}
            for label, period, hours in (("1m/6h", 1, 6), ("1h/7d", 60, 168),
                                         ("1d/90d", 1440, 2160)):
                payload, curl, cerr = fetch_candles(
                    m["market_ticker"], m["series_ticker"], period, hours)
                series_m["windows"][label] = {
                    "period_interval_minutes": period,
                    "points": distill_candles((payload or {}).get("candlesticks")),
                    "source": curl,
                    "error": cerr,
                }
                log(f"  candles {m['market_ticker']} {label}: "
                    f"{len(series_m['windows'][label]['points'])} points err={cerr}")
            charts_out.append(series_m)

        topics_out[topic_key] = {
            "label": rule["label"],
            "patterns": [{"pattern": p, "why": w} for p, w in rule["patterns"]],
            "top_series": [{"ticker": x["ticker"], "title": x["title"],
                            "volume_contracts": x["volume_contracts"],
                            "match_reason": x["match_reason"]} for x in selected],
            "series_matched": len(matched),
            "series_selected": [s["ticker"] for s in selected],
            "series": matched,
            "errors": series_errors,
            "open_market_count": len(open_markets),
            "resolved_market_count": len(
                [r for r in resolved_out if r["topic"] == topic_key]),
        }
        markets_out.extend(open_markets)

    # dedupe by market ticker (a market can appear in several series requests only
    # if the API returns overlapping data; keep first occurrence and note it)
    seen, deduped, dupes = set(), [], 0
    for m in markets_out:
        key = m["market_ticker"]
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        deduped.append(m)
    if dupes:
        log(f"deduplicated {dupes} overlapping market records")

    meta["topics"] = topics_out
    meta["request_stats"] = STATS
    meta["duplicate_records_removed"] = dupes
    meta["counts"] = {
        "open_markets": len(deduped),
        "resolved_markets": len(resolved_out),
        "chart_series": len(charts_out),
    }

    write(DATA / "metadata.json", meta)
    write(DATA / "markets.json", {"generated_utc": meta["generated_utc"],
                                  "base": BASE, "markets": deduped})
    write(DATA / "resolved.json", {"generated_utc": meta["generated_utc"],
                                   "base": BASE, "markets": resolved_out})
    write(DATA / "charts.json", {"generated_utc": meta["generated_utc"],
                                 "base": BASE, "series": charts_out})
    log(f"done: open={len(deduped)} resolved={len(resolved_out)} "
        f"charts={len(charts_out)} requests={STATS['requests']} "
        f"failed={STATS['failed']}")
    _write_log()
    return 0


def write(path, obj):
    path.write_text(json.dumps(obj, indent=1, sort_keys=False), encoding="utf-8")
    log(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "explore"
    if mode == "explore":
        sys.exit(explore())
    if mode == "collect":
        sys.exit(collect())
    print(__doc__)
    sys.exit(2)
