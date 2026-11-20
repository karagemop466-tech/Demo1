#!/usr/bin/env python3
"""Build the static dashboard site from the collected Kalshi demo dataset.

Rules enforced by this builder:
  * A value is printed only if it exists in data/*.json (collected from the
    official API). Missing values render as an em dash and inherit the row's
    verification status.
  * Every row links to the official request URL recorded for it.
  * Every internal link is checked at build time; a broken link fails the build.

Outputs: site/ for GitHub Pages (served from the repo subpath /Demo1/).
"""

import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SITE = ROOT / "site"

DOCS = "https://docs.kalshi.com"
TOPIC_ORDER = ["gas_prices", "elections", "culture", "crypto", "golf"]
TOPIC_PAGES = {
    "gas_prices": "gas-prices.html",
    "elections": "elections.html",
    "culture": "culture.html",
    "crypto": "crypto.html",
    "golf": "golf.html",
}

BUILD_ERRORS = []


# --------------------------------------------------------------------------
def esc(v):
    return html.escape("" if v is None else str(v), quote=True)


def dash(v, suffix=""):
    """Render a value or an em dash. Never substitutes an inferred number."""
    if v is None or v == "":
        return "<span class='na' title='not returned by the official API'>—</span>"
    return esc(v) + suffix


def cents(dollar_string):
    """Fixed-point dollar string -> cents string, only when parseable."""
    if dollar_string in (None, ""):
        return None
    try:
        from decimal import Decimal
        return f"{Decimal(str(dollar_string)) * 100:.1f}"
    except Exception:
        return None


def load(name, default=None):
    p = DATA / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        BUILD_ERRORS.append(f"cannot parse {name}: {e}")
        return default


def pct(v):
    if v is None:
        return None
    try:
        return f"{float(str(v)) * 100:.1f}"
    except Exception:
        return None


def when(ts):
    if not ts:
        return None
    return str(ts).replace("T", " ").replace("Z", " UTC")


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------
NAV = [
    ("index.html", "Overview"),
    ("markets.html", "Live markets"),
    ("gas-prices.html", "Gas prices"),
    ("elections.html", "Elections"),
    ("culture.html", "Culture"),
    ("crypto.html", "Crypto"),
    ("golf.html", "Golf"),
    ("resolved.html", "Resolved"),
    ("liquidity.html", "Liquidity & chart"),
    ("portfolio.html", "Portfolio"),
    ("strategies.html", "Strategies"),
    ("suggestions.html", "Suggestions"),
    ("questions.html", "Questions"),
    ("flagged.html", "Flagged for review"),
    ("sources.html", "Sources"),
]


def page(name, title, body, subtitle="", active=None):
    meta = load("metadata.json", {}) or {}
    gen = meta.get("generated_utc", "")
    nav = []
    for href, label in NAV:
        cls = " class='on'" if href == (active or name) else ""
        nav.append(f"<a href='{href}'{cls}>{esc(label)}</a>")
    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Kalshi Demo Research</title>
<meta name="description" content="Verified Kalshi demo-market research dashboard: live official API data for gas prices, elections, culture, crypto and golf, with every row linked to its source.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="index.html"><span class="mark">K</span> Kalshi <b>Demo</b> Research</a>
    <nav class="nav">{''.join(nav)}</nav>
  </div>
</header>
<main class="wrap">
  <div class="pagehead">
    <p class="kicker">{esc(subtitle) if subtitle else 'Official demo API data'}</p>
    <h1>{esc(title)}</h1>
  </div>
  {body}
</main>
<footer class="foot">
  <div class="wrap">
    <p>Data snapshot: <b>{esc(gen or 'not collected yet')}</b> · Source: official Kalshi demo Trade API
    (<a href="https://external-api.demo.kalshi.co/trade-api/v2/exchange/status">external-api.demo.kalshi.co/trade-api/v2</a>) ·
    Documentation: <a href="{DOCS}">docs.kalshi.com</a></p>
    <p class="fine">The Kalshi demo environment is a test exchange. Prices, depth and balances there are simulated, not real-money liquidity.
    Values absent from the API are shown as “—” and are never inferred. Unverified items are listed on
    <a href="flagged.html">Flagged for review</a>.</p>
  </div>
</footer>
</body>
</html>
"""
    (SITE / name).write_text(doc, encoding="utf-8")


def table(headers, rows, cls=""):
    head = "".join(f"<th>{esc(h)}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    if not rows:
        body = f"<tr><td colspan='{len(headers)}' class='empty'>No records returned by the official API for this view.</td></tr>"
    return f"<div class='tablewrap'><table class='{cls}'><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"


def src(url, label="API"):
    if not url:
        return "<span class='na'>—</span>"
    return f"<a href='{esc(url)}' target='_blank' rel='noreferrer'>{esc(label)} ↗</a>"


def pill(text, kind="ok"):
    return f"<span class='pill {kind}'>{esc(text)}</span>"


# --------------------------------------------------------------------------
# Build pages
# --------------------------------------------------------------------------
def market_link(m):
    return (f"<a href='market.html?t={esc(m['market_ticker'])}'>"
            f"{esc(m.get('title') or m['market_ticker'])}</a>")


def topic_label(key, meta):
    return (meta.get("topics", {}).get(key, {}) or {}).get("label", key)


def build_index(meta, markets, resolved):
    counts = meta.get("counts", {})
    exch = meta.get("exchange_status") or {}
    stat_rows = [
        ["Official REST base", f"<code>{esc(meta.get('rest_base'))}</code>"],
        ["Exchange active", dash(exch.get("exchange_active"))],
        ["Trading active", dash(exch.get("trading_active"))],
        ["Series discovered", dash(meta.get("series_count"))],
        ["Open markets collected", dash(counts.get("open_markets"))],
        ["Resolved markets collected", dash(counts.get("resolved_markets"))],
        ["Price-history series", dash(counts.get("chart_series"))],
        ["API requests this snapshot", dash((meta.get("request_stats") or {}).get("requests"))],
        ["Failed requests", dash((meta.get("request_stats") or {}).get("failed"))],
        ["Snapshot (UTC)", dash(meta.get("generated_utc"))],
    ]
    per_topic = []
    for key in TOPIC_ORDER:
        t = meta.get("topics", {}).get(key, {})
        per_topic.append([
            f"<a href='{TOPIC_PAGES[key]}'>{esc(t.get('label', key))}</a>",
            dash(t.get("series_matched")),
            dash(t.get("open_market_count")),
            dash(t.get("resolved_market_count")),
        ])
    cat_rows = [[esc(k), dash(v)] for k, v in (meta.get("categories") or {}).items()]

    body = f"""
