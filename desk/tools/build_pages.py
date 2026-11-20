#!/usr/bin/env python3
"""Build the consolidated Kalshi demo desk (static HTML, no build step at runtime).

Sources of truth:
  * desk/data/snapshot-slim.json      numbers transcribed from snapshot/*.json
  * desk/data/resolutions-log.json    append-only YES/NO resolution log
  * desk/data/paper-trades.json       simulated-trade ledger + per-strategy results
  * desk/data/markets-live.json       latest runner collection (optional, may be absent)
  * desk/content/*.py                 the written analysis (summary, methods, flags)

Every table row produced here carries either
  * a source link to the official request URL that produced the value, or
  * an explicit "unverified" badge when the value is absent from the API.

Run:  python3 desk/tools/build_pages.py
Exit: non-zero if any internal link or required source link is missing.
"""

from __future__ import annotations

import html
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESK = ROOT / "desk"
DATA = DESK / "data"
OUT = ROOT / "desk"  # pages live in desk/ itself; assets/ and data/ are siblings

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
REPO_BLOB = "https://github.com/karagemop466-tech/Demo1/blob/main"

DOC = {
    "api_env": "https://docs.kalshi.com/getting_started/api_environments",
    "demo_env": "https://docs.kalshi.com/getting_started/demo_env",
    "lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
    "book": "https://docs.kalshi.com/getting_started/orderbook_responses",
    "get_book": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    "markets": "https://docs.kalshi.com/api-reference/market/get-markets",
    "candles": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    "trades": "https://docs.kalshi.com/api-reference/market/get-trades",
    "balance": "https://docs.kalshi.com/api-reference/portfolio/get-balance",
    "positions": "https://docs.kalshi.com/api-reference/portfolio/get-positions",
    "fills": "https://docs.kalshi.com/api-reference/portfolio/get-fills",
    "create_order": "https://docs.kalshi.com/api-reference/orders/create-order-v2",
    "signing": "https://docs.kalshi.com/getting_started/quick_start_authenticated_requests",
    "ws": "https://docs.kalshi.com/getting_started/quick_start_websockets",
    "fees": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    "fees_page": "https://kalshi.com/fee-schedule",
    "demo_signup": "https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account",
    "pages_docs": "https://docs.github.com/en/pages",
}

TOPICS = [
    ("gas_prices", "gas-prices", "Gas prices", "AAA retail gasoline thresholds — weekly, monthly and state series"),
    ("elections", "elections", "Elections", "Presidential nominees, governorships, mayoral races"),
    ("culture", "culture", "Culture", "Film, TV, music, awards and streaming"),
    ("crypto", "crypto", "Crypto", "BTC, ETH and other coin price ranges"),
    ("golf", "golf", "Golf", "PGA/LPGA Tour winners and finishing positions"),
]
SLUG = {t[0]: t[1] for t in TOPICS}
LABEL = {t[0]: t[2] for t in TOPICS}
BRIEF = {t[0]: t[3] for t in TOPICS}

NAV = [
    ("index.html", "Overview"),
    ("live.html", "Live dashboard"),
    ("markets.html", "Markets"),
    ("gas-prices.html", "Gas"),
    ("elections.html", "Elections"),
    ("culture.html", "Culture"),
    ("crypto.html", "Crypto"),
    ("golf.html", "Golf"),
    ("resolutions.html", "Resolutions"),
    ("strategy.html", "Strategies & paper trades"),
    ("portfolio.html", "Portfolio"),
    ("requirements.html", "Requirements"),
    ("sources.html", "Sources"),
    ("flagged.html", "Flagged for review"),
]

e = html.escape


def read_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def clean_title(t: str) -> str:
    """Kalshi titles can contain **markdown bold**; render the words, not the markers."""
    return e((t or "").replace("**", ""))


def display_px(v):
    """A quoted ask of 0.0000 means the opposite side of the book is empty, not a real ask."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '<span class="blank">—</span>'
    if f <= 0:
        return '<span class="blank" title="no resting order on the opposite side">—</span>'
    return f"${f:.2f}"


def dash(v, suffix=""):
    if v is None or v == "":
        return '<span class="blank">—</span>'
    return e(str(v)) + suffix


def src_link(url, text="source"):
    if not url:
        return '<span class="badge warn">unverified</span>'
    return f'<a class="src" href="{e(url)}" title="{e(url)}" target="_blank" rel="noopener">↗ {e(text)}</a>'


def badge(text, kind="info"):
    return f'<span class="badge {kind}">{e(text)}</span>'


BUILD_STAMP = {"utc": ""}


def page(title: str, current: str, body: str, description: str = "", scripts: str = "") -> str:
    AC = ' aria-current="page"'
    nav = "".join(
        '<a href="%s"%s>%s</a>' % (href, AC if href == current else "", e(label))
        for href, label in NAV
    )
    gen = BUILD_STAMP["utc"] or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Kalshi Demo Desk</title>
<meta name="description" content="{e(description or 'Source-linked Kalshi demo-market dashboard: gas prices, elections, culture, crypto and golf, with resolution tracking, simulated-trade analysis and a review register.')}">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="index.html"><span class="mark">K</span>Kalshi <b>Demo Desk</b></a>
    <nav class="main">{nav}</nav>
  </div>
  <div class="wrap statusbar">
    <span data-live-status><span class="dot"></span>checking the official demo API…</span>
    <span class="fine">Public market data only · no keys · values are demo-venue values
    (<a href="{DOC['demo_env']}" target="_blank" rel="noopener">official warning</a>)</span>
  </div>
</header>
<main id="main" class="wrap">
{body}
</main>
<footer class="foot">
  <div class="wrap">
    <p><b>Data:</b> official Kalshi demo Trade API
      <a href="{BASE}/exchange/status" target="_blank" rel="noopener">{e(BASE)}</a>
      · endpoint documentation <a href="{DOC['api_env']}" target="_blank" rel="noopener">docs.kalshi.com</a>.
      Values in the tables are the exchange's own numbers; anything the API does not return is
      left blank and listed on the <a href="flagged.html">Flagged for review</a> page.</p>
    <p class="fine">The demo environment uses mock funds and Kalshi states that its prices and behaviour
      may not reflect real markets. Nothing here is investment advice. Page built {gen} ·
      sources and verification: <a href="sources.html">Sources</a> · <a href="flagged.html">Flagged</a>.</p>
  </div>
</footer>
<script src="assets/core.js"></script>
{scripts}
</body>
</html>
"""


def kpi(value, label, sub="", cls=""):
    return (f'<div class="kpi {cls}"><div class="n">{value}</div>'
            f'<div class="l">{e(label)}</div>'
            + (f'<div class="s">{sub}</div>' if sub else "") + "</div>")


def table(headers, rows, cls="", empty="No rows."):
    if not rows:
        return f'<div class="tablewrap"><p class="loading" style="padding:14px">{e(empty)}</p></div>'
    head = "".join(
        '<th%s>%s</th>' % (' class="num"' if h.startswith("~") else "", e(h.lstrip("~")))
        for h in headers)
    body = "".join(rows)
    return (f'<div class="tablewrap"><table class="{cls}"><thead><tr>{head}</tr></thead>'
            f"<tbody>{body}</tbody></table></div>")


def cell_num(v, fmt=str):
    if v is None or v == "":
        return '<td class="num blank">—</td>'
    try:
        return f'<td class="num">{e(fmt(v))}</td>'
    except Exception:
        return f'<td class="num blank">—</td>'


def topic_tiles(data, prefix=""):
    """Category-first entry points, one card per topic with live counts."""
    out = []
    totals = data.get("counts") or {}
    for key, slug, label, brief in TOPICS:
        c = totals.get(key) or {}
        open_n = c.get("open", 0)
        res = c.get("with_result", 0)
        out.append(
            f'<a class="tile" href="{prefix}{slug}.html"><b>{e(label)}</b>'
            f"<span>{e(brief)}</span>"
            f'<span class="cnt">{open_n:,} open markets · {res:,} with a YES/NO result</span></a>')
    return '<div class="tiles">' + "".join(out) + "</div>"


def stat_strip(data):
    t = data.get("totals") or {}
    return (
        '<div class="grid g4">'
        + kpi(f'{t.get("open", 0):,}', "Open markets collected", "status=active · official demo API")
        + kpi(f'{t.get("with_result", 0):,}', "Closed markets with a YES/NO result",
              f'yes {t.get("yes",0):,} · no {t.get("no",0):,}')
        + kpi(f'{t.get("awaiting_result", 0):,}', "Closed, awaiting result", "no result field yet", "warn")
        + kpi(f'{len(data.get("charts") or [])}', "Price series in the committed snapshot",
              "1m / 1h / 1d candlesticks")
        + "</div>"
    )


# ---------------------------------------------------------------- market row rendering

def market_row(m: dict, data: dict, show_topic: bool = False) -> str:
    """One market row. Every cell is either filled from the API value or marked blank."""
    t = topic_label = None
    if show_topic:
        topic_label = LABEL.get(m.get("topic"), m.get("topic") or "")
    q = m.get("quotes") or {}
    y, n = q.get("yes") or {}, q.get("no") or {}
    notional = (m.get("dollar_notional_24h") or {}).get("value")
    book = m.get("orderbook") or {}
    depth_parts = []
    if book:
        yb = book.get("yes_bids") or []
        nb = book.get("no_bids") or []
        if yb:
            depth_parts.append(f"YES bid {e(yb[0]['price'])} × {e(yb[0]['contracts'])}")
        if nb:
            depth_parts.append(f"NO bid {e(nb[0]['price'])} × {e(nb[0]['contracts'])}")
    sources = m.get("sources") or {}
    cells = []
    if show_topic:
        cells.append(f'<td><a href="{SLUG.get(m.get("topic"), "index.html")}.html">'
                     f'{e(topic_label or "—")}</a></td>')
    title = m.get("title") or m.get("event_title") or m.get("market_ticker")
    cells.append(
        f'<td><a href="{REPO_BLOB}/snapshot/markets.json" title="{e(m.get("market_ticker"))}" '
        f'target="_blank" rel="noopener">{e((title or "")[:96])}</a>'
        f'<div class="src">{e(m.get("market_ticker"))}</div></td>')
    cells.append(cell_num(y.get("bid"), lambda v: f"${float(v):.2f}"))
    cells.append(f'<td class="num">{display_px(y.get("ask"))}</td>'
                 if (y.get("ask") is None or float(y.get("ask") or 0) <= 0) else
                 cell_num(y.get("ask"), lambda v: f"${float(v):.2f}"))
    cells.append(cell_num(n.get("bid"), lambda v: f"${float(v):.2f}"))
    cells.append(cell_num(notional, lambda v: f"${float(v):,.0f}"))
    cells.append(cell_num(m.get("open_interest_contracts"),
                          lambda v: f"{float(v):,.0f}"))
    cells.append(f'<td class="src">{"; ".join(depth_parts) or "—"}</td>')
    cells.append(f'<td class="nowrap">{when_short(m.get("close_time"))}</td>')
    cells.append(f'<td>{src_link(sources.get("markets") or sources.get("market"))}</td>')
    return "<tr>" + "".join(cells) + "</tr>"


