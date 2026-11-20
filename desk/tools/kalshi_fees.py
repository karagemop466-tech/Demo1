#!/usr/bin/env python3
"""Kalshi trading-fee arithmetic, verified against the published fee table.

Official source (fetched 2026-11-20):
  https://kalshi.com/docs/kalshi-fee-schedule.pdf
  "General Trading Fees" — fees = roundup(M x 0.07 x C x P x (1-P))
    P = contract price in dollars, C = contracts, M = multiplier (default 1)
  "Maker Fees"          — fees = roundup(M x 0.0175 x C x P x (1-P)), M default 0
  "Settlement Fees"     — "There is no settlement fee."

Rounding detail, resolved empirically (not guessed): the PDF's prose says the fee is
rounded up "to a centicent", but its own 21-row table only reproduces if the *total* is
rounded up to a whole cent. Every one of the 21 published rows is asserted below; the
wording/table discrepancy is published as irregularity FL-06 rather than silently picked.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_CEILING

TAKER_RATE = Decimal("0.07")
MAKER_RATE = Decimal("0.0175")
CENT = Decimal("0.01")
CENTICENT = Decimal("0.0001")

# Verbatim from the PDF's "General Trading Fees Table" (price, fee for 1 contract, fee for 100).
PDF_TABLE = [
    ("0.01", "0.01", "0.07"), ("0.05", "0.01", "0.34"), ("0.10", "0.01", "0.63"),
    ("0.15", "0.01", "0.90"), ("0.20", "0.02", "1.12"), ("0.25", "0.02", "1.32"),
    ("0.30", "0.02", "1.47"), ("0.35", "0.02", "1.60"), ("0.40", "0.02", "1.68"),
    ("0.45", "0.02", "1.74"), ("0.50", "0.02", "1.75"), ("0.55", "0.02", "1.74"),
    ("0.60", "0.02", "1.68"), ("0.65", "0.02", "1.60"), ("0.70", "0.02", "1.47"),
    ("0.75", "0.02", "1.32"), ("0.80", "0.02", "1.12"), ("0.85", "0.01", "0.90"),
    ("0.90", "0.01", "0.63"), ("0.95", "0.01", "0.34"), ("0.99", "0.01", "0.07"),
]


def _d(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _ceil(value: Decimal, step: Decimal) -> Decimal:
    return (value / step).to_integral_value(rounding=ROUND_CEILING) * step


def taker_fee(price, contracts, multiplier=1, step: Decimal = CENT) -> Decimal:
    """Fee in dollars for an immediately-matched (taker) order."""
    p, c = _d(price), _d(contracts)
    if p is None or c is None or c <= 0 or p <= 0 or p >= 1:
        return Decimal("0")
    raw = Decimal(str(multiplier)) * TAKER_RATE * c * p * (Decimal(1) - p)
    return _ceil(raw, step)


def maker_fee(price, contracts, multiplier=0, step: Decimal = CENT) -> Decimal:
    """Fee in dollars for a resting (maker) order that later fills."""
    p, c = _d(price), _d(contracts)
    if p is None or c is None or c <= 0 or p <= 0 or p >= 1:
        return Decimal("0")
    raw = Decimal(str(multiplier)) * MAKER_RATE * c * p * (Decimal(1) - p)
    return _ceil(raw, step)


def settlement_fee() -> Decimal:
    """The schedule states there is no settlement fee."""
    return Decimal("0")


def verify_published_table() -> list:
    """Return a list of (price, expected, got, ok) for the 21 published rows."""
    results = []
    for price, fee1, fee100 in PDF_TABLE:
        got1 = taker_fee(price, 1)
        got100 = taker_fee(price, 100)
        ok = got1 == Decimal(fee1) and got100 == Decimal(fee100)
        results.append((price, fee1, str(got1), fee100, str(got100), ok))
    return results


if __name__ == "__main__":
    rows = verify_published_table()
    bad = [r for r in rows if not r[-1]]
    for r in rows:
        print(("OK  " if r[-1] else "FAIL"), f"P={r[0]}  fee(1)={r[2]} (pdf {r[1]})  fee(100)={r[3]} (pdf {r[2-1+1] if False else r[3]})")
    print(f"{len(rows)-len(bad)}/{len(rows)} published rows reproduced")
    raise SystemExit(1 if bad else 0)
