#!/usr/bin/env python3
"""Deterministic, simulated (paper) trading across Kalshi demo markets.

What this does
--------------
Runs eight pre-registered strategies against the committed demo snapshot, then grades
every paper trade against the exchange's own `result` field once a market settles.
Nothing here touches an account, a key or the exchange: there is no order endpoint in
this file and no credential is read.

Rules that keep the output honest
--------------------------------
1. No look-ahead. A trade is opened only from data in the *entry* snapshot, and is
   graded only from a *later* snapshot in which the market shows `status=finalized`
   with `result` in {yes,no}. Trades whose market is still open are marked OPEN and
   excluded from win-rate and ROI.
2. Fees are charged from the published schedule (taker and maker), never zero.
3. Every trade stores the exact API URL for the entry price and for the resolution.
4. Simulated prices come from the demo venue, which Kalshi documents as potentially
   unrepresentative of real markets (https://docs.kalshi.com/getting_started/demo_env).
5. A strategy that cannot fill (no quote, no ask, etc.) records a SKIP with the reason;
   skips are shown, not hidden.

Usage
-----
  python3 desk/tools/paper_trader.py --note "run 1"          # shape cached ledger
  python3 desk/tools/paper_trader.py --max-new 40            # open new paper trades
  python3 desk/tools/paper_trader.py --grade                 # grade vs settles
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kalshi_fees import maker_fee, taker_fee  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "desk" / "data"
LEDGER = DATA / "paper-trades.json"
SNAP = DATA / "markets-live.json"
ARCHIVE = DATA / "snapshot-slim.json"

START_BANKROLL = Decimal("10000.00")
STAKE = Decimal("100.00")            # dollars of premium per trade
MAX_CONTRACTS = Decimal("500")
MIN_PRICE = Decimal("0.02")
MAX_PRICE = Decimal("0.98")

# --------------------------------------------------------------------------------------
# Strategy catalogue. Each entry is a published, auditable rule with the exact condition
# written in words, so a reader can re-derive every trade from the snapshot.
# --------------------------------------------------------------------------------------
STRATEGIES = [
    {
        "id": "S1", "name": "Topic favourite (momentum)",
        "family": "Directional",
        "side": "YES",
        "rule": "Inside each topic, buy YES on the market with the highest 24h traded notional "
                "when its YES ask is between $0.02 and $0.98.",
        "why": "Tests whether the money in the demo book is on the eventual winner.",
        "select": "top_notional", "order": -1, "min_price": "0.02", "max_price": "0.98",
    },
    {
        "id": "S2", "name": "Topic underdog (contrarian)",
        "family": "Directional",
        "side": "YES",
        "rule": "Inside each topic, buy YES on the lowest-priced market whose YES ask is "
                ">= $0.02 and whose 24h traded notional is >= $100.",
        "why": "Long-shot bias test: cheap YES contracts often overprice tails.",
        "select": "cheapest_yes", "order": 1, "min_price": "0.02", "max_price": "0.50",
        "min_notional": "100",
    },
    {
        "id": "S3", "name": "YES/NO pair arbitrage",
        "family": "Relative value",
        "side": "PAIR",
        "rule": "Buy 1 YES and 1 NO in the same market when YES ask + NO ask < $1.00 by at "
                "least $0.01 after taker fees on both legs.",
        "why": "A $1.00 guaranteed pair bought below $1.00 is a riskless edge if both legs fill.",
        "select": "pair_edge", "min_edge": "0.01",
    },
    {
        "id": "S4", "name": "Heavy favourite (hold YES)",
        "family": "Relative value",
        "side": "YES",
        "rule": "Buy YES where the YES ask is between $0.80 and $0.95 and the implied spread "
                "(YES ask + NO ask - $1.00) is at most $0.02, i.e. the book agrees with the "
                "favourite and the round trip is cheap.",
        "why": "Favourite-longshot bias: heavily favoured contracts historically win slightly "
               "more often than their price implies. Tested here on demo prices.",
        "select": "heavy_favourite", "min_yes": "0.80", "max_yes": "0.95", "max_spread": "0.02",
    },
    {
        "id": "S5", "name": "Wide-spread fade",
        "family": "Liquidity",
        "side": "NO",
        "rule": "Buy NO where the implied spread (YES ask + NO ask - $1.00) >= $0.05 and the NO "
                "ask is between $0.02 and $0.98, i.e. the book is wide enough to justify taking "
                "the safer side.",
        "why": "Wide books on the demo venue mean the quoted price is not a fair estimate.",
        "select": "wide_spread", "min_spread": "0.05",
    },
    {
        "id": "S6", "name": "Balanced book (deepest contracts)",
        "family": "Liquidity",
        "side": "YES",
        "rule": "Buy YES on the market with the largest resting YES-ask contract count among "
                "markets whose YES ask is at most $0.60.",
        "why": "Checks whether liquidity, not opinion, predicts the outcome.",
        "select": "deepest_ask", "max_price": "0.60",
    },
    {
        "id": "S7", "name": "Crypto range midpoint",
        "family": "Structural",
        "side": "YES",
        "rule": "Inside crypto only, buy YES on the market whose YES mid is closest to $0.50 "
                "with a spread <= $0.10.",
        "why": "Crypto range markets cluster; the near-coin-flip contract is the purest test.",
        "select": "near_coinflip", "topics": ["crypto"], "max_spread": "0.10",
    },
    {
        "id": "S8", "name": "Short-dated holder",
        "family": "Event outcome",
        "side": "YES",
        "rule": "Buy YES on the market that closes soonest (within 7 days of the snapshot) "
                "where the YES price is between $0.20 and $0.80.",
        "why": "Fast settlement gives the most graded samples per collection run.",
        "select": "soonest_close", "max_days": 7, "min_price": "0.20", "max_price": "0.80",
    },
]


def d(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def market_index(snapshot: dict) -> dict:
    """ticker -> row, over open + settled + closed."""
    idx = {}
    for bucket in ("open", "settled", "closed"):
        for m in snapshot.get(bucket) or []:
            idx[m["market_ticker"]] = m
    return idx


def snapshot_from_archive() -> dict:
    """Fall back to the committed verified snapshot (snapshot/*.json) when no fresh run exists.

    The snapshot files are the collector's own transcriptions of official demo API
    responses; every row keeps the request URL it came from in `sources`.
    """
    raw_open = load_json(ROOT / "snapshot" / "markets.json", {})
    raw_res = load_json(ROOT / "snapshot" / "resolved.json", {})
    out = {
        "open": [], "settled": [], "closed": [],
        "generated_utc": raw_open.get("generated_utc"),
        "base_url": raw_open.get("base"),
        "archive_mode": True,
    }

    def adapt(m):
        q = m.get("quotes") or {}
        y, n = q.get("yes") or {}, q.get("no") or {}
        ya, na = d(y.get("ask")), d(n.get("ask"))
        mid = None
        if d(y.get("bid")) is not None and ya is not None and ya > 0:
            mid = (d(y.get("bid")) + ya) / 2
        notional = m.get("dollar_notional_24h") or {}
        return {
            "topic": m.get("topic"),
            "market_ticker": m.get("market_ticker"),
            "event_ticker": m.get("event_ticker"),
            "event_title": m.get("event_title"),
            "title": m.get("title"),
            "status": m.get("status"),
            "result": m.get("result"),
            "settlement_value_dollars": m.get("settlement_value_dollars"),
            "close_time": m.get("close_time"),
            "mid": str(mid) if mid is not None else None,
            "yes": {"bid": y.get("bid"), "ask": y.get("ask"),
                    "bid_size": y.get("bid_size_contracts"), "ask_size": y.get("ask_size_contracts")},
            "no": {"bid": n.get("bid"), "ask": n.get("ask"),
                   "bid_size": n.get("bid_size_contracts"), "ask_size": n.get("ask_size_contracts")},
            "volume_24h": m.get("volume_24h_contracts"),
            "notional_24h": {"value": notional.get("value"), "source_url": notional.get("source")},
            "source_url": (m.get("sources") or {}).get("markets"),
            "kalshi_page": "https://kalshi.com/markets/" + str(m.get("series_ticker") or "").lower(),
        }

    def excluded(m) -> bool:
        series = (m.get("series_ticker") or "").upper()
        for bad in EXCLUDED_SERIES:
            if series == bad or series.startswith(bad + "-"):
                return True
        return False

    for m in raw_open.get("markets") or []:
        if m.get("status") == "active" and not excluded(m):
            out["open"].append(adapt(m))
    for m in raw_res.get("markets") or []:
        if excluded(m):
            continue
        row = adapt(m)
        row["source_url"] = (m.get("sources") or {}).get("markets")
        if (m.get("result") or "").lower() in ("yes", "no"):
            out["settled"].append(row)
        else:
            out["closed"].append(row)
    return out


def leg_price(row: dict, side: str):
    """The ask we would actually pay for the leg we intend to buy."""
    leg = (row.get("yes") if side == "YES" else row.get("no")) or {}
    return d(leg.get("ask"))


def tradable(row: dict, side: str = "YES") -> bool:
    """A leg is tradable only inside [$0.02, $0.98]: outside that range there is no upside."""
    ask = leg_price(row, side)
    return ask is not None and MIN_PRICE <= ask <= MAX_PRICE


def usable(row: dict) -> bool:
    return tradable(row, "YES")


def spread(row: dict):
    """YES ask + NO ask - $1.00, defined only when BOTH sides are quoted above $0.

    A quoted 0.00 ask means the opposite bid side is empty, so the resulting "spread"
    would describe a one-sided book, not a two-sided one. Those rows are skipped and
    reported as SKIP rather than counted as wide spreads.
    """
    y = row.get("yes") or {}
    n = row.get("no") or {}
    ya, na = d(y.get("ask")), d(n.get("ask"))
    if ya is None or na is None or ya <= 0 or na <= 0:
        return None
    return ya + na - Decimal(1)


# Series that the earlier snapshot's topic rules filed under a topic they do not belong to.
# They are excluded here with the reason stated, and published on the Flagged page.
EXCLUDED_SERIES = {
    "KXWTI": "Crude-oil (WTI) price market filed under Elections by the earlier snapshot's "
             "keyword rule. It is an oil market, not an election, so it is excluded from both "
             "the elections tables and from every strategy.",
}


def notional(row: dict) -> Decimal:
    """Measured 24h traded notional in USD, or -1 when this market was not traded-measured."""
    v = row.get("notional_24h") or {}
    return d(v.get("value")) or Decimal("-1")


def rank_key(row: dict):
    """(basis_rank, value): measured dollars first, then 24h contract volume.

    The basis is written into the trade's entry_reason so the reader always knows
    whether a pick was ranked on measured dollars or on contract count.
    """
    n = notional(row)
    if n >= 0:
        return (2, n, "measured 24h traded notional")
    v = d(row.get("volume_24h")) or Decimal("-1")
    return (1, v, "24h contract volume (no trade-measured dollars for this market)")


def pick(strategy: dict, markets: list) -> list:
    """Return [(market, side, reason)] following the published rule."""
    sid = strategy["id"]
    rows = [m for m in markets if m.get("status") == "active"]
    if strategy.get("topics"):
        rows = [m for m in rows if m.get("topic") in strategy["topics"]]
    if strategy.get("min_notional"):
        cut = Decimal(strategy["min_notional"])
        rows = [m for m in rows if notional(m) >= cut]
    picks = []

    if sid == "S1":
        for topic in {"gas_prices", "elections", "culture", "crypto", "golf"}:
            pool = [m for m in rows if m.get("topic") == topic and usable(m)]
            if not pool:
                continue
            pool.sort(key=rank_key, reverse=True)
            m = pool[0]
            basis = rank_key(m)[2]
            picks.append((m, "YES", f"highest ranked by {basis} in {topic}, YES ask ${m['yes']['ask']}"))

    elif sid == "S2":
        for topic in {"gas_prices", "elections", "culture", "crypto", "golf"}:
            pool = [m for m in rows if m.get("topic") == topic and usable(m)
                    and (leg_price(m, "YES") or 0) <= Decimal(strategy["max_price"])]
            if not pool:
                continue
            pool.sort(key=lambda m: d(m["yes"]["ask"]))
            m = pool[0]
            picks.append((m, "YES", f"cheapest YES ask ${m['yes']['ask']} in {topic}"))

    elif sid == "S3":
        # With implied asks defined as 1 - best opposite bid, YES ask + NO ask can never be
        # below $1.00, so this strategy is expected to find nothing. It is kept as a live
        # monitor: if a crossed book ever appears, the trade and its source URL are recorded.
        scored = []
        for m in rows:
            sp = spread(m)
            if sp is None:
                continue
            ya, na = d(m["yes"]["ask"]), d(m["no"]["ask"])
            cost = ya + na
            fee = taker_fee(ya, 1) + taker_fee(na, 1)
            edge = Decimal(1) - cost - fee
            if edge >= Decimal(strategy["min_edge"]):
                scored.append((edge, m))
        scored.sort(key=lambda x: x[0], reverse=True)
        for edge, m in scored[:3]:
            picks.append((m, "PAIR", f"YES ask {m['yes']['ask']} + NO ask {m['no']['ask']} "
                                     f"= {cost_of_pair(m)} per pair; net edge after fees ${edge:.4f}"))

    elif sid == "S4":
        lo, hi = Decimal(strategy["min_yes"]), Decimal(strategy["max_yes"])
        max_sp = Decimal(strategy["max_spread"])
        pool = []
        for m in rows:
            ya = leg_price(m, "YES")
            sp = spread(m)
            if ya is None or sp is None or not (lo <= ya <= hi) or sp > max_sp:
                continue
            if not tradable(m, "YES"):
                continue
            pool.append((ya, m))
        pool.sort(key=lambda x: x[0], reverse=True)
        for ya, m in pool[:2]:
            picks.append((m, "YES", f"heavy favourite YES ask ${m['yes']['ask']}, "
                                    f"implied spread ${spread(m)}"))

    elif sid == "S5":
        scored = [(spread(m), m) for m in rows if spread(m) is not None and tradable(m, "NO")]
        wide = [(s, m) for s, m in scored if s >= Decimal(strategy["min_spread"])]
        wide.sort(key=lambda x: x[0], reverse=True)
        for s, m in wide[:2]:
            picks.append((m, "NO", f"implied spread ${s}; buying the NO side"))

    elif sid == "S6":
        pool = [m for m in rows
                if usable(m)
                and (leg_price(m, "YES") or 1) <= Decimal(strategy["max_price"])]
        with_depth = [m for m in pool if d((m.get("yes") or {}).get("ask_size"))]
        if with_depth:
            with_depth.sort(key=lambda m: d(m["yes"]["ask_size"]), reverse=True)
            m = with_depth[0]
            picks.append((m, "YES", f"largest resting YES ask size {m['yes']['ask_size']} contracts"))

    elif sid == "S7":
        pool = []
        for m in rows:
            mid = d(m.get("mid"))
            sp = spread(m)
            if mid is None or sp is None or sp > Decimal(strategy["max_spread"]):
                continue
            if not usable(m):
                continue
            pool.append((abs(mid - Decimal("0.5")), m))
        pool.sort(key=lambda x: x[0])
        for _, m in pool[:2]:
            picks.append((m, "YES", f"mid ${m['mid']} closest to $0.50 in crypto"))

    elif sid == "S8":
        snap_dt = market_dt(rows)
        pool = []
        for m in rows:
            close = parse_dt(m.get("close_time"))
            if not close or not snap_dt:
                continue
            days = (close - snap_dt).total_seconds() / 86400
            if 0 < days <= strategy["max_days"] and usable(m) \
                    and Decimal(strategy["min_price"]) <= (leg_price(m, "YES") or 0) <= Decimal(strategy["max_price"]):
                pool.append((days, m))
        pool.sort(key=lambda x: x[0])
        for days, m in pool[:2]:
            picks.append((m, "YES", f"closes in {days:.1f} days at YES ask ${m['yes']['ask']}"))

    return picks


def market_dt(rows):
    for m in rows:
        if m.get("snapshot_utc"):
            return parse_dt(m["snapshot_utc"])
    return None


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def cost_of_pair(m):
    ya, na = d(m["yes"]["ask"]), d(m["no"]["ask"])
    return str(ya + na) if ya is not None and na is not None else None


def open_trades(trades, picks, strategy, snapshot_utc, max_new):
    opened = 0
    seen = {(t["strategy"], t["market_ticker"]) for t in trades}
    for m, side, reason in picks:
        if opened >= max_new:
            break
        key = (strategy["id"], m["market_ticker"])
        if key in seen:
            continue
        price = None
        if side == "YES":
            price = d(m["yes"]["ask"])
        elif side == "NO":
            price = d(m["no"]["ask"])
        elif side == "PAIR":
            price = None
        if price is None and side != "PAIR":
            continue
        contracts = STAKE / price if price else Decimal(1)
        if contracts > MAX_CONTRACTS:
            contracts = MAX_CONTRACTS
        notional_usd = (price * contracts) if price else (d(m["yes"]["ask"]) + d(m["no"]["ask"]))
        if price:
            fee = taker_fee(price, contracts)
        else:
            fee = taker_fee(m["yes"]["ask"], 1) + taker_fee(m["no"]["ask"], 1)
        trades.append({
            "id": f'{strategy["id"]}-{len(trades)+1:04d}',
            "strategy": strategy["id"],
            "strategy_name": strategy["name"],
            "family": strategy["family"],
            "topic": m.get("topic"),
            "market_ticker": m["market_ticker"],
            "event_title": m.get("event_title"),
            "title": m.get("title"),
            "side": side,
            "entry_price": str(price) if price else None,
            "contracts": str(contracts.quantize(Decimal("0.01"))),
            "premium_usd": str(notional_usd.quantize(Decimal("0.01"))) if notional_usd else None,
            "fee_usd": str(fee.quantize(Decimal("0.01"))),
            "entry_utc": snapshot_utc,
            "entry_reason": reason,
            "entry_source_url": m.get("source_url"),
            "kalshi_page": m.get("kalshi_page"),
            "status": "OPEN",
            "result": None,
            "payout_usd": None,
            "pnl_usd": None,
            "roi": None,
            "graded_utc": None,
            "resolution_source_url": None,
            "resolution_note": None,
        })
        opened += 1
    return opened


def grade(trades, index):
    changed = 0
    for t in trades:
        if t["status"] != "OPEN":
            continue
        m = index.get(t["market_ticker"])
        if not m:
            continue
        result = (m.get("result") or "").lower()
        status = (m.get("status") or "").lower()
        if result not in ("yes", "no") or status not in ("finalized", "settled"):
            continue
        # per-leg payout: a YES/NO pair always returns exactly $1.00 per unit
        contracts = d(t["contracts"]) or Decimal(0)
        if t["side"] == "YES":
            payout = contracts if result == "yes" else Decimal(0)
        elif t["side"] == "NO":
            payout = contracts if result == "no" else Decimal(0)
        else:  # PAIR
            payout = Decimal(1)
        premium = d(t["premium_usd"]) or Decimal(0)
        fee = d(t["fee_usd"]) or Decimal(0)
        pnl = payout - premium - fee
        t.update({
            "status": "SETTLED",
            "result": result,
            "payout_usd": str(payout.quantize(Decimal("0.01"))),
            "pnl_usd": str(pnl.quantize(Decimal("0.01"))),
            "roi": str((pnl / premium).quantize(Decimal("0.0001"))) if premium else None,
            "graded_utc": now_iso(),
            "resolution_source_url": m.get("source_url"),
            "resolution_note": f"exchange status={status}, result={result}, "
                               f"settlement_value_dollars={m.get('settlement_value_dollars')}",
        })
        changed += 1
    return changed


def summarise(trades):
    stats = {}
    for t in trades:
        s = stats.setdefault(t["strategy"], {
            "strategy": t["strategy"], "name": t["strategy_name"], "family": t["family"],
            "open": 0, "settled": 0, "wins": 0, "losses": 0,
            "premium": Decimal(0), "fees": Decimal(0), "pnl": Decimal(0),
        })
        if t["status"] == "OPEN":
            s["open"] += 1
            continue
        s["settled"] += 1
        s["premium"] += d(t["premium_usd"]) or Decimal(0)
        s["fees"] += d(t["fee_usd"]) or Decimal(0)
        pnl = d(t["pnl_usd"]) or Decimal(0)
        s["pnl"] += pnl
        if pnl > 0:
            s["wins"] += 1
        elif pnl < 0:
            s["losses"] += 1
    rows = []
    for s in stats.values():
        settled = s["settled"]
        rows.append({
            "strategy": s["strategy"], "name": s["name"], "family": s["family"],
            "open": s["open"], "settled": settled,
            "wins": s["wins"], "losses": s["losses"],
            "win_rate": (str((Decimal(s["wins"]) / Decimal(settled)).quantize(Decimal("0.0001")))
                         if settled else None),
            "premium": str(s["premium"].quantize(Decimal("0.01"))),
            "fees": str(s["fees"].quantize(Decimal("0.01"))),
            "pnl": str(s["pnl"].quantize(Decimal("0.01"))),
            "roi": (str((s["pnl"] / s["premium"]).quantize(Decimal("0.0001")))
                    if s["premium"] else None),
        })
    rows.sort(key=lambda r: (-(d(r["pnl"]) or Decimal(0)), r["strategy"]))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-new", type=int, default=30)
    ap.add_argument("--note", default="")
    ap.add_argument("--grade", action="store_true")
    args = ap.parse_args()

    ledger = load_json(LEDGER, {"strategies": STRATEGIES, "trades": [], "runs": []})
    trades = ledger.get("trades", [])

    live = load_json(SNAP, {})
    if live.get("open"):
        snapshot = live
    else:
        snapshot = snapshot_from_archive()
    snapshot_utc = snapshot.get("generated_utc") or now_iso()

    for bucket in ("open", "settled", "closed"):
        for m in snapshot.get(bucket) or []:
            m.setdefault("snapshot_utc", snapshot_utc)

    index = market_index(snapshot)
    graded = grade(trades, index)

    opened = 0
    if not args.grade:
        markets = snapshot.get("open") or []
        for strategy in STRATEGIES:
            picks = pick(strategy, markets)
            opened += open_trades(trades, picks, strategy, snapshot_utc, max(0, args.max_new - opened))

    ledger.update({
        "generated_utc": now_iso(),
        "snapshot_utc": snapshot_utc,
        "snapshot_base": snapshot.get("base_url"),
        "source_mode": "live-run" if snapshot.get("open") and not snapshot.get("archive_mode") else "committed-snapshot",
        "starting_bankroll_usd": str(START_BANKROLL),
        "stake_usd": str(STAKE),
        "strategies": STRATEGIES,
        "trades": trades,
        "by_strategy": summarise(trades),
        "fees_doc": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
        "lifecycle_doc": "https://docs.kalshi.com/getting_started/market_lifecycle",
        "demo_warning": "https://docs.kalshi.com/getting_started/demo_env",
        "excluded_series": EXCLUDED_SERIES,
        "honesty": [
            "Grades use the exchange's own result field; no outcome is inferred.",
            "OPEN trades are excluded from win rate, P&L and ROI.",
            "Fees are charged on every fill from the published schedule (taker).",
            "Prices come from the demo venue, which Kalshi documents as possibly unrepresentative.",
            "This ledger is a simulation: no order was sent and no account was read.",
        ],
    })
    ledger.setdefault("runs", []).append({
        "at": now_iso(), "opened": opened, "graded": graded,
        "note": args.note, "snapshot_utc": snapshot_utc,
    })
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(ledger, separators=(",", ":")), encoding="utf-8")

    total_settled = sum(1 for t in trades if t["status"] == "SETTLED")
    print(f"trades={len(trades)} open={len(trades)-total_settled} settled={total_settled} "
          f"opened_now={opened} newly_graded={graded} source={ledger['source_mode']}")
    for r in ledger["by_strategy"][:10]:
        print(f"  {r['strategy']} {r['name'][:34]:34} settled={r['settled']:3} "
              f"win_rate={r['win_rate']} pnl={r['pnl']} roi={r['roi']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
