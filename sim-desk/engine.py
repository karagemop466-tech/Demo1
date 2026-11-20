#!/usr/bin/env python3
"""
sim-desk engine — unattended simulated-trading strategy runner for the official
Kalshi DEMO Trade API (public endpoints, no authentication, no orders).

What it does every run:
  1. Loads the open-markets universe (GET /markets?status=open, paginated).
  2. Classifies markets into the 5 tracked topics (gas, elections, culture,
     crypto, golf) with transparent keyword rules from config.json.
  3. Ranks candidates by computed 24h traded notional (volume_24h x
     last_price_dollars — a disclosed ESTIMATE; Kalshi publishes no official
     dollar-volume field).
  4. Evaluates 3 deterministic strategies over the official public trades tape
     (GET /markets/trades — the demo candlesticks endpoint currently returns
     empty arrays for most markets, a flagged demo irregularity) and the
     official bids-only orderbook. Entry price = implied best ask of the
     bought side (1.00 - best opposite bid, per the official orderbook doc).
  5. Simulates fills (never places orders), charging the official taker fee
     roundup(M x 0.07 x C x P x (1-P)) with M=1.
  6. Marks open positions to the official last_price_dollars each run.
  7. Settles open positions when the market reports status=settled and
     result in {yes,no}: winning side receives $1.00 per contract (official
     market-settlement rule; settlement fee is zero for simple yes/no).
  8. Writes sim-desk/data/{ledger,performance,run_log}.json (append-only
     ledger; bounded sizes per config ledger_caps).

Verification sources (official, fetched 2026-11-20):
  - Orderbook bids-only + implied asks:
      https://docs.kalshi.com/getting_started/orderbook_responses
  - Settlement $1 per winning contract:
      https://docs.kalshi.com/getting_started/market_settlement
  - Trades tape (official public endpoint):
      https://docs.kalshi.com/api-reference/market/get-trades
  - Candlesticks (1|60|1440 — currently empty on demo, flagged):
      https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  - Markets endpoint (status enum, limit<=1000, tickers filter, demo hosts):
      https://docs.kalshi.com/api-reference/market/get-markets
  - Taker fee roundup(M x 0.07 x C x P x (1-P)); no settlement fee:
      https://kalshi.com/docs/kalshi-fee-schedule.pdf
  - Demo environment (mock funds; prices may not reflect real markets):
      https://docs.kalshi.com/getting_started/demo_env

Usage:
  python3 sim-desk/engine.py --out sim-desk/data
  python3 sim-desk/engine.py --out sim-desk/data --recorded sim-desk/tests/fixtures
  python3 sim-desk/engine.py --fresh --out sim-desk/data

Exit codes: 0 = run completed (errors inside are logged, not fatal);
            1 = could not run at all (bad config/ledger or every request failed).
"""

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone


def now_utc_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, sort_keys=False)
        fh.write("\n")
    os.replace(tmp, path)