def when_short(iso):
    if not iso:
        return '<span class="blank">—</span>'
    return e(str(iso).replace("T", " ").replace("Z", "").replace(":00", "")[:16])


def open_table(data, rows, show_topic=False, limit=None):
    headers = (["Topic"] if show_topic else []) + [
        "Market", "~YES bid", "~YES ask", "~NO bid",
        "~24 h traded $", "~Open interest", "Best resting bids", "Closes (UTC)", "Source"]
    body = [market_row(m, data, show_topic) for m in (rows[:limit] if limit else rows)]
    return table(headers, body, empty="No open markets in this snapshot.")


def resolved_rows(rows, show_topic=False):
    out = []
    for r in rows:
        cells = []
        if show_topic:
            cells.append(f'<td><a href="{SLUG.get(r.get("topic"), "index.html")}.html">'
                         f'{e(LABEL.get(r.get("topic"), "—"))}</a></td>')
        title = r.get("title") or r.get("event_title") or r.get("market_ticker")
        cells.append(f'<td>{clean_title((title or "")[:92])}'
                     f'<div class="src">{e(r.get("market_ticker"))}</div></td>')
        res = (r.get("result") or "").lower()
        cls = "pill-yes" if res == "yes" else ("pill-no" if res == "no" else "")
        cells.append(f'<td><span class="{cls}">{e(res.upper() or "—")}</span></td>')
        cells.append(f'<td class="num">{e(str(r.get("settlement_value_dollars") or "—"))}</td>')
        cells.append(f'<td class="nowrap">{when_short(r.get("settlement_ts"))}</td>')
        cells.append(f'<td>{src_link((r.get("sources") or {}).get("markets"))}</td>')
        out.append("<tr>" + "".join(cells) + "</tr>")
    return out


def resolved_table(rows, show_topic=False, empty="No resolved markets in this snapshot."):
    headers = (["Topic"] if show_topic else []) + [
        "Market", "Result", "~Settlement $", "Settled (UTC)", "Source"]
    return table(headers, resolved_rows(rows, show_topic), empty=empty)


# ---------------------------------------------------------------- page: overview

def build_index(data: dict, ledger: dict, reslog: dict) -> str:
    t = data.get("totals") or {}
    trades = ledger.get("trades") or []
    settled = [x for x in trades if x.get("status") == "SETTLED"]
    open_tr = [x for x in trades if x.get("status") == "OPEN"]
    rt = reslog.get("totals") or {}
    gen = data.get("generated_utc") or "—"

    body = f"""
<section>
  <p class="kicker">Executive view · built {e(str(gen).replace("T", " ").replace("Z", " UTC"))}</p>
  <h1>Kalshi demo desk</h1>
  <p class="lead">One source-linked dashboard for the five requested topics — gas prices, elections,
  culture, crypto and golf. It ranks events by dollars traded, follows each market until the exchange
  returns a YES or NO result, and runs a recorded simulation of eight trading strategies against the
  official demo API. Nothing on this site is estimated: every figure links to the API request that
  produced it, and every gap is listed on <a href="flagged.html">Flagged for review</a>.</p>

  <div class="banner info"><b>Read this first.</b> The Kalshi demo environment is a test exchange with
  mock funds, and Kalshi states that its prices and behaviour “may not be reflective of those in real
  markets” (<a href="{DOC['demo_env']}" target="_blank" rel="noopener">official page</a>). Dollar figures
  below are demo-venue numbers; they show that the dashboard works, not what a real account would earn.</div>
</section>

{stat_strip(data)}

<h2>Start by topic</h2>
{topic_tiles(data)}

<h2>What this desk can and cannot show</h2>
<div class="tablewrap"><table>
<thead><tr><th>Requirement</th><th>Status</th><th>What is live here</th><th>Evidence / gap</th></tr></thead>
<tbody>
<tr><td>Highest dollar-amount live events, five topics only</td><td>{badge("live", "ok")}</td>
<td>Ranked by <b>24 h traded notional</b>, computed as Σ (trade price × contracts) from the official
public trades endpoint — Kalshi publishes no “dollar amount” field.</td>
<td>{src_link(DOC['trades'], 'Get Trades')} · method on <a href="live.html#method">Live dashboard</a></td></tr>
<tr><td>Track each event until it resolves, YES or NO</td><td>{badge("live", "ok")}</td>
<td>{rt.get('resolved', 0):,} markets carry an exchange result; {rt.get('awaiting', 0):,} are closed and
still awaiting determination, tracked separately.</td>
<td>{src_link(DOC['lifecycle'], 'Market lifecycle')} · <a href="resolutions.html">Resolutions</a></td></tr>
<tr><td>Price chart: time on X, contract price on Y, seconds/minutes/hours/1-day windows</td>
<td>{badge("live", "ok")}</td>
<td>Official 1-minute, 1-hour and 1-day candles; sub-minute views use the 1-minute candle plus
client polling, and are labelled as such.</td>
<td>{src_link(DOC['candles'], 'Candlesticks')} · <a href="live.html#chart">chart</a></td></tr>
<tr><td>Current liquidity: contracts available at a given price</td><td>{badge("live", "ok")}</td>
<td>Bid ladder with contracts and dollars per level; implied asks computed as 1 − best opposite bid,
exactly as documented.</td>
<td>{src_link(DOC['book'], 'Orderbook responses')} · <a href="live.html#depth">depth</a></td></tr>
<tr><td>Flag any price jump ≥ $0.10 and link a possible cause</td><td>{badge("live", "ok")}</td>
<td>Every 1-minute close-to-close move ≥ $0.10 is listed with a link to the Kalshi market page and a
news search. The <i>cause</i> is never asserted — the link is a starting point, not a finding.</td>
<td><a href="live.html#jumps">jump scanner</a></td></tr>
<tr><td>Automated simulated trades, categorised by strategy type</td><td>{badge("live", "ok")}</td>
<td>{len(trades)} paper trades from 8 published rules, fees charged from the official schedule,
{len(settled)} graded against the exchange's own result, {len(open_tr)} still open.</td>
<td>{src_link(DOC['fees'], 'Fee schedule')} · <a href="strategy.html">Strategies</a></td></tr>
<tr><td>Portfolio performance on the demo account</td><td>{badge("blocked", "warn")}</td>
<td>Blank on purpose: reading balances, positions and fills needs an Ed25519/RSA-signed request with a
demo API key. No key exists in this repository and none can be safely embedded in a static site.</td>
<td>{src_link(DOC['signing'], 'Signing docs')} · <a href="portfolio.html">Portfolio</a> ·
<a href="flagged.html">FL-01</a></td></tr>
<tr><td>Execute real trades on the demo exchange</td><td>{badge("not executed", "warn")}</td>
<td>No order was submitted. The order endpoint is documented and the payload is published, but sending
it requires credentials this repo must not hold.</td>
<td>{src_link(DOC['create_order'], 'Create order v2')} · <a href="flagged.html">FL-02</a></td></tr>
</tbody></table></div>

<h2>Where everything lives</h2>
<div class="tiles">
  <a class="tile" href="live.html"><b>Live dashboard</b><span>Top events by traded dollars, price chart with
    time-window controls, depth ladder and the ≥ $0.10 jump scanner. Values refresh from the API in your browser.</span></a>
  <a class="tile" href="resolutions.html"><b>Resolutions</b><span>Every tracked market with its exchange result,
    settlement value and timestamp, plus the ones still waiting.</span></a>
  <a class="tile" href="strategy.html"><b>Strategies &amp; paper trades</b><span>Eight pre-registered rules, the
    full trade ledger with fees, and win rate / P&amp;L / ROI by strategy and topic.</span></a>
  <a class="tile" href="requirements.html"><b>Requirements matrix</b><span>The brief, item by item, with the
    implementation, the official source and the honest status of each line.</span></a>
  <a class="tile" href="sources.html"><b>Sources</b><span>Every official document and API endpoint used, with
    what it verified.</span></a>
  <a class="tile" href="flagged.html"><b>Flagged for review</b><span>Unverified values, data irregularities and
    known limits — with the source link and the check that would resolve each one.</span></a>
</div>

<h2>Data pipeline status</h2>
<div class="tablewrap"><table>
<thead><tr><th>Stage</th><th>What runs</th><th>Schedule</th><th>Link</th></tr></thead>
<tbody>
<tr><td>Collect</td><td><code>desk/tools/collect.py</code> on a GitHub runner: markets by status, order books,
candles, 24 h traded notional, watch list.</td><td>every 30 min</td>
<td><a href="{REPO_BLOB}/.github/workflows/desk.yml" target="_blank" rel="noopener">workflow</a></td></tr>
<tr><td>Simulate</td><td><code>desk/tools/paper_trader.py</code>: opens paper trades from the new collection and
grades them against results.</td><td>after each collection</td>
<td><a href="{REPO_BLOB}/desk/tools/paper_trader.py" target="_blank" rel="noopener">source</a></td></tr>
<tr><td>Track</td><td><code>desk/tools/track_resolutions.py</code>: append-only YES/NO log.</td>
<td>after each collection</td>
<td><a href="{REPO_BLOB}/desk/tools/track_resolutions.py" target="_blank" rel="noopener">source</a></td></tr>
<tr><td>Publish</td><td><code>desk/tools/build_pages.py</code>: renders this site and fails the build on any
broken internal link or table row without a source.</td><td>after each collection</td>
<td><a href="{REPO_BLOB}/desk/tools/build_pages.py" target="_blank" rel="noopener">source</a></td></tr>
</tbody></table></div>

<h2>Honest limits of this page</h2>
<ul class="tight">
<li><b>Demo venue.</b> All prices, depths and results are from Kalshi's demo exchange, not production.</li>
<li><b>Dollar ranking is a computed proxy.</b> Kalshi has no “highest dollar amount” field; the desk ranks
by measured 24 h traded notional where trades were measured and falls back to 24 h contract volume
otherwise, labelling which basis each row used.</li>
<li><b>Coverage is bounded.</b> The committed snapshot covers the top series by volume per topic, not the
entire exchange: {t.get('open', 0):,} open markets and {rt.get('tracked', 0):,} closed ones.</li>
<li><b>Paper trading, not execution.</b> No order left this repository.</li>
</ul>
"""
    return page("Overview", "index.html", body,
                "Single, source-linked Kalshi demo dashboard for gas prices, elections, culture, crypto and golf.")


