#!/usr/bin/env python3
"""
engine_refresh.py — narrow, live demo-API pull that feeds the engine.

Why this exists: `snapshot/` (tools/collect_kalshi.py) carries 1-minute price
history for 10 markets, which is too few to chart or backtest across five topics.
This script fetches a small, explicit set of markets and writes a compact JSON the
static page can render offline, each block stamped with the request URL that
produced it. Public, unauthenticated endpoints only — it has no signing code and
no write path to the exchange.

Everything is a direct copy of an official response, except the two derived
numbers the API does not return, which are computed and labelled as such:
  * `dollar_notional_24h`  = volume_24h_fp x notional_value_dollars  (computed)
  * `implied_yes_ask`      = 1.00 - highest NO bid                 (documented identity,
    https://docs.kalshi.com/getting_started/orderbook_responses)

Endpoints (official references):
  GET /markets?status=open&limit=200      https://docs.kalshi.com/api-reference/market/get-markets
  GET /events?limit=200                   https://docs.kalshi.com/api-reference/events/get-events
  GET /markets/{t}/orderbook              https://docs.kalshi.com/api-reference/market/get-market-orderbook
  GET /series/{s}/markets/{t}/candlesticks https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  GET /exchange/status                    https://docs.kalshi.com/api-reference/exchange/get-exchange-status

Usage:
  python3 tools/engine_refresh.py --out engine/data/live-snapshot.json [--markets-per-topic 5]
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

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
SERIES_INDEX = "desk/data/series-index.json"   # committed, read-only, regenerated from the snapshot
UA = "Demo1-engine/1.0 (GitHub Actions runner; public demo market data only)"
MAX_LIMIT = 200          # documented cap for /markets and /events list calls
CANDLE_WINDOWS = [("1m", 2, 1), ("1h", 24 * 7, 60), ("1d", 24 * 90, 1440)]

# Topic selection rules. Kept to title/series-ticker text that the API actually
# returned, so a match can be shown next to the string that matched it.
TOPICS = {
    "gas_prices": [r"gas\s*price", r"gasoline", r"\bgas\b", r"fuel\s*price", r"crude\s*oil",
                   r"natural\s*gas", r"\bdiesel\b", r"pump\s*price", r"gas\b.*\$\d"],
    "elections": [r"election", r"president", r"senate", r"governor", r"congress", r"house of reps",
                  r"prime minister", r"parliament", r"mayoral", r"nominee", r"midterm", r"ballot"],
    "culture": [r"oscar", r"emmy", r"grammy", r"box office", r"album", r"movie", r"film", r"tv\s*show",
                r"netflix", r"spotify", r"billboard", r"time\s*person", r"celebrity", r"grammys"],
    "crypto": [r"\bbitcoin\b", r"\bbtc\b", r"\bethereum\b", r"\beth\b", r"\bsolana\b", r"\bsol\b",
               r"\bxrp\b", r"crypto", r"\bdoge", r"\bxrp\b", r"market\s*cap"],
    "golf": [r"\bgolf\b", r"\bmasters\b", r"\bus open\b", r"pga", r"lpga", r"ryder cup",
             r"tour\s*championship", r"\bopen\s*championship\b", r"deere\b", r"pga\s*tour"],
}
TOPIC_TIC = {
    "gas_prices": r"GAS|GASOLINE|CRUDE|OIL|FUEL|PETROL",
    "elections": r"PRES|SENATE|GOVERNOR|ELECT|CONGRESS|MAYOR|PRESD|HOUSE",
    "culture": r"OSCAR|EMMY|GRAMMY|BOXOFFICE|MOVIE|FILM|ALBUM|BILLBOARD|TIMEPERS|CULT",
    "crypto": r"BTC|ETH|SOL|XRP|DOGE|CRYPTO|COIN|CRYPT",
    "golf": r"GOLF|MASTERS|PGA|LPGA|RYDER|GOLFTOUR|THRC|TOURCH",
}

requests_log: list[dict] = []


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def notice(msg: str) -> None:
    """GitHub Actions workflow command: shows up as a check annotation, readable via
    api.github.com. Used because artifact/log hosts are outside this sandbox's egress."""
    print(f"::notice::{msg}", flush=True)


