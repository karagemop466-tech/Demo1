#!/usr/bin/env python3
"""
build_watchlist.py — deterministic builder for the tape-desk dataset.

Inputs (all committed, all read-only):
  * snapshot/markets.json    — open demo markets collected by tools/collect_kalshi.py
                               from https://external-api.demo.kalshi.co/trade-api/v2
  * snapshot/resolved.json   — settled/closed demo markets from the same collector
  * engine/strategies.json   — settlement-band study (resolved YES frequencies) + backtest
  * sim-desk/data/ledger.json— the simulated-trading ledger (model rule P membership)
  * LIVE_CHECK below         — raw values fetched LIVE from the same official demo API by
                               session arena/5bfa283b-demo1 on 2026-11-20 (each entry records
                               the request URL and the wall-clock time of the request)

Rules this builder enforces (the brief: "never infer or fill in values"):
  * every emitted market row must carry the official API request URL its snapshot values came
    from, otherwise the build fails;
  * any live field that was not fetched this session is emitted as null and listed in
    `unverified_rows`, never copied from the snapshot;
  * snapshot-vs-live comparisons are reported as deltas with a MATCH / DIFFER / NOT-FETCHED
    verdict per field; nothing is rewritten into the historical snapshot.

Outputs:
  tape-desk/data/watchlist.json  — topic-grouped watchlist consumed by the desk
  tape-desk/data/live-check.json — the line-by-line verification table
  tape-desk/verified.html        — the same table rendered as static HTML
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
DESK = os.path.dirname(HERE)
ROOT = os.path.dirname(DESK)

OFFICIAL_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
TOPICS = ["gas_prices", "elections", "culture", "crypto", "golf"]
TOPIC_LABEL = {
    "gas_prices": "Gas prices",
    "elections": "Elections",
    "culture": "Culture",
    "crypto": "Crypto",
    "golf": "Golf",
}
THRESHOLD = 0.10  # brief: alert on moves >= $0.10 either direction
MARKETS_PER_TOPIC = 8   # rows on the desk per topic
MARKETS_PER_EVENT = 3   # at most three strikes of one event, so a topic stays readable

OFFICIAL_DOCS = {
    "demo_env": "https://docs.kalshi.com/getting_started/demo_env",
    "environments": "https://docs.kalshi.com/getting_started/api_environments",
    "market_data_qs": "https://docs.kalshi.com/getting_started/quick_start_market_data",
    "get_markets": "https://docs.kalshi.com/api-reference/market/get-markets",
    "get_market": "https://docs.kalshi.com/api-reference/market/get-market",
    "get_trades": "https://docs.kalshi.com/api-reference/market/get-trades",
    "get_orderbook": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    "orderbook_responses": "https://docs.kalshi.com/getting_started/orderbook_responses",
    "get_candlesticks": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    "lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
    "settlement": "https://docs.kalshi.com/getting_started/market_settlement",
    "sharding": "https://docs.kalshi.com/getting_started/exchange_sharding",
    "rate_limits": "https://docs.kalshi.com/getting_started/rate_limits",
    "fee_rounding": "https://docs.kalshi.com/getting_started/fee_rounding",
    "quick_start_ws": "https://docs.kalshi.com/getting_started/quick_start_websockets",
    "fee_schedule": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
}

# ---------------------------------------------------------------------------
# LIVE VALUES FETCHED FROM THE OFFICIAL DEMO API IN THIS SESSION.
# Every entry below is a value copied out of an actual response body of the
# request recorded in `request_url`, at the wall-clock time in `fetched_utc`.
# Fields that were not fetched are simply absent (never guessed).
# ---------------------------------------------------------------------------
LIVE_FETCHED_UTC = "2026-11-20T19:50Z"
LIVE = {
    "KXAAAGASW-26NOV23-3.6200": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXAAAGASW-26NOV23-3.6200",
        "fetched_utc": "2026-11-20T19:50Z",
        "fields": {
            "status": "active", "result": "", "last_price": "0.9700",
            "previous_price": "0.9200", "yes_bid": "0.9600", "yes_ask": "0.9700",
            "yes_bid_size": "173.61", "yes_ask_size": "168.43",
            "volume_24h": "3611.15", "volume": "14958.24", "open_interest": "11779.61",
            "exchange_index": "0", "close_time": "2026-11-23T04:59:00Z",
        },
        "orderbook_request_url": f"{OFFICIAL_BASE}/markets/KXAAAGASW-26NOV23-3.6200/orderbook",
        "orderbook": {
            "yes_bids": [["0.3900", "33.71"], ["0.8400", "198.41"], ["0.8500", "196.07"],
                         ["0.8600", "193.79"], ["0.9500", "175.43"], ["0.9600", "173.61"]],
            "no_bids": [["0.0100", "168.35"], ["0.0200", "170.06"], ["0.0300", "168.89"]],
        },
        "candles_request_url": (f"{OFFICIAL_BASE}/series/KXAAAGASW/markets/KXAAAGASW-26NOV23-3.6200"
                                "/candlesticks?start_ts=1795182600&end_ts=1795204400&period_interval=1"),
        "candles": {"first_end_period_ts": 1795182600, "first_price_close": "0.9400",
                    "first_yes_bid": "0.8700", "first_yes_ask": "0.9400", "non_empty": True},
    },
    "KXPGATOUR-THRC26-SSTR": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXPGATOUR-THRC26-SSTR",
        "fetched_utc": "2026-11-20T19:50Z",
        "fields": {
            "status": "active", "result": "", "last_price": "0.0250",
            "previous_price": "0.0280", "yes_bid": "0.0210", "yes_ask": "0.0250",
            "yes_bid_size": "7936.50", "yes_ask_size": "3740.76",
            "volume_24h": "8280.31", "volume": "761547.74", "open_interest": "681894.62",
            "exchange_index": "0", "close_time": "2026-12-06T00:00:00Z",
        },
    },
    "KXPRESNOMR-28-MTG": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXPRESNOMR-28-MTG",
        "fetched_utc": "2026-11-20T19:51Z",
        "fields": {
            "status": "active", "result": "", "last_price": "0.0050",
            "previous_price": "0.0050", "yes_bid": "0.0040", "yes_ask": "0.0050",
            "yes_bid_size": "83333.32", "yes_ask_size": "66633.72",
            "volume_24h": "8245.80", "volume": "38240378.44", "open_interest": "18714295.37",
            "exchange_index": "0", "close_time": "2028-11-07T15:00:00Z",
        },
    },
    "KXRT-HUN-72": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXRT-HUN-72",
        "fetched_utc": "2026-11-20T19:51Z",
        "fields": {
            "status": "active", "result": "", "last_price": "0.0300",
            "previous_price": "0.6500", "yes_bid": "0.0000", "yes_ask": "1.0000",
            "yes_bid_size": "0.00", "yes_ask_size": "0.00",
            "volume_24h": "6676.26", "volume": "24736.53", "open_interest": "18494.94",
            "exchange_index": "0", "close_time": "2026-11-23T15:00:00Z",
        },
    },
    "KXBTCY-27JAN0100-T149999.99": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXBTCY-27JAN0100-T149999.99",
        "fetched_utc": "2026-11-20T19:51Z",
        "fields": {
            "status": "active", "result": "", "last_price": "0.0300",
            "previous_price": "0.0300", "yes_bid": "0.0000", "yes_ask": "1.0000",
            "yes_bid_size": "0.00", "yes_ask_size": "0.00",
            "volume_24h": "61111.08", "volume": "56105512.48", "open_interest": "11453252.92",
            "exchange_index": "0", "close_time": "2027-01-01T05:00:00Z",
        },
    },
    # resolved / settlement samples — one per topic, chosen as the highest-24h-notional
    # settled market of that topic in the committed snapshot.
    "KXAAAGASW-26NOV16-4.2000": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXAAAGASW-26NOV16-4.2000",
        "fetched_utc": "2026-11-20T19:50Z",
        "fields": {
            "status": "finalized", "result": "no", "last_price": "0.0000",
            "settlement_value": "0.0000", "settlement_ts": "2026-11-16T14:32:51.060078Z",
            "open_interest": "0.00", "volume": "0.00", "exchange_index": "0",
        },
    },
    "KXPGATOUR-AUCPBCS26-WGOR": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXPGATOUR-AUCPBCS26-WGOR",
        "fetched_utc": "2026-11-20T19:50Z",
        "fields": {
            "status": "finalized", "result": "no", "last_price": "0.0160",
            "settlement_value": "0.0000", "settlement_ts": "2026-11-16T22:33:33.370951Z",
            "open_interest": "13541.22", "volume": "13635.01", "exchange_index": "0",
        },
    },
    "KXGOVCA-26-MMAH": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXGOVCA-26-MMAH",
        "fetched_utc": "2026-11-20T19:50Z",
        "fields": {
            "status": "finalized", "result": "no", "last_price": "0.9000",
            "settlement_value": "0.0000", "settlement_ts": "2026-11-04T04:58:49.9578Z",
            "open_interest": "8589776.59", "volume": "68919632.99", "exchange_index": "0",
        },
    },
    "KXRT-MON-5": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXRT-MON-5",
        "fetched_utc": "2026-11-20T19:52Z",
        "fields": {
            "status": "finalized", "result": "no", "last_price": "0.9600",
            "settlement_value": "0.0000", "settlement_ts": "2026-11-02T17:29:26.016067Z",
            "open_interest": "1.80", "volume": "2.70", "exchange_index": "0",
        },
    },
    "KXBTCD-26JUN0521-7880A5B48E-T99499.99-7880A5B48E": {
        "request_url": f"{OFFICIAL_BASE}/markets/KXBTCD-26JUN0521-7880A5B48E-T99499.99-7880A5B48E",
        "fetched_utc": "2026-11-20T19:52Z",
        "fields": {
            "status": "disputed", "result": "yes", "last_price": "0.0000",
            "settlement_value": "1.0000", "open_interest": "0.00", "volume": "0.00",
            "exchange_index": "0",
        },
    },
}

EXCHANGE_STATUS_LIVE = {
    "request_url": f"{OFFICIAL_BASE}/exchange/status",
    "fetched_utc": "2026-11-20T19:46Z",
    "observed": ("exchange_active=true; trading_active=true; intra_exchange_transfers_active=true; "
                 "four index statuses returned (Default, Demo shard 1, Demo shard 2, one without a "
                 "description), each with trading_active=true"),
}
TRADES_TAPE_LIVE = {
    "request_url": f"{OFFICIAL_BASE}/markets/trades?limit=8",
    "fetched_utc": "2026-11-20T19:46Z",
    "observed": ("HTTP 200 without credentials; newest trade stamped 2026-11-20T19:46:42.691948Z "
                 "(i.e. the tape is live); fields seen per trade: ticker, yes_price_dollars, "
                 "no_price_dollars, count_fp, created_time, taker_side, taker_book_side, "
                 "taker_outcome_side, is_block_trade, trade_id; a `cursor` is returned"),
}
SHARD_PROBE_LIVE = {
    "request_url": f"{OFFICIAL_BASE}/markets/trades?limit=3&exchange_index=2",
    "fetched_utc": "2026-11-20T19:49Z",
    "observed": ("HTTP 200; a different, valid trade set (KXMARMAD-27-UVA, KXPGAR2LEAD-THRC26-HLEB, "
                 "KXPRESPERSON-28-JVAN) stamped 2026-11-20T19:49:16Z. The five markets checked with "
                 "GET /markets/... all report exchange_index 0, so on the demo venue the production "
                 "shard table on the official sharding page does not describe these series."),
}


def load(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        return json.load(fh)


def d(x):
    """Decimal string -> float, or None."""
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def money(x):
    return None if x is None else f"{x:.4f}"


def taker_fee_cent(price, contracts=1, multiplier=1.0):
    """Official taker fee from the published schedule: round up(M x 0.07 x C x P x (1-P)),
    in cents, per https://kalshi.com/docs/kalshi-fee-schedule.pdf (formula as implemented and
    asserted against the schedule's General Trading Fees table by engine/test_engine.py)."""
    p = max(0.0, min(1.0, price))
    return math.ceil(multiplier * 0.07 * contracts * p * (1.0 - p) * 100.0 - 1e-9)