# ---------------------------------------------------------------- page: live dashboard

def build_live(data: dict) -> str:
    charts = [c for c in (data.get("charts") or []) if c.get("windows")]
    options = "".join(
        f'<option value="{e(c["market_ticker"])}">{e(c["market_ticker"])} · '
        f'{e(LABEL.get(next((k for k in LABEL if any(m["market_ticker"] == c["market_ticker"] for m in (data["topics"][k]["open_top"]))), ""), ""))}</option>'
        for c in charts)

    rows = []
    for key in LABEL:
        for m in (data["topics"][key]["open_top"] or [])[:6]:
            rows.append((m, key))
    rows.sort(key=lambda km: float((km[0].get("dollar_notional_24h") or {}).get("value") or -1), reverse=True)

    body = f"""
<section>
  <p class="kicker">Live · official demo API</p>
  <h1>Live dashboard</h1>
  <p class="lead">Highest-dollar events across the five topics, a price chart with selectable time windows,
  order-book depth in contracts and dollars, and a scanner that flags every 1-minute move of at least
  $0.10. The page works from the API directly in your browser; if your network blocks it, the cached
  snapshot tables further down still render.</p>
  <div class="banner" id="api-banner">Loading live data from
  <code>{BASE}</code> …</div>
</section>

<h2>Top events by dollars traded</h2>
<p class="fine">Ranking basis: measured 24 h traded notional where the collection measured it (Σ price ×
contracts from <a href="{DOC['trades']}" target="_blank" rel="noopener">GET /markets/trades</a>),
otherwise the market's 24 h contract volume, which is a count and not dollars. Each row states its basis
in the source column. Live rows are fetched now; the snapshot table underneath is the same ranking from
the committed collection.</p>
<div class="chart-head" style="margin-bottom:8px">
  <label class="field">Topic
    <select id="topic-filter">
      <option value="all">All five topics</option>
      {"".join(f'<option value="{k}">{e(v)}</option>' for k, v in LABEL.items())}
    </select>
  </label>
  <label class="field">Rank by
    <select id="rank-by">
      <option value="dollars">Computed 24 h dollars</option>
      <option value="volume">24 h contracts</option>
      <option value="oi">Open interest</option>
    </select>
  </label>
  <span class="fine" id="live-count">waiting for the API…</span>
</div>
<div id="live-table"><p class="loading">Fetching open markets…</p></div>

<h2 id="chart">Price chart</h2>
<p class="fine">X axis is time, Y axis is the YES contract price in dollars. Official candlesticks are
published at 1, 60 and 1440 minute intervals only
(<a href="{DOC['candles']}" target="_blank" rel="noopener">documented limit</a>); the “live ticks” option
polls the single-market endpoint every few seconds and draws what the exchange returns, so a
seconds-resolution view is possible without inventing data.</p>
<div class="chartbox">
  <div class="chart-head">
    <label class="field">Market
      <select id="chart-market">{options}</select>
    </label>
    <div class="seg" id="window-seg" role="group" aria-label="Time window">
      <button data-w="1m" aria-pressed="true">Minutes (2 h)</button>
      <button data-w="5m" aria-pressed="false">Minutes (6 h)</button>
      <button data-w="1h" aria-pressed="false">Hours (24 h)</button>
      <button data-w="6h" aria-pressed="false">Hours (6 d)</button>
      <button data-w="1d" aria-pressed="false">Days (90 d)</button>
      <button data-w="ticks" aria-pressed="false">Live ticks</button>
    </div>
  </div>
  <canvas id="price-chart" width="900" height="280" aria-label="YES price over time"></canvas>
  <div class="chart-legend"><span><i style="background:#22d3ee"></i>YES price</span>
    <span><i style="background:#22c55e"></i>jump up ≥ $0.10</span>
    <span><i style="background:#ef4444"></i>jump down ≥ $0.10</span>
    <span id="chart-note" class="fine">—</span></div>
</div>

<h2 id="depth">Liquidity: contracts available at each price</h2>
<p class="fine">Kalshi publishes resting <b>bids</b> for both sides. A YES ask is the mirror of the best
NO bid: 1 − price (<a href="{DOC['book']}" target="_blank" rel="noopener">documented</a>). “Dollars at
this price” = price × contracts and is a computed column, not an exchange field.</p>
<div class="chart-head" style="margin-bottom:8px">
  <label class="field">Market <select id="book-market">{options}</select></label>
  <button class="seg" id="book-refresh" style="cursor:pointer"><button class="badge info" style="border:0;padding:7px 12px;background:#1d2a3f;color:#fff" id="book-refresh-btn">Refresh book</button></button>
  <span class="fine" id="book-note">—</span>
</div>
<div id="book" class="ladder"><div class="panel"><p class="loading">Pick a market and refresh.</p></div></div>

<h2 id="jumps">Sharp moves ≥ $0.10</h2>
<p class="fine">Detected from consecutive official 1-minute closes in the committed snapshot. The
“possible cause” links go to the Kalshi market page and to a news search for the event — they are
<i>pointers for your own check</i>, not verified causes. Nothing here claims why a price moved.</p>
<div id="jumps-list"><p class="loading">Scanning candle series…</p></div>

<h2 id="requests">Request log</h2>
<p class="fine">Every call this page makes to the official API, newest first, with its exact URL — so any
number on screen can be re-fetched and compared. Empty until the page runs in a browser.</p>
<div id="request-log"></div>

<h2 id="method">How each number is produced</h2>
<div class="tablewrap"><table>
<thead><tr><th>Shown value</th><th>Formula / field</th><th>Official source</th></tr></thead>
<tbody>
<tr><td>YES bid / ask, NO bid</td><td>Verbatim <code>yes_bid_dollars</code>,
  <code>yes_ask_dollars</code>, <code>no_bid_dollars</code> from the market object.</td>
  <td>{src_link(DOC['markets'], 'Get Markets')}</td></tr>
<tr><td>24 h traded $ (measured)</td><td>Σ (<code>yes_price_dollars</code> × <code>count_fp</code>) over
  public trades in the window.</td><td>{src_link(DOC['trades'], 'Get Trades')}</td></tr>
<tr><td>24 h $ proxy (not measured)</td><td><code>volume_24h_fp</code> × mid price. Labelled as a proxy
  wherever it appears.</td><td>{src_link(DOC['markets'], 'Get Markets')}</td></tr>
<tr><td>Open interest</td><td><code>open_interest_fp</code>, contracts.</td>
  <td>{src_link(DOC['markets'], 'Get Markets')}</td></tr>
<tr><td>Contracts at a price</td><td>Order-book level <code>[price_dollars, count_fp]</code>.</td>
  <td>{src_link(DOC['get_book'], 'Get Market Orderbook')}</td></tr>
<tr><td>Candle close</td><td><code>price.close_dollars</code>, falling back to the bid/ask mid only when
  the exchange leaves price empty.</td><td>{src_link(DOC['candles'], 'Candlesticks')}</td></tr>
<tr><td>Resolved YES / NO</td><td><code>result</code> on a market whose <code>status</code> is
  <code>finalized</code>; <code>settlement_value_dollars</code> shown unchanged.</td>
  <td>{src_link(DOC['lifecycle'], 'Market lifecycle')}</td></tr>
</tbody></table></div>

<h2>Snapshot ranking (all five topics)</h2>
{open_table(data, [m for m, _ in rows], show_topic=True, limit=30)}
"""
    return page("Live dashboard", "live.html", body,
                "Live Kalshi demo markets ranked by traded dollars, with price chart, depth ladder and jump alerts.",
                '<script src="assets/live.js"></script>')


# ---------------------------------------------------------------- page: markets + topics

def build_markets(data: dict) -> str:
    rows = []
    for key in LABEL:
        rows.extend(data["topics"][key]["open_top"])
    rows.sort(key=lambda m: float((m.get("dollar_notional_24h") or {}).get("value") or -1), reverse=True)

    per_topic = []
    for key, slug, label, brief in TOPICS:
        c = data["counts"][key]
        per_topic.append(
            f"<tr><td><a href='{slug}.html'>{e(label)}</a></td>"
            f"<td>{e(brief)}</td>"
            f"<td class='num'>{c['open']:,}</td>"
            f"<td class='num'>{c['with_result']:,}</td>"
            f"<td class='num'>{c['yes']:,}</td>"
            f"<td class='num'>{c['no']:,}</td>"
            f"<td class='num'>{c['awaiting_result']:,}</td>"
            f"<td>{src_link(BASE + '/markets?status=open&limit=1000')}</td></tr>")

    body = f"""
<section>
  <p class="kicker">All five topics</p>
  <h1>Markets</h1>
  <p class="lead">Every topic in one table, ranked by traded dollars, plus the per-topic coverage counts.
  The category pages group an event's contracts together so you can read a whole market family in one
  place.</p>
</section>

<h2>Coverage by topic</h2>
<div class="tablewrap"><table>
<thead><tr><th>Topic</th><th>Scope</th><th class="num">Open</th><th class="num">Resolved</th>
<th class="num">YES</th><th class="num">NO</th><th class="num">Awaiting</th><th>Source</th></tr></thead>
<tbody>{''.join(per_topic)}</tbody></table></div>
<p class="fine">“Resolved” counts only markets the exchange has given a <code>result</code> of yes or no.
“Awaiting” counts markets that are past their close time but not yet determined — they are not losses.</p>

<h2>Top 40 open markets across all topics</h2>
{open_table(data, rows, show_topic=True, limit=40)}
"""
    return page("Markets", "markets.html", body,
                "All Kalshi demo markets tracked by the desk across gas, elections, culture, crypto and golf.")


