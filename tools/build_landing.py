#!/usr/bin/env python3
"""Regenerate the data blocks on the root landing page from the committed snapshot.

Why this exists
---------------
The landing page used to carry hand-typed counts, which is how a figure drifts away
from the data it claims to summarise. This script writes the KPI cards, the per-topic
counts and the "snapshot collected" timestamp on index.html straight from

    snapshot/metadata.json
    snapshot/markets.json
    snapshot/resolved.json

using exactly the definitions the site's own verifier uses
(tools/verify_site.py::check_index_figures):

    open              markets in snapshot/markets.json
    resolved          records in snapshot/resolved.json (settled + awaiting)
    settled           of those, result == yes or no
    awaiting          the rest (closed / determined / disputed, no result yet)

Blocks are delimited by HTML comments, so the rest of the page stays hand-editable
and other sessions can still add sections:

    <!-- KPI:START -->    ... generated cards ...    <!-- KPI:END -->
    <!-- TOPICS:START --> ... generated table ...    <!-- TOPICS:END -->
    <!-- ASOF:START -->   ... generated timestamp ...<!-- ASOF:END -->

Usage
-----
    python3 tools/build_landing.py            # rewrite the blocks in index.html
    python3 tools/build_landing.py --check    # exit 1 if index.html is out of date
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "index.html"
SNAP = ROOT / "snapshot"

TOPICS = [
    ("gas_prices", "Gas prices", "site/gas-prices.html"),
    ("elections", "Elections", "site/elections.html"),
    ("culture", "Culture", "site/culture.html"),
    ("crypto", "Crypto", "site/crypto.html"),
    ("golf", "Golf", "site/golf.html"),
]
DOCS_MARKETS = "https://docs.kalshi.com/api-reference/market/get-markets"
DOCS_LIFECYCLE = "https://docs.kalshi.com/getting_started/market_lifecycle"
API_MARKETS = "https://external-api.demo.kalshi.co/trade-api/v2/markets"
API_STATUS = "https://external-api.demo.kalshi.co/trade-api/v2/exchange/status"


def esc(v) -> str:
    return html.escape("" if v is None else str(v), quote=True)


def load(name: str) -> dict:
    path = SNAP / name
    if not path.exists():
        raise SystemExit(f"missing snapshot file: {path.relative_to(ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


def num(v) -> str:
    return "—" if v is None else f"{v:,}"


def compute() -> dict:
    meta = load("metadata.json")
    markets = load("markets.json").get("markets", [])
    resolved = load("resolved.json").get("markets", [])
    counts = meta.get("counts") or {}
    req = meta.get("request_stats") or {}
    exch = meta.get("exchange_status") or {}

    settled = [r for r in resolved if (r.get("result") or "").lower() in ("yes", "no")]
    per_topic = []
    for key, label, page in TOPICS:
        t = (meta.get("topics") or {}).get(key) or {}
        n_open = sum(1 for m in markets if m.get("topic") == key)
        res = [r for r in resolved if r.get("topic") == key]
        n_set = sum(1 for r in res if (r.get("result") or "").lower() in ("yes", "no"))
        n_series = t.get("series_matched")
        if n_series is None:
            n_series = len(t.get("top_series") or t.get("series") or []) or None
        per_topic.append({
            "key": key, "label": t.get("label") or label, "page": page,
            "open": n_open, "resolved": len(res), "settled": n_set,
            "awaiting": len(res) - n_set, "series": n_series,
        })
    return {
        "generated_utc": meta.get("generated_utc"),
        "rest_base": meta.get("rest_base"),
        "open": counts.get("open_markets", len(markets)),
        "resolved": counts.get("resolved_markets", len(resolved)),
        "settled": len(settled),
        "awaiting": len(resolved) - len(settled),
        "charts": counts.get("chart_series"),
        "series_count": meta.get("series_count"),
        "requests": req.get("requests"),
        "failed": req.get("failed"),
        "exchange_active": exch.get("exchange_active"),
        "trading_active": exch.get("trading_active"),
        "topics": per_topic,
    }


def kpi_block(d: dict) -> str:
    exch = "unknown"
    if d["exchange_active"] is not None and d["trading_active"] is not None:
        exch = ("active" if d["exchange_active"] else "inactive") + " · trading " + \
               ("active" if d["trading_active"] else "inactive")
    cards = [
        (num(d["open"]), "Open markets in the snapshot",
         f'<a href="snapshot/markets.json">snapshot/markets.json ↗</a> · '
         f'<a href="{API_MARKETS}">GET /markets ↗</a>'),
        (num(d["settled"]), "Resolved with a YES/NO result",
         f'<a href="snapshot/resolved.json">snapshot/resolved.json ↗</a> · '
         f'<a href="{DOCS_LIFECYCLE}">result field ↗</a>'),
        (num(d["awaiting"]), "Closed, awaiting a result",
         f'<a href="site/resolved.html">resolved table ↗</a> · '
         f'<a href="{DOCS_LIFECYCLE}">lifecycle ↗</a>'),
        (num(d["series_count"]), "Series discovered",
         f'<a href="snapshot/metadata.json">metadata ↗</a> · '
         f'<a href="{DOCS_MARKETS}">series list ↗</a>'),
        (num(d["requests"]) + " / " + num(d["failed"]), "API requests / failed",
         f'<a href="snapshot/collect-log.txt">collection log ↗</a> · '
         f'<a href="{API_STATUS}">exchange status ↗</a>'),
        (esc(exch), "Demo exchange state at collection",
         f'<a href="{API_STATUS}">GET /exchange/status ↗</a>'),
    ]
    out = ['  <div class="kpis">']
    for big, label, src in cards:
        out.append(f'    <div class="kpi"><div class="n">{big}</div>'
                   f'<div class="l">{esc(label)}</div>{src}</div>')
    out.append('  </div>')
    out.append('  <p class="small">Snapshot collected <b>' + esc(d["generated_utc"]) +
               '</b> from <code>' + esc(d["rest_base"]) + '</code>. Closed records collected: <b>' +
               num(d["resolved"]) + '</b> = <b>' + num(d["settled"]) + '</b> settled with a YES/NO result + <b>' +
               num(d["awaiting"]) + '</b> awaiting one. '
               f'Definitions follow the <a href="{DOCS_LIFECYCLE}">market lifecycle</a>: a record counts as '
               'resolved only when the API sets <code>result</code> to <code>yes</code> or <code>no</code>; '
               'closed, determined or disputed records without a result are counted as awaiting.</p>')
    return "\n".join(out)


def topics_block(d: dict) -> str:
    out = ['  <table>', '    <thead>',
           '      <tr><th>Topic</th><th class="num">Open markets</th><th class="num">Resolved YES/NO</th>'
           '<th class="num">Closed, awaiting</th><th class="num">Series matched</th>'
           '<th>Topic page</th><th>Official source</th></tr>',
           '    </thead>', '    <tbody>']
    for t in d["topics"]:
        out.append(
            f'      <tr><td><b>{esc(t["label"])}</b></td>'
            f'<td class="num">{num(t["open"])}</td>'
            f'<td class="num">{num(t["settled"])}</td>'
            f'<td class="num">{num(t["awaiting"])}</td>'
            f'<td class="num">{num(t["series"])}</td>'
            f'<td><a href="{esc(t["page"])}">{esc(t["label"])} ↗</a></td>'
            f'<td><a href="{API_MARKETS}">GET /markets ↗</a> · '
            f'<a href="{DOCS_MARKETS}">docs ↗</a></td></tr>')
    out.append(
        f'      <tr><td><b>Total</b></td><td class="num"><b>{num(d["open"])}</b></td>'
        f'<td class="num"><b>{num(d["settled"])}</b></td><td class="num"><b>{num(d["awaiting"])}</b></td>'
        f'<td class="num">—</td>'
        f'<td><a href="site/markets.html">All open markets ↗</a></td>'
        f'<td><a href="snapshot/collect-log.txt">collection log ↗</a></td></tr>')
    out += ['    </tbody>', '  </table>']
    return "\n".join(out)


def asof_block(d: dict) -> str:
    return f'<b>{esc(d["generated_utc"])}</b>'


def replace_block(text: str, name: str, body: str) -> str:
    start, end = f"<!-- {name}:START -->", f"<!-- {name}:END -->"
    i, j = text.find(start), text.find(end)
    if i < 0 or j < 0 or j < i:
        raise SystemExit(f"index.html is missing the {name} block markers")
    return text[: i + len(start)] + "\n" + body + "\n" + text[j:]


def main() -> int:
    data = compute()
    original = PAGE.read_text(encoding="utf-8")
    updated = replace_block(original, "KPI", kpi_block(data))
    updated = replace_block(updated, "TOPICS", topics_block(data))
    updated = replace_block(updated, "ASOF", asof_block(data))

    if "--check" in sys.argv:
        if updated != original:
            print("index.html data blocks are stale — run python3 tools/build_landing.py")
            return 1
        print(f"index.html data blocks are current (open={data['open']}, settled={data['settled']}, "
              f"awaiting={data['awaiting']}, snapshot={data['generated_utc']})")
        return 0
    PAGE.write_text(updated, encoding="utf-8")
    print(f"updated index.html — open={data['open']} settled={data['settled']} "
          f"awaiting={data['awaiting']} snapshot={data['generated_utc']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
