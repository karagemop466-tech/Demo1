#!/usr/bin/env python3
"""
demo_trader.py — Kalshi DEMO account trader + portfolio tracker (credential-gated).

Enables the portfolio-performance and trade-execution parts of the dashboard by
calling the official Kalshi DEMO Trade API with signed API-key requests. It is
deliberately inactive unless demo credentials are supplied via environment
variables, and it only ever talks to the DEMO environment.

Required environment variables (GitHub Actions secrets or local export):
  KALSHI_DEMO_API_KEY_ID       API Key ID (Account & security -> API Keys on demo.kalshi.co)
  KALSHI_DEMO_PRIVATE_KEY      PEM contents of the private key (or KALSHI_DEMO_PRIVATE_KEY_PATH)
Optional:
  KALSHI_DEMO_PRIVATE_KEY_PATH path to PEM file
  KALSHI_ALLOW_TRADING=1       required for anything that can rest an order
                               (reads like `status` work without it)

Verified official references (see SOURCES.md, fetched 2026-11-20):
  - Auth headers + RSA-PSS/SHA-256 or Ed25519 signing of
    `timestamp + METHOD + path` (path only, no query string):
    https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md
  - Create Order (V2): POST /portfolio/events/orders — body uses `side: bid|ask`,
    fixed-point `count` ("10.00") and `price` ("0.5600") strings,
    required `time_in_force` + `self_trade_prevention_type`;
    legacy /portfolio/orders writes return 410 Gone:
    https://docs.kalshi.com/api-reference/orders/create-order-v2.md
  - Cancel Order (V2): DELETE /portfolio/events/orders/{order_id}?market_ticker=...
    (market_ticker required for auto-routing):
    https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md
  - Get Balance: GET /portfolio/balance -> {balance (cents int), balance_dollars,
    portfolio_value (cents), updated_ts}:
    https://docs.kalshi.com/api-reference/portfolio/get-balance.md
  - Rate limits: default 10 tokens/request; 429 -> back off (no penalty):
    https://docs.kalshi.com/getting_started/rate_limits.md

Subcommands:
  status               Read balance/positions/fills/orders -> docs/data/portfolio.json
  trade                Place ONE limit order (requires KALSHI_ALLOW_TRADING=1)
  cancel               Cancel one resting order by id + market ticker
  auto                 Run strategies from scripts/strategies.json (if enabled there)

Examples:
  python3 scripts/demo_trader.py status
  python3 scripts/demo_trader.py trade --ticker KXBTCMINMON-BTC-26NOV30-7250000 \
      --side bid --count 5 --price 0.55 --dry-run
  python3 scripts/demo_trader.py auto
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

BASE = "https://external-api.demo.kalshi.co"
API_ROOT = "/trade-api/v2"
DOCS_AUTH = "https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md"

KEY_ID = os.environ.get("KALSHI_DEMO_API_KEY_ID", "")
PEM_INLINE = os.environ.get("KALSHI_DEMO_PRIVATE_KEY", "")
PEM_PATH = os.environ.get("KALSHI_DEMO_PRIVATE_KEY_PATH", "")
TRADING_ALLOWED = os.environ.get("KALSHI_ALLOW_TRADING") == "1"

PRIV = None
ALGO = None


def load_key():
    global PRIV, ALGO
    if PRIV is not None:
        return PRIV, ALGO
    if not KEY_ID:
        raise SystemExit("KALSHI_DEMO_API_KEY_ID not set — demo credentials absent; nothing to do (this is the expected state without secrets).")
    pem = None
    if PEM_INLINE:
        pem = PEM_INLINE.encode()
    elif PEM_PATH:
        with open(PEM_PATH, "rb") as f:
            pem = f.read()
    else:
        raise SystemExit("Set KALSHI_DEMO_PRIVATE_KEY (PEM contents) or KALSHI_DEMO_PRIVATE_KEY_PATH.")
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    PRIV = load_pem_private_key(pem, password=None)
    ALGO = "ed25519" if PRIV.__class__.__name__.startswith("Ed25519") else "rsa"
    return PRIV, ALGO


def sign(timestamp_ms, method, path_without_query):
    key, algo = load_key()
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    msg = f"{timestamp_ms}{method}{path_without_query}".encode()
    if algo == "ed25519":
        return base64.b64encode(key.sign(msg)).decode()
    return base64.b64encode(
        key.sign(msg, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH), hashes.SHA256())
    ).decode()


def auth_headers(method, full_path_with_query):
    ts = str(int(time.time() * 1000))
    path_only = urllib.parse.urlparse(full_path_with_query).path
    return {
        "KALSHI-ACCESS-KEY": KEY_ID,
        "KALSHI-ACCESS-SIGNATURE": sign(ts, method, path_only),
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def call(method, path_with_query, body=None, retries=3):
    url = BASE + path_with_query
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method, headers=auth_headers(method, path_with_query))
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            payload = e.read().decode(errors="replace")[:500]
            if e.code == 429 and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {payload}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"network: {e}") from e
    raise RuntimeError("unreachable")


def fp_count(n):
    return f"{float(n):.2f}"


def fp_price(n):
    return f"{float(n):.4f}"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def topic_of(market_ticker, series_map):
    st = market_ticker.split("-")[0]
    for topic, lst in (series_map or {}).items():
        if st in lst:
            return topic
    return ""


def cmd_status(out_dir):
    if not KEY_ID:
        print(json.dumps({"configured": False, "reason": "no demo credentials in environment", "auth_docs": DOCS_AUTH}))
        return 0
    result = {"configured": True, "generated_at": now_iso(), "env": "demo", "errors": []}
    try:
        b = call("GET", f"{API_ROOT}/portfolio/balance")
        result["balance"] = {
            "balance_cents": b.get("balance"),
            "balance_dollars": b.get("balance_dollars"),
            "portfolio_value_cents": b.get("portfolio_value"),
            "updated_ts": b.get("updated_ts"),
            "api_url": BASE + API_ROOT + "/portfolio/balance",
        }
    except Exception as e:
        result["errors"].append(f"balance: {e}")
    time.sleep(0.35)
    for name, path in (("positions", "/portfolio/positions"), ("fills", "/portfolio/fills"), ("orders", "/portfolio/orders?status=resting")):
        try:
            d = call("GET", API_ROOT + path)
            key = [k for k in ("market_positions", "fills", "orders") if k in d]
            result[name] = d.get(key[0]) if key else d
            result[name + "_api_url"] = BASE + API_ROOT + path
        except Exception as e:
            result["errors"].append(f"{name}: {e}")
        time.sleep(0.35)
    # trade journal + analysis
    sm_path = os.path.join(out_dir, "..", "..", "scripts", "strategies.json")
    try:
        with open(sm_path) as f:
            smap = json.load(f).get("series_map_example", {})
    except Exception:
        smap = {}
    trades = result.get("fills") or []
    analysis = {"by_topic": {}, "by_strategy": {}, "win_rate": None}
    try:
        for t in trades:
            price = float((t.get("price_dollars") or "0").replace("$", "") or 0)
            count = float(t.get("count") or 0)
            topic = topic_of(t.get("market_ticker", ""), smap)
            side = t.get("outcome_side") or t.get("side") or ""
            slot = analysis["by_topic"].setdefault(topic or "unknown", {"fills": 0, "notional_usd": 0.0, "yes_fills": 0, "no_fills": 0})
            slot["fills"] += 1
            slot["notional_usd"] = round(slot["notional_usd"] + price * count, 4)
            slot["yes_fills" if side.lower().startswith("yes") or side == "buy" else "no_fills"] += 1
    except Exception as e:
        result["errors"].append(f"analysis: {e}")
    result["analysis"] = analysis
    path = os.path.join(out_dir, "portfolio.json")
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(json.dumps({"ok": not result["errors"], "written": path, "errors": result["errors"]}))
    return 0


def cmd_trade(ticker, side, count, price, tif, dry_run, post_only):
    if not TRADING_ALLOWED:
        raise SystemExit("Refusing to trade: set KALSHI_ALLOW_TRADING=1 to enable order placement (demo environment only).")
    body = {
        "ticker": ticker,
        "side": side,  # bid|ask on the single YES book (verified: create-order-v2.md)
        "count": fp_count(count),
        "price": fp_price(price),
        "time_in_force": tif,
        "self_trade_prevention_type": "taker_at_cross",
        "client_order_id": str(uuid.uuid4()),
        "post_only": bool(post_only),
        "cancel_order_on_pause": True,
        "reduce_only": False,
    }
    print(json.dumps({"dry_run": dry_run, "request": body, "endpoint": "POST " + BASE + API_ROOT + "/portfolio/events/orders", "docs": "https://docs.kalshi.com/api-reference/orders/create-order-v2.md"}, indent=2))
    if dry_run:
        return 0
    resp = call("POST", API_ROOT + "/portfolio/events/orders", body)
    print(json.dumps(resp, indent=2))
    return 0


def cmd_cancel(order_id, market_ticker):
    if not TRADING_ALLOWED:
        raise SystemExit("Refusing to cancel: set KALSHI_ALLOW_TRADING=1.")
    q = "/portfolio/events/orders/" + urllib.parse.quote(order_id)
    if market_ticker:
        q += "?" + urllib.parse.urlencode({"market_ticker": market_ticker})
    print(json.dumps(call("DELETE", q), indent=2))
    return 0


def cmd_auto(out_dir):
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "strategies.json")
    with open(cfg_path) as f:
        cfg = json.load(f)
    if not cfg.get("enabled", False):
        print(json.dumps({"status": "strategies disabled (scripts/strategies.json enabled=false); nothing executed", "how_to_enable": "set enabled=true AND KALSHI_ALLOW_TRADING=1; review per-strategy caps first"}))
        return 0
    if not TRADING_ALLOWED:
        raise SystemExit("strategies enabled in config but KALSHI_ALLOW_TRADING=1 is not set; refusing.")
    smap = cfg.get("series_map_example", {})
    snap_path = os.path.join(out_dir, "snapshot.json")
    with open(snap_path) as f:
        snap = json.load(f)
    log = []
    for strat in cfg.get("strategies", []):
        topic = strat.get("topic", "")
        max_contracts = float(strat.get("max_contracts_per_trade", 1))
        max_spread = float(strat.get("max_spread_dollars", 0.05))
        max_price = float(strat.get("max_entry_price_dollars", 0.60))
        min_price = float(strat.get("min_entry_price_dollars", 0.05))
        side_want = strat.get("side", "yes")  # yes|no
        for ev in (snap.get("topics", {}).get(topic, {}) or {}).get("top_events", []):
            for m in ev.get("markets", []):
                bid = float(m.get("yes_bid_dollars") or 0)
                ask = float(m.get("yes_ask_dollars") or 0)
                spread = round(ask - bid, 4)
                if not (min_price <= ask <= max_price) or spread > max_spread or ask <= 0:
                    continue
                if side_want == "no":
                    nbid = float(m.get("no_bid_dollars") or 0)
                    if nbid <= 0 or nbid > max_price:
                        continue
                    body_side, price = "bid", nbid
                else:
                    body_side, price = "bid", ask
                body = {
                    "ticker": m["ticker"], "side": body_side,
                    "count": fp_count(max_contracts), "price": fp_price(price),
                    "time_in_force": "good_till_canceled",
                    "self_trade_prevention_type": "taker_at_cross",
                    "client_order_id": str(uuid.uuid4()),
                    "post_only": True, "cancel_order_on_pause": True, "reduce_only": False,
                }
                try:
                    resp = call("POST", API_ROOT + "/portfolio/events/orders", body)
                    log.append({"strategy": strat.get("name"), "market": m["ticker"], "response": resp, "at": now_iso()})
                except Exception as e:
                    log.append({"strategy": strat.get("name"), "market": m["ticker"], "error": str(e), "at": now_iso()})
                time.sleep(0.5)
    out = os.path.join(out_dir, "trades.json")
    prev = []
    if os.path.exists(out):
        try:
            prev = json.load(open(out)).get("trades", [])
        except Exception:
            prev = []
    with open(out, "w") as f:
        json.dump({"generated_at": now_iso(), "trades": (prev + log)[-500:]}, f, indent=1)
    print(json.dumps({"executed": len(log), "written": out}))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    t = sub.add_parser("trade")
    t.add_argument("--ticker", required=True)
    t.add_argument("--side", choices=["bid", "ask"], required=True)
    t.add_argument("--count", type=float, required=True)
    t.add_argument("--price", type=float, required=True)
    t.add_argument("--tif", default="good_till_canceled", choices=["good_till_canceled", "fill_or_kill", "immediate_or_cancel"])
    t.add_argument("--post-only", action="store_true")
    t.add_argument("--dry-run", action="store_true")
    c = sub.add_parser("cancel")
    c.add_argument("--order-id", required=True)
    c.add_argument("--market-ticker", default="")
    sub.add_parser("auto")
    args = ap.parse_args()
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "data")
    if args.cmd == "status":
        sys.exit(cmd_status(out_dir))
    if args.cmd == "trade":
        sys.exit(cmd_trade(args.ticker, args.side, args.count, args.price, args.tif, args.dry_run, args.post_only))
    if args.cmd == "cancel":
        sys.exit(cmd_cancel(args.order_id, args.market_ticker))
    if args.cmd == "auto":
        sys.exit(cmd_auto(out_dir))


if __name__ == "__main__":
    main()