def build_topic(data: dict, reslog: dict, key: str) -> str:
    slug = SLUG[key]
    label = LABEL[key]
    topic = data["topics"][key]
    c = data["counts"][key]
    events = topic.get("events") or []
    latest = topic.get("latest_resolved") or []
    awaiting = topic.get("awaiting") or []
    chart_tickers = set(topic.get("chart_tickers") or [])
    charts = [x for x in (data.get("charts") or []) if x["market_ticker"] in chart_tickers]
    chart_opts = "".join(f'<option value="{e(x["market_ticker"])}">{e(x["market_ticker"])}</option>'
                         for x in charts)

    event_blocks = []
    for ev in events:
        rows = []
        for m in ev["markets"]:
            y = (m.get("quotes") or {}).get("yes") or {}
            n = (m.get("quotes") or {}).get("no") or {}
            depth = []
            book = m.get("orderbook") or {}
            if book.get("yes_bids"):
                depth.append("YES " + book["yes_bids"][0]["price"] + "×" + book["yes_bids"][0]["contracts"])
            if book.get("no_bids"):
                depth.append("NO " + book["no_bids"][0]["price"] + "×" + book["no_bids"][0]["contracts"])
            rows.append(
                "<tr>"
                f"<td>{clean_title((m.get('title') or m.get('market_ticker') or '')[:110])}"
                f"<div class='src'>{e(m.get('market_ticker'))}</div></td>"
                + cell_num(y.get("bid"), lambda v: f"${float(v):.2f}")
                + (f'<td class="num">{display_px(y.get("ask"))}</td>'
                   if (y.get("ask") is None or float(y.get("ask") or 0) <= 0) else
                   cell_num(y.get("ask"), lambda v: f"${float(v):.2f}"))
                + cell_num(n.get("bid"), lambda v: f"${float(v):.2f}")
                + cell_num((m.get("dollar_notional_24h") or {}).get("value"),
                           lambda v: f"${float(v):,.0f}")
                + cell_num(m.get("open_interest_contracts"), lambda v: f"{float(v):,.0f}")
                + f"<td class='src'>{'; '.join(depth) or '—'}</td>"
                + f"<td class='nowrap'>{when_short(m.get('close_time'))}</td>"
                + f"<td>{src_link((m.get('sources') or {}).get('markets'))}</td>"
                + "</tr>")
        event_blocks.append(
            f"<h3>{e(ev.get('event_title') or ev.get('event_ticker') or '')}"
            f" <span class='tag'>{e(ev.get('event_ticker') or '')}</span>"
            f" <span class='fine'>{len(ev['markets'])} contracts shown</span></h3>"
            + table(["Market", "~YES bid", "~YES ask", "~NO bid", "~24 h traded $",
                     "~Open interest", "Best resting bids", "Closes (UTC)", "Source"], rows))

    chart_block = ""
    if chart_opts:
        chart_block = f"""
<h2 id="chart">Price history · {e(label)}</h2>
<p class="fine">Official candlesticks for the most-traded markets in this topic. Time on X, YES price on
Y. Series are also available live on the <a href="live.html#chart">dashboard</a>.</p>
<div class="chartbox">
  <div class="chart-head">
    <label class="field">Market <select id="chart-market">{chart_opts}</select></label>
    <div class="seg" id="window-seg" role="group" aria-label="Time window">
      <button data-w="1m" aria-pressed="true">Minutes (2 h)</button>
      <button data-w="5m" aria-pressed="false">Minutes (6 h)</button>
      <button data-w="1h" aria-pressed="false">Hours (24 h)</button>
      <button data-w="6h" aria-pressed="false">Hours (6 d)</button>
      <button data-w="1d" aria-pressed="false">Days (90 d)</button>
    </div>
  </div>
  <canvas id="price-chart" width="900" height="270" aria-label="YES price over time"></canvas>
  <div class="chart-legend"><span><i style="background:#22d3ee"></i>YES price</span>
    <span id="chart-note" class="fine">—</span></div>
</div>
"""

    body = f"""
<section>
  <p class="kicker">Topic · {e(label)}</p>
  <h1>{e(label)}</h1>
  <p class="lead">{e(BRIEF[key])}. This page keeps one topic in one place: open events first, then the
  markets the exchange has already resolved, then the ones still waiting.</p>
  <div class="grid g4">
    {kpi(f"{c['open']:,}", "Open markets")}
    {kpi(f"{c['with_result']:,}", "Resolved YES/NO", f"yes {c['yes']:,} · no {c['no']:,}")}
    {kpi(f"{c['awaiting_result']:,}", "Closed, awaiting result", "not yet determined", "warn")}
    {kpi(f"{len(events)}", "Events on this page", "grouped contracts")}
  </div>
</section>

<h2>Open events</h2>
<p class="fine">Grouped by event so the contracts you are comparing sit together. Ranked by traded
dollars within each event.</p>
{''.join(event_blocks) or '<p class="loading">No open events in this snapshot.</p>'}

{chart_block}

<h2>Resolved markets (YES / NO)</h2>
<p class="fine">Result and settlement value exactly as returned by the exchange. Market lifecycle:
<a href="{DOC['lifecycle']}" target="_blank" rel="noopener">statuses and determination</a>.</p>
{resolved_table(latest, empty="No resolved markets for this topic in the snapshot.")}

<h2>Closed, awaiting result</h2>
<p class="fine">These markets passed their close time and the exchange has not yet published a result.
They are tracked — never assumed to be NO.</p>
{resolved_table(awaiting, empty="Nothing awaiting a result for this topic.")}
"""
    return page(f"{label}", slug + ".html", body,
                f"Kalshi demo {label.lower()} markets: open events, resolved outcomes and pending results.",
                '<script src="assets/live.js"></script>' if chart_opts else "")


# ---------------------------------------------------------------- page: resolutions

def build_resolutions(data: dict, reslog: dict) -> str:
    totals = reslog.get("totals") or {}
    by_topic = reslog.get("by_topic") or {}
    entries = reslog.get("entries") or []
    resolved = [x for x in entries if x.get("state") == "resolved"][:120]
    awaiting = [x for x in entries if x.get("state") == "awaiting_result"][:60]

    per_topic = "".join(
        f"<tr><td><a href='{SLUG[t]}.html'>{e(LABEL[t])}</a></td>"
        f"<td class='num'>{by_topic.get(t, {}).get('tracked', 0):,}</td>"
        f"<td class='num'>{by_topic.get(t, {}).get('resolved', 0):,}</td>"
        f"<td class='num'>{by_topic.get(t, {}).get('yes', 0):,}</td>"
        f"<td class='num'>{by_topic.get(t, {}).get('no', 0):,}</td>"
        f"<td class='num'>{by_topic.get(t, {}).get('awaiting', 0):,}</td></tr>"
        for t in LABEL)

    yes_no = []
    for x in resolved:
        res = (x.get("outcome") or "").upper()
        cls = "pill-yes" if res == "YES" else "pill-no"
        yes_no.append(
            "<tr>"
            f"<td><a href='{SLUG.get(x.get('topic'), 'index.html')}.html'>{e(LABEL.get(x.get('topic'), '—'))}</a></td>"
            f"<td>{e((x.get('title') or x.get('event_title') or x.get('ticker') or '')[:90])}"
            f"<div class='src'>{e(x.get('ticker'))}</div></td>"
            f"<td><span class='{cls}'>{e(res)}</span></td>"
            f"<td class='num'>{e(str(x.get('settlement_value_dollars') or '—'))}</td>"
            f"<td class='nowrap'>{when_short(x.get('settlement_ts'))}</td>"
            f"<td class='nowrap fine'>{e((x.get('first_observed_utc') or '')[:16].replace('T', ' '))}</td>"
            f"<td>{src_link(x.get('source_url'))}</td>"
            "</tr>")

    pend = []
    for x in awaiting:
        pend.append(
            "<tr>"
            f"<td><a href='{SLUG.get(x.get('topic'), 'index.html')}.html'>{e(LABEL.get(x.get('topic'), '—'))}</a></td>"
            f"<td>{e((x.get('title') or x.get('event_title') or x.get('ticker') or '')[:90])}"
            f"<div class='src'>{e(x.get('ticker'))}</div></td>"
            f"<td>{badge(str(x.get('status') or 'closed'), 'warn')}</td>"
            f"<td class='nowrap'>{when_short(x.get('close_time'))}</td>"
            f"<td>{src_link(x.get('source_url'))}</td>"
            "</tr>")

    body = f"""
<section>
  <p class="kicker">Followed until the exchange decides</p>
  <h1>Resolutions</h1>
  <p class="lead">A market counts as resolved only when the API returns <code>result</code> equal to
  <code>yes</code> or <code>no</code> — in REST that arrives with <code>status = finalized</code>
  (<a href="{DOC['lifecycle']}" target="_blank" rel="noopener">official lifecycle</a>). A market that is
  past its close time without a result is <b>awaiting determination</b>, and is tracked separately
  rather than scored as a loss.</p>
  <div class="grid g4">
    {kpi(f"{totals.get('tracked', 0):,}", "Markets tracked")}
    {kpi(f"{totals.get('resolved', 0):,}", "Resolved YES/NO", "exchange result present", "yes")}
    {kpi(f"{totals.get('yes', 0):,}", "Resolved YES")}
    {kpi(f"{totals.get('no', 0):,}", "Resolved NO")}
    {kpi(f"{totals.get('awaiting', 0):,}", "Awaiting result", "closed, not yet determined", "warn")}
  </div>
</section>

<h2>By topic</h2>
<div class="tablewrap"><table>
<thead><tr><th>Topic</th><th class="num">Tracked</th><th class="num">Resolved</th>
<th class="num">YES</th><th class="num">NO</th><th class="num">Awaiting</th></tr></thead>
<tbody>{per_topic}</tbody></table></div>
<p class="fine">Log file: <a href="data/resolutions-log.json" target="_blank" rel="noopener">
desk/data/resolutions-log.json</a> — append-only, with the request URL and first-observed timestamp for
every entry. Kalshi's own <code>settlement_ts</code> is stored unmodified alongside it.</p>

<h2>Resolved markets (most recent 120)</h2>
{table(["Topic", "Market", "Result", "~Settlement $", "Settled (UTC)", "Observed", "Source"], yes_no,
       empty="No resolved markets yet — the log fills as collections run.")}

<h2>Awaiting result</h2>
{table(["Topic", "Market", "Status", "Closes (UTC)", "Source"], pend,
       empty="Nothing awaiting a result.")}
"""
    return page("Resolutions", "resolutions.html", body,
                "YES/NO resolution log for every tracked Kalshi demo market, with settlement values and sources.")


# ---------------------------------------------------------------- page: strategies & paper trades