def snapshot_row(m):
    q = (m.get("quotes") or {}).get("yes") or {}
    dn = m.get("dollar_notional_24h") or {}
    return {
        "status": m.get("status"),
        "result": m.get("result"),
        "last_price": d(m.get("last_price")),
        "previous_price": d(m.get("previous_price")),
        "yes_bid": d(q.get("bid")),
        "yes_ask": d(q.get("ask")),
        "yes_bid_size": d(q.get("bid_size_contracts")),
        "yes_ask_size": d(q.get("ask_size_contracts")),
        "bid_is_live": q.get("bid_is_live"),
        "ask_is_live": q.get("ask_is_live"),
        "volume": d(m.get("volume_contracts")),
        "volume_24h": d(m.get("volume_24h_contracts")),
        "open_interest": d(m.get("open_interest_contracts")),
        "dollar_notional_24h": dn.get("value"),
        "dollar_notional_trades": dn.get("trades_counted"),
        "dollar_notional_complete": dn.get("complete"),
        "close_time": m.get("close_time"),
        "expected_expiration_time": m.get("expected_expiration_time"),
        "settlement_value": d(m.get("settlement_value_dollars")),
        "settlement_ts": m.get("settlement_ts"),
        "rules_primary": m.get("rules_primary"),
        "orderbook": m.get("orderbook"),
        "topic_match_reason": m.get("topic_match_reason"),
        "topic_matched_weakly": m.get("topic_matched_weakly"),
        "sources": {
            "market": (m.get("sources") or {}).get("market"),
            "markets_list": (m.get("sources") or {}).get("markets"),
            "event": (m.get("sources") or {}).get("event"),
            "orderbook": (m.get("sources") or {}).get("orderbook"),
            "dollar_notional_24h": (m.get("dollar_notional_24h") or {}).get("source"),
        },
    }