def get_json(path: str, params: dict | None = None, base: str = BASE, retries: int = 2):
    q = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{base}{path}" + (f"?{q}" if q else "")
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8")
            rec = {"url": url, "status": 200, "bytes": len(body)}
            requests_log.append(rec)
            return json.loads(body), url, None
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"
        except Exception as e:  # noqa: BLE001 - network layer, report verbatim
            last = f"{type(e).__name__}: {e}"
        time.sleep(1.5 * (attempt + 1))
    requests_log.append({"url": url, "status": None, "error": last})
    return None, url, last


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def classify(market: dict) -> tuple[str | None, str, str]:
    """(topic, matched text, which field) — never a guess."""
    title = (market.get("title") or "") + " " + (market.get("subtitle") or "")
    ser = market.get("series_ticker") or ""
    low_t, low_s = title.lower(), ser.upper()
    for topic, pats in TOPICS.items():
        for p in pats:
            m = re.search(p, low_t)
            if m:
                return topic, m.group(0), "title"
        if re.search(TOPIC_TIC[topic], low_s):
            return topic, ser, "series_ticker"
    return None, "", ""


def candle_point(c: dict) -> dict:
    """Transcribe documented nested candle fields; missing values stay blank."""
    price = c.get("price") or {}
    bid = c.get("yes_bid") or {}
    ask = c.get("yes_ask") or {}
    return {
        "t": c.get("end_period_ts"),
        "price_close": fnum(price.get("close_dollars")),
        "price_open": fnum(price.get("open_dollars")),
        "price_high": fnum(price.get("high_dollars")),
        "price_low": fnum(price.get("low_dollars")),
        "yes_bid_close": fnum(bid.get("close_dollars")),
        "yes_ask_close": fnum(ask.get("close_dollars")),
        "volume": fnum(c.get("volume_fp")),
    }