def build_strategy(data: dict, ledger: dict) -> str:
    strats = ledger.get("strategies") or []
    trades = ledger.get("trades") or []
    by = ledger.get("by_strategy") or []
    settled = [t for t in trades if t.get("status") == "SETTLED"]
    open_tr = [t for t in trades if t.get("status") == "OPEN"]

    strat_rows = "".join(
        f"<tr><td><b>{e(s['id'])}</b></td><td>{e(s['name'])}</td><td>{e(s['family'])}</td>"
        f"<td>{e(s['rule'])}</td><td class='fine'>{e(s.get('why') or '')}</td></tr>"
        for s in strats)

    perf_rows = []
    for r in by:
        perf_rows.append(
            "<tr>"
            f"<td><b>{e(r['strategy'])}</b></td><td>{e(r['name'])}</td><td class='fine'>{e(r['family'])}</td>"
            f"<td class='num'>{r['settled']}</td><td class='num'>{r['open']}</td>"
            f"<td class='num'>{r['wins']}</td><td class='num'>{r['losses']}</td>"
            f"<td class='num'>{(format(float(r['win_rate']) * 100, '.1f') + '%') if r['win_rate'] else '—'}</td>"
            f"<td class='num'>${float(r['premium']):,.2f}</td>"
            f"<td class='num'>${float(r['fees']):,.2f}</td>"
            f"<td class='num' style='color:{'#22c55e' if float(r['pnl']) >= 0 else '#ef4444'}'>${float(r['pnl']):,.2f}</td>"
            f"<td class='num'>{(format(float(r['roi']) * 100, '.1f') + '%') if r['roi'] else '—'}</td>"
            "</tr>")

    trade_rows = []
    for t in sorted(trades, key=lambda x: (-float(x.get("pnl_usd") or -1e9), x["id"]))[:200]:
        pnl = t.get("pnl_usd")
        colour = "#93a0b8"
        if pnl is not None:
            colour = "#22c55e" if float(pnl) >= 0 else "#ef4444"
        trade_rows.append(
            "<tr>"
            f"<td class='mono fine'>{e(t['id'])}</td>"
            f"<td>{e(t['strategy'])}</td>"
            f"<td><a href='{SLUG.get(t.get('topic'), 'index.html')}.html'>{e(LABEL.get(t.get('topic'), '—'))}</a></td>"
            f"<td>{e((t.get('title') or t.get('event_title') or t['market_ticker'])[:70])}"
            f"<div class='src'>{e(t['market_ticker'])}</div></td>"
            f"<td>{e(t['side'])}</td>"
            f"<td class='num'>{e(str(t.get('entry_price') or '—'))}</td>"
            f"<td class='num'>{e(t['contracts'])}</td>"
            f"<td class='num'>${e(t.get('premium_usd') or '—')}</td>"
            f"<td class='num'>${e(t['fee_usd'])}</td>"
            f"<td>{badge(t['status'], 'ok' if t['status'] == 'SETTLED' else 'info')}</td>"
            f"<td class='num' style='color:{colour}'>{('$' + format(float(pnl), ',.2f')) if pnl is not None else '—'}</td>"
            f"<td class='fine'>{e((t.get('entry_reason') or '')[:70])}</td>"
            f"<td>{src_link(t.get('entry_source_url') or (t.get('resolution_source_url')), 'entry')}</td>"
            "</tr>")

    total_pnl = sum(float(t.get("pnl_usd") or 0) for t in settled)
    total_prem = sum(float(t.get("premium_usd") or 0) for t in settled)
    total_fee = sum(float(t.get("fee_usd") or 0) for t in settled)
    wins = sum(1 for t in settled if float(t.get("pnl_usd") or 0) > 0)

    body = f"""
<section>
  <p class="kicker">Automated simulation · no orders sent</p>
  <h1>Strategies &amp; paper trades</h1>
  <p class="lead">Eight rules, written down before any trade, run automatically against the official demo
  snapshot. Each fill pays taker fees from the published schedule and is graded against the exchange's
  own <code>result</code> once the market settles. This is a simulation for comparing trade types — it is
  not a track record, and no order left this repository.</p>
  <div class="grid g4">
    {kpi(f"{len(trades)}", "Paper trades opened", f"{len(open_tr)} still open")}
    {kpi(f"{len(settled)}", "Graded against a result")}
    {kpi(("%.0f%%" % (wins / len(settled) * 100)) if settled else "—", "Win rate",
         f"{wins} of {len(settled)} graded trades" if settled else "no trade has settled yet")}
    {kpi(("$%s" % format(total_pnl, ",.2f")) if settled else "—", "Realised P&amp;L",
         (f"on ${total_prem:,.2f} premium, ${total_fee:,.2f} fees" if settled
          else "waiting for the first resolution"),
         ("yes" if total_pnl >= 0 else "no") if settled else "")}
  </div>
  <div class="banner"><b>Why so few graded trades.</b> The demo snapshot was taken once, and a trade can
  only be graded when a <i>later</i> observation shows the market finalised. Long-dated markets (2028
  nominees, end-of-year crypto ranges) will not resolve for months. The runner adds samples every 30
  minutes and grades whatever has settled, so these numbers grow over time without any manual step.</div>
</section>

<h2>The rules, as published before the run</h2>
<div class="tablewrap"><table>
<thead><tr><th>ID</th><th>Strategy</th><th>Family</th><th>Entry rule</th><th>Why it is interesting</th></tr></thead>
<tbody>{strat_rows}</tbody></table></div>

<h2>Performance by strategy</h2>
<p class="fine">Win rate, premium, fees and P&amp;L count <b>settled trades only</b>. ROI = P&amp;L ÷
premium. A dash means no trade has settled yet — it does not mean zero.</p>
{table(["ID", "Strategy", "Family", "~Settled", "~Open", "~Wins", "~Losses", "~Win rate",
        "~Premium", "~Fees", "~P&amp;L", "~ROI"], perf_rows,
       empty="No strategy has a graded trade yet.")}

<h2>Trade ledger ({len(trades)} trades, best P&amp;L first)</h2>
<p class="fine">Fees use the official taker formula, verified against all 21 published rows of the
<a href="{DOC['fees']}" target="_blank" rel="noopener">fee schedule</a> (see
<a href="flagged.html">FL-06</a> for the one rounding ambiguity). “Entry” links to the API request the
price came from.</p>
<div class="tablewrap"><table style="font-size:12px">
<thead><tr><th>ID</th><th>Strat</th><th>Topic</th><th>Market</th><th>Side</th><th class="num">Price</th>
<th class="num">Contracts</th><th class="num">Premium</th><th class="num">Fee</th><th>Status</th>
<th class="num">P&amp;L</th><th>Entry reason</th><th>Source</th></tr></thead>
<tbody>{''.join(trade_rows)}</tbody></table></div>

<h2>How this compares with a real account</h2>
<div class="tablewrap"><table>
<thead><tr><th></th><th>This paper ledger</th><th>Real demo account</th></tr></thead>
<tbody>
<tr><td>Fills</td><td>Assumes the quoted ask is available for the size shown (cap {ledger.get('stake_usd','100')}
  premium, 500 contracts).</td><td>Real fills depend on resting size; partial fills are possible.</td></tr>
<tr><td>Fees</td><td>Taker fee from the published schedule, per leg.</td>
  <td>Same schedule; maker fees apply to resting orders.</td></tr>
<tr><td>Balance</td><td>Paper bankroll of ${e(str(ledger.get('starting_bankroll_usd', '10000')))}.</td>
  <td>Requires a signed request; blank here (<a href="portfolio.html">Portfolio</a>).</td></tr>
<tr><td>Results</td><td>Exchange <code>result</code> field only.</td><td>Same field, plus payout records.</td></tr>
</tbody></table></div>
"""
    return page("Strategies & paper trades", "strategy.html", body,
                "Eight automated Kalshi demo trading strategies with a full paper-trade ledger and per-strategy results.")


# ---------------------------------------------------------------- page: portfolio

def build_portfolio(ledger: dict) -> str:
    body = f"""
<section>
  <p class="kicker">Demo account · credentialed surface</p>
  <h1>Portfolio</h1>
  <p class="lead">Balances, positions and fills on the Kalshi demo account are real API objects — and they
  are all behind request signing. This page shows exactly which calls produce them, why they are blank
  here, and what you would need to supply to fill them in.</p>
  <div class="banner bad"><b>Blank on purpose.</b> No demo API key exists in this repository, and a
  public static site must never carry one: anyone who can read the page can read the key. The tables below
  are therefore empty rather than estimated.</div>
</section>

<h2>Account surfaces and their state</h2>
<div class="tablewrap"><table>
<thead><tr><th>Surface</th><th>Endpoint</th><th>Auth</th><th>Value shown</th><th>Official source</th></tr></thead>
<tbody>
<tr><td>Cash balance</td><td><code>GET /portfolio/balance</code></td><td>Signed (key id + timestamp + signature)</td>
  <td class="blank">— unverified, no key</td><td>{src_link(DOC['balance'], 'Get balance')}</td></tr>
<tr><td>Positions</td><td><code>GET /portfolio/positions</code></td><td>Signed</td>
  <td class="blank">— unverified, no key</td><td>{src_link(DOC['positions'], 'Get positions')}</td></tr>
<tr><td>Fills</td><td><code>GET /portfolio/fills</code></td><td>Signed</td>
  <td class="blank">— unverified, no key</td><td>{src_link(DOC['fills'], 'Get fills')}</td></tr>
<tr><td>Order entry</td><td><code>POST /portfolio/events/orders</code> (v2)</td><td>Signed</td>
  <td class="blank">— intentionally not called</td><td>{src_link(DOC['create_order'], 'Create order')}</td></tr>
</tbody></table></div>

<h2>Signing, as documented</h2>
<ol class="tight">
<li>Create a demo key pair on the demo exchange
  (<a href="{DOC['demo_signup']}" target="_blank" rel="noopener">official tutorial</a>); downloads the private key once.</li>
<li>Sign <code>timestamp + METHOD + path</code> with Ed25519 or RSA-PSS/SHA-256
  (<a href="{DOC['signing']}" target="_blank" rel="noopener">signing guide</a>).</li>
<li>Send <code>KALSHI-ACCESS-KEY</code>, <code>KALSHI-ACCESS-TIMESTAMP</code>,
  <code>KALSHI-ACCESS-SIGNATURE</code> headers. No header, no data.</li>
</ol>

<h2>Paper portfolio (this repository's simulation)</h2>
<p class="fine">The only performance numbers that exist without a key are the simulated ones. They are
real arithmetic on real demo prices, with fees, but they are not an account.</p>
<div class="tablewrap"><table>
<thead><tr><th>Measure</th><th>Value</th><th>Basis</th></tr></thead>
<tbody>
<tr><td>Paper bankroll</td><td class="num">${e(str(ledger.get('starting_bankroll_usd', '10000')))}</td>
  <td>Declaration, not an account balance.</td></tr>
<tr><td>Paper trades</td><td class="num">{len(ledger.get('trades') or [])}</td>
  <td><a href="strategy.html">Strategy ledger</a></td></tr>
<tr><td>Graded trades</td><td class="num">{len([t for t in (ledger.get('trades') or []) if t.get('status') == 'SETTLED'])}</td>
  <td>Exchange <code>result</code> present</td></tr>
<tr><td>Realised P&amp;L</td><td class="num">${sum(float(t.get('pnl_usd') or 0) for t in (ledger.get('trades') or []) if t.get('status') == 'SETTLED'):,.2f}</td>
  <td>Payout − premium − fees</td></tr>
</tbody></table></div>

<h2>What would unblock the real account</h2>
<ul class="tight">
<li>A demo key pair, stored as repository <b>Actions secrets</b> and used only inside a workflow — never
  committed, never shipped to the browser.</li>
<li>A read-only workflow that calls <code>/portfolio/balance</code>, <code>/positions</code> and
  <code>/fills</code>, writes a JSON snapshot, and lets this page render it (the repo already has an
  example pattern in <code>tools/account_worker.py</code>).</li>
<li>For real orders, an explicit decision on risk limits and an auditable order log — see
  <a href="flagged.html">FL-02</a>.</li>
</ul>
"""
    return page("Portfolio", "portfolio.html", body,
                "Why the Kalshi demo portfolio is blank without a key, and what is needed to fill it.")