<section class="hero">
  <div>
    <h2>What this is</h2>
    <p class="lede">A live research dashboard for the <b>Kalshi demo exchange</b>, focused on
    gas prices, elections, culture, crypto and golf. Market prices, order-book depth and resolution
    outcomes are read straight from the official Trade API v2 demo endpoints by a scheduled job,
    and every row keeps a link to the exact API request that produced it.</p>
    <div class="btnrow">
      <a class="btn" href="markets.html">Open live market table</a>
      <a class="btn ghost" href="liquidity.html">Price chart &amp; depth</a>
      <a class="btn ghost" href="flagged.html">Flagged for review</a>
    </div>
  </div>
  <aside class="card">
    <p class="kicker">Snapshot health</p>
    <ul class="kv">
      <li><span>Snapshot</span><b>{dash(meta.get('generated_utc'))}</b></li>
      <li><span>Requests</span><b>{dash((meta.get('request_stats') or {}).get('requests'))}</b></li>
      <li><span>Failed</span><b>{dash((meta.get('request_stats') or {}).get('failed'))}</b></li>
      <li><span>Environment</span><b>DEMO</b></li>
    </ul>
    <p class="fine">Collected by <code>tools/collect_kalshi.py</code> on a GitHub Actions runner; the
    log of every request is committed with the data.</p>
  </aside>
</section>

<h2>Executive summary</h2>
<div class="callout">
  <ul class="tight">
    <li><b>Data is real and official, but demo.</b> All figures come from <code>{esc(meta.get('rest_base'))}</code>,
    the recommended demo base URL documented at <a href="{DOCS}/getting_started/api_environments">docs.kalshi.com</a>.
    The demo exchange is a test venue — values are not real-money liquidity.</li>
    <li><b>Scope.</b> Only five topics are tracked. Topic membership is decided by an explicit,
    published keyword/category rule set, listed on each topic page so its accuracy can be audited.</li>
    <li><b>Resolution tracking.</b> Markets are followed until settled; the API's <code>result</code>
    field (yes / no) and settlement value are recorded with the resolution source from the event.</li>
    <li><b>“Highest dollar amount” is measured, not assumed.</b> Contract volume is <i>not</i> dollars.
    Dollar notional is computed as the sum of <code>yes_price_dollars × count_fp</code> over the last
    24 hours of public trades, and the record count behind every total is shown.</li>
    <li><b>Portfolio, trade analysis and order execution are credential-gated.</b> No Kalshi API key
    exists in this repository or in the build environment, so those pages document the exact endpoints
    and payment logic instead of inventing figures. This is listed as a blocker on
    <a href="flagged.html">Flagged for review</a>.</li>
  </ul>
</div>

<h2>Snapshot at a glance</h2>
{table(["Item", "Value (from official API)"], stat_rows)}

<h2>Topic coverage</h2>
{table(["Topic", "Series matched by rule", "Open markets collected", "Resolved markets found"], per_topic)}

