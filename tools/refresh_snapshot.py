#!/usr/bin/env python3
"""Refresh data/snapshot.json from the Kalshi demo REST API.

Stdlib only, no third-party packages. Unauthenticated public reads only — this
script never sends a signing key and never writes anything except the snapshot
file (and the request log inside it).

Rules enforced here, because they are the rules the whole site depends on:

* copy API fields verbatim under the same name; keep decimal strings as strings
* a field the API did not return becomes null, never 0 and never an estimate
* nothing is inferred to "complete" a row; short rows stay short
* every row carries the exact URL that produced it, so provenance.html is truthful
* pagination cursors are followed unchanged until one comes back empty

Usage
    python3 tools/refresh_snapshot.py --out data/snapshot.json
    python3 tools/refresh_snapshot.py --check          # probe API quirks, no write
    python3 tools/refresh_snapshot.py --with-trades    # also sum exact turnover
    python3 tools/refresh_snapshot.py --base https://external-api.kalshi.com/trade-api/v2
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
USER_AGENT = "kalshi-demo-dashboard/1.0 (snapshot collector; read-only)"

# --- topic scoping recipe -----------------------------------------------------
# The brief's five topics only. Each entry is (topic key, request path, query).
# These filters were the only ones that returned data in the demo environment;
# see flagged.html#fl-5 for Culture being nearly empty, and questions.html#q-6
# for why "elections" is a category list rather than a search term.
TOPIC_QUERIES = [
    ("gas-prices", "/events", {"series_ticker": "KXAAAGASM", "status": "open", "limit": 200}),
    ("crypto", "/events", {"series_ticker": "KXBTC15M", "status": "open", "limit": 200}),
    ("golf", "/events", {"tags": "Golf", "status": "open", "limit": 200}),
    ("elections", "/events", {"series_ticker": "KXCABALLOTMEASURES", "status": "open", "limit": 200}),
    ("culture", "/events", {"series_ticker": "KXXBANNEDGROK", "status": "open", "limit": 200}),
]

SERIES_QUERIES = [
    ("gas-prices", "/series", {"tags": "Gas", "include_volume": "true"}),
    ("crypto", "/series", {"tags": "BTC", "include_volume": "true"}),
    ("golf", "/series", {"tags": "Golf", "include_volume": "true"}),
    ("elections", "/series", {"category": "Elections", "include_volume": "true"}),
    ("culture", "/series", {"category": "Culture", "include_volume": "true"}),
]

# Market fields copied verbatim (API name -> snapshot name). Anything not listed
# is not copied, so an accidental rename shows up as a null rather than a wrong value.
MARKET_FIELDS = [
    "ticker", "title", "yes_sub_title", "status", "result", "floor_strike", "strike_type",
    "last_price_dollars", "previous_price_dollars",
    "yes_bid_dollars", "yes_bid_size_fp", "yes_ask_dollars", "yes_ask_size_fp",
    "no_bid_dollars", "no_ask_dollars", "open_interest_fp", "volume_fp", "volume_24h_fp",
    "open_time", "close_time", "expected_expiration_time",
    "settlement_ts", "settlement_value_dollars", "rules_primary",
]

EVENT_FIELDS = [
    "event_ticker", "series_ticker", "title", "sub_title", "category",
    "exchange_index", "collateral_return_type", "mutually_exclusive", "strike_date",
]

MAX_PAGE_REQUESTS = 60      # safety stop for cursor loops
REQUEST_SPACING_S = 0.12    # stay far under the public unauthenticated budget


class Client:
    def __init__(self, base: str, timeout: float = 20.0):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.log: list[dict] = []
        self.ctx = ssl.create_default_context()

    def get(self, path: str, params: dict | None = None, note: str = ""):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        entry = {"request": url, "note": note}
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as resp:
                body = resp.read().decode("utf-8")
                entry.update(status=resp.status, bytes=len(body))
        except urllib.error.HTTPError as exc:
            entry.update(status=exc.code, error=str(exc.reason))
            self.log.append(entry)
            raise FetchError(f"HTTP {exc.code} for {url}") from exc
        except (urllib.error.URLError, ssl.SSLError, TimeoutError, OSError) as exc:
            entry.update(status=None, error=type(exc).__name__ + ": " + str(getattr(exc, "reason", exc))[:180])
            self.log.append(entry)
            raise FetchError(f"no response from {url} ({entry['error']})") from exc
        self.log.append(entry)
        time.sleep(REQUEST_SPACING_S)
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise FetchError(f"non-JSON response from {url}") from exc

    def paginate_events(self, params: dict):
        """Follow /events cursors to completion. Cursors are opaque: pass them back
        unchanged. Stop when the returned cursor is empty. Deduplicate by
        event_ticker because rows can repeat when a market's close time changes
        mid-scan (getting_started/pagination)."""
        seen, out, cursor = set(), [], None
        for _ in range(MAX_PAGE_REQUESTS):
            q = dict(params)
            q.setdefault("with_nested_markets", "true")
            if cursor:
                q["cursor"] = cursor
            data = self.get("/events", q, note="events page")
            for ev in (data.get("events") or []):
                if ev.get("event_ticker") in seen:
                    continue
                seen.add(ev.get("event_ticker"))
                out.append(ev)
            cursor = data.get("cursor") or None
            if not cursor:
                break
        else:
            print(f"  ! stopped after {MAX_PAGE_REQUESTS} pages; result may be partial", file=sys.stderr)
        return out


class FetchError(RuntimeError):
    pass


def market_row(m: dict, source: str) -> dict:
    row = {k: m.get(k, None) for k in MARKET_FIELDS}
    row["source"] = source
    return row


def event_row(ev: dict, topic: str, source: str) -> dict:
    row = {k: ev.get(k, None) for k in EVENT_FIELDS}
    row["topic"] = topic
    row["event_status"] = ev.get("status", None)
    settle = (ev.get("markets") or [{}])[0].get("settlement_sources") or ev.get("settlement_sources") or []
    if isinstance(settle, list) and settle:
        first = settle[0] if isinstance(settle[0], dict) else {}
        row["settlement_source"] = {"name": first.get("name", ""), "url": first.get("url", "")}
    else:
        row["settlement_source"] = None
    row["source"] = source
    row["markets"] = [market_row(m, source) for m in (ev.get("markets") or [])]
    return row


def series_rows(data: dict, topic: str, source: str) -> list[dict]:
    out = []
    for s in (data.get("series") or []):
        out.append({
            "series_ticker": s.get("series_ticker"),
            "title": s.get("title"),
            "category": (s.get("category") or (s.get("categories") or [None])[0]),
            "tags": s.get("tags") or None,
            "frequency": s.get("frequency"),
            "volume_fp_contracts": s.get("volume_fp", None),   # null unless include_volume was honoured
            "topic": topic,
            "source": source,
        })
    return out


def build(client: Client, with_trades: bool) -> dict:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    snap: dict = {
        "schema_version": "1.1",
        "dataset": "kalshi-demo-topic-snapshot",
        "capture_window_utc": now + " to " + now,
        "captured_by": "tools/refresh_snapshot.py",
        "collection_method": "unauthenticated GET requests against the demo REST host; fields copied verbatim",
        "environment": "demo",
        "api_base_used": client.base,
        "credentials_used": None,
        "caveats": [
            "Demo-environment prices and volumes are simulated and do not represent production Kalshi markets.",
            "Kalshi's API exposes contract counts (volume_fp, volume_24h_fp, open_interest_fp), not dollar volume.",
            "Responses are cached for a short time by Kalshi, so prices, sizes and status can lag the exchange by several seconds.",
            "This file was produced by the collector in this repository; see provenance.html for the request log.",
        ],
        "events": [],
        "series_volume": [],
        "candlesticks": None,
        "orderbook": None,
        "api_behaviours_observed": [],
        "request_log": [],
    }

    try:
        status = client.get("/exchange/status", None, note="exchange liveness")
    except FetchError as exc:
        print(f"\nFATAL: {exc}\nThe demo host was unreachable from this machine; nothing was written.", file=sys.stderr)
        raise SystemExit(3)
    snap["exchange_status"] = {"source": client.base + "/exchange/status", **{
        k: status.get(k) for k in ("exchange_active", "trading_active", "intra_exchange_transfers_active")
    }, "shards": status.get("shards") or []}

    for topic, path, params in TOPIC_QUERIES:
        print(f"  events  {topic}")
        try:
            events = client.paginate_events(dict(params))
        except FetchError as exc:
            print(f"    ! skipped: {exc}", file=sys.stderr)
            snap["api_behaviours_observed"].append(f"topic query for {topic} failed: {exc}")
            continue
        src = client.base + path + "?" + urllib.parse.urlencode(params)
        for ev in events:
            snap["events"].append(event_row(ev, topic, src))
        if not events:
            snap["api_behaviours_observed"].append(f"{topic}: {src} returned no events at capture time.")

    for topic, path, params in SERIES_QUERIES:
        print(f"  series  {topic}")
        try:
            data = client.get(path, dict(params), note="series volumes")
        except FetchError as exc:
            print(f"    ! skipped: {exc}", file=sys.stderr)
            continue
        snap["series_volume"] += series_rows(data, topic, client.base + path + "?" + urllib.parse.urlencode(params))

    # Candlesticks + book for the first open crypto market: the only fast-minting series in demo.
    crypto = next((e for e in snap["events"] if e["topic"] == "crypto" and e["markets"]), None)
    if crypto:
        m = crypto["markets"][0]
        t = m.get("ticker")
        series = m.get("ticker", "").rsplit("-", 2)[0]
        end = int(time.time())
        start = end - 3600
        try:
            c = client.get(f"/series/{series}/markets/{t}/candlesticks",
                           {"start_ts": start, "end_ts": end, "period_interval": 1}, note="1-minute candles")
            snap["candlesticks"] = {
                "series_ticker": series, "ticker": t, "period_interval_minutes": 1,
                "start_ts": start, "end_ts": end,
                "source": f"{client.base}/series/{series}/markets/{t}/candlesticks?start_ts={start}&end_ts={end}&period_interval=1",
                "candles": c.get("candlesticks") or [],
            }
        except FetchError as exc:
            snap["api_behaviours_observed"].append(f"candlestick fetch failed: {exc}")
        try:
            o = client.get(f"/markets/{t}/orderbook", None, note="order book")
            ob = o.get("orderbook_fp") or {}
            snap["orderbook"] = {
                "ticker": t, "captured_at_utc": snap["capture_window_utc"],
                "yes_dollars": ob.get("yes_dollars") or [], "no_dollars": ob.get("no_dollars") or [],
                "source": f"{client.base}/markets/{t}/orderbook",
                "note": "Empty arrays mean no resting orders, not missing data; an unknown ticker also returns 200 with empty arrays.",
            }
        except FetchError as exc:
            snap["api_behaviours_observed"].append(f"orderbook fetch failed: {exc}")

    if with_trades:
        print("  trades  (exact turnover)")
        for e in snap["events"]:
            total, covered, missing = 0.0, 0, 0   # missing counts legs the tape could not be read for
            for m in e["markets"]:
                try:
                    data = client.get("/trades", {"ticker": m["ticker"], "limit": 1000}, note="tape")
                except FetchError as exc:
                    snap["api_behaviours_observed"].append(f"/trades for {m['ticker']} failed: {exc}")
                    missing += 1
                    continue
                trades = data.get("trades") or []
                if trades:
                    covered += 1
                    for tr in trades:
                        try:
                            total += float(tr.get("price_dollars") or tr.get("yes_price") or 0) * float(tr.get("count") or 0)
                        except (TypeError, ValueError):
                            pass
            if covered and not missing:
                e["turnover_usd_exact"] = round(total, 6)
                e["turnover_covered_markets"] = covered
                e["turnover_total_markets"] = len(e["markets"])

    snap["request_log"] = client.log
    return snap


def check(client: Client) -> int:
    """Re-verify the two API behaviours the UI branches on. Prints, never writes."""
    rc = 0
    print("checks against", client.base)
    try:
        data = client.get("/series", {"category": "Crypto", "limit": 5}, note="limit-ignored probe")
        n = len(data.get("series") or [])
        print(f"  /series?limit=5 returned {n} series ->", "limit IGNORED (as documented)" if n > 5 else "limit honoured (update the docs note!)")
        if n <= 5:
            rc = 1
    except FetchError as exc:
        print("  /series probe failed:", exc); rc = 1
    try:
        data = client.get("/series", {"tags": "NoSuchTagHere123"}, note="unknown-tag probe")
        print("  unknown tag ->", "series:null (as documented)" if data.get("series") is None else "series:[] — API changed")
    except FetchError as exc:
        print("  tag probe failed:", exc); rc = 1
    try:
        client.get("/markets/DOES-NOT-EXIST-999999/orderbook", None, note="empty-book probe")
        print("  unknown ticker orderbook -> 200 (empty, not 404) as documented")
    except FetchError as exc:
        print("  orderbook probe returned:", exc, "(non-200 would be an API change)")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE, help="REST root; defaults to the demo host in the brief")
    ap.add_argument("--out", default="data/snapshot.json", help="where to write the snapshot")
    ap.add_argument("--check", action="store_true", help="probe documented API quirks and exit")
    ap.add_argument("--with-trades", action="store_true", help="also sum exact turnover from GET /trades")
    ap.add_argument("--dry-run", action="store_true", help="collect, print counts, write nothing")
    a = ap.parse_args()

    client = Client(a.base)
    if a.check:
        return check(client)

    print("collecting from", client.base)
    snap = build(client, a.with_trades)
    ok = sum(1 for e in client.log if e.get("status") == 200)
    print(f"events {len(snap['events'])} · markets {sum(len(e['markets']) for e in snap['events'])} · "
          f"series rows {len(snap['series_volume'])} · requests {len(client.log)} ({ok} ok)")
    if a.dry_run:
        print("--dry-run: nothing written")
        return 0
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("wrote", a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