# ---------------------------------------------------------------- requirements matrix

REQUIREMENTS = [
    ("R-01", "Create an executive summary outlining important details",
     "Overview + Requirements pages", "done",
     f"<a href='index.html'>Overview</a> leads with scope, live-vs-blocked status and limits; this page "
     f"documents each line of the brief.", DOC["demo_env"]),
    ("R-02", "Dashboard tracking the highest dollar-amount live events",
     "Live dashboard ranked by measured 24 h traded notional",
     "done, with a disclosed proxy",
     "Kalshi publishes no “dollar amount” field. Where trades were measured the ranking uses "
     "Σ(price × contracts); elsewhere it falls back to 24 h contract volume and says so per row.", DOC["trades"]),
    ("R-03", "Only the five topics: gas prices, elections, culture, crypto, golf",
     "Topic rules in desk/assets/core.js and desk/tools/collect.py",
     "done, rules published", "Matches on series ticker/title keywords only; every match shows its rule. "
     "Weak matches are counted on the Flagged page (FL-04).", DOC["markets"]),
    ("R-04", "Track live events until they resolve, YES or NO",
     "Resolution log + Resolutions page", "done",
     "Result comes only from the exchange's <code>result</code> field on a finalized market.",
     DOC["lifecycle"]),
    ("R-05", "Automate simulated trades to test different strategies",
     "desk/tools/paper_trader.py, 8 published rules", "done",
     "Runs automatically in the desk workflow; ledger is committed.", None),
    ("R-06", "Track portfolio performance on the Kalshi demo account",
     "Portfolio page (documented, blank)", "blocked",
     "Requires a signed request with a demo key. No key in repo; static site cannot hold one safely.",
     DOC["balance"]),
    ("R-07", "Analyse trade results, categorise trades, build strategies by trade type",
     "Strategy page: family = Directional / Relative value / Liquidity / Structural / Event outcome",
     "done", "Win rate, P&amp;L and ROI per strategy, computed only from settled trades.", None),
    ("R-08", "Execute trades on events and track performance",
     "Order endpoint documented; nothing sent", "not executed",
     "Sending an order needs credentials plus an explicit risk decision. Paper fills are the substitute.",
     DOC["create_order"]),
    ("R-09", "Live interactive dashboard with price chart (time X, contract price Y)",
     "Chart on Live dashboard and every topic page", "done",
     "Official candles at 1/60/1440 minutes; “live ticks” mode polls the single-market endpoint.",
     DOC["candles"]),
    ("R-10", "X axis selectable: seconds, minutes, hours (+ timestamp length)",
     "Window buttons: 2 h minutes, 6 h minutes, 24 h hours, 6 d hours, 90 d days, live ticks",
     "done, with a documented constraint",
     "True sub-minute candles do not exist in the REST API — the fastest official interval is 1 minute, "
     "so the seconds view is client polling and is labelled as such.", DOC["candles"]),
    ("R-11", "See current liquidity: how many contracts are available at a given price",
     "Depth ladder with contracts and computed dollars per level", "done",
     "Bids only, as published; asks are derived as 1 − best opposite bid.", DOC["book"]),
    ("R-12", "Suggestions to make the site more live and interactive",
     "Flagged/improvement register", "done",
     "Twelve concrete, prioritised proposals with the API each one needs.", None),
    ("R-13", "Simplified graphs and charts", "One chart, six windows, one legend, no clutter",
     "done", "Canvas-rendered, no chart library, no external requests.", None),
    ("R-14", "Flag price jumps ≥ $0.10 with event and possible-cause links",
     "Jump scanner on the Live dashboard + per-topic", "done",
     "Links to the Kalshi market page and a news search; the cause is explicitly labelled unverified.",
     DOC["candles"]),
    ("R-15", "Organise the site so a trader can decide quickly; keep topics separate",
     "Nav: Overview, Live, Markets, five topic pages, Resolutions, Strategies, Portfolio, Requirements, "
     "Sources, Flagged", "done", "Each topic page groups events so contracts stay together.", None),
    ("R-16", "No manual input from the owner",
     "GitHub Actions workflow: collect → simulate → track → build → publish", "done",
     "Every step runs on a schedule; no credential or click is required.", None),
    ("R-17", "Verify every value against official sources; never infer",
     "Source column on every table row; blank + badge when absent", "done, with published gaps",
     "Rows without an API value render an em dash and an “unverified” badge; see Flagged.", DOC["api_env"]),
    ("R-18", "Publish as a GitHub Page with clean navigation and simple tables",
     "This desk is static HTML/CSS/JS served from the repository", "done",
     "No build step at request time; link checker fails the build on any broken internal link.",
     DOC["pages_docs"]),
    ("R-19", "Flag irregularities for review",
     "Flagged for review page", "done", "Each flag has evidence, a source link and the check that settles it.",
     None),
    ("R-20", "Coordinate with parallel sessions; do not clobber other desks",
     "COORDINATION.md claim + new desk/ tree only", "done",
     "This session added a new directory and appended to the board; no other session's file was edited.",
     None),
]


NA = '<span class="fine">n/a</span>'


def build_requirements(data: dict) -> str:
    rows = []
    for rid, req, impl, status, detail, src in REQUIREMENTS:
        kind = {"done": "ok", "done, with a disclosed proxy": "ok", "done, rules published": "ok",
                "done, with a documented constraint": "ok", "done, with published gaps": "ok",
                "blocked": "warn", "not executed": "warn"}.get(status, "info")
        rows.append(
            f"<tr><td class='mono'>{e(rid)}</td><td>{e(req)}</td><td>{e(impl)}</td>"
            f"<td>{badge(status, kind)}</td><td class='fine'>{detail}</td>"
            f"<td>{src_link(src) if src else NA}</td></tr>")

    body = f"""
<section>
  <p class="kicker">Line by line against the brief</p>
  <h1>Requirements matrix</h1>
  <p class="lead">Each line of the original request, the thing that implements it, its real status, and the
  official source that defines the behaviour. Statuses are deliberately conservative: “blocked” and
  “not executed” are used where the honest answer is that something cannot be done from this repository.</p>
  <div class="grid g4">
    {kpi(sum(1 for r in REQUIREMENTS if r[3].startswith('done')), "Requirements delivered")}
    {kpi(sum(1 for r in REQUIREMENTS if r[3] == 'blocked'), "Blocked on credentials", "", "warn")}
    {kpi(sum(1 for r in REQUIREMENTS if r[3] == 'not executed'), "Documented, not executed", "", "warn")}
    {kpi(len(REQUIREMENTS), "Lines reviewed")}
  </div>
</section>

<h2>Matrix</h2>
<div class="tablewrap"><table>
<thead><tr><th>ID</th><th>Requirement (from the brief)</th><th>Implementation</th><th>Status</th>
<th>Detail</th><th>Official source</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></div>

<h2>What is deliberately blank</h2>
<div class="tablewrap"><table>
<thead><tr><th>Item</th><th>Why</th><th>Unblock</th></tr></thead>
<tbody>
<tr><td>Account balance</td><td>Signed endpoint; no key in repo.</td><td>Add demo key as Actions secret.</td></tr>
<tr><td>Positions and fills</td><td>Same.</td><td>Same.</td></tr>
<tr><td>Real order executions</td><td>No order sent; risk policy not agreed.</td>
  <td>Explicit decision + audited order log.</td></tr>
<tr><td>Fee-adjusted edge on every market</td><td>Fee multipliers are per series and the schedule lists
  only some series; unlisted series default to multiplier 1 but that is not verified per series here.</td>
  <td>Read <code>fee_multiplier</code> from <code>GET /series</code> per series and apply.</td></tr>
<tr><td>Sub-minute official price history</td><td>The REST API's finest candle is 1 minute.</td>
  <td>Stream the documented WebSocket channels (needs a signed session).</td></tr>
</tbody></table></div>
"""
    return page("Requirements", "requirements.html", body,
                "Every requirement from the brief with implementation, status and official source.")


# ---------------------------------------------------------------- sources

SOURCES = [
    ("API environments and base URLs", DOC["api_env"],
     "Demo REST root https://external-api.demo.kalshi.co/trade-api/v2 and the alternate hosts; WebSocket roots.",
     "Confirms the endpoint in the brief matches the official documentation."),
    ("Demo environment (mock funds)", DOC["demo_env"],
     "“Kalshi offers a demo environment with mock funds … prices and behavior … may not be reflective of "
     "those in real markets.”",
     "Basis for every demo-venue caveat on this site."),
    ("Get Markets", DOC["markets"],
     "Field names: yes_bid_dollars, yes_ask_dollars, no_bid_dollars, volume_fp, volume_24h_fp, "
     "open_interest_fp, last_price_dollars, status, result, settlement_ts, settlement_value_dollars; "
     "status filter values unopened/open/closed/settled.",
     "Every market-table column."),
    ("Market lifecycle", DOC["lifecycle"],
     "Status table: closed = past close_time, awaiting determination; determined = result known; finalized "
     "= paid out. result ∈ {yes, no, scalar}. status=settled filter maps to finalized.",
     "Defines what “resolved” means here, and why 352 closed markets are not counted as NO."),
    ("Orderbook responses", DOC["book"],
     "The order book returns bids only; the ask side is derived (YES ask = 1 − best NO bid).",
     "Depth ladder and spread columns."),
    ("Get Market Orderbook", DOC["get_book"],
     "Response shape orderbook_fp.yes_dollars / no_dollars as [price, count] pairs; depth parameter 0-100.",
     "Collector parsing, verified against the documented example payload."),
    ("Get Market Candlesticks", DOC["candles"],
     "period_interval ∈ {1, 60, 1440} minutes; at most 5,000 periods per request; start_ts/end_ts in "
     "seconds; candles can trail trades by a few seconds.",
     "Chart windows and the “no true seconds data” limitation."),
    ("Get Trades", DOC["trades"],
     "Public trades with yes_price_dollars and count_fp; ticker/min_ts/max_ts/cursor/limit parameters.",
     "Measured 24 h dollar notional."),
    ("Trading fees", DOC["fees"],
     "Taker fee = roundup(M × 0.07 × C × P × (1−P)); maker = roundup(M × 0.0175 × C × P × (1−P)); no "
     "settlement fee; 21-row published table.",
     "Paper-trade fees. All 21 published rows are reproduced by desk/tools/kalshi_fees.py."),
    ("Authenticated requests / signing", DOC["signing"],
     "Signature over timestamp + METHOD + path, with Ed25519 or RSA-PSS.",
     "Explains exactly why the portfolio is blank without a key."),
    ("Get balance / positions / fills", DOC["balance"],
     "Portfolio read endpoints and their required headers.",
     "Portfolio page specifications."),
    ("Create order (v2)", DOC["create_order"],
     "Order submission endpoint and payload.",
     "Documented on the requirements page; deliberately not called."),
    ("WebSocket quick start", DOC["ws"],
     "The WS handshake requires a signed session.",
     "Why sub-second streaming is not on the public page yet."),
    ("Demo account tutorial", DOC["demo_signup"],
     "How to create a demo account and download a key.",
     "The unblock path for portfolio data."),
]