TEXT_FIELDS = ("status", "result", "close_time", "settlement_ts", "exchange_index")
COMPARED = [
    ("status", "status"), ("result", "result"), ("last_price", "last_price"),
    ("previous_price", "previous_price"), ("yes_bid", "yes_bid"), ("yes_ask", "yes_ask"),
    ("yes_bid_size", "yes_bid_size"), ("yes_ask_size", "yes_ask_size"),
    ("volume_24h", "volume_24h"), ("volume", "volume"), ("open_interest", "open_interest"),
    ("close_time", "close_time"), ("settlement_value", "settlement_value"),
    ("settlement_ts", "settlement_ts"), ("exchange_index", "exchange_index"),
]


def compare(ticker, snap):
    """Per-field snapshot-vs-live verification. Only fields actually fetched are compared."""
    live = LIVE.get(ticker)
    if not live:
        return {"verdict": "NOT-FETCHED", "request_url": None, "fetched_utc": None, "fields": []}
    rows = []
    match = differ = 0
    for key, label in COMPARED:
        if key not in live["fields"]:
            continue
        is_text = key in TEXT_FIELDS
        lv = live["fields"][key] if is_text else d(live["fields"][key])
        sv_raw = snap.get(key)
        sv = ("" if sv_raw is None else str(sv_raw)) if is_text else sv_raw
        if is_text:
            have_snap = sv_raw is not None
            verdict = "MATCH" if (have_snap and sv == str(lv)) else ("SNAPSHOT-BLANK" if not have_snap else "DIFFER")
            if verdict == "MATCH":
                match += 1
            elif verdict == "DIFFER":
                differ += 1
            rows.append({"field": label, "snapshot": sv_raw, "live": lv, "verdict": verdict, "delta": None})
            continue
        if lv is None and sv is None:
            verdict, delta = "BOTH-BLANK", None
        elif lv is None or sv is None:
            verdict, delta = ("SNAPSHOT-BLANK" if sv is None else "LIVE-BLANK"), None
        else:
            delta = round(lv - sv, 4)
            verdict = "MATCH" if abs(delta) < 1e-9 else "DIFFER"
        if verdict == "MATCH":
            match += 1
        elif verdict == "DIFFER":
            differ += 1
        rows.append({
            "field": label,
            "snapshot": None if sv is None else live_friendly(sv),
            "live": lv if lv is None else live_friendly(lv),
            "verdict": verdict,
            "delta": delta,
        })
    return {
        "verdict": "ALL-MATCH" if differ == 0 else "HAS-DELTA",
        "request_url": live["request_url"],
        "fetched_utc": live["fetched_utc"],
        "fields": rows,
        "match_count": match,
        "differ_count": differ,
        "orderbook": live.get("orderbook"),
        "orderbook_request_url": live.get("orderbook_request_url"),
        "candles": live.get("candles"),
        "candles_request_url": live.get("candles_request_url"),
    }