def to_float(value):
    """Parse a price/number that the API may return as fixed-point string or number.
    Returns None when the value is absent or unparsable (never guesses)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------- API client

class ApiClient:
    """Public-market-data client. Records every request into run_log entries."""

    def __init__(self, base_url, run_log, sleep=0.15, retry_on_429=1, backoff=2.0,
                 recorded_dir=None):
        self.base_url = base_url.rstrip("/")
        self.run_log = run_log
        self.sleep = sleep
        self.retry_on_429 = retry_on_429
        self.backoff = backoff
        self.recorded_dir = recorded_dir
        self.call_count = 0
        self.error_count = 0

    def _recorded_path(self, url):
        manifest = read_json(os.path.join(self.recorded_dir, "manifest.json"))
        path_qs = url[len(self.base_url):] if url.startswith(self.base_url) else url
        if path_qs in manifest:
            return os.path.join(self.recorded_dir, manifest[path_qs])
        # longest prefix match: candlestick/tickers URLs embed dynamic timestamps,
        # so fixtures register a stable prefix ending at the query boundary.
        best = None
        for key in manifest:
            if path_qs.startswith(key) and (best is None or len(key) > len(best)):
                best = key
        if best is None:
            raise KeyError(f"no recorded fixture matches URL {url}")
        return os.path.join(self.recorded_dir, manifest[best])

    def get(self, path, params=None):
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        entry = {"url": url, "ts": now_utc_iso(), "status": None, "ms": None, "ok": False}
        self.call_count += 1
        started = time.time()
        try:
            if self.recorded_dir:
                with open(self._recorded_path(url), "r", encoding="utf-8") as fh:
                    body = json.load(fh)
                entry["status"], entry["ms"], entry["ok"] = 200, 0, True
                self.run_log["requests"].append(entry)
                return body
            attempt = 0
            while True:
                try:
                    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                                               "User-Agent": "sim-desk/1.0 (kalshi demo research)"})
                    with urllib.request.urlopen(req, timeout=20) as resp:
                        body = json.loads(resp.read().decode("utf-8"))
                    entry["status"], entry["ok"] = resp.status, True
                    break
                except urllib.error.HTTPError as exc:
                    entry["status"] = exc.code
                    if exc.code == 429 and attempt < self.retry_on_429:
                        attempt += 1
                        time.sleep(self.backoff)
                        continue
                    raise
        except Exception as exc:  # network/parse failures are logged, never fabricated
            self.error_count += 1
            entry["error"] = str(exc)[:300]
            self.run_log["requests"].append(entry)
            return None
        finally:
            entry["ms"] = int((time.time() - started) * 1000)
        self.run_log["requests"].append(entry)
        if self.sleep:
            time.sleep(self.sleep)
        return body


# ------------------------------------------------------------ classification

def compile_topic_rules(config):
    rules = []
    for topic in config["topics"]["order"]:
        spec = config["topics"]["rules"][topic]
        rules.append((topic,
                      re.compile(spec.get("ticker", "")) if spec.get("ticker") else None,
                      re.compile(spec.get("title", ""), re.IGNORECASE) if spec.get("title") else None))
    return rules


def classify(market, rules):
    """Return (topic, matched_by) or (None, None). First rule in configured order wins."""
    series = market.get("series_ticker") or ""
    event = market.get("event_ticker") or ""
    title = market.get("title") or market.get("custom_strike") or ""
    for topic, ticker_re, title_re in rules:
        if ticker_re and (ticker_re.search(series) or ticker_re.search(event)):
            return topic, "ticker:" + ticker_re.pattern
        if title_re and title and title_re.search(title):
            return topic, "title:" + title_re.pattern
    return None, None


def market_volume_24h(market):
    v = to_float(market.get("volume_24h"))
    if v is None:
        v = to_float(market.get("volume_24h_fp"))
    return v


def market_last_price(market):
    lp = to_float(market.get("last_price_dollars"))
    if lp is None:
        lp = to_float(market.get("last_price"))
    return lp


def close_time_ts(market):
    for key in ("close_time", "expected_close_time"):
        raw = market.get(key)
        if isinstance(raw, str) and raw:
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
    return None


def parse_orderbook_best_bids(book):
    """Returns (best_yes_bid, best_no_bid, yes_levels, no_levels) — official doc:
    arrays of [price_dollars, count_fp] strings, ascending, best bid is LAST element."""
    ob = (book or {}).get("orderbook_fp") or {}
    yes = ob.get("yes_dollars") or []
    no = ob.get("no_dollars") or []
    best_yes = to_float(yes[-1][0]) if yes else None
    best_no = to_float(no[-1][0]) if no else None

    def levels(arr):
        out = []
        for lvl in arr:
            p, c = to_float(lvl[0]), to_float(lvl[1]) if len(lvl) > 1 else None
            if p is not None:
                out.append({"price": p, "contracts": c})
        return out

    return best_yes, best_no, levels(yes), levels(no)


def implied_asks(best_yes_bid, best_no_bid):
    """Official rule: best YES ask = 1 - best NO bid; best NO ask = 1 - best YES bid."""
    yes_ask = round(1.0 - best_no_bid, 6) if best_no_bid is not None else None
    no_ask = round(1.0 - best_yes_bid, 6) if best_yes_bid is not None else None
    return yes_ask, no_ask


def fee_cents(contracts, price, multiplier=1.0):
    """Official taker fee, rounded up to the next cent:
    fee = roundup(M x 0.07 x C x P x (1-P)). Source: kalshi.com fee schedule PDF."""
    raw = multiplier * 0.07 * contracts * price * (1.0 - price) * 100.0
    return int(math.ceil(round(raw, 6)))


# ------------------------------------------------------------------ signals

def trade_closes(api, ticker):
    """Public trades tape for one market (official GET /markets/trades).
    Returns (yes_prices_ascending_by_time, request_url). The demo candlesticks
    endpoint is unreliable (empty arrays despite recent trades — flagged by this
    repo's other desks), so signals run on executed-trade prices."""
    if not ticker:
        return None, None
    body = api.get("/markets/trades", {"ticker": ticker, "limit": 200})
    if body is None:
        return None, None
    trades = body.get("trades") or []
    rows = []
    for t in trades:
        price = to_float(t.get("yes_price_dollars"))
        ts = t.get("created_time")
        if price is None:
            continue
        rows.append((ts or "", price))
    rows.sort(key=lambda r: r[0])
    url = api.run_log["requests"][-1]["url"] if api.run_log["requests"] else None
    return [p for _, p in rows], url


def evaluate_strategies(config, market, closes, yes_ask, no_ask, volume_24h):
    """Returns (strategy_name, side, reason) or (None, None, reason). Deterministic.
    `closes` are YES trade prices from the official tape, ascending by time."""
    outcomes = {}
    momentum = next(s for s in config["strategies"] if s["name"] == "momentum-tape")
    revert = next(s for s in config["strategies"] if s["name"] == "mean-revert-tape")
    longshot = next(s for s in config["strategies"] if s["name"] == "longshot-value")

    # momentum-tape
    n = min(len(closes), momentum["trend_trades"])
    if len(closes) >= momentum["min_trades"] and n >= 2:
        trend = closes[-1] - closes[-n]
        if trend >= momentum["trend_threshold_dollars"]:
            if yes_ask is not None and momentum["band_min"] <= yes_ask <= momentum["band_max"]:
                outcomes["momentum-tape"] = ("yes", f"tape trend over last {n} trades {trend:+.2f} >= +{momentum['trend_threshold_dollars']:.2f}; YES implied ask ${yes_ask:.2f} in band")
            else:
                outcomes["momentum-tape"] = (None, f"tape trend {trend:+.2f} but YES implied ask outside band")
        elif trend <= -momentum["trend_threshold_dollars"]:
            if no_ask is not None and momentum["band_min"] <= no_ask <= momentum["band_max"]:
                outcomes["momentum-tape"] = ("no", f"tape trend over last {n} trades {trend:+.2f} <= -{momentum['trend_threshold_dollars']:.2f}; NO implied ask ${no_ask:.2f} in band")
            else:
                outcomes["momentum-tape"] = (None, f"tape trend {trend:+.2f} but NO implied ask outside band")

    # mean-revert-tape
    window = closes[-revert["mean_trades"]:]
    if len(window) >= revert["min_trades"]:
        mean = sum(window) / len(window)
        dev = closes[-1] - mean
        if dev <= -revert["deviation_threshold_dollars"]:
            if yes_ask is not None and revert["band_min"] <= yes_ask <= revert["band_max"]:
                outcomes["mean-revert-tape"] = ("yes", f"last trade {closes[-1]:.2f} is ${-dev:.2f} below mean of last {len(window)} trades {mean:.2f}; YES implied ask ${yes_ask:.2f} in band")
            else:
                outcomes["mean-revert-tape"] = (None, f"last trade below mean by {-dev:.2f} but YES implied ask outside band")
        elif dev >= revert["deviation_threshold_dollars"]:
            if no_ask is not None and revert["band_min"] <= no_ask <= revert["band_max"]:
                outcomes["mean-revert-tape"] = ("no", f"last trade {closes[-1]:.2f} is ${dev:.2f} above mean of last {len(window)} trades {mean:.2f}; NO implied ask ${no_ask:.2f} in band")
            else:
                outcomes["mean-revert-tape"] = (None, f"last trade above mean by {dev:.2f} but NO implied ask outside band")

    # longshot-value
    if no_ask is not None and no_ask <= longshot["no_ask_max"]:
        if volume_24h is not None and volume_24h >= longshot["min_volume_24h_contracts"]:
            outcomes["longshot-value"] = ("no", f"NO implied ask ${no_ask:.2f} <= ${longshot['no_ask_max']:.2f} with 24h volume {volume_24h:.0f} contracts")
        else:
            outcomes["longshot-value"] = (None, f"NO implied ask ${no_ask:.2f} but 24h volume below {longshot['min_volume_24h_contracts']}")

    for name in config["strategy_priority"]:
        if name in outcomes:
            side, reason = outcomes[name]
            if side:
                return name, side, reason
    # nothing fired; report the most informative skip reason
    for name in config["strategy_priority"]:
        if name in outcomes:
            return None, None, f"{name}: {outcomes[name][1]}"
    return None, None, "insufficient trade history for all strategies"


# ------------------------------------------------------------------- ledger

def new_ledger(config):
    return {
        "schema": 1,
        "meta": {
            "base_url": config["base_url"],
            "started_cash_dollars": config["started_cash_dollars"],
            "updated_ts": now_utc_iso(),
            "runs": 0,
            "simulated": True,
            "notes": [
                "All fills are SIMULATED — no orders were placed and no Kalshi account was touched.",
                "Demo environment: mock funds; prices may not reflect real markets (official demo-env warning).",
                "Entry prices are implied asks derived from the bids-only orderbook (official rule).",
                "Fees use the official taker formula roundup(M x 0.07 x C x P x (1-P)) with M=1.",
            ],
            "sources": {
                "orderbook_rule": "https://docs.kalshi.com/getting_started/orderbook_responses",
                "settlement_rule": "https://docs.kalshi.com/getting_started/market_settlement",
                "candlesticks": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
                "markets": "https://docs.kalshi.com/api-reference/market/get-markets",
                "fee_schedule": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
                "demo_env": "https://docs.kalshi.com/getting_started/demo_env",
            },
        },
        "cash": config["started_cash_dollars"],
        "positions_open": [],
        "trades_settled": [],
        "runs": [],
    }


def position_key(pos):
    return pos["ticker"] + "|" + pos["side"]


def open_counts_by_topic(positions):
    counts = {}
    for p in positions:
        counts[p["topic"]] = counts.get(p["topic"], 0) + 1
    return counts


def band_of(price):
    if price is None:
        return "unknown"
    for lo, hi in ((0.0, 0.20), (0.20, 0.40), (0.40, 0.60), (0.60, 0.80), (0.80, 1.01)):
        if lo <= price < hi:
            return f"{lo:.2f}-{hi:.2f}"
    return "unknown"


def build_position(config, market, topic, matched_by, strategy, side, entry_price,
                   contracts, fee, ob_url, tape_url, run_id, volume_24h):
    title = market.get("title") or market.get("yes_sub_title") or market.get("custom_strike") or ""
    return {
        "id": "sim-" + uuid.uuid4().hex[:12],
        "ticker": market.get("ticker"),
        "series_ticker": market.get("series_ticker"),
        "event_ticker": market.get("event_ticker"),
        "title": title,
        "topic": topic,
        "matched_by": matched_by,
        "strategy": strategy,
        "side": side,
        "contracts": contracts,
        "entry_price": round(entry_price, 4),
        "entry_fee": fee,
        "entry_ts": now_utc_iso(),
        "entry_run": run_id,
        "entry_source_url": None,  # filled by caller (markets page request)
        "orderbook_source_url": ob_url,
        "trades_tape_source_url": tape_url,
        "volume_24h_at_entry": volume_24h,
        "band": band_of(entry_price),
        "mark_price": round(entry_price, 4),
        "mark_ts": now_utc_iso(),
        "mark_basis": "entry price (first run)",
        "notional_dollars": round(contracts * entry_price, 2),
    }


def settle_position(pos, market_row, run_id, api_url, settled_statuses=("settled", "finalized")):
    result = (market_row.get("result") or "").lower()
    status = (market_row.get("status") or "").lower()
    if status not in settled_statuses or result not in ("yes", "no"):
        return None
    contracts = pos["contracts"]
    win = (pos["side"] == result)
    payout = round(contracts * 1.0 if win else 0.0, 2)
    cost = round(contracts * pos["entry_price"], 2)
    realized = round(payout - cost - pos["entry_fee"], 2)
    settled = dict(pos)
    settled.update({
        "exit_ts": now_utc_iso(),
        "exit_run": run_id,
        "result": result,
        "status": status,
        "payout": payout,
        "realized_pnl": realized,
        "settlement_ts": market_row.get("settlement_ts"),
        "settlement_value_dollars": to_float(market_row.get("settlement_value_dollars")),
        "settlement_source_url": api_url,
    })
    return settled


# ------------------------------------------------------------ performance

def rollup(trades, key_fn):
    out = {}
    for t in trades:
        k = key_fn(t)
        if k is None:
            continue
        bucket = out.setdefault(k, {
            "opened": 0, "settled": 0, "wins": 0, "losses": 0, "win_rate": None,
            "invested": 0.0, "fees": 0.0, "realized_pnl": 0.0, "roi": None,
        })
        bucket["opened"] += 1
        bucket["invested"] += t["contracts"] * t["entry_price"]
        bucket["fees"] += t["entry_fee"]
        if "realized_pnl" in t:
            bucket["settled"] += 1
            bucket["realized_pnl"] = round(bucket["realized_pnl"] + t["realized_pnl"], 2)
            bucket["wins"] += 1 if t["realized_pnl"] > 0 else 0
            bucket["losses"] += 1 if t["realized_pnl"] <= 0 else 0
    for bucket in out.values():
        if bucket["settled"]:
            bucket["win_rate"] = round(bucket["wins"] / bucket["settled"], 4)
            base = bucket["invested"] + bucket["fees"]
            bucket["roi"] = round(bucket["realized_pnl"] / base, 4) if base else None
        bucket["invested"] = round(bucket["invested"], 2)
        bucket["fees"] = round(bucket["fees"], 2)
    return out


def build_performance(config, ledger):
    open_value = sum(p["contracts"] * p["mark_price"] for p in ledger["positions_open"])
    equity = ledger["cash"] + open_value
    settled = ledger["trades_settled"]
    realized = round(sum(t["realized_pnl"] for t in settled), 2)
    started = config["started_cash_dollars"]
    curve = [{"ts": r["ts"], "equity": r["equity"]} for r in ledger["runs"] if r.get("equity") is not None]

    by_strategy = rollup(ledger["positions_open"] + settled, lambda t: t.get("strategy"))
    by_topic = rollup(ledger["positions_open"] + settled, lambda t: t.get("topic"))
    by_band = rollup(ledger["positions_open"] + settled, lambda t: t.get("band"))
    matrix = []
    for t in ledger["positions_open"] + settled:
        k = (t.get("topic"), t.get("strategy"))
        if k not in [(m["topic"], m["strategy"]) for m in matrix]:
            matrix.append({"topic": t.get("topic"), "strategy": t.get("strategy")})
    for m in matrix:
        sub = rollup([t for t in ledger["positions_open"] + settled
                      if t.get("topic") == m["topic"] and t.get("strategy") == m["strategy"]],
                     lambda t: t.get("topic"))
        if m["topic"] in sub:
            m.update(sub[m["topic"]])

    return {
        "schema": 1,
        "updated_ts": now_utc_ts(ledger),
        "simulated": True,
        "started_cash_dollars": started,
        "cash": round(ledger["cash"], 2),
        "open_value": round(open_value, 2),
        "equity": round(equity, 2),
        "open_count": len(ledger["positions_open"]),
        "settled_count": len(settled),
        "realized_pnl": realized,
        "roi_on_started_cash": round((equity - started) / started, 4) if started else None,
        "equity_curve": curve[-config["ledger_caps"]["equity_points_kept"]:],
        "by_strategy": by_strategy,
        "by_topic": by_topic,
        "by_band": by_band,
        "category_matrix": matrix,
        "result_counts": {
            "yes": sum(1 for t in settled if t.get("result") == "yes"),
            "no": sum(1 for t in settled if t.get("result") == "no"),
        },
    }


def now_utc_ts(ledger):
    return ledger["meta"].get("updated_ts") or now_utc_iso()


# ------------------------------------------------------------------ the run

def run(config, ledger, api, run_id):
    caps = config["ledger_caps"]
    sizing = config["sizing"]
    rules = compile_topic_rules(config)
    errors = []

    # --- 1. universe: (a) paginated open-markets scan (sort order not guaranteed
    # by the API) plus (b) targeted series queries with the documented
    # series_ticker filter, because the demo exchange is sparse and the general
    # scan alone can miss the sparse-but-liquid tracked series entirely.
    by_ticker = {}
    cursor = ""
    for _ in range(config["universe"]["scan_pages"]):
        params = {"status": config["universe"]["markets_status"],
                  "limit": config["universe"]["page_limit"]}
        if cursor:
            params["cursor"] = cursor
        body = api.get("/markets", params)
        if not body or not body.get("markets"):
            break
        for m in body["markets"]:
            t = m.get("ticker")
            if t and t not in by_ticker:
                by_ticker[t] = m
        cursor = body.get("cursor") or ""
        if not cursor:
            break
    for topic_key, series_list in config["topics"]["known_series"].items():
        for series in series_list:
            body = api.get("/markets", {"series_ticker": series,
                                        "status": config["universe"]["markets_status"],
                                        "limit": config["universe"]["page_limit"]})
            if not body or not body.get("markets"):
                continue
            for m in body["markets"]:
                t = m.get("ticker")
                if not t:
                    continue
                m.setdefault("series_ticker", series)
                m.setdefault("topic_hint", topic_key)
                if t not in by_ticker:
                    by_ticker[t] = m
    markets = list(by_ticker.values())

    # --- 2+3. classify + rank by computed 24h notional (disclosed estimate)
    now = time.time()
    candidates = []
    for m in markets:
        topic, matched_by = classify(m, rules)
        if not topic and m.get("topic_hint"):
            # targeted series rows keep their configured topic when keyword rules
            # miss (short demo titles); the hint is disclosed in matched_by.
            topic = m["topic_hint"]
            matched_by = "known_series:" + str(m.get("series_ticker"))
        if not topic:
            continue
        vol24 = market_volume_24h(m) or 0.0
        last = market_last_price(m)
        if last is None:
            continue
        if vol24 < config["universe"]["min_volume_24h_contracts"]:
            continue
        ct = close_time_ts(m)
        if ct is not None and ct - now < config["universe"]["min_hours_until_close"] * 3600:
            continue
        candidates.append({
            "market": m, "topic": topic, "matched_by": matched_by,
            "volume_24h": vol24, "last": last,
            "notional_24h": vol24 * last,
        })
    per_topic = {}
    candidates.sort(key=lambda c: c["notional_24h"], reverse=True)
    shortlist = []
    for c in candidates:
        t = c["topic"]
        if per_topic.get(t, 0) >= config["universe"]["max_per_topic_candidates"]:
            continue
        per_topic[t] = per_topic.get(t, 0) + 1
        shortlist.append(c)
        if len(shortlist) >= config["universe"]["candidates_max"]:
            break

    # --- 4+5. signals and simulated fills
    new_trades = []
    skips = []
    for c in shortlist:
        if len(new_trades) >= sizing["max_new_trades_per_run"]:
            break
        if len(ledger["positions_open"]) + len(new_trades) >= sizing["max_open_positions"]:
            skips.append({"ticker": c["market"].get("ticker"), "reason": "max_open_positions reached"})
            continue
        if open_counts_by_topic(ledger["positions_open"]).get(c["topic"], 0) >= sizing["max_open_per_topic"]:
            skips.append({"ticker": c["market"].get("ticker"), "reason": f"max_open_per_topic({c['topic']}) reached"})
            continue
        existing = {position_key(p) for p in ledger["positions_open"]}
        ticker = c["market"].get("ticker")
        book = api.get(f"/markets/{ticker}/orderbook", {"depth": 10})
        if book is None:
            skips.append({"ticker": ticker, "reason": "orderbook request failed"})
            continue
        ob_url = api.run_log["requests"][-1]["url"]
        best_yes_bid, best_no_bid, yes_levels, no_levels = parse_orderbook_best_bids(book)
        yes_ask, no_ask = implied_asks(best_yes_bid, best_no_bid)
        closes, tape_url = trade_closes(api, ticker)
        if not closes:
            skips.append({"ticker": ticker, "reason": "no trade history returned by the official tape (demo candlesticks also empty — flagged)"})
            continue
        strategy, side, reason = evaluate_strategies(config, c["market"], closes, yes_ask, no_ask, c["volume_24h"])
        if not strategy:
            skips.append({"ticker": ticker, "reason": reason})
            continue
        entry_price = yes_ask if side == "yes" else no_ask
        if entry_price is None or not (0 < entry_price < 1):
            skips.append({"ticker": ticker, "reason": f"{side} implied ask unavailable"})
            continue
        contracts = sizing["contracts_per_trade"]
        fee = fee_cents(contracts, entry_price) / 100.0
        cost = contracts * entry_price
        if cost + fee > ledger["cash"]:
            skips.append({"ticker": ticker, "reason": f"insufficient simulated cash for ${cost + fee:.2f} position"})
            continue
        if any(position_key(p) == f"{ticker}|{side}" for p in ledger["positions_open"]):
            skips.append({"ticker": ticker, "reason": "position already open in this market+side"})
            continue
        markets_url = next((r["url"] for r in reversed(api.run_log["requests"]) if r["ok"] and "/markets?" in r["url"]), None)
        pos = build_position(config, c["market"], c["topic"], c["matched_by"], strategy, side,
                             entry_price, contracts, fee, ob_url, tape_url, run_id, c["volume_24h"])
        pos["entry_source_url"] = markets_url
        pos["signal_reason"] = reason
        pos["best_opposite_bid"] = best_no_bid if side == "yes" else best_yes_bid
        ledger["cash"] = round(ledger["cash"] - cost - fee, 2)
        ledger["positions_open"].append(pos)
        new_trades.append(pos)

    # --- 6+7. mark to market + settle open positions
    settled_now = []
    if ledger["positions_open"]:
        tickers_param = ",".join(sorted({p["ticker"] for p in ledger["positions_open"]}))
        body = api.get("/markets", {"tickers": tickers_param, "limit": 1000})
        rows = {}
        if body and body.get("markets"):
            rows = {m.get("ticker"): m for m in body["markets"] if m.get("ticker")}
        mark_url = api.run_log["requests"][-1]["url"] if api.run_log["requests"] else None
        still_open = []
        for pos in ledger["positions_open"]:
            row = rows.get(pos["ticker"])
            if row is None:
                still_open.append(pos)
                continue
            last = market_last_price(row)
            if last is None:
                still_open.append(pos)
                continue
            pos["mark_price"] = round(last if pos["side"] == "yes" else 1.0 - last, 4)
            pos["mark_ts"] = now_utc_iso()
            pos["mark_basis"] = "official last_price_dollars (held side)"
            pos["mark_source_url"] = mark_url
            status = (row.get("status") or "").lower()
            settled = settle_position(pos, row, run_id, mark_url,
                                      settled_statuses=config.get("settlement_statuses", ("settled", "finalized")))
            if settled:
                ledger["cash"] = round(ledger["cash"] + settled["payout"], 2)
                settled_now.append(settled)
            else:
                if status == "closed":
                    pos["note"] = "market closed — awaiting settlement"
                still_open.append(pos)
        ledger["positions_open"] = still_open
        ledger["trades_settled"].extend(settled_now)

    # --- 8. run record
    open_value = sum(p["contracts"] * p["mark_price"] for p in ledger["positions_open"])
    equity = round(ledger["cash"] + open_value, 2)
    ledger["runs"].append({
        "ts": now_utc_iso(),
        "run_id": run_id,
        "universe_markets": len(markets),
        "candidates": len(shortlist),
        "new_trades": len(new_trades),
        "settled": len(settled_now),
        "api_calls": api.call_count,
        "errors": api.error_count,
        "cash": round(ledger["cash"], 2),
        "equity": equity,
        "open_positions": len(ledger["positions_open"]),
    })
    ledger["runs"] = ledger["runs"][-caps["runs_kept"]:]
    ledger["meta"]["updated_ts"] = now_utc_iso()
    ledger["meta"]["runs"] = len(ledger["runs"])

    return {
        "new_trades": new_trades,
        "settled": settled_now,
        "skips": skips,
        "equity": equity,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description="sim-desk automated strategy runner (simulated fills only)")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    parser.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"))
    parser.add_argument("--recorded", default=None, help="replay recorded fixture payloads instead of network calls")
    parser.add_argument("--fresh", action="store_true", help="start a new ledger (destructive)")
    args = parser.parse_args()

    config = read_json(args.config)
    os.makedirs(args.out, exist_ok=True)
    ledger_path = os.path.join(args.out, "ledger.json")
    if args.fresh or not os.path.exists(ledger_path):
        ledger = new_ledger(config)
    else:
        ledger = read_json(ledger_path)
        if ledger.get("schema") != 1:
            print("ledger schema mismatch; refusing to overwrite", file=sys.stderr)
            return 1

    run_log = {"schema": 1, "ts": now_utc_iso(), "requests": [], "errors": []}
    api = ApiClient(config["base_url"], run_log,
                    sleep=config["api_politeness"]["sleep_seconds_between_calls"],
                    retry_on_429=config["api_politeness"]["retry_on_429"],
                    backoff=config["api_politeness"]["backoff_seconds"],
                    recorded_dir=args.recorded)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    result = run(config, ledger, api, run_id)

    write_json(ledger_path, ledger)
    write_json(os.path.join(args.out, "performance.json"), build_performance(config, ledger))
    run_log["requests"] = run_log["requests"][-config["ledger_caps"]["requests_kept"]:]
    run_log["summary"] = {
        "run_id": run_id,
        "api_calls": api.call_count,
        "request_errors": api.error_count,
        "new_trades": len(result["new_trades"]),
        "settled": len(result["settled"]),
        "skips": len(result["skips"]),
        "equity": result["equity"],
    }
    run_log["skips"] = result["skips"]
    write_json(os.path.join(args.out, "run_log.json"), run_log)

    print(f"run {run_id}: api_calls={api.call_count} errors={api.error_count} "
          f"new_trades={len(result['new_trades'])} settled={len(result['settled'])} "
          f"equity={result['equity']:.2f} cash={ledger['cash']:.2f} "
          f"open={len(ledger['positions_open'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