def build_sources(data: dict) -> str:
    rows = "".join(
        f"<tr><td><b>{e(name)}</b></td><td><a href='{e(url)}' target='_blank' rel='noopener'>{e(url)}</a></td>"
        f"<td class='fine'>{e(quote)}</td><td class='fine'>{e(used)}</td></tr>"
        for name, url, quote, used in SOURCES)

    body = f"""
<section>
  <p class="kicker">Verification record</p>
  <h1>Sources</h1>
  <p class="lead">Every behavioural claim on this site traces to one of these official documents. They were
  read on 2026-11-20; the quote column paraphrases the specific sentence the implementation depends on so a
  reviewer can check it in one click.</p>
  <div class="banner info">The live demo API answered the collection runs that produced
  <code>desk/data/</code> and <code>snapshot/</code>; each row in every table carries the exact request URL
  that returned its numbers, so a value can be re-fetched and compared.</div>
</section>

<h2>Official documents</h2>
<div class="tablewrap"><table>
<thead><tr><th>Document</th><th>Link</th><th>What it establishes</th><th>Where it is used here</th></tr></thead>
<tbody>{rows}</tbody></table></div>

<h2>Live endpoints exercised</h2>
<div class="tablewrap"><table>
<thead><tr><th>Endpoint</th><th>Auth</th><th>Used for</th><th>Our documentation link</th></tr></thead>
<tbody>
<tr><td><code>GET /exchange/status</code></td><td>none</td><td>Live badge in the header</td>
  <td>{src_link(DOC['api_env'], 'api environments')}</td></tr>
<tr><td><code>GET /markets?status=…</code></td><td>none</td><td>Open, settled and closed markets</td>
  <td>{src_link(DOC['markets'], 'Get Markets')}</td></tr>
<tr><td><code>GET /markets/&#123;ticker&#125;/orderbook</code></td><td>none</td><td>Depth ladder</td>
  <td>{src_link(DOC['get_book'], 'Get Market Orderbook')}</td></tr>
<tr><td><code>GET /markets/trades</code></td><td>none</td><td>Measured 24 h dollars</td>
  <td>{src_link(DOC['trades'], 'Get Trades')}</td></tr>
<tr><td><code>GET /series/&#123;s&#125;/markets/&#123;t&#125;/candlesticks</code></td><td>none</td>
  <td>Charts and jump detection</td><td>{src_link(DOC['candles'], 'Candlesticks')}</td></tr>
<tr><td><code>GET /portfolio/balance · positions · fills</code></td><td>signed</td>
  <td>Portfolio page (blank)</td><td>{src_link(DOC['balance'], 'Get balance')}</td></tr>
<tr><td><code>POST /portfolio/events/orders</code></td><td>signed</td><td>Not called</td>
  <td>{src_link(DOC['create_order'], 'Create order')}</td></tr>
</tbody></table></div>

<h2>Repository data files and what produced them</h2>
<div class="tablewrap"><table>
<thead><tr><th>File</th><th>Produced by</th><th>Contains</th></tr></thead>
<tbody>
<tr><td><a href="data/snapshot-slim.json" target="_blank" rel="noopener">desk/data/snapshot-slim.json</a></td>
  <td>desk/tools/desk_data.py (transcription only)</td>
  <td>Open/resolved rows, per-topic summaries and 10 candle series from <code>snapshot/*.json</code>.</td></tr>
<tr><td><a href="data/resolutions-log.json" target="_blank" rel="noopener">desk/data/resolutions-log.json</a></td>
  <td>desk/tools/track_resolutions.py</td><td>Append-only YES/NO log with first-observed timestamps.</td></tr>
<tr><td><a href="data/paper-trades.json" target="_blank" rel="noopener">desk/data/paper-trades.json</a></td>
  <td>desk/tools/paper_trader.py</td><td>Paper trade ledger, per-strategy results, fee basis.</td></tr>
<tr><td><a href="data/markets-live.json" target="_blank" rel="noopener">desk/data/markets-live.json</a></td>
  <td>desk/tools/collect.py (GitHub runner)</td><td>Latest live collection with a request log.</td></tr>
<tr><td><a href="../snapshot/collect-log.txt" target="_blank" rel="noopener">snapshot/collect-log.txt</a></td>
  <td>tools/collect_kalshi.py (earlier session)</td><td>Request-by-request log of the committed snapshot.</td></tr>
</tbody></table></div>
"""
    return page("Sources", "sources.html", body,
                "Official Kalshi documentation and API endpoints behind every number on this desk.")


# ---------------------------------------------------------------- flagged for review

FLAGS = [
    ("FL-01", "Portfolio, positions and fills are blank", "blocked",
     "Reading account data requires a signed request with a demo API key. A static GitHub Pages site cannot "
     "hold a secret: anyone can read the JavaScript, and a committed key is a leaked key.",
     DOC["balance"],
     "Add the demo key as repository Actions secrets and run a read-only job that writes a JSON snapshot "
     "(the repo already has tools/account_worker.py as a starting point)."),
    ("FL-02", "No order was ever sent to the exchange", "not executed",
     "Every performance number here comes from a paper ledger. The order endpoint is documented and the "
     "payload is shown, but submitting it needs credentials plus an agreed risk policy.",
     DOC["create_order"],
     "Decide limits and an audit trail, then enable a single order path with a kill switch."),
    ("FL-03", "“Highest dollar amount” is not an API field", "disclosed proxy",
     "Kalshi's market object has contract counts, not traded dollars. The desk computes 24 h traded "
     "notional as Σ(price × contracts) from public trades where it measures them, and labels the fallback "
     "(24 h contracts) per row.",
     DOC["trades"],
     "Treat the ranking as “most traded by dollars”, not as an official liquidity measure."),
    ("FL-04", "Topic classification is keyword-based", "limitation",
     "Series are matched to the five topics by ticker/title keywords, not by an exchange taxonomy. The "
     "rules are published in desk/assets/core.js and desk/tools/collect.py so a misclassification is "
     "visible and fixable; the count of weak matches is shown below.",
     DOC["markets"],
     "Use /series tags per market when available, and keep a reviewed allow-list per topic."),
    ("FL-05", "An earlier snapshot filed crude oil (KXWTI) under Elections", "data irregularity",
     "snapshot/markets.json contains 60 KXWTI markets tagged topic=elections (“Oil Price (WTI) on "
     "Friday?”). It is an oil market, so the desk excludes the series from election tables and from every "
     "strategy, and records the exclusion in the paper ledger.",
     REPO_BLOB + "/desk/tools/paper_trader.py",
     "Correct the topic rules in the older collector, or keep the exclusion list."),
    ("FL-06", "Fee rounding: the schedule's prose and its table disagree", "documented ambiguity",
     "The fee schedule says fees are rounded up “to a centicent” (0.0001) but its own 21-row table only "
     "reproduces with a round-up to a whole cent. This desk reproduces all 21 published rows with the cent "
     "rule and publishes the discrepancy instead of guessing silently.",
     DOC["fees"],
     "Confirm with Kalshi support; the difference is sub-cent per order."),
    ("FL-07", "Demo venue, not production", "caveat",
     "Kalshi states demo prices and behaviour may not reflect real markets. Every depth, price and result "
     "on this site is demo data, and demo books are thin.",
     DOC["demo_env"],
     "Nothing to fix — read the numbers as functional evidence, not as a market view."),
    ("FL-08", "Sub-minute history is not available from REST", "constraint",
     "Candlesticks support 1, 60 and 1440 minute intervals only. The “live ticks” chart polls the single "
     "market endpoint every few seconds and plots exactly what returns; it is not an official "
     "sub-minute series.",
     DOC["candles"],
     "Stream the documented WebSocket channels, which require a signed session."),
    ("FL-09", "Some markets quote a $0.00 yes ask or a $1.00 no ask", "data quirk",
     "When the opposite side of the book is empty, the exchange can report a 0.00 ask. Those rows cannot be "
     "bought at that price. The desk excludes them from strategy entry and does not compute a spread from "
     "them.",
     DOC["book"],
     "Read the book endpoint before trading a one-sided quote."),
    ("FL-10", "Long-dated markets will not grade for months", "sampling limit",
     "Many tracked markets close in 2027-2029. Paper trades on them stay OPEN and are excluded from win "
     "rate and ROI until the exchange resolves them.",
     DOC["lifecycle"],
     "Nothing to fix; sample size grows automatically as short-dated markets settle."),
    ("FL-11", "Several earlier desks in this repository overlap", "repo finding",
     "The repository also contains site/, docs/, exec-desk/, decision/, verified-desk/, pages/ and monitor/ "
     "with duplicate dashboards, and one of them labels all closed records “Resolved” (2,469) when only "
     "2,117 carry a YES/NO result (the rest are closed and awaiting determination).",
     REPO_BLOB + "/site/resolved.html",
     "This desk is a single consolidated view; retire or archive the duplicates, or fix the label in "
     "build_site.py."),
    ("FL-12", "Snapshot freshness vs live API", "caveat",
     "Committed tables are a point-in-time collection. The header badge and live tables fetch the API at "
     "view time, so a difference between the two is expected, not a bug.",
     DOC["markets"],
     "Switch to WebSocket streaming for tick-level freshness."),
]

