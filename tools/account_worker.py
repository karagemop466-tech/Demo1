#!/usr/bin/env python3
"""Read-only Kalshi demo account worker (standard library only).

Why this exists
---------------
Portfolio performance, fills and settlement data live behind signed requests.
A GitHub Pages site is public, so it must never hold a private key. This worker
is the only component that touches credentials: it runs where you put it (your
machine, a small server, or a CI job you control), signs requests with your demo
key, writes a *derived, non-secret* JSON summary, and nothing else.

It never places, amends or cancels orders. It has no write path at all.

Setup
-----
1. Create a demo API key: demo.kalshi.co -> Account & security -> API Keys.
   (Documented: https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
2. Export:
       export KALSHI_API_KEY_ID="<key id uuid>"
       export KALSHI_PRIVATE_KEY_PATH="/secure/path/kalshi-demo.key"
3. Run:
       python tools/account_worker.py --out snapshot/account.json
4. Commit only snapshot/account.json (it contains derived numbers, no secrets).
   The site renders whatever is in it; if the file is absent the pages show an
   explicit "not connected" state instead of inventing figures.

Signature scheme (verified against docs.kalshi.com):
    message = timestamp_ms + METHOD + path_without_query
    RSA keys  -> RSA-PSS, SHA-256, MGF1(SHA-256), salt = digest length
    Ed25519   -> sign the message directly
    headers  -> KALSHI-ACCESS-KEY / KALSHI-ACCESS-TIMESTAMP / KALSHI-ACCESS-SIGNATURE
"""

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
SIGN_PREFIX = "/trade-api/v2"

try:  # optional: only needed when a key is actually used
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAVE_CRYPTO = True
except Exception:  # pragma: no cover
    HAVE_CRYPTO = False


def load_key(path):
    with open(path, "rb") as f:
        pem = f.read()
    return serialization.load_pem_private_key(pem, password=None)


def sign(key, timestamp_ms, method, path):
    msg = f"{timestamp_ms}{method}{path}".encode()
    if isinstance(key, Ed25519PrivateKey):
        sig = key.sign(msg)
    else:
        sig = key.sign(
            msg,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                        salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )
    return base64.b64encode(sig).decode()


def signed_get(key_id, key, path, params=None):
    """GET a private endpoint. `path` is relative to BASE (e.g. /portfolio/balance)."""
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    ts = str(int(time.time() * 1000))
    headers = {
        "KALSHI-ACCESS-KEY": key_id,
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "KALSHI-ACCESS-SIGNATURE": sign(key, ts, "GET", SIGN_PREFIX + path),
        "Accept": "application/json",
        "User-Agent": "kalshi-demo-research/1.0",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return url, json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:300]
        except Exception:
            pass
        return url, None, f"HTTP {e.code} {body}".strip()
    except Exception as e:
        return url, None, f"{type(e).__name__}: {e}"


def D(v):
    try:
        return Decimal(str(v))
    except Exception:
        return None


def analyse(positions, fills, settlements):
    """Derive performance by topic-agnostic categories. Every number is a sum of
    documented API fields, and each block reports how many records it used."""
    out = {"by_market": {}, "totals": {}}
    realised = Decimal("0")
    fees = Decimal("0")
    exposure = Decimal("0")
    for p in positions.get("market_positions", []):
        t = p.get("ticker")
        rp = D(p.get("realized_pnl_dollars"))
        fe = D(p.get("fees_paid_dollars"))
        ex = D(p.get("market_exposure_dollars"))
        if rp is not None:
            realised += rp
        if fe is not None:
            fees += fe
        if ex is not None:
            exposure += ex
        out["by_market"][t] = {
            "position_contracts": p.get("position_fp"),
            "market_exposure_dollars": p.get("market_exposure_dollars"),
            "realized_pnl_dollars": p.get("realized_pnl_dollars"),
            "fees_paid_dollars": p.get("fees_paid_dollars"),
            "total_traded_dollars": p.get("total_traded_dollars"),
            "last_updated_ts": p.get("last_updated_ts"),
        }
    # trade-level categorisation used by the strategies page
    by_side = {}
    maker_taker = {"taker": 0, "maker": 0}
    for f in fills.get("fills", []):
        side = (f.get("outcome_side") or f.get("side") or "unknown")
        by_side.setdefault(side, {"fills": 0, "contracts": Decimal("0"),
                                  "fees": Decimal("0")})
        by_side[side]["fills"] += 1
        c = D(f.get("count_fp")) or Decimal("0")
        by_side[side]["contracts"] += c
        fc = D(f.get("fee_cost")) or Decimal("0")
        by_side[side]["fees"] += fc
        fees += fc
        maker_taker["taker" if f.get("is_taker") else "maker"] += 1
    out["by_side"] = {k: {"fills": v["fills"], "contracts": str(v["contracts"]),
                          "fees_dollars": str(v["fees"])} for k, v in by_side.items()}
    out["maker_taker"] = maker_taker
    out["totals"] = {
        "positions_counted": len(positions.get("market_positions", [])),
        "fills_counted": len(fills.get("fills", [])),
        "settlements_counted": len(settlements.get("settlements", [])),
        "realized_pnl_dollars": str(realised),
        "fees_paid_dollars": str(fees),
        "open_exposure_dollars": str(exposure),
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="snapshot/account.json")
    args = ap.parse_args()

    key_id = __import__("os").environ.get("KALSHI_API_KEY_ID", "").strip()
    key_path = __import__("os").environ.get("KALSHI_PRIVATE_KEY_PATH", "").strip()
    if not key_id or not key_path:
        print("KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PATH not set — "
              "this worker will not run without a demo key. Nothing written.", file=sys.stderr)
        return 2
    if not HAVE_CRYPTO:
        print("the 'cryptography' package is required to sign requests "
              "(pip install cryptography)", file=sys.stderr)
        return 2

    key = load_key(key_path)
    result = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "environment": "demo",
        "base": BASE,
        "read_only": True,
        "orders_placed": 0,
        "sources": {},
        "errors": [],
    }
    bal_url, bal, bal_err = signed_get(key_id, key, "/portfolio/balance")
    result["sources"]["balance"] = bal_url
    if bal_err:
        result["errors"].append({"endpoint": "/portfolio/balance", "error": bal_err})
    else:
        result["balance_dollars"] = bal.get("balance_dollars")
        result["portfolio_value_dollars"] = (
            str(D(bal.get("portfolio_value")) / 100) if bal.get("portfolio_value") is not None else None)
        result["balance_updated_ts"] = bal.get("updated_ts")

    pos_url, pos, pos_err = signed_get(
        key_id, key, "/portfolio/positions",
        {"settlement_status": "all", "limit": 1000})
    result["sources"]["positions"] = pos_url
    if pos_err:
        result["errors"].append({"endpoint": "/portfolio/positions", "error": pos_err})
        pos = {}
    fill_url, fills, fill_err = signed_get(key_id, key, "/portfolio/fills", {"limit": 1000})
    result["sources"]["fills"] = fill_url
    if fill_err:
        result["errors"].append({"endpoint": "/portfolio/fills", "error": fill_err})
        fills = {}
    set_url, sets, set_err = signed_get(key_id, key, "/portfolio/settlements", {"limit": 1000})
    result["sources"]["settlements"] = set_url
    if set_err:
        result["errors"].append({"endpoint": "/portfolio/settlements", "error": set_err})
        sets = {}

    result["analysis"] = analyse(pos or {}, fills or {}, sets or {})
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"wrote {out} (no secrets included)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