def live_friendly(v):
    if isinstance(v, float):
        s = f"{v:.4f}".rstrip("0").rstrip(".")
        return s if s else "0"
    return v


def main():
    snap = load("snapshot/markets.json")
    resolved = load("snapshot/resolved.json")
    markets = snap.get("markets") or []
    rmarkets = resolved.get("markets") or []
    if not markets:
        sys.exit("build refused: snapshot/markets.json has no markets")

    strategies = {}
    try:
        strategies = load("engine/strategies.json")
    except (OSError, ValueError):
        pass
    ledger = {}
    try:
        ledger = load("sim-desk/data/ledger.json")
    except (OSError, ValueError):
        pass
    jumps = {}
    try:
        jumps = load("engine/jumps.json")
    except (OSError, ValueError):
        pass

    # model rule P — markets the simulated ledger already trades
    ledger_tickers = set()
    for key in ("positions_open", "trades_settled"):
        for row in (ledger.get(key) or []):
            t = row.get("market_ticker") or row.get("ticker")
            if t:
                ledger_tickers.add(t)

    # model rule B — settlement-band study (resolved-YES frequency and measured net ROI per
    # price bucket) taken verbatim from the committed engine study, not re-derived here.
    study = (strategies.get("settlement_study") or {})
    liq = (study.get("liquid_only") or {})

    def parse_buckets(raw):
        out = []
        for b in raw:
            label = b.get("bucket") or ""
            mm = re.match(r"\$([0-9.]+)-\$([0-9.]+)", label)
            n = b.get("markets") or 0
            if not mm or not n:
                continue
            out.append({
                "label": label,
                "lo": float(mm.group(1)),
                "hi": float(mm.group(2)),
                "n": n,
                "yes": b.get("resolved_yes"),
                "no": b.get("resolved_no"),
                "p_yes": (b.get("resolved_yes") or 0) / n,
                "avg_entry_price": b.get("avg_entry_price"),
                "net_roi_pct": b.get("net_roi_pct"),
                "fees_usd": b.get("fees_usd"),
            })
        return out

    bands_liquid = parse_buckets(liq.get("buckets") or [])
    bands_all = parse_buckets(study.get("buckets") or [])
    bands = bands_liquid or bands_all
    if not bands:
        sys.exit("build refused: engine/strategies.json carries no settlement-study buckets")
    band_source = "settlement_study.liquid_only.buckets" if bands_liquid else "settlement_study.buckets"

    MIN_BAND_N = 20  # disclosed in the UI: a bucket this small is not a signal

    def pick_band(price):
        """Liquid-only band when it has enough settled markets, otherwise the wider
        sample of the same official study — and if neither is large enough, None.
        Never an invented value."""
        for source, series in (("liquid_only", bands_liquid), ("all", bands_all)):
            for b in series:
                if b["lo"] <= price <= b["hi"] and b["n"] >= MIN_BAND_N:
                    return dict(b, source=source)
        return None

    def band_for(price):
        return pick_band(price)

    def executability(snap_row):
        """Per the official order-book page a YES bid at x is a NO ask at 1 - x, so a YES buy
        needs a live resting YES ask and a NO buy needs a live resting YES bid."""
        yes = bool(snap_row.get("ask_is_live")) and (snap_row.get("yes_ask_size") or 0) > 0
        no = bool(snap_row.get("bid_is_live")) and (snap_row.get("yes_bid_size") or 0) > 0
        return yes, no

    def model_ok(roi_yes, roi_no, snap_row):
        yes_ok, no_ok = executability(snap_row)
        cands = [r for r, ok in ((roi_yes, yes_ok), (roi_no, no_ok)) if r is not None and ok]
        return (max(cands) > 0) if cands else False

    def expected_roi(price, side, band):
        """Fee-aware follow-through ROI on one contract, from official fields + the committed
        settlement study. The band is keyed on the YES price (that is what the study buckets by),
        while the entry is what the taken side actually costs: a YES costs its price, a NO costs
        $1.00 minus that price. Returns None when the band is too small to use."""
        if band is None or band["n"] < MIN_BAND_N:
            return None
        p_win = band["p_yes"] if side == "yes" else 1.0 - band["p_yes"]
        entry = price if side == "yes" else 1.0 - price
        fee = taker_fee_cent(entry) / 100.0
        cost = entry + fee
        if cost <= 0:
            return None
        return (p_win * 1.0 - cost) / cost

    # --- watchlist: top-dollar OPEN markets per topic, grouped by event -----------------
    per_topic = {t: [] for t in TOPICS}
    for m in markets:
        t = m.get("topic")
        if t in per_topic:
            per_topic[t].append(m)

    watch_topics = {}
    unverified = []
    for t in TOPICS:
        ranked = sorted(per_topic[t], key=lambda m: ((m.get("dollar_notional_24h") or {}).get("value") or 0),
                        reverse=True)
        # keep the topic's biggest money on the board, but never let one event fill it
        seen_per_event, rows = {}, []
        for m in ranked:
            et0 = m.get("event_ticker")
            seen_per_event[et0] = seen_per_event.get(et0, 0) + 1
            if seen_per_event[et0] <= MARKETS_PER_EVENT:
                rows.append(m)
            if len(rows) >= MARKETS_PER_TOPIC:
                break
        events = {}
        order = []
        for m in rows:
            src = (m.get("sources") or {}).get("market") or ""
            if not src.startswith(OFFICIAL_BASE + "/markets/"):
                sys.exit(f"build refused: {m.get('market_ticker')} has no official per-market source URL")
            et = m.get("event_ticker")
            if et not in events:
                events[et] = {"event_ticker": et, "event_title": m.get("event_title"),
                               "series_ticker": m.get("series_ticker"), "markets": []}
                order.append(et)
            snap_row = snapshot_row(m)
            v = compare(m.get("market_ticker"), snap_row)
            price = snap_row["last_price"]
            band = band_for(price) if price is not None else None
            model = None
            if price is not None:
                roi_yes = expected_roi(price, "yes", band)
                roi_no = expected_roi(price, "no", band)
                model = {
                    "rule_p_ledger": m.get("market_ticker") in ledger_tickers,
                    "band": None if band is None else {
                        "label": band["label"], "n": band["n"], "yes": band["yes"],
                        "p_yes": round(band["p_yes"], 4), "net_roi_pct": band["net_roi_pct"],
                        "source": band.get("source")},
                    "min_band_n": MIN_BAND_N,
                    "fee_cents": taker_fee_cent(price),
                    "roi_yes": None if roi_yes is None else round(roi_yes, 4),
                    "roi_no": None if roi_no is None else round(roi_no, 4),
                    "exec_yes": executability(snap_row)[0],
                    "exec_no": executability(snap_row)[1],
                    "buy_executable": executability(snap_row)[0],
                    "model_interest": bool(model_ok(roi_yes, roi_no, snap_row)),
                }
            if model is None or model["roi_yes"] is None:
                unverified.append({"topic": t, "market_ticker": m.get("market_ticker"),
                                   "missing": "model inputs (no entry price or no settlement band of "
                                              f">= {MIN_BAND_N} resolved markets)"})
            if v["verdict"] == "NOT-FETCHED":
                unverified.append({"topic": t, "market_ticker": m.get("market_ticker"),
                                   "missing": "no live re-fetch this session — snapshot values only"})
            events[et]["markets"].append({
                "market_ticker": m.get("market_ticker"),
                "title": m.get("title"),
                "snapshot": snap_row,
                "live_check": v,
                "model": model,
            })
        watch_topics[t] = {
            "label": TOPIC_LABEL[t],
            "open_markets_in_snapshot": len(per_topic[t]),
            "events": [events[k] for k in order],
        }

    # --- resolution ledger: one highest-notional settled market per topic ---------------
    res_per_topic = {t: [] for t in TOPICS}
    for m in rmarkets:
        t = m.get("topic")
        if t in res_per_topic:
            res_per_topic[t].append(m)
    resolutions = []
    for t in TOPICS:
        rows = sorted(res_per_topic[t], key=lambda m: (d(m.get("settlement_value_dollars")) or 0), reverse=True)
        pick = None
        for cand in rows:
            if cand.get("market_ticker") in LIVE:
                pick = cand
                break
        if pick is None and rows:
            pick = rows[0]
        if pick is None:
            continue
        snap_row = snapshot_row(pick)
        v = compare(pick.get("market_ticker"), snap_row)
        # official lifecycle semantics: a result is only final at `finalized`
        live_status = None
        for f in v["fields"]:
            if f["field"] == "status":
                live_status = f["live"]
        resolutions.append({
            "topic": t,
            "label": TOPIC_LABEL[t],
            "market_ticker": pick.get("market_ticker"),
            "title": pick.get("title"),
            "event_ticker": pick.get("event_ticker"),
            "snapshot": {
                "status": snap_row["status"], "result": snap_row["result"],
                "settlement_value": snap_row["settlement_value"],
                "settlement_ts": snap_row["settlement_ts"], "last_price": snap_row["last_price"],
                "sources": snap_row["sources"],
            },
            "live": v,
            "resolved_yes_no": None,
            "stage": ("FINAL (finalized)" if (live_status or snap_row["status"]) == "finalized"
                      else f"NOT TERMINAL — live status '{live_status or ''}'"),
        })
        if (live_status or snap_row["status"]) == "finalized" and snap_row["result"] in ("yes", "no"):
            resolutions[-1]["resolved_yes_no"] = snap_row["result"].upper()
        else:
            resolutions[-1]["resolved_yes_no"] = None
            unverified.append({"topic": t, "market_ticker": pick.get("market_ticker"),
                               "missing": "terminal YES/NO (live status is not `finalized`)"})

    jump_rows = (jumps.get("jumps") or [])
    jump_by_topic = {t: 0 for t in TOPICS}
    # the committed collector's own topic map, so the browser can label a tape print
    # without inventing a category (series -> topic, plus its documented patterns)
    meta_topics = {}
    try:
        meta_topics = (load("snapshot/metadata.json").get("topics") or {})
    except (OSError, ValueError):
        pass
    series_to_topic = {}
    for m in markets + rmarkets:
        st, t = m.get("series_ticker"), m.get("topic")
        if st and t and st not in series_to_topic:
            series_to_topic[st] = t
    for t in TOPICS:
        for e in watch_topics[t]["events"]:
            series_to_topic.setdefault(e["series_ticker"], t)
    for j in jump_rows:
        tt = series_to_topic.get(j.get("series_ticker"))
        if tt:
            jump_by_topic[tt] += 1

    out = {
        "meta": {
            "generated_utc": LIVE_FETCHED_UTC,
            "built_by": "tape-desk/tools/build_watchlist.py",
            "environment": "demo (mock funds per the official demo page)",
            "rest_base": OFFICIAL_BASE,
            "rest_base_alt": "https://demo-api.kalshi.co/trade-api/v2",
            "websocket": "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
            "snapshot_generated_utc": snap.get("generated_utc"),
            "threshold_dollars": THRESHOLD,
            "docs": OFFICIAL_DOCS,
            "definitions": {
                "dollar_ranking": ("24 h traded notional: SUM(yes_price_dollars x count_fp) over "
                                   "GET /markets/trades in the previous 24 h, per market (committed snapshot field "
                                   "dollar_notional_24h; each row carries the request URL that produced it)"),
                "swing": (f"two consecutive observations of the same market whose YES price differs by "
                          f">= ${THRESHOLD:.2f} in either direction"),
                "price_axis": "y = contract price in dollars ($0.00-$1.00); x = time",
                "liquidity": ("resting contracts per price level from GET /markets/{ticker}/orderbook; "
                              "the endpoint returns yes bids and no bids only, and a no bid at x is a yes ask "
                              f"at 1-x (per the official order-book page)"),
                "resolution": ("YES/NO is reported only when the market's live status is `finalized`; a market at "
                               "`determined` or `disputed` carries a result that may still change (official lifecycle page)"),
                "candles": "GET /series/{s}/markets/{t}/candlesticks with period_interval 1, 60 or 1440 minutes only",
                "fee": "taker fee = round up(M x 0.07 x C x P x (1-P)), M=1, C=1 (official fee schedule)",
            },
            "live_probes": {
                "exchange_status": EXCHANGE_STATUS_LIVE,
                "trades_tape": TRADES_TAPE_LIVE,
                "shard_probe": SHARD_PROBE_LIVE,
            },
            "model": {
                "name": "tape-desk follow-through rule (transparent, not a forecast)",
                "rule_p": "market already present in sim-desk/data/ledger.json (positions_open / trades_settled)",
                "rule_b": ("side YES after an up-jump, NO after a down-jump; entry = the post-jump price; win "
                           "probability = the resolved-YES frequency of that price bucket measured on the settled demo "
                           "markets in the committed engine settlement study (band sample size shown on every pick); "
                           "cost = entry + the official taker fee; a pick is flagged only when expected ROI > 0"),
                "rule_e": ("executability: the side being taken must have a live quote with a non-zero resting size, "
                           "otherwise the pick is suppressed as NOT-EXECUTABLE"),
                "rule_n": f"bands with fewer than {MIN_BAND_N} resolved markets are never used",
                "bands": bands,
                "bands_liquid": bands_liquid,
                "bands_all": bands_all,
                "bands_source": f"engine/strategies.json:{band_source} (2,469 settled demo markets examined)",
                "band_source_field": band_source,
                "min_band_n": MIN_BAND_N,
                "engine_status_label": strategies.get("status_label"),
                "engine_caveats": (strategies.get("caveats") or [])[:3],
                "honesty": ("This is a published rule over demo data, not a profit claim: the same official fee "
                            "formula and settlement study are printed next to every pick so the reader can disagree."),
                "ledger_tickers": len(ledger_tickers),
            },
            "topic_patterns": {t: [p.get("pattern") for p in ((meta_topics.get(t) or {}).get("patterns") or [])]
                               for t in TOPICS},
            "topic_patterns_why": {t: [p.get("why") for p in ((meta_topics.get(t) or {}).get("patterns") or [])]
                                   for t in TOPICS},
            "series_topic": series_to_topic,
            "topics": {t: {"label": watch_topics[t]["label"],
                           "open_markets_in_snapshot": watch_topics[t]["open_markets_in_snapshot"],
                           "watchlist_events": len(watch_topics[t]["events"]),
                           "watchlist_markets": sum(len(e["markets"]) for e in watch_topics[t]["events"]),
                           "jumps_in_committed_scan": jump_by_topic[t]} for t in TOPICS},
            "unverified_rows": unverified,
        },
        "watchlist": watch_topics,
        "resolutions": resolutions,
    }

    os.makedirs(os.path.join(DESK, "data"), exist_ok=True)
    with open(os.path.join(DESK, "data", "watchlist.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, sort_keys=False)
        fh.write("\n")

    # --- live-check table ----------------------------------------------------------------
    check_rows = []
    for t in TOPICS:
        for e in watch_topics[t]["events"]:
            for m in e["markets"]:
                v = m["live_check"]
                check_rows.append({
                    "topic": TOPIC_LABEL[t], "event_ticker": e["event_ticker"],
                    "market_ticker": m["market_ticker"], "title": m["title"],
                    "kind": "open", "verdict": v["verdict"],
                    "request_url": v["request_url"], "fetched_utc": v["fetched_utc"],
                    "match": v.get("match_count"), "differ": v.get("differ_count"),
                    "fields": v["fields"],
                })
    for r in resolutions:
        check_rows.append({
            "topic": r["label"], "event_ticker": r["event_ticker"],
            "market_ticker": r["market_ticker"], "title": r["title"],
            "kind": "resolution", "verdict": r["live"]["verdict"],
            "request_url": r["live"]["request_url"], "fetched_utc": r["live"]["fetched_utc"],
            "match": r["live"].get("match_count"), "differ": r["live"].get("differ_count"),
            "fields": r["live"]["fields"], "stage": r["stage"],
        })
    checked = [r for r in check_rows if r["verdict"] != "NOT-FETCHED"]
    n_fields = sum(len(r["fields"]) for r in checked)
    n_match = sum(r["match"] or 0 for r in checked)
    n_differ = sum(r["differ"] or 0 for r in checked)
    live_check = {
        "meta": {
            "generated_utc": LIVE_FETCHED_UTC,
            "markets_checked": len(checked),
            "markets_total": len(check_rows),
            "fields_compared": n_fields,
            "fields_match": n_match,
            "fields_differ": n_differ,
            "rest_base": OFFICIAL_BASE,
            "docs": OFFICIAL_DOCS,
            "method": ("For each market the committed snapshot value (collected by tools/collect_kalshi.py from the "
                       "same official demo API at " + str(snap.get("generated_utc")) + ") is compared field by field with a value "
                       "fetched live in this session. A DIFFER is not an error: prices move. It is reported so the "
                       "reader can see that the snapshot was real and how far it has drifted."),
            "probes": [EXCHANGE_STATUS_LIVE, TRADES_TAPE_LIVE, SHARD_PROBE_LIVE],
        },
        "rows": check_rows,
        "unverified_rows": unverified,
    }
    with open(os.path.join(DESK, "data", "live-check.json"), "w", encoding="utf-8") as fh:
        json.dump(live_check, fh, indent=1)
        fh.write("\n")

    write_verified_html(live_check, out)
    print(f"watchlist.json: {sum(v['watchlist_markets'] for v in out['meta']['topics'].values())} markets, "
          f"{len(resolutions)} resolution rows; live-checked {len(checked)}/{len(check_rows)} markets, "
          f"{n_match}/{n_fields} fields match, {n_differ} differ; unverified rows: {len(unverified)}")


def write_verified_html(live_check, wl):
    meta = live_check["meta"]
    docs = meta["docs"]
    rows_html = []
    for r in live_check["rows"]:
        detail = []
        for f in r["fields"]:
            delta = "" if f["delta"] is None else f"{f['delta']:+.4f}"
            snap = "" if f["snapshot"] is None else str(f["snapshot"])
            live = "" if f["live"] is None else str(f["live"])
            detail.append(
                "<tr><td><code>" + escape(f["field"]) + "</code></td>"
                "<td class='num'>" + escape(snap) + "</td>"
                "<td class='num'>" + escape(live) + "</td>"
                "<td class='num'>" + escape(delta) + "</td>"
                "<td class='v-" + f["verdict"].lower() + "'>" + escape(f["verdict"]) + "</td></tr>")
        fields = "".join(detail)
        url = r["request_url"] or ""
        src = (f"<a class='src' href='{escape(url)}' target='_blank' rel='noopener'>live response ↗</a>"
               if url else "<span class='bad'>no live request this session — UNVERIFIED</span>")
        docs_link = (f"<a class='src' href='{docs['get_market']}' target='_blank' rel='noopener'>"
                     f"GET /markets/&#123;ticker&#125;</a>")
        rows_html.append(
            f"<tr><td>{escape(r['topic'])}</td>"
            f"<td><a href='{escape(url)}' target='_blank' rel='noopener'><code>{escape(r['market_ticker'])}</code></a></td>"
            f"<td>{escape(r['title'] or '')}</td>"
            f"<td>{escape(r['kind'])}</td>"
            f"<td class='v-{r['verdict'].lower() if r['verdict'] else ''}'>{escape(r['verdict'] or '')}</td>"
            f"<td>{escape(r['fetched_utc'] or '')}</td>"
            f"<td>{src}<br>{docs_link}</td></tr>")
        if fields:
            rows_html.append(f"<tr class='detail'><td colspan='7'><table class='fields'>"
                             f"<thead><tr><th>field</th><th>snapshot</th><th>live</th><th>Δ</th><th>verdict</th>"
                             f"</tr></thead><tbody>{fields}</tbody></table></td></tr>")
    probes = "".join(
        f"<tr><td>{escape(p['observed'])}</td><td><a class='src' href='{escape(p['request_url'])}' "
        f"target='_blank' rel='noopener'>↗</a></td><td>{escape(p['fetched_utc'])}</td></tr>"
        for p in meta["probes"])
    unverified = "".join(
        f"<tr><td>{escape(u['topic'])}</td><td><code>{escape(u['market_ticker'])}</code></td>"
        f"<td>{escape(u['missing'])}</td></tr>" for u in live_check["unverified_rows"])

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live verification — tape-desk (Kalshi demo)</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="../index.html">Kalshi demo ← landing</a>
  <nav class="desknav"><a href="index.html">Live tape desk</a>
    <a href="consolidation-map.html">Desk map</a>
    <a href="README.md">README</a>
    <a href="data/watchlist.json">watchlist.json</a>
    <a href="data/live-check.json">live-check.json</a></nav>
</header>
<main>
<h1>Line-by-line verification against the official demo API</h1>
<p class="lede">Snapshot = values committed by the repository's collector at
<code>{escape(str(meta.get('generated_utc')))}</code>. Live = a response body fetched from the
same official demo host <b>in this session</b>. Nothing is inferred: a field that was not fetched is
absent from both sides and listed under “not re-verified”.</p>
<div class="kpis">
  <div class="kpi"><b>{meta['markets_checked']}/{meta['markets_total']}</b><span>markets re-fetched live</span></div>
  <div class="kpi"><b>{meta['fields_match']}/{meta['fields_compared']}</b><span>fields identical to the snapshot</span></div>
  <div class="kpi"><b>{meta['fields_differ']}</b><span>fields that moved (expected)</span></div>
  <div class="kpi"><b>{len(live_check['unverified_rows'])}</b><span>rows flagged, not filled</span></div>
</div>
<p class="fine">{escape(meta['method'])}</p>
<h2>Endpoints probed without credentials</h2>
<table class="grid"><caption>Unauthenticated demo-API probes (this session) — <a class="src" href="{docs['market_data_qs']}" target="_blank" rel="noopener">official: real-time market data without authentication</a></caption>
<thead><tr><th>observed</th><th>request URL</th><th>UTC</th></tr></thead><tbody>{probes}</tbody></table>
<h2>Per-market field comparison</h2>
<table class="grid"><caption>Each row's source is the live response itself; the endpoint is documented at <a class="src" href="{docs['get_market']}" target="_blank" rel="noopener">GET /markets/&#123;ticker&#125;</a></caption>
<thead><tr><th>topic</th><th>market</th><th>title</th><th>kind</th><th>verdict</th><th>live fetch</th><th>sources</th></tr></thead>
<tbody>{''.join(rows_html)}</tbody></table>
<h2>Values left blank and flagged</h2>
<table class="grid"><caption>Per the brief, anything not confirmable from the official source is blank, never filled — <a class="src" href="{docs['demo_env']}" target="_blank" rel="noopener">official: demo environment</a></caption>
<thead><tr><th>topic</th><th>market</th><th>what is missing</th></tr></thead><tbody>{unverified}</tbody></table>
<h2>Official pages read for this page</h2>
<ul class="srcs">
<li><a href="{docs['demo_env']}" target="_blank" rel="noopener">Test in the demo environment</a> — mock funds; demo prices may not reflect real markets.</li>
<li><a href="{docs['environments']}" target="_blank" rel="noopener">API environments and endpoints</a> — the demo REST and WebSocket bases used here.</li>
<li><a href="{docs['market_data_qs']}" target="_blank" rel="noopener">Quick start: market data</a> — market data needs no authentication.</li>
<li><a href="{docs['get_markets']}" target="_blank" rel="noopener">GET /markets</a>, <a href="{docs['get_market']}" target="_blank" rel="noopener">GET /markets/&#123;ticker&#125;</a>, <a href="{docs['get_trades']}" target="_blank" rel="noopener">GET /markets/trades</a>, <a href="{docs['get_orderbook']}" target="_blank" rel="noopener">GET /markets/&#123;ticker&#125;/orderbook</a>, <a href="{docs['get_candlesticks']}" target="_blank" rel="noopener">GET …/candlesticks</a>.</li>
<li><a href="{docs['lifecycle']}" target="_blank" rel="noopener">Market lifecycle</a> — <code>result</code> is set at <code>determined</code>, may be challenged at <code>disputed</code>, and payout is <code>finalized</code>.</li>
<li><a href="{docs['settlement']}" target="_blank" rel="noopener">Market settlement</a> — a winning contract pays $1.</li>
<li><a href="{docs['orderbook_responses']}" target="_blank" rel="noopener">Orderbook responses</a> — the book returns yes bids and no bids; a no bid at x is a yes ask at 1&nbsp;−&nbsp;x.</li>
<li><a href="{docs['sharding']}" target="_blank" rel="noopener">Exchange sharding</a> — <code>exchange_index</code> routing and the market-level <code>exchange_index</code> field.</li>
<li><a href="{docs['quick_start_ws']}" target="_blank" rel="noopener">Quick start: WebSockets</a> — the WS handshake requires a signed key, even for public channels.</li>
</ul>
</main>
</body>
</html>
"""
    with open(os.path.join(DESK, "verified.html"), "w", encoding="utf-8") as fh:
        fh.write(html)


def check_committed():
    """--check: validate the committed outputs without rewriting them.

    Used by CI as a content invariant that cannot drift with the snapshot refresh cadence:
    every published row must cite an official request URL, every live re-check must cite the
    request it came from, and no blank value may be presented as a number.
    """
    bad = []
    with open(os.path.join(DESK, "data", "watchlist.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    meta = data.get("meta") or {}
    if meta.get("rest_base") != OFFICIAL_BASE:
        bad.append("watchlist meta rest_base is not the official demo base")
    rows = 0
    for topic, block in (data.get("watchlist") or {}).items():
        for ev in block.get("events") or []:
            for m in ev.get("markets") or []:
                rows += 1
                src = ((m.get("snapshot") or {}).get("sources") or {}).get("market") or ""
                if not src.startswith(OFFICIAL_BASE + "/markets/"):
                    bad.append(f"{m.get('market_ticker')}: snapshot row has no official market URL")
                chk = m.get("live_check") or {}
                if chk.get("verdict") == "NOT-FETCHED" and (chk.get("request_url") or chk.get("fields")):
                    bad.append(f"{m.get('market_ticker')}: NOT-FETCHED row carries live data")
                if chk.get("fields"):
                    for f in chk["fields"]:
                        if f.get("verdict") in ("MATCH", "DIFFER") and (f.get("live") in (None, "")):
                            bad.append(f"{m.get('market_ticker')}: {f.get('field')} verdict {f.get('verdict')} with a blank live value")
                for key in ("last_price", "yes_bid", "yes_ask"):
                    v = (m.get("snapshot") or {}).get(key)
                    if v is None and (m.get("snapshot") or {}).get(key + "_size"):
                        bad.append(f"{m.get('market_ticker')}: {key} blank but a size is shown")
    with open(os.path.join(DESK, "data", "live-check.json"), encoding="utf-8") as fh:
        lc = json.load(fh)
    for r in lc.get("rows") or []:
        if r["verdict"] != "NOT-FETCHED" and not str(r.get("request_url") or "").startswith(OFFICIAL_BASE):
            bad.append(f"{r.get('market_ticker')}: live row without an official request URL")
    total = (lc.get("meta") or {}).get("fields_compared")
    counted = sum(len(r["fields"]) for r in lc.get("rows") or [] if r["verdict"] != "NOT-FETCHED")
    if total != counted:
        bad.append(f"live-check meta counts {total} compared fields, rows carry {counted}")
    if bad:
        for b in bad[:20]:
            print("CHECK FAIL:", b)
        sys.exit(1)
    print(f"CHECK OK: {rows} watchlist rows and {len(lc.get('rows') or [])} verification rows, "
          f"{total} compared fields, every value tied to an official request URL")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check_committed()
    else:
        main()