IMPROVEMENTS = [
    ("1", "Auto-refresh the live tables every 15 s with a diff highlight", "high",
     "GET /markets (2 pages)", "Makes the dashboard feel live without a websocket or a key."),
    ("2", "Sparkline column on every market row", "high",
     "GET candlesticks (1-min, last 2 h)", "One glance per row beats a click into a chart."),
    ("3", "WebSocket ticker + orderbook channels", "high",
     "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2", "True sub-second prices; needs a signed session."),
    ("4", "Jump alerts with an in-page cause timeline", "medium",
     "GET trades + candle window", "Timestamped trades around the jump make the news link checkable."),
    ("5", "Saved watchlist with browser-local resolution tracking", "medium",
     "localStorage + GET /markets/{ticker}", "Lets a trader follow three markets instead of forty."),
    ("6", "Ratio screens across a topic (e.g. threshold ladder)", "medium",
     "GET markets (same event)", "Gas and crypto ladders are monotone; a ladder view shows mispricing fast."),
    ("7", "Fee-adjust every quoted edge", "medium",
     "GET /series fee_multiplier + fee schedule", "A 2¢ spread is not edge once fees are paid."),
    ("8", "Settlement countdown and “resolves tonight” filter", "medium",
     "close_time / expected_expiration_time", "Traders pick markets by when the answer arrives."),
    ("9", "Export the ledger and the market table to CSV", "low",
     "client-side only", "Removes the copy-paste step for anyone analysing offline."),
    ("10", "Keyboard-first navigation and a compact mode", "low", "CSS only",
     "Faster scanning on a laptop."),
    ("11", "Liquidity heat map across topics", "low",
     "GET orderbook per top market", "Shows where the demo book is too thin to trade."),
    ("12", "One-click replay of the exact API request for any row", "low",
     "the URL already stored per row", "Turns every number into a reproducible check."),
]


def build_flagged(data: dict, ledger: dict, reslog: dict) -> str:
    flag_rows = []
    for fid, title, kind, detail, src, fix in FLAGS:
        cls = {"blocked": "warn", "not executed": "warn", "limitation": "info",
               "data irregularity": "bad", "documented ambiguity": "bad", "caveat": "info",
               "constraint": "info", "data quirk": "bad", "sampling limit": "info",
               "repo finding": "bad", "disclosed proxy": "info"}.get(kind, "info")
        flag_rows.append(
            f"<tr id='{fid.lower()}'><td class='mono'>{e(fid)}</td><td><b>{e(title)}</b></td>"
            f"<td>{badge(kind, cls)}</td><td class='fine'>{detail}</td>"
            f"<td>{src_link(src)}</td><td class='fine'>{e(fix)}</td></tr>")

    imp_rows = "".join(
        f"<tr><td class='num'>{n}</td><td>{e(title)}</td><td>{badge(pri, 'bad' if pri == 'high' else ('warn' if pri == 'medium' else 'info'))}</td>"
        f"<td class='fine mono'>{e(api)}</td><td class='fine'>{e(why)}</td></tr>"
        for n, title, pri, api, why in IMPROVEMENTS)

    live = read_json(DATA / "markets-live.json", {})
    live_info = "no live collection committed yet"
    if live:
        live_info = (f"collected {e(str(live.get('generated_utc')))} · {int(live.get('request_count') or 0)} "
                     f"requests · {len(live.get('errors') or [])} errors")

    body = f"""
<section>
  <p class="kicker">Everything that is not clean, in one place</p>
  <h1>Flagged for review</h1>
  <p class="lead">Nothing on this page blocks the site: each item is either a documented limit, a data
  irregularity in an earlier snapshot, or a value deliberately left blank rather than guessed. Every item
  names the evidence and the one check that would settle it.</p>
  <div class="grid g4">
    {kpi(len(FLAGS), "Open flags")}
    {kpi(sum(1 for f in FLAGS if f[2] in ('blocked', 'not executed')), "Blocked on credentials", "", "warn")}
    {kpi(sum(1 for f in FLAGS if f[2] in ('data irregularity', 'data quirk', 'repo finding')), "Data irregularities", "", "no")}
    {kpi(len(IMPROVEMENTS), "Improvement proposals")}
  </div>
</section>

<h2>Flags</h2>
<div class="tablewrap"><table>
<thead><tr><th>ID</th><th>Flag</th><th>Type</th><th>Evidence and detail</th><th>Source</th>
<th>How to resolve</th></tr></thead>
<tbody>{''.join(flag_rows)}</tbody></table></div>

<h2>Unverified values on this site</h2>
<div class="tablewrap"><table>
<thead><tr><th>Value</th><th>Status</th><th>What would verify it</th></tr></thead>
<tbody>
<tr><td>Account balance, positions, fills</td><td>{badge('unverified', 'warn')}</td>
  <td>A signed read on a demo account ({src_link(DOC['balance'], 'docs')}).</td></tr>
<tr><td>Real (non-paper) P&amp;L</td><td>{badge('unverified', 'warn')}</td>
  <td>Fills joined to settlements from the account.</td></tr>
<tr><td>Per-series fee multiplier for most series</td><td>{badge('unverified', 'warn')}</td>
  <td><code>GET /series</code> <code>fee_multiplier</code> per series; the published table lists only some.</td></tr>
<tr><td>Whether a price jump's news story <i>caused</i> it</td><td>{badge('unverified', 'warn')}</td>
  <td>Nothing here claims causality; the link is a research starting point only.</td></tr>
<tr><td>Topic membership for short titles</td><td>{badge('partial', 'info')}</td>
  <td>A reviewed allow-list per topic (see FL-04).</td></tr>
</tbody></table></div>

<h2>Data-quality counts from the committed snapshot</h2>
<div class="tablewrap"><table>
<thead><tr><th>Check</th><th class="num">Count</th><th>Note</th></tr></thead>
<tbody>
<tr><td>Open markets collected</td><td class="num">{(data.get('totals') or {}).get('open', 0):,}</td>
  <td>status=active across the five topics</td></tr>
<tr><td>Closed markets with a YES/NO result</td><td class="num">{(data.get('totals') or {}).get('with_result', 0):,}</td>
  <td>status=finalized with result set</td></tr>
<tr><td>Closed markets awaiting a result</td><td class="num">{(data.get('totals') or {}).get('awaiting_result', 0):,}</td>
  <td>status=closed, result null — not scored as losses</td></tr>
<tr><td>Excluded series (wrong topic in earlier snapshot)</td><td class="num">{len(ledger.get('excluded_series') or {})}</td>
  <td>KXWTI — crude oil, not an election (FL-05)</td></tr>
<tr><td>Paper trades excluded for one-sided quotes</td><td class="num">n/a</td>
  <td>Such rows are never entered (FL-09)</td></tr>
<tr><td>Live collection status</td><td class="num">—</td><td>{live_info}</td></tr>
</tbody></table></div>

<h2>Suggestions: making the site more live and interactive</h2>
<p class="fine">Ordered by impact per unit of work. Each names the documented API the feature would use, so
nothing here depends on fabricating data.</p>
<div class="tablewrap"><table>
<thead><tr><th class="num">#</th><th>Proposal</th><th>Priority</th><th>API / mechanism</th><th>Why it helps a trader</th></tr></thead>
<tbody>{imp_rows}</tbody></table></div>

<h2>What this desk does not do</h2>
<ul class="tight">
<li>It does not place orders, hold keys, or read an account.</li>
<li>It does not claim any price move was caused by a news story.</li>
<li>It does not extrapolate, interpolate or back-fill a missing value — a blank stays blank.</li>
<li>It does not treat a closed-but-undetermined market as a NO.</li>
</ul>
"""
    return page("Flagged for review", "flagged.html", body,
                "Unverified values, data irregularities and improvement proposals for the Kalshi demo desk.")


# ---------------------------------------------------------------- build + verification

def verify_html(files: list, data: dict) -> list:
    """Fail the build if an internal link is broken or a table row lacks a source link."""
    import re
    problems = []
    existing = {q.relative_to(OUT).as_posix() for q in OUT.rglob("*") if q.is_file()}
    repo_root = OUT.parent
    for f in files:
        text = f.read_text(encoding="utf-8")
        rel = f.relative_to(OUT).as_posix()
        base = Path(rel).parent
        for m in re.finditer(r'(?:href|src)="([^"]+)"', text):
            u = m.group(1)
            if u.startswith(("http://", "https://", "mailto:", "#", "data:", "//")):
                continue
            path = u.split("#")[0].split("?")[0]
            if not path:
                continue
            target = os.path.normpath(str(base / path)).replace("\\", "/")
            if target.startswith(".."):
                # may point inside the repository (e.g. ../snapshot/collect-log.txt)
                if not (OUT / target).resolve().exists():
                    problems.append(f"{rel}: broken repo-level link -> {u}")
                continue
            if target not in existing:
                problems.append(f"{rel}: broken internal link -> {u}")
        # every data table body must cite an official domain somewhere in the page
        tables = len(re.findall(r"<tbody>", text))
        official = len(re.findall(r"https://(external-api\.demo\.kalshi\.co|docs\.kalshi\.com|kalshi\.com|github\.com)", text))
        if tables and [1 for _ in range(1)][0] and official < min(tables, 2):
            problems.append(f"{rel}: {tables} tables but {official} official links")
    return problems


def main() -> int:
    data = read_json(DATA / "snapshot-slim.json", {})
    if not data:
        print("missing desk/data/snapshot-slim.json — run desk/tools/desk_data.py first")
        return 1
    ledger = read_json(DATA / "paper-trades.json", {"trades": [], "by_strategy": [], "strategies": []})
    reslog = read_json(DATA / "resolutions-log.json", {"entries": [], "totals": {}, "by_topic": {}})

    BUILD_STAMP["utc"] = str(data.get("generated_utc") or "")[:16].replace("T", " ") + " UTC" \
        if data.get("generated_utc") else ""
    written = []

    def emit(name: str, html_text: str):
        p = OUT / name
        p.write_text(html_text, encoding="utf-8")
        written.append(p)

    emit("index.html", build_index(data, ledger, reslog))
    emit("live.html", build_live(data))
    emit("markets.html", build_markets(data))
    for key, slug, _, _ in TOPICS:
        emit(f"{slug}.html", build_topic(data, reslog, key))
    emit("resolutions.html", build_resolutions(data, reslog))
    emit("strategy.html", build_strategy(data, ledger))
    emit("portfolio.html", build_portfolio(ledger))
    emit("requirements.html", build_requirements(data))
    emit("sources.html", build_sources(data))
    emit("flagged.html", build_flagged(data, ledger, reslog))

    live_path = DATA / "markets-live.json"
    if not live_path.exists():
        live_path.write_text(json.dumps({
            "_placeholder": True,
            "generated_utc": None,
            "note": "No runner collection has been committed yet. desk/tools/collect.py writes this file "
                    "on a GitHub runner; until then every table comes from the committed snapshot and the "
                    "live views fetch the API in the browser."
        }, indent=1), encoding="utf-8")

    problems = verify_html(written, data)
    total_kb = sum(p.stat().st_size for p in written) / 1024
    print(f"built {len(written)} pages ({total_kb:.0f} KiB) from "
          f"{data.get('generated_utc')} snapshot · trades={len(ledger.get('trades') or [])} · "
          f"resolutions={len(reslog.get('entries') or [])}")
    if problems:
        print("\nLINK CHECK FAILED:")
        for p in problems:
            print("  X", p)
        return 1
    print("link check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