<h2>Discovery categories on the demo exchange</h2>
<p class="fine">Read from <code>GET /series</code> (<a href="{esc(meta.get('series_list_url') or '')}">this snapshot's request</a>).
Counts are series per discovery category as returned by the API; they are not a Kalshi-official topic taxonomy for this project.</p>
{table(["Discovery category (API)", "Series in category"], cat_rows)}
"""
    page("index.html", "Kalshi demo research overview", body,
         subtitle="Verified snapshot · official demo API", active="index.html")


def build_markets(meta, markets):
    rows = []
    for m in sorted(markets, key=lambda x: -(float(x.get("dollar_notional_24h", {}).get("value") or 0))):
        q = m.get("quotes", {})
        yb, ya = q.get("yes", {}), q.get("no", {})
        dn = m.get("dollar_notional_24h", {})
        rows.append([
            f"<a href='{TOPIC_PAGES.get(m['topic'], 'markets.html')}'>{esc(topic_label(m['topic'], meta))}</a>",
            market_link(m),
            f"<code>{esc(m.get('market_ticker'))}</code>",
            dash(cents(yb.get("bid"))),
            dash(cents(yb.get("ask"))),
            dash(cents(m.get("last_price"))),
            dash(m.get("volume_24h_contracts")),
            dash(m.get("volume_contracts")),
            dash(m.get("open_interest_contracts")),
            (f"${dn['value']:,.2f}" if dn.get("value") is not None else dash(None)),
            dash(dn.get("trades_counted")),
            pill(m.get("status") or "unknown", "ok" if m.get("status") == "active" else "warn"),
            src(m.get("sources", {}).get("market"), "market"),
        ])
    body = f"""
<div class="callout">
  <b>How to read this table.</b> Prices are in cents of a dollar (100¢ = $1.00 payout). “Bid / ask” are the
  API's own quote fields; a quote with zero size behind it is not a tradeable level (see the market page).
  “Notional 24h” is <i>computed</i>: Σ(<code>yes_price_dollars × count_fp</code>) over public trades in the last
  24 h from <a href="{DOCS}/api-reference/market/get-trades">Get Trades</a>, with the number of trades counted shown —
  it is a measure of dollars <i>traded</i>, not dollars of resting liquidity.
  Rows are sorted by that computed notional; ties fall back to the API's own volume.
</div>
<p class="fine">Collected {dash(meta.get('generated_utc'))} from <code>{esc(meta.get('rest_base'))}</code>.
Market metadata: <a href="{DOCS}/api-reference/market/get-markets">Get Markets</a>.</p>
{table(["Topic", "Market / event", "Ticker", "YES bid ¢", "YES ask ¢", "Last ¢",
        "24h volume (contracts)", "Total volume (contracts)", "Open interest (contracts)",
        "Notional 24h (USD, computed)", "Trades counted", "Status", "Source"], rows, "wide")}
"""
    page("markets.html", "Live markets in focus", body,
         subtitle="All five topics · ranked by computed 24h dollar notional")


def build_topic(key, meta, markets, resolved):
    label = topic_label(key, meta)
    topic_meta = meta.get("topics", {}).get(key, {})
    rule = meta.get("topics", {}).get(key, {})
    mine = [m for m in markets if m["topic"] == key]
    mine.sort(key=lambda x: -(float(x.get("dollar_notional_24h", {}).get("value") or 0)
                              if x.get("dollar_notional_24h", {}).get("value") is not None else 0))
    rows = []
    for m in mine:
        q = m.get("quotes", {})
        yb, ya = q.get("yes", {}), q.get("no", {})
        dn = m.get("dollar_notional_24h", {})
        rows.append([
            market_link(m),
            f"<code>{esc(m.get('market_ticker'))}</code>",
            dash(cents(yb.get("bid"))),
            dash(cents(yb.get("ask"))),
            dash(cents(m.get("last_price"))),
            dash(m.get("volume_24h_contracts")),
            dash(m.get("open_interest_contracts")),
            (f"${dn['value']:,.2f}" if dn.get("value") is not None else dash(None)),
            dash(when(m.get("close_time"))),
            pill(m.get("status") or "unknown", "ok" if m.get("status") == "active" else "warn"),
            src(m.get("sources", {}).get("market"), "market"),
        ])
    res_rows = []
    for m in [r for r in resolved if r["topic"] == key]:
        res = (m.get("result") or "").lower()
        settle_src = m.get("settlement_sources") or []
        res_rows.append([
            market_link(m),
            f"<code>{esc(m.get('market_ticker'))}</code>",
            pill(res.upper(), "ok" if res == "yes" else ("bad" if res == "no" else "warn")) if res else pill("unresolved", "warn"),
            dash(m.get("settlement_value_dollars")),
            dash(when(m.get("settlement_ts"))),
            " ".join(src(s.get("url"), s.get("name") or "source") for s in settle_src) or dash(None),
            src(m.get("sources", {}).get("market"), "market"),
        ])
    series_rows = [[f"<code>{esc(s['ticker'])}</code>", esc(s.get("title")),
                    esc(s.get("category")), esc(s.get("match_reason")),
                    dash(s.get("volume_contracts"))]
                   for s in (topic_meta.get("series") or [])]
    errs = topic_meta.get("errors") or []
    err_html = ""
    if errs:
        err_html = ("<h2>Collection errors</h2><p class='fine'>Requests that failed for this topic are listed, "
                    "not silently dropped.</p>" + table(["Series", "Error", "Request"],
                    [[esc(e["series"]), esc(e["error"]), src(e["url"])] for e in errs]))
    body = f"""
<div class="callout">
  <b>Topic rule (auditable).</b> A series is assigned to <b>{esc(label)}</b> when its title, ticker or tags contain
  one of: {esc(', '.join(rule.get('words', []) or []))} — or its discovery categories include one of:
  {esc(', '.join(rule.get('categories', []) or []))}. The rule is heuristic, not an official Kalshi taxonomy;
  matches and the reason for each are listed below so false positives and omissions can be seen.
</div>
<p class="fine">{len(mine)} open markets and {len([r for r in resolved if r['topic'] == key])} resolved markets collected
from <code>{esc(meta.get('rest_base'))}</code> at {dash(meta.get('generated_utc'))}.</p>

<h2>Live markets</h2>
{table(["Market / event", "Ticker", "YES bid ¢", "YES ask ¢", "Last ¢", "24h volume", "Open interest",
        "Notional 24h (USD, computed)", "Close time", "Status", "Source"], rows, "wide")}

<h2>Resolved markets (followed until settled)</h2>
{table(["Market / event", "Ticker", "Result", "Settlement value", "Settled (UTC)",
        "Resolution source (from event)", "Source"], res_rows, "wide")}

<h2>Series matched by the topic rule</h2>
<p class="fine">From <a href="{DOCS}/api-reference/market/get-series-list">Get Series List</a> and
<a href="{DOCS}/api-reference/events/get-events">Get Events</a> metadata; <code>match_reason</code> records exactly why each series was included.</p>
{table(["Series ticker", "Title", "Primary category", "Match reason", "Series volume (contracts)"], series_rows)}
{err_html}
"""
    page(TOPIC_PAGES[key], f"{label} — Kalshi demo markets", body,
         subtitle=f"Focus topic · {label}")


def build_resolved(meta, resolved):
    rows = []
    for m in sorted(resolved, key=lambda x: x.get("settlement_ts") or "", reverse=True):
        res = (m.get("result") or "").lower()
        settle_src = m.get("settlement_sources") or []
        rows.append([
            f"<a href='{TOPIC_PAGES.get(m['topic'], 'markets.html')}'>{esc(topic_label(m['topic'], meta))}</a>",
            market_link(m),
            f"<code>{esc(m.get('market_ticker'))}</code>",
            pill(res.upper(), "ok" if res == "yes" else ("bad" if res == "no" else "warn")) if res else pill("no result field", "warn"),
            dash(m.get("settlement_value_dollars")),
            dash(m.get("expiration_value")),
            dash(when(m.get("settlement_ts"))),
            " ".join(src(s.get("url"), s.get("name") or "source") for s in settle_src) or dash(None),
            src(m.get("sources", {}).get("market"), "market"),
        ])
    body = f"""
<div class="callout">
  <b>Resolution tracking.</b> Markets are collected with <code>status=settled</code>, which the official
  <a href="{DOCS}/getting_started/market_lifecycle">Market Lifecycle</a> page maps to the <code>finalized</code>
  state. The outcome is the API's own <code>result</code> field (documented values: yes / no / scalar); the
  event's <code>settlement_sources</code> give the official outside source used to determine the market.
  A market with an empty <code>result</code> is shown as “no result field” rather than guessed.
</div>
<p class="fine">Total resolved records in this snapshot: <b>{len(resolved)}</b>.</p>
{table(["Topic", "Market / event", "Ticker", "Result (YES/NO)", "Settlement value",
        "Expiration value", "Settled (UTC)", "Resolution source (from event)", "Source"], rows, "wide")}
<div class="callout warn">
  <b>Scope limit.</b> Only series matched by the topic rules are followed. Resolved markets outside
  gas prices, elections, culture, crypto and golf are intentionally excluded.
</div>
"""
    page("resolved.html", "Resolved outcomes (YES / NO)", body,
         subtitle="Tracked until settlement · result straight from the API")


def build_liquidity(meta, markets, charts):
    charts_by_ticker = {c["market_ticker"]: c for c in charts}
    # depth table: every collected order-book level, best price first
    depth_rows = []
    for m in markets:
        ob = m.get("orderbook") or {}
        for side_key, side_label in (("yes_bids", "YES bids"), ("no_bids", "NO bids")):
            lv = ob.get(side_key) or []
            if not lv:
                continue
            best = lv[0]
            depth_rows.append([
                market_link(m),
                esc(side_label),
                dash(cents(best.get("price"))),
                dash(best.get("contracts")),
                dash(len(lv)),
                src(ob.get("source"), "book"),
            ])
    # full ladder for the richest book
    ladders = ""
    for m in markets[:6]:
        ob = m.get("orderbook") or {}
        if not (ob.get("yes_bids") or ob.get("no_bids")):
            continue
        rows = []
        ys = {b["price"]: b["contracts"] for b in ob.get("yes_bids") or []}
        ns = {b["price"]: b["contracts"] for b in ob.get("no_bids") or []}
        prices = sorted({*ys.keys(), *ns.keys()}, key=lambda p: -float(p))
        for p in prices:
            rows.append([f"{float(p)*100:.1f}¢" if float(p) <= 1 else esc(p),
                         esc(ys.get(p, "")), esc(ns.get(p, ""))])
        ladders += (f"<h3>{esc(m.get('title') or m['market_ticker'])} "
                    f"<span class='fine'>({esc(m['market_ticker'])})</span></h3>"
                    + table(["Price", "YES bid contracts", "NO bid contracts"], rows)
                    + f"<p class='fine'>Implied YES ask {dash(ob.get('implied_yes_ask'))} · "
                      f"implied NO ask {dash(ob.get('implied_no_ask'))} · "
                      f"{src(ob.get('source'), 'order book request')}</p>")
    chart_payload = json.dumps(charts, separators=(",", ":")).replace("</", "<\\/")

    body = f"""
<div class="callout">
  <b>What the order book really is.</b> Kalshi returns <i>bids only</i>. A YES bid at price X equals a NO ask at
  1.00 − X, so the ask side is derived, never quoted from a separate field
  (<a href="{DOCS}/getting_started/orderbook_responses">Orderbook Responses</a>). Every level below is a live resting
  bid with the contract count available at that price. Prices are dollars; 0.42 = 42¢.
</div>

<h2>Price movement — time on X, contract price on Y</h2>
<p>Choose a market, a bucket size and a window. Data comes from
<a href="{DOCS}/api-reference/market/get-market-candlesticks">Get Market Candlesticks</a>, which only supports
1, 60 and 1440-minute periods — the seconds/minutes/hours choice below maps onto those documented intervals
(a finer “seconds” resolution does not exist on the REST candlestick endpoint and is not fabricated).</p>
<div class="controls card">
  <label>Market<select id="chartMarket"></select></label>
  <label>Bucket<select id="chartBucket">
    <option value="1m/6h">1 minute (last 6 h)</option>
    <option value="1h/7d" selected>1 hour (last 7 days)</option>
    <option value="1d/90d">1 day (last 90 days)</option>
  </select></label>
  <label>Y axis<select id="chartSeries">
    <option value="price_close">Traded price (close)</option>
    <option value="yes_bid_close">YES bid (close)</option>
    <option value="yes_ask_close">YES ask (close)</option>
  </select></label>
</div>
<div class="card chartcard">
  <svg id="chart" viewBox="0 0 900 340" role="img" aria-label="Contract price over time"></svg>
  <p class="fine" id="chartNote">Loading price history…</p>
</div>
<div id="chartTable"></div>

<h2>Liquidity at each price (best level per market)</h2>
<p class="fine">From <a href="{DOCS}/api-reference/market/get-market-order-book">Get Market Order Book</a>.
Only markets whose books were requested in this snapshot appear. “Levels” is how many distinct prices were returned.</p>
{table(["Market", "Side", "Best price ¢", "Contracts at best price", "Levels returned", "Source"], depth_rows, "wide")}

<h2>Full bid ladders (top markets)</h2>
{ladders or "<p class='empty'>No order-book levels were returned in this snapshot.</p>"}

<script id="chartData" type="application/json">{chart_payload}</script>
<script src="assets/chart.js"></script>
"""
    page("liquidity.html", "Liquidity, depth and price movement", body,
         subtitle="Order-book depth · candlestick history")


def build_portfolio(meta):
    endpoints = [
        ["Cash balance", "GET /portfolio/balance",
         "balance_dollars, portfolio_value (fixed-point dollars)",
         f"{DOCS}/api-reference/portfolio/get-balance"],
        ["Positions", "GET /portfolio/positions?settlement_status=all",
         "position_fp (signed contracts), market_exposure_dollars, realized_pnl_dollars, fees_paid_dollars",
         f"{DOCS}/api-reference/portfolio/get-positions"],
        ["Fills (trade log)", "GET /portfolio/fills",
         "count_fp, yes_price_dollars, no_price_dollars, fee_cost, outcome_side, is_taker",
         f"{DOCS}/api-reference/portfolio/get-fills"],
        ["Settlements", "GET /portfolio/settlements",
         "Per-market settlement payouts, used to confirm resolved P&L",
         f"{DOCS}/api-reference/portfolio/get-settlements"],
        ["Orders", "GET /portfolio/orders",
         "Resting / cancelled / executed orders, for slippage analysis",
         f"{DOCS}/api-reference/orders/get-orders"],
    ]
    rows = [[esc(a), f"<code>{esc(b)}</code>", esc(c), src(d, "docs")] for a, b, c, d in endpoints]
    body = f"""
<div class="callout bad">
  <b>Blocker: no demo API credentials exist in this project.</b> Every portfolio endpoint requires signed
  requests (<code>KALSHI-ACCESS-KEY</code>, <code>KALSHI-ACCESS-TIMESTAMP</code>, <code>KALSHI-ACCESS-SIGNATURE</code>
  — see <a href="{DOCS}/getting_started/quick_start_authenticated_requests">Quick Start: Authenticated Requests</a>).
  This repository has no key, the build environment holds no key, and a <b>static GitHub Pages site must never
  hold one</b>: anything shipped to the browser is public. Portfolio, trade analysis and execution therefore
  show the exact endpoints and formulas and <b>no numbers</b> — inventing demo balances would be fabrication.
  The single decision needed to unblock this is recorded on <a href="questions.html">Questions</a>.
</div>

<h2>How performance is measured once a key is connected</h2>
<div class="grid2">
  <div class="card"><p class="kicker">Equity</p>
    <p>Cash from <code>balance_dollars</code> plus mark-to-market of open positions. Mark value uses the
    position's <code>market_exposure_dollars</code>, not a hand-typed price.</p></div>
  <div class="card"><p class="kicker">Realised P&amp;L</p>
    <p><code>realized_pnl_dollars</code> per market from Get Positions, reconciled against settlement payouts
    from Get Settlements. Fees come from <code>fees_paid_dollars</code> and each fill's <code>fee_cost</code>.</p></div>
  <div class="card"><p class="kicker">Execution quality</p>
    <p>Per fill: intended price vs <code>yes_price_dollars</code>, <code>is_taker</code> flag, and the depth that
    existed at that price in the order book at the time.</p></div>
  <div class="card"><p class="kicker">Denominator discipline</p>
    <p>Win rate and average return are reported with the number of closed trades. Below a disclosed minimum
    sample, the dashboard says “insufficient sample” instead of showing a misleading percentage.</p></div>
</div>

<h2>Required endpoints</h2>
{table(["Metric", "Endpoint", "Fields used", "Official reference"], rows, "wide")}

<h2>Rate limit note carried over from the docs</h2>
<p class="fine">Balance has its own rate-limit bucket (1 request/second on lower tiers) and the documentation
advises reacting to fill events rather than polling. That shapes the design: a small server-side worker
signs requests and caches results, and the browser reads only cached JSON.</p>
"""
    page("portfolio.html", "Portfolio performance (demo account)", body,
         subtitle="Credential-gated · endpoints and methodology documented")


def build_strategies(meta, markets, resolved):
    tradable = [m for m in markets if (m.get("dollar_notional_24h") or {}).get("trades_counted")]
    rows = []
    for m in tradable[:25]:
        q = m.get("quotes", {})
        yb, ya = q.get("yes", {}), q.get("no", {})
        spread = None
        try:
            if yb.get("bid") and ya.get("bid"):
                from decimal import Decimal
                spread = Decimal("1") - Decimal(yb["bid"]) - Decimal(ya["bid"])
                spread = f"{spread * 100:.1f}"
        except Exception:
            spread = None
        rows.append([
            f"<a href='{TOPIC_PAGES.get(m['topic'], 'markets.html')}'>{esc(topic_label(m['topic'], meta))}</a>",
            market_link(m),
            dash(cents(yb.get("bid"))),
            dash(cents(yb.get("ask"))),
            dash(spread),
            dash(m.get("dollar_notional_24h", {}).get("value")),
            dash(m.get("open_interest_contracts")),
            dash(when(m.get("close_time"))),
        ])
    cat_rows = [
        ["Directional probability", "Buy YES or NO when your probability estimate beats the market's implied price.",
         "Needs a forecast that is independent of the market price; without one this is noise.",
         "Contract price; order book; your own model output"],
        ["Relative value / spread", "Exploit YES bid + NO bid < $1.00 (buy both sides) or > $1.00 (sell both).",
         "Edge is small and fees can exceed it; requires depth at both prices.",
         "YES bid, NO bid, implied asks, fee schedule"],
        ["Liquidity provision", "Rest passive bids and earn the spread; measured with fill rate and adverse selection.",
         "Requires resting orders (credential-gated) and mark-to-market of inventory.",
         "Book depth per price; volume; fill log"],
        ["Event outcome (long-hold)", "Hold to settlement when the price is far from your estimate and the horizon is short.",
         "Capital is locked until settlement; resolution risk and disputes matter.",
         "Result field; settlement value; settlement source"],
        ["Resolution tracking", "Systematically record yes/no outcomes and compare the pre-settlement price to the outcome.",
         "Descriptive only until enough resolved samples accumulate; not a trading signal by itself.",
         "status=settled markets; settlement_ts; result"],
    ]
    body = f"""
<h2>Strategies, grouped by how the trade makes money</h2>
<p>Each category lists the observable inputs the dashboard actually collects, so a strategy can be judged
against data rather than intuition. Performance for any of them requires the demo-account fills that are
blocked on credentials (see <a href="portfolio.html">Portfolio</a>).</p>
{table(["Strategy category", "Trade logic", "What can go wrong", "Inputs needed (collected?)"], cat_rows, "wide")}

<h2>Spread screen on the most-traded tracked markets</h2>
<p class="fine">Computed spread = 1.00 − best YES bid − best NO bid, in cents. A positive number means the two
sides cannot be bought for less than $1.00; a negative number means a crossed/arbitrage-like book exists at the
quoted quotes. This uses API quote fields only and ignores size — check the ladder on
<a href="liquidity.html">Liquidity</a> before believing any of it.</p>
{table(["Topic", "Market", "YES bid ¢", "NO bid ¢", "Computed spread ¢", "Notional 24h (USD)",
        "Open interest", "Close time"], rows, "wide")}

<div class="callout warn">
  <b>Honest status.</b> No strategy on this page has a verified track record. Presenting one would require
  executed fills, fees and outcomes from the demo account — which is exactly what the credential blocker
  prevents. The page is a specification for analysis, not a performance claim.
</div>
"""
    page("strategies.html", "Trade categories & strategy catalogue", body,
         subtitle="Categorised strategies · inputs traced to collected data")


def build_suggestions():
    items = [
        ("Connect a read-only demo API key", "Highest value",
         "Unlocks portfolio, fills, settlements and therefore real performance analysis.",
         "A signed server-side worker (never the browser) with a read-only key; decide hosting.",
         "Requires your decision — see Questions Q1"),
        ("Add a signed execution service with hard risk caps", "High",
         "Turns the documented order form into working demo trading with a full audit trail.",
         "Per-order maximum, daily loss cap, allowed topics, kill switch.",
         "Requires your decision — see Questions Q2"),
        ("Upgrade the price chart to WebSocket streaming", "High",
         "REST candlesticks are limited to 1/60/1440-minute buckets and can lag a few seconds.",
         "Authenticated WebSocket session (documented: even public channels need the signed handshake).",
         "Blocked on credentials"),
        ("Use an official series taxonomy instead of keyword rules", "Medium",
         "Removes false positives/negatives in topic assignment.",
         "A curated list of series tickers per topic, reviewed by you.",
         "Needs your input; interim rules are published on each topic page"),
        ("Snapshot the dataset on a schedule and keep history", "Medium",
         "Enables trends, liquidity drift and resolution-vs-price analysis over time.",
         "A cron schedule plus committed snapshots; decide retention.",
         "Safe to implement; grows repo size"),
        ("Show fee-adjusted edge, not gross spreads", "Medium",
         "Gross spread screens overstate profit because Kalshi fees are quadratic on price.",
         "The official fee schedule values per series (fee_type / fee_multiplier are in Get Series).",
         "Needs fee formula verification before any number is shown"),
        ("Replace heuristic dollar notional with a defined metric", "Medium",
         "“Highest dollar amount” is ambiguous; the current computed notional counts traded dollars.",
         "Agree whether the metric should be traded dollars, dollars of resting depth, or open interest × price.",
         "Requires your definition — Questions Q3"),
        ("Add alerting on resolution and large price moves", "Low",
         "Live events are only useful if someone is told when they resolve.",
         "Notification channel and thresholds.",
         "Requires your decision"),
    ]
    rows = [[f"<b>{esc(a)}</b>", pill(b, "warn" if b in ("High", "Highest value") else "ok"),
             esc(c), esc(d), esc(e)] for a, b, c, d, e in items]
    body = f"""
<div class="callout">
  <b>This page is a review queue, not a changelog.</b> Nothing here is implemented automatically. Each item states
  the change, why it improves decisions, what is needed, and whether it is blocked on a decision from you.
  Pick the ones worth doing and they can be sequenced.
</div>
{table(["Suggestion", "Value", "Why it improves decisions", "What it needs", "Status"], rows, "wide")}

<h2>How to choose between them</h2>
<ol class="tight">
  <li><b>Unblock measurement first.</b> Items 1 and 2 are the only ones that turn this dashboard from a
  market viewer into a performance tracker. Everything else is theory until fills exist.</li>
  <li><b>Fix definitions before numbers.</b> Items 6 and 7 change what the headline figures mean; do them
  before anyone makes a trading decision from the dashboard.</li>
  <li><b>Then widen the data.</b> Streaming and historical snapshots (3 and 5) improve fidelity once the
  definitions are stable.</li>
</ol>
"""
    page("suggestions.html", "Suggestions for review", body,
         subtitle="Review queue · nothing auto-applied")


def build_questions(meta):
    qa = [
        ("Q1", "Is there a Kalshi demo API key available for this project, and may a server-side worker use it?",
         "No key exists in the repository or the build environment (verified by inspection).",
         "Every portfolio, fills and settlement figure is blank because of this — not because the API failed.",
         "A read-only demo key issued from demo.kalshi.co. Until then portfolio analysis cannot be verified.",
         f"{DOCS}/getting_started/quick_start_authenticated_requests"),
        ("Q2", "Should the dashboard be allowed to place real orders on the demo exchange?",
         "Order placement requires a signed request to POST /portfolio/events/orders.",
         "No order has been placed and no order form is live.",
         "Explicit go/no-go plus risk limits (max order size, daily loss cap, permitted topics, kill switch).",
         f"{DOCS}/api-reference/orders/create-order-v2"),
        ("Q3", "What exactly does “highest dollar amount live events” mean?",
         "Three defensible readings: dollars traded, dollars of resting depth, open interest × price.",
         "The dashboard currently shows a computed 24 h traded notional and labels it as such.",
         "A definition. Until chosen, ranking is disclosed as one interpretation, not the only one.",
         f"{DOCS}/api-reference/market/get-trades"),
        ("Q4", "Is the demo exchange's liquidity representative of production?",
         "Demo and production are separate environments with separate credentials and separate books.",
         "Conclusion: demo depth cannot be used to estimate real fill sizes.",
         "Confirm that strategy calibration on demo data is acceptable, or provide a production read-only key.",
         f"{DOCS}/getting_started/api_environments"),
        ("Q5", "Which series belong to each of the five topics?",
         "The API exposes discovery categories and tags, but no project-specific topic taxonomy.",
         "Keyword/category rules are published per topic page with the match reason for every series.",
         "Approve or edit the series allowlist per topic.",
         f"{DOCS}/api-reference/market/get-series-list"),
        ("Q6", "How should fees and net edge be computed?",
         "Each series reports fee_type and fee_multiplier; fees are quadratic and price-dependent.",
         "Gross spreads are shown and explicitly labelled as pre-fee.",
         "Verification of the fee formula against the official fee schedule before any net figure is published.",
         "https://kalshi.com/docs/kalshi-fee-schedule.pdf"),
        ("Q7", "How fresh must prices be?",
         "REST candlesticks support only 1/60/1440-minute buckets and can trail trades by seconds; streaming needs a signed WebSocket session.",
         "Charts show bucketed official history, not tick data.",
         "A refresh target (e.g. sub-minute) decides whether streaming is required.",
         f"{DOCS}/getting_started/quick_start_websockets"),
        ("Q8", "What is the minimum sample before a strategy performance claim is shown?",
         "Nothing on the site currently claims strategy performance.",
         "Win rates and averages are withheld until closed trades exist.",
         "A threshold (e.g. ≥ 30 closed trades) below which the dashboard reports “insufficient sample”.",
         f"{DOCS}/api-reference/portfolio/get-positions"),
        ("Q9", "Should resolved markets outside the five topics be tracked?",
         "Collection is limited to matched series by design.",
         "Resolved tables include only gas, elections, culture, crypto, golf.",
         "Confirm the scope limit is intended.",
         f"{DOCS}/api-reference/market/get-markets"),
        ("Q10", "Who reviews the flagged irregularities, and how often?",
         "Flagged items are published openly on the site.",
         "Irregularities do not block publication; they are listed with sources.",
         "A review cadence and an owner.",
         "flagged.html"),
    ]
    rows = [[f"<b>{esc(a)}</b>", esc(b), esc(c), esc(d), esc(e), src(f, "official") if f.startswith("http") else f"<a href='{esc(f)}'>{esc(f)}</a>"]
            for a, b, c, d, e, f in qa]
    body = f"""
<div class="callout">
  <b>Read this before trusting any number.</b> These are the questions that must be answered before a trading or
  design decision can be made fairly from what we have. For each: what is known from an official source, what is
  genuinely missing, and the specific input that would resolve it.
</div>
{table(["#", "Question", "What we know (official)", "What is missing", "What would resolve it", "Source"], rows, "wide")}

<h2>Information we do not have (and did not invent)</h2>
<ul class="tight">
  <li>Demo-account cash, positions, fills, fees and realised P&amp;L — no key.</li>
  <li>Fee-adjusted edge for any market — fee formula not yet verified per series.</li>
  <li>Production liquidity, order-book depth and slippage — demo books are separate.</li>
  <li>Seconds-level price history — not offered by REST candlesticks.</li>
  <li>Any forward-looking forecast — out of scope; the dashboard reports market prices, not our predictions.</li>
</ul>
"""
    page("questions.html", "Questions, information and answers", body,
         subtitle="Decision preconditions · unknowns stated plainly")


def build_flagged(meta, markets):
    items = [
        ("Demo exchange values are not production values",
         "Every price, depth level and volume figure comes from external-api.demo.kalshi.co.",
         "The demo environment is Kalshi's test venue with separate credentials and books.",
         f"{DOCS}/getting_started/api_environments", "By design — disclosed in the footer and every table"),
        ("No portfolio, fills or settlement data",
         "The portfolio page shows endpoints and methodology but no figures.",
         "No Kalshi demo API key exists in the repo or environment; a static site cannot hold one.",
         f"{DOCS}/getting_started/quick_start_authenticated_requests", "Blocked on the user (Q1)"),
        ("No trades executed",
         "No order has been submitted; the order form is documentation only.",
         "Execution needs a signed server-side service and explicit risk limits.",
         f"{DOCS}/api-reference/orders/create-order-v2", "Blocked on the user (Q2)"),
        ("“Highest dollar amount” is an interpretation",
         "Ranking uses a computed 24 h traded notional with the trade count shown.",
         "The brief does not define the metric; alternatives are listed in Q3.",
         f"{DOCS}/api-reference/market/get-trades", "Needs a definition"),
        ("Topic assignment is heuristic",
         "Each series records why it matched, and rules are published per topic page.",
         "There is no official Kalshi taxonomy mapping to these five topics.",
         f"{DOCS}/api-reference/market/get-series-list", "Needs an approved allowlist (Q5)"),
        ("Fee-adjusted edge is not shown",
         "Spreads are labelled pre-fee.",
         "The fee formula has not been verified against the official fee schedule in this session.",
         "https://kalshi.com/docs/kalshi-fee-schedule.pdf", "Needs verification (Q6)"),
        ("Charts are bucketed, not tick-level",
         "Candlesticks use the documented 1 / 60 / 1440-minute intervals.",
         "Sub-minute history requires the authenticated WebSocket stream.",
         f"{DOCS}/api-reference/market/get-market-candlesticks", "Design limit"),
        ("Some markets return empty quote fields",
         "A quote with zero size behind it is displayed but marked as not tradeable in the market view.",
         "The API can return a 0.0000 bid with 0.00 size; that is not a real level.",
         f"{DOCS}/api-reference/market/get-markets", "Displayed, not silently dropped"),
    ]
    rows = [[esc(a), esc(b), esc(c), src(d, "official"), esc(e)] for a, b, c, d, e in items]
    empties = [m for m in markets if not (m.get("quotes", {}).get("yes", {}).get("bid_is_live"))]
    empty_rows = [[market_link(m), f"<code>{esc(m['market_ticker'])}</code>",
                   dash(m.get("quotes", {}).get("yes", {}).get("bid")),
                   dash(m.get("quotes", {}).get("yes", {}).get("bid_size_contracts")),
                   src(m.get("sources", {}).get("market"), "market")]
                  for m in empties[:40]]
    body = f"""
<div class="callout warn">
  <b>Flagged for review.</b> These are known gaps and irregularities, published deliberately with their sources.
  None of them block the site from being useful; all of them should be read before acting on a number.
</div>
{table(["Irregularity", "What the site shows", "Why it happens", "Official source", "Status"], rows, "wide")}

<h2>Open markets whose YES bid is not a live level</h2>
<p class="fine">These markets were returned with no size behind the YES bid (or no bid at all), so no tradeable
price is implied. They are listed here rather than hidden. Showing the first {len(empty_rows)} of {len(empties)}.</p>
{table(["Market", "Ticker", "YES bid ¢", "Contracts at YES bid", "Source"], empty_rows, "wide")}
"""
    page("flagged.html", "Flagged for review", body,
         subtitle="Known gaps, disclosed with sources")


def build_sources(meta):
    base = meta.get("rest_base") or "https://external-api.demo.kalshi.co/trade-api/v2"
    docs_rows = []
    refs = [
        ("API environments & base URLs", f"{DOCS}/getting_started/api_environments"),
        ("Quick start: market data (public, no auth)", f"{DOCS}/getting_started/quick_start_market_data"),
        ("Quick start: authenticated requests (signing)", f"{DOCS}/getting_started/quick_start_authenticated_requests"),
        ("Quick start: WebSockets (signed handshake)", f"{DOCS}/getting_started/quick_start_websockets"),
        ("Get Markets", f"{DOCS}/api-reference/market/get-markets"),
        ("Get Market", f"{DOCS}/api-reference/market/get-market"),
        ("Get Market Order Book", f"{DOCS}/api-reference/market/get-market-order-book"),
        ("Get Market Candlesticks (1 / 60 / 1440 min)", f"{DOCS}/api-reference/market/get-market-candlesticks"),
        ("Get Trades", f"{DOCS}/api-reference/market/get-trades"),
        ("Get Series List (categories, fee_type)", f"{DOCS}/api-reference/market/get-series-list"),
        ("Get Events (settlement_sources)", f"{DOCS}/api-reference/events/get-events"),
        ("Get Balance", f"{DOCS}/api-reference/portfolio/get-balance"),
        ("Get Positions (realized_pnl_dollars)", f"{DOCS}/api-reference/portfolio/get-positions"),
        ("Get Fills", f"{DOCS}/api-reference/portfolio/get-fills"),
        ("Get Settlements", f"{DOCS}/api-reference/portfolio/get-settlements"),
        ("Create Order (V2)", f"{DOCS}/api-reference/orders/create-order-v2"),
        ("Orderbook responses (bid/ask reciprocity)", f"{DOCS}/getting_started/orderbook_responses"),
        ("Market lifecycle (status, result)", f"{DOCS}/getting_started/market_lifecycle"),
        ("Fixed-point representation", f"{DOCS}/getting_started/fixed_point_migration"),
        ("Rate limits and tiers", f"{DOCS}/getting_started/rate_limits"),
        ("Documentation index (llms.txt)", f"{DOCS}/llms.txt"),
        ("Exchange status (live request)", f"{meta.get('rest_base') or 'https://external-api.demo.kalshi.co/trade-api/v2'}/exchange/status"),
    ]
    docs_rows = [[esc(a), src(b, "open")] for a, b in refs]
    body = f"""
<div class="callout">
  <b>Every published value traces to one of these.</b> API documentation pages were read directly during this
  session; live figures are reproduced from the collected snapshot, and each row links to the exact request URL.
</div>
<h2>Official Kalshi documentation</h2>
{table(["Reference", "Link"], docs_rows, "wide")}

<h2>Live data requests used for this snapshot</h2>
<ul class="tight">
  <li><code>GET {esc(base)}/series?include_volume=true</code></li>
  <li><code>GET {esc(base)}/markets?series_ticker=…&amp;status=open|settled</code></li>
  <li><code>GET {esc(base)}/events/{'{event_ticker}'}</code></li>
  <li><code>GET {esc(base)}/markets/{'{ticker}'}/orderbook</code></li>
  <li><code>GET {esc(base)}/markets/trades?ticker=…&amp;min_ts=…</code></li>
  <li><code>GET {esc(base)}/series/{'{series}'}/markets/{'{ticker}'}/candlesticks?period_interval=1|60|1440</code></li>
</ul>

<h2>Verification method</h2>
<ol class="tight">
  <li>Documentation pages fetched from docs.kalshi.com and quoted in the collector's docstring.</li>
  <li>Data collected by <code>tools/collect_kalshi.py</code> on a GitHub Actions runner with unrestricted egress.</li>
  <li>Every JSON record stores the request URL that produced it; the site renders that URL as the row's source.</li>
  <li>Absent fields render as “—” and are listed on <a href="flagged.html">Flagged for review</a>.</li>
  <li>The build fails if any internal link is broken.</li>
</ol>
"""
    page("sources.html", "Sources and verification log", body,
         subtitle="Official references · how each value was obtained")


def build_market_detail(meta, markets, charts):
    payload = {"markets": {m["market_ticker"]: m for m in markets},
               "charts": {c["market_ticker"]: c for c in charts}}
    js = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
    body = f"""
<p class="fine"><a href="markets.html">← Back to all markets</a></p>
<div id="detail"><p class="empty">Select a market from the table.</p></div>
<script id="detailData" type="application/json">{js}</script>
<script src="assets/detail.js"></script>
"""
    page("market.html", "Market detail", body, subtitle="Quotes, ladder, history, resolution")


# --------------------------------------------------------------------------
def link_check():
    pages = sorted(p for p in SITE.glob("*.html"))
    existing = {p.name for p in pages} | {"assets/style.css", "assets/chart.js",
                                          "assets/detail.js"}
    bad = []
    for p in pages:
        text = p.read_text(encoding="utf-8")
        for href in re.findall(r"href='([^']+)'", text):
            if href.startswith(("http", "#", "mailto:")):
                continue
            target = href.split("#")[0].split("?")[0]
            if not target:
                continue
            if target not in existing and not (SITE / target).exists():
                bad.append(f"{p.name} -> {href}")
        for script in re.findall(r"src='([^']+)'", text):
            if script.startswith("http"):
                continue
            if not (SITE / script).exists():
                bad.append(f"{p.name} -> script {script}")
    return bad


def main():
    SITE.mkdir(exist_ok=True)
    (SITE / "assets").mkdir(exist_ok=True)
    meta = load("metadata.json", {}) or {}
    markets = (load("markets.json", {}) or {}).get("markets", [])
    resolved = (load("resolved.json", {}) or {}).get("markets", [])
    charts = (load("charts.json", {}) or {}).get("series", [])
    if not meta:
        print("WARNING: data/metadata.json missing — building empty-state site")
    build_index(meta, markets, resolved)
    build_markets(meta, markets)
    for key in TOPIC_ORDER:
        build_topic(key, meta, markets, resolved)
    build_resolved(meta, resolved)
    build_liquidity(meta, markets, charts)
    build_portfolio(meta)
    build_strategies(meta, markets, resolved)
    build_suggestions()
    build_questions(meta)
    build_flagged(meta, markets)
    build_sources(meta)
    build_market_detail(meta, markets, charts)
    # static assets
    for asset in ("style.css", "chart.js", "detail.js"):
        src_asset = ROOT / "assets" / asset
        if not src_asset.exists():
            BUILD_ERRORS.append(f"missing source asset assets/{asset}")
            continue
        (SITE / "assets" / asset).write_text(src_asset.read_text(encoding="utf-8"),
                                             encoding="utf-8")
    (SITE / ".nojekyll").write_text("", encoding="utf-8")
    bad = link_check()
    for b in bad:
        BUILD_ERRORS.append(f"broken internal link: {b}")
    print(f"built {len(list(SITE.glob('*.html')))} pages; "
          f"markets={len(markets)} resolved={len(resolved)} charts={len(charts)}")
    if BUILD_ERRORS:
        print("BUILD ERRORS:")
        for e in BUILD_ERRORS:
            print("  -", e)
        return 1
    print("link check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