def event_series(event_ticker, events, base):
    """Read the series from the official event, never infer it from a ticker."""
    if not event_ticker:
        return None, None, "market has no event_ticker"
    event = events.get(event_ticker)
    if event is None:
        payload, url, err = get_json(
            f"/events/{urllib.parse.quote(event_ticker, safe='')}", None, base)
        if err:
            return None, url, err
        event = (payload or {}).get("event") or {}
        event = {**event, "source": url}
        events[event_ticker] = event
    series = event.get("series_ticker")
    if not isinstance(series, str) or not series:
        return None, event.get("source"), "event has no series_ticker"
    return series, event.get("source"), None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--out", default="engine/data/live-snapshot.json")
    ap.add_argument("--markets-per-topic", type=int, default=5)
    ap.add_argument("--max-pages", type=int, default=12)
    ap.add_argument("--series-index", default=SERIES_INDEX,
                    help="committed per-topic series list (read-only); see desk/tools/build_series_index.py")
    ap.add_argument("--series-per-topic", type=int, default=6)
    ap.add_argument("--events-probe-pages", type=int, default=1,
                    help="pages of GET /events to pull, to prove the documented limit works")
    args = ap.parse_args()

    started = datetime.now(timezone.utc)

    # 0. exchange status — cheapest possible "is this environment up" probe
    status, status_url, status_err = get_json("/exchange/status", {}, args.base)
    log(f"exchange/status -> {'ok' if not status_err else status_err}")

    # 1. events, at the DOCUMENTED limit. The 11:22Z run asked limit=1000 and got
    #    HTTP 400 (recorded in data/meta.json), which is why events were empty.
    events: dict[str, dict] = {}
    cursor, pages, ev_err = None, 0, None
    for _ in range(max(1, args.events_probe_pages)):
        payload, url, err = get_json("/events", {"limit": MAX_LIMIT, "cursor": cursor}, args.base)
        pages += 1
        if err:
            ev_err = err
            break
        for e in (payload or {}).get("events", []) or []:
            events[e.get("event_ticker")] = {
                "event_ticker": e.get("event_ticker"),
                "series_ticker": e.get("series_ticker"),
                "title": e.get("title"),
                "strike_date": e.get("strike_date"),
                "category": e.get("category"),
                "mutually_exclusive": e.get("mutually_exclusive"),
                "source": url,
            }
        cursor = (payload or {}).get("cursor")
        if not cursor:
            break
    log(f"events -> {len(events)} events, {pages} page(s), err={ev_err}")

    # 2. open markets, paginated at the documented cap
    markets: list[dict] = []
    cursor, m_pages = None, 0
    for _ in range(args.max_pages):
        payload, url, err = get_json("/markets", {"status": "open", "limit": MAX_LIMIT,
                                                  "mve_filter": "exclude", "cursor": cursor}, args.base)
        if err:
            log(f"markets page {m_pages} FAILED {err}")
            break
        m_pages += 1
        batch = (payload or {}).get("markets", []) or []
        markets.extend(batch)
        cursor = (payload or {}).get("cursor")
        if not batch or not cursor:
            break
    log(f"markets/open -> {len(markets)} across {m_pages} page(s)")

    # 2b. The newest pages are dominated by multivariate combo markets even with
    #     mve_filter=exclude (the demo venue creates weather/sports ladders faster than
    #     it creates topic markets), so a newest-first scan alone found 0 five-topic
    #     markets on 2026-11-21. Query the series the committed collection returned for
    #     each topic instead — the documented `series_ticker` filter.
    seen_tickers = {m.get("ticker") for m in markets}
    series_added = 0
    index_path = args.series_index
    try:
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)
    except Exception as exc:  # noqa: BLE001 - optional input, reported not guessed
        index = None
        log(f"series index {index_path} unavailable ({type(exc).__name__}: {exc}); "
            f"falling back to the paged scan only")
    if index:
        for topic, block in (index.get("topics") or {}).items():
            for entry in (block.get("series") or [])[:args.series_per_topic]:
                series = entry.get("series_ticker")
                if not series:
                    continue
                payload, url, err = get_json("/markets", {"series_ticker": series, "status": "open",
                                                          "limit": MAX_LIMIT, "mve_filter": "exclude"},
                                             args.base)
                if err:
                    log(f"  series {series} FAILED {err}")
                    continue
                for m in (payload or {}).get("markets", []) or []:
                    if m.get("ticker") in seen_tickers:
                        continue
                    seen_tickers.add(m.get("ticker"))
                    # GET /markets does NOT return series_ticker (it is an /events field;
                    # confirmed against the live response on 2026-11-21 and against the
                    # Get Markets schema). The series a row belongs to is known exactly
                    # from the documented `series_ticker` filter that returned it, so it
                    # is recorded as the request's value — not inferred from the ticker.
                    m = dict(m)
                    m["series_ticker"] = series
                    m["series_from_request"] = url
                    markets.append(m)
                    series_added += 1
        log(f"series fan-out -> {series_added} additional open markets from "
            f"{sum(len((b.get('series') or [])[:args.series_per_topic]) for b in (index.get('topics') or {}).values())} series")

    # 3. pick the biggest dollar-amount live market per topic. Ranking input is the
    #    official volume_24h_fp x notional_value_dollars; both operands come from the
    #    API, the product is labelled computed.
    scored = []
    skipped_no_series = 0   # counted below: rows whose series the event lookup did not supply
    for m in markets:
        topic, matched, field = classify(m)
        if not topic:
            continue
        # A market with no series_ticker cannot be charted: the candlestick path is
        # /series/{series}/markets/{ticker}/candlesticks. GET /markets omits the field,
        # so it is resolved from the official event (event_series(), step 4) for the
        # selected rows only. Observed 2026-11-21: quote(None) raised
        # "TypeError: quote_from_bytes() expected bytes" and kept run 44876739087 red.
        if not m.get("ticker"):
            skipped_no_series += 1
            continue
        vol24 = fnum(m.get("volume_24h_fp")) or fnum(m.get("volume_fp")) or 0.0
        notional = fnum(m.get("notional_value_dollars")) or 1.0
        scored.append({
            "topic": topic,
            "match_text": matched,
            "match_field": field,
            "series_ticker": m.get("series_ticker"),
            "event_ticker": m.get("event_ticker"),
            "market_ticker": m.get("ticker"),
            "title": m.get("title"),
            "subtitle": m.get("yes_sub_title") or m.get("subtitle"),
            "status": m.get("status"),
            "yes_bid_dollars": m.get("yes_bid_dollars"),
            "yes_ask_dollars": m.get("yes_ask_dollars"),
            "no_bid_dollars": m.get("no_bid_dollars"),
            "last_price_dollars": m.get("last_price_dollars"),
            "previous_price_dollars": m.get("previous_price_dollars"),
            "volume_24h_fp": m.get("volume_24h_fp"),
            "open_interest_fp": m.get("open_interest_fp"),
            "notional_value_dollars": m.get("notional_value_dollars"),
            "close_time": m.get("close_time"),
            "expected_expiration_time": m.get("latest_expiration_time") or m.get("expected_expiration_time"),
            "rules_primary": m.get("rules_primary"),
            "dollar_notional_24h_computed": round(vol24 * notional, 2),
            "result": m.get("result"),
            "settlement_value_dollars": m.get("settlement_value_dollars"),
            "settlement_ts": m.get("settlement_ts"),
            "source": f"{args.base}/markets?status=open&limit={MAX_LIMIT}",
        })
    ranked: dict[str, list[dict]] = {t: [] for t in TOPICS}
    for row in sorted(scored, key=lambda r: -r["dollar_notional_24h_computed"]):
        bucket = ranked.setdefault(row["topic"], [])
        if len(bucket) < args.markets_per_topic:
            bucket.append(row)
    chosen = [r for rows in ranked.values() for r in rows]
    log(f"topic picks -> " + ", ".join(f"{t}:{len(v)}" for t, v in ranked.items()) +
         f" (of {len(scored)} topic-matched; {skipped_no_series} skipped for a missing series_ticker)")

    # Keep the initial events probe separate from per-market event lookups.
    event_cache = dict(events)

    # 4. order book + candles for each chosen market
    for row in chosen:
        t = row["market_ticker"]
        # Resolve the series from the official event (GET /events/{ticker}); never from a
        # ticker prefix. A market with no resolvable series still gets its order book, and
        # its candle slots are emitted empty with the reason, so nothing is invented.
        ser, ser_source, ser_err = event_series(row.get("event_ticker"), event_cache, args.base)
        if not ser:
            log(f"  {t}: no series_ticker ({ser_err}); candles left empty")
        row["series_ticker"] = ser
        row["series_source"] = ser_source
        row["series_error"] = ser_err
        ob, ob_url, ob_err = get_json(f"/markets/{urllib.parse.quote(t)}/orderbook", None, args.base)
        book = (ob or {}).get("orderbook_fp") or (ob or {}).get("orderbook") or {}
        yb = book.get("yes_dollars") or book.get("yes") or []
        nb = book.get("no_dollars") or book.get("no") or []
        row["orderbook"] = {
            "yes_bids": [{"price": p, "contracts": c} for p, c in yb],
            "no_bids": [{"price": p, "contracts": c} for p, c in nb],
            "best_yes_bid": yb[-1][0] if yb else None,
            # documented identity, not a returned field
            "implied_yes_ask": (round(1.0 - float(nb[-1][0]), 4) if nb else None),
            "source": ob_url,
            "error": ob_err,
        }
        candles = {}
        for label, span_hours, interval in CANDLE_WINDOWS:
            if not ser:
                candles[label] = {"period_minutes": interval, "points": [],
                                  "source": None, "error": ser_err}
                continue
            end = int(time.time())
            start = end - int(span_hours * 3600)
            payload, url, err = get_json(
                f"/series/{urllib.parse.quote(ser, safe='')}/markets/{urllib.parse.quote(t, safe='')}/candlesticks",
                {"start_ts": start, "end_ts": end, "period_interval": interval}, args.base)
            pts = [candle_point(c) for c in (payload or {}).get("candlesticks", []) or []]
            candles[label] = {"period_minutes": interval, "points": pts,
                              "source": url, "error": err}
        row["candles"] = candles
        log(f"  {t}: book {'ok' if not ob_err else ob_err}, "
            + ", ".join(f"{k}:{len(v['points'])}" for k, v in candles.items()))

    # 5. recently settled markets: how each one resolved (yes / no / scalar)
    settled: list[dict] = []
    cursor = None
    s_pages = 0
    seen_topics: dict[str, int] = {t: 0 for t in TOPICS}
    for _ in range(6):
        payload, url, err = get_json("/markets", {"status": "settled", "limit": MAX_LIMIT,
                                                  "mve_filter": "exclude", "cursor": cursor}, args.base)
        if err:
            log(f"settled page {s_pages} FAILED {err}")
            break
        s_pages += 1
        for m in (payload or {}).get("markets", []) or []:
            topic, matched, field = classify(m)
            if not topic or seen_topics.get(topic, 0) >= 4:
                continue
            seen_topics[topic] = seen_topics.get(topic, 0) + 1
            settled.append({
                "topic": topic, "match_text": matched, "match_field": field,
                "series_ticker": m.get("series_ticker"),
                "event_ticker": m.get("event_ticker"),
                "market_ticker": m.get("ticker"),
                "title": m.get("title"),
                "status": m.get("status"),
                "result": m.get("result"),
                "last_price_dollars": m.get("last_price_dollars"),
                "settlement_value_dollars": m.get("settlement_value_dollars"),
                "settlement_ts": m.get("settlement_ts"),
                "close_time": m.get("close_time"),
                "volume_fp": m.get("volume_fp"),
                "notional_value_dollars": m.get("notional_value_dollars"),
                "source": url,
            })
        cursor = (payload or {}).get("cursor")
        if not cursor or all(v >= 4 for v in seen_topics.values()):
            break
    # 6. awaiting-determination: `status=closed` matches any market past close_time that
    #    is not yet finalized (https://docs.kalshi.com/getting_started/market_lifecycle),
    #    i.e. exactly the "watch until it resolves" set.
    pending: list[dict] = []
    cursor = None
    p_pages = 0
    seen_pending: dict[str, int] = {t: 0 for t in TOPICS}
    for _ in range(4):
        payload, url, err = get_json("/markets", {"status": "closed", "limit": MAX_LIMIT,
                                                  "mve_filter": "exclude", "cursor": cursor}, args.base)
        if err:
            log(f"closed page {p_pages} FAILED {err}")
            break
        p_pages += 1
        for m in (payload or {}).get("markets", []) or []:
            topic, matched, field = classify(m)
            if not topic or seen_pending.get(topic, 0) >= 4:
                continue
            seen_pending[topic] = seen_pending.get(topic, 0) + 1
            pending.append({
                "topic": topic, "match_text": matched, "match_field": field,
                "series_ticker": m.get("series_ticker"),
                "event_ticker": m.get("event_ticker"),
                "market_ticker": m.get("ticker"),
                "title": m.get("title"),
                "status": m.get("status"),
                "result": m.get("result"),
                "last_price_dollars": m.get("last_price_dollars"),
                "close_time": m.get("close_time"),
                "expected_expiration_time": m.get("latest_expiration_time"),
                "volume_fp": m.get("volume_fp"),
                "notional_value_dollars": m.get("notional_value_dollars"),
                "source": url,
            })
        cursor = (payload or {}).get("cursor")
        if not cursor or all(v >= 4 for v in seen_pending.values()):
            break
    log(f"awaiting determination -> {len(pending)} rows over {p_pages} page(s)")
    log(f"settled -> {len(settled)} rows over {s_pages} page(s)"
        f" ({', '.join(f'{k}:{v}' for k, v in seen_topics.items())})")

    payload = {
        "generated_utc": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "completed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "environment": "demo",
        "base": args.base,
        "note": ("Kalshi demo venue: mock funds; official docs warn prices and behavior may not "
                 "reflect real markets (https://docs.kalshi.com/getting_started/demo_env)."),
        "exchange_status": {"value": status, "source": status_url, "error": status_err},
        "events_probe": {"count": len(events), "pages": pages, "limit": MAX_LIMIT,
                         "error": ev_err,
                         "sample": sorted(events.values(), key=lambda e: e["event_ticker"] or "")[:5],
                         "source": f"{args.base}/events?limit={MAX_LIMIT}"},
        "ranking": {
            "basis": "volume_24h_fp x notional_value_dollars, labelled computed",
            "why": ("no official USD-volume field exists on GET /markets; the two operands are "
                    "official, their product is arithmetic"),
            "topic_matched_rows": len(scored),
            "markets_pages_read": m_pages,
        },
        "topics": {t: {"label": t, "picked": len(ranked.get(t, []))} for t in TOPICS},
        "markets": chosen,
        "settled": settled,
        "awaiting_determination": pending,
        "requests": requests_log,
        "request_count": len(requests_log),
        "failed_requests": [r for r in requests_log if r.get("error")],
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    size = os.path.getsize(args.out)
    log(f"wrote {args.out} ({size} bytes, {len(requests_log)} requests, "
        f"{len(payload['failed_requests'])} failures)")
    notice(f"engine_refresh: markets={len(chosen)} settled={len(settled)} "
           f"pending={len(pending)} "
           f"events_probe={len(events)} (err={ev_err or 'none'}) "
           f"requests={len(requests_log)} failures={len(payload['failed_requests'])} bytes={size}")
    if not chosen:
        # Publishing an empty snapshot would silently blank the engine page. Fail loudly
        # instead, with the reason in a check annotation that survives the log host.
        first = payload["failed_requests"][0] if payload["failed_requests"] else None
        print("::error::engine_refresh collected 0 topic markets"
              + (f" — first failed request {first.get('url')}: {first.get('error')}" if first else ""),
              flush=True)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - last-resort diagnostic for CI
        import traceback

        tb = traceback.format_exc()
        print(tb, file=sys.stderr, flush=True)
        last = tb.strip().splitlines()[-1] if tb.strip() else ""
        print(f"::error::engine_refresh crashed: {type(exc).__name__}: {exc} "
              f"| {last}", flush=True)
        sys.exit(1)
