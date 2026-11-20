#!/usr/bin/env python3
"""Builds audit/index.html from the rows below.

Every row carries an official Kalshi source URL (docs.kalshi.com or kalshi.com) and,
where relevant, the repo location it audits. Values are quoted from the official pages
read on 2026-11-20; anything not read is marked Unverified, never filled in.
Run:  python3 audit/build_audit.py
"""
import html
import pathlib

REPO = "https://github.com/karagemop466-tech/Demo1/blob/main/"
DOC = "https://docs.kalshi.com/"

# result keys -> (label, css class)
RESULT = {
    "ok": ("Confirmed", "ok"),
    "bad": ("Mismatch", "bad"),
    "unv": ("Unverified", "unv"),
    "new": ("New info", "new"),
}

SECTIONS = [
    {
        "id": "A",
        "title": "A. Environments and authentication",
        "rows": [
            dict(id="A-01", claim="Demo REST base URL is https://external-api.demo.kalshi.co/trade-api/v2 (also supported: https://demo-api.kalshi.co/trade-api/v2)",
                 repo="docs/api-verification.md row 1; decision/api-notes.html",
                 src=DOC + "getting_started/api_environments",
                 says="Demo: recommended <code>https://external-api.demo.kalshi.co/trade-api/v2</code>; also supported <code>https://demo-api.kalshi.co/trade-api/v2</code>.",
                 res="ok"),
            dict(id="A-02", claim="Demo WebSocket URL is wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2 (also supported: wss://demo-api.kalshi.co/trade-api/ws/v2)",
                 repo="exec-desk/js/config.js; assets/js/kalshi-core.js; docs/api-verification.md row 2",
                 src=DOC + "getting_started/api_environments",
                 says="Demo WebSocket: recommended <code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code>; also supported <code>wss://demo-api.kalshi.co/trade-api/ws/v2</code>.",
                 res="ok"),
            dict(id="A-03", claim="Dedicated per-user hosts for fill and order updates (not referenced anywhere in the repo)",
                 repo="No reference found (search of all HTML, JS, MD and PY files in the repo)",
                 src=DOC + "getting_started/api_environments",
                 says="Demo user host <code>wss://user-ws.demo.kalshi.co/trade-api/ws/v2</code> serves the <code>fill</code> and <code>user_orders</code> channels; \"The earlier <code>warp-ws</code> and <code>margin-warp-ws</code> hosts are deprecated.\"",
                 res="new"),
            dict(id="A-04", claim="Request signing: timestamp + method + path, no query string; RSA-PSS SHA-256 or Ed25519; timestamp in milliseconds",
                 repo="docs/api-verification.md row 18 (WebSocket form of the same rule)",
                 src=DOC + "getting_started/quick_start_authenticated_requests",
                 says="\"Concatenate <code>timestamp + HTTP_METHOD + path</code>\"; \"Sign the full URL path from the API root, without query parameters.\"; \"RSA keys use RSA-PSS with SHA-256; Ed25519 keys sign the message directly.\"; \"The timestamp must be within 30 seconds of Kalshi’s clock.\"",
                 res="ok"),
            dict(id="A-05", claim="Demo uses mock funds; demo prices may not reflect real markets; demo and production credentials are separate",
                 repo="exec-desk/flagged.html (UNVERIFIED-05); docs/api-verification.md E-2",
                 src=DOC + "getting_started/demo_env",
                 says="\"Kalshi offers a <em>demo</em> environment with mock funds.\"; \"The price and behavior of markets in the demo environment may not be reflective of those in real markets.\"; \"credentials are not shared between this environment and production.\"",
                 res="ok"),
            dict(id="A-06", claim="Public market data (order book, markets, events, candlesticks) needs no API key",
                 repo="docs/api-verification.md E-1",
                 src=DOC + "getting_started/orderbook_responses",
                 says="\"No authentication is required for this endpoint.\" (order book page). The quick-start example also says \"no auth required for public market data\".",
                 res="ok"),
        ],
    },
    {
        "id": "B",
        "title": "B. Endpoints, parameters and value sets",
        "rows": [
            dict(id="B-01", claim="Order creation is POST /portfolio/events/orders with ticker, client_order_id, side (bid|ask), count, price, time_in_force, self_trade_prevention_type; HTTP 201 means accepted, not necessarily resting",
                 repo="docs/api-verification.md row 16",
                 src=DOC + "api-reference/orders/create-order-v2",
                 says="Request URL <code>https://external-api.kalshi.com/trade-api/v2/portfolio/events/orders</code> (POST). Quick start: \"A <code>201</code> means the order was accepted, not that it is resting: check <code>remaining_count</code>.\" Duplicate IDs return <code>409 order_already_exists</code>.",
                 res="ok"),
            dict(id="B-02", claim="Legacy /portfolio/orders write endpoints are removed and return HTTP 410 Gone",
                 repo="EXECUTIVE_SUMMARY.md line 27; SOURCES.md line 21; exec-desk/flagged.html line 34; verified-desk/index.html line 76; docs/pages/sources.html line 69; COORDINATION.md line 533",
                 src=DOC + "api-reference/orders/create-order-v2",
                 says="<strong>Re-verified 2026-11-20 (session arena/b62e8188-demo1) — claim CONFIRMED.</strong> The full official page description (docs.kalshi.com/api-reference/orders/create-order-v2.md, fetched 2026-11-20) reads: \"The legacy <code>/portfolio/orders</code> write endpoints (create, cancel, amend, decrease and their batch forms) have been removed and now return <code>410 Gone</code> with code <code>deprecated_v1_order_endpoint</code>; use this path instead.\" The earlier partial search-index excerpt (\"deprecated no earlier than May 6, 2026\") was stale; the repo wording matches the current official text.",
                 res="ok"),
            dict(id="B-03", claim="GET /events: limit 1 to 200 (default 200); status filter unopened, open, closed, settled; with_nested_markets option",
                 repo="docs/api-verification.md row 4; exec-desk/js/markets.js line 50",
                 src=DOC + "api-reference/events/get-events",
                 says="\"Maximum value is 200.\" Status: \"Possible values are 'unopened', 'open', 'closed', 'settled'.\" with_nested_markets: \"When true, each event will include a 'markets' field containing a list of Market objects.\"",
                 res="ok"),
            dict(id="B-04", claim="GET /markets: limit 0 to 1000 (default 100); status filter unopened, open, paused, closed, settled",
                 repo="docs/api-verification.md row 3",
                 src=DOC + "api-reference/market/get-markets",
                 says="\"Number of results per page. Defaults to 100. Maximum value is 1000.\" Status options: unopened, open, paused, closed, settled.",
                 res="ok"),
            dict(id="B-05", claim="Candlesticks: GET /series/{series_ticker}/markets/{ticker}/candlesticks with start_ts, end_ts and period_interval of 1, 60 or 1440 minutes; no sub-minute candles",
                 repo="docs/api-verification.md row 10 and row 11; exec-desk/js/jumps.js line 55",
                 src=DOC + "api-reference/market/get-market-candlesticks",
                 says="\"Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day).\" Path and the required start_ts and end_ts parameters match.",
                 res="ok"),
            dict(id="B-06", claim="Candlesticks: at most 5,000 periods per request",
                 repo="docs/api-verification.md row 10",
                 src=DOC + "api-reference/market/get-market-candlesticks",
                 says="<strong>Re-verified 2026-11-20 (session arena/b62e8188-demo1) — claim CONFIRMED.</strong> The official page description reads: \"One request can span at most 5,000 periods. If the minutes between <code>start_ts</code> and <code>end_ts</code> divided by <code>period_interval</code> exceed 5,000, the request is rejected with 400 <code>bad_request</code> and the <code>details</code> field gives the requested and maximum counts.\" The original audit read only the first two chunks and missed the description block.",
                 res="ok"),
            dict(id="B-07", claim="Order book returns bids only; YES and NO arrays ascending with best bid last; NO bid at p equals YES ask at 1 − p; empty book returns 200 with empty arrays; depth limits levels",
                 repo="docs/api-verification.md row 9",
                 src=DOC + "getting_started/orderbook_responses",
                 says="\"Kalshi’s orderbook only returns bids, not asks.\"; \"Arrays are sorted by price in <strong>ascending order</strong>\"; \"The <strong>highest</strong> bid (best bid) is the <strong>last</strong> element in each array\"; \"the endpoint returns <code>200</code> with empty arrays rather than <code>404</code>\"; a YES BID at X is equivalent to a NO ASK at $1.00 − X.",
                 res="ok"),
            dict(id="B-08", claim="Market status values in responses: initialized, active, inactive, closed, determined, disputed, amended, finalized. Filter mapping: open = active, paused = inactive, settled = finalized",
                 repo="exec-desk/js/kalshi.js lines 113–115; assets/js/kalshi-core.js line 285; assets/js/paper-trading.js line 179",
                 src=DOC + "getting_started/market_lifecycle",
                 says="Table of statuses as listed. \"When filtering with <code>GET /markets?status=</code>, the values map as follows\": open → <code>active</code>; paused → <code>inactive</code>; settled → <code>finalized</code>. \"In REST, settled markets end up at <code>finalized</code> rather than a separate <code>settled</code> status.\"",
                 res="ok"),
            dict(id="B-09", claim="After determination, result is yes, no or scalar; settlement_ts is set once settled",
                 repo="docs/api-verification.md row 8 (the repo also lists an empty-string value; not re-checked here)",
                 src=DOC + "getting_started/market_lifecycle",
                 says="\"the market is determined and <code>result</code> is set to <code>yes</code>, <code>no</code>, or <code>scalar</code>.\"",
                 res="ok"),
            dict(id="B-10", claim="Events have no top-level status; the event status filter matches child market statuses",
                 repo="strategy-desk/assets/app.js lines 285–292 derive an event status locally",
                 src=DOC + "getting_started/market_lifecycle",
                 says="\"The filter matches on child market statuses, not an event-level status; an event appears in results if <strong>any</strong> of its child markets has a matching status.\"",
                 res="ok"),
            dict(id="B-11", claim="Settlement pays $1 per contract to holders of the winning side",
                 repo="decision/js/resolutions.js line 67 (resolution tracking)",
                 src=DOC + "getting_started/market_settlement",
                 says="\"Yes outcome: Yes contract holders receive $1 per contract\"; \"No outcome: No contract holders receive $1 per contract\".",
                 res="ok"),
            dict(id="B-12", claim="Nested markets on /events cover settled markets (exec-desk uses with_nested_markets for the settled view)",
                 repo="exec-desk/js/markets.js line 50",
                 src=DOC + "api-reference/events/get-events",
                 says="with_nested_markets: \"Historical markets settled before the historical cutoff will not be included.\" The cutoff date is not stated in the text read, so the size of the gap cannot be measured.",
                 res="ok"),
            dict(id="B-13", claim="Series records carry fee_type and fee_multiplier (live response shows quadratic and 1); the fee formula is used for edge estimates",
                 repo="docs/api-verification.md row 20; exec-desk/flagged.html irregularity 6",
                 src=DOC + "api-reference/market/get-series-list",
                 says="Field names and the observed values were confirmed in a live response from the official demo host on 2026-11-20. The fee formula itself is not on any page read here; the fee schedule (https://kalshi.com/docs/kalshi-fee-schedule.pdf) was not fetched.",
                 res="unv"),
        ],
    },
    {
        "id": "C",
        "title": "C. Repo code checked against the official values",
        "rows": [
            dict(id="C-01", claim="Live refresh compares raw REST market status with 'open' (open count) and 'closed'/'settled'. Official open value is 'active'.",
                 repo="strategy-desk/assets/app.js lines 257–292 (raw /markets records at 269–275; comparisons at 286–292)",
                 src=DOC + "getting_started/market_lifecycle",
                 says="open filter → <code>active</code>. Market responses never return <code>open</code>. Effect: openCount is always 0, so open events are labelled 'closed'. The snapshot path (line 365) maps <code>active</code> to <code>open</code>, so live and snapshot modes disagree.",
                 res="bad"),
            dict(id="C-02", claim="Settled test uses 'settled' (and 'closed'); official settled value is 'finalized'",
                 repo="strategy-desk/assets/app.js line 287",
                 src=DOC + "getting_started/market_lifecycle",
                 says="\"In REST, settled markets end up at <code>finalized</code> rather than a separate <code>settled</code> status.\" Impact is limited because line 288 falls back to the <code>result</code> field.",
                 res="bad"),
            dict(id="C-03", claim="Event tables use the derived status from C-01 and C-02",
                 repo="strategy-desk/assets/markets.js lines 23 and 74",
                 src=DOC + "getting_started/market_lifecycle",
                 says="Inherits C-01 and C-02. Open events are not counted as open in live mode.",
                 res="bad"),
            dict(id="C-04", claim="Status checks for active, initialized, inactive, determined and finalized",
                 repo="exec-desk/js/kalshi.js lines 113–115; assets/js/kalshi-core.js line 285; assets/js/paper-trading.js line 179; assets/js/demo-live.js line 137; decision/js/resolutions.js line 67",
                 src=DOC + "getting_started/market_lifecycle",
                 says="Consistent with the official REST values in B-08.",
                 res="ok"),
            dict(id="C-05", claim="Filter calls use 'open' and 'settled' values",
                 repo="exec-desk/js/markets.js lines 50 and 113; tools/collect_kalshi.py line 237",
                 src=DOC + "api-reference/market/get-markets",
                 says="'open' and 'settled' are valid values of the documented status filter.",
                 res="ok"),
            dict(id="C-06", claim="Irregularity R2: market status filters are listed in prose without 'paused', but the schema enum includes it",
                 repo="exec-desk/flagged.html line 28",
                 src=DOC + "api-reference/market/get-markets",
                 says="The market status enum includes <code>paused</code> (B-04). The four-value list in the repo applies to the events filter (B-03). The repo note is accurate.",
                 res="ok"),
            dict(id="C-07", claim="Price history uses 1-minute candles",
                 repo="exec-desk/js/jumps.js line 55",
                 src=DOC + "api-reference/market/get-market-candlesticks",
                 says="\"Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day).\"",
                 res="ok"),
        ],
    },
    {
        "id": "D",
        "title": "D. Inconsistencies inside the official docs",
        "rows": [
            dict(id="D-01", claim="Error code for orders placed on a closed market: MARKET_INACTIVE or market_inactive?",
                 repo="verified-desk/portfolio.html line 94 uses 409 market_inactive",
                 src=DOC + "getting_started/market_lifecycle",
                 says="Lifecycle page: orders after close are \"rejected with <code>MARKET_INACTIVE</code>\". Order Errors and quick-start pages use lowercase <code>market_inactive</code>, and Order Errors says \"Match codes case-sensitively.\" Official docs disagree on case; reviewers should confirm with the live API.",
                 res="unv"),
        ],
    },
]

FLAGS = [
    dict(id="F-01", sev="Resolved 2026-11-20", title="strategy-desk live mode mislabels open events as closed (C-01 to C-03) — FIXED",
         detail="Raw REST statuses are compared with values the API does not return. Fix applied 2026-11-20 by session arena/b62e8188-demo1: strategy-desk/assets/app.js now normalizes raw statuses via normStatus() (active/initialized/inactive to open, determined/disputed/amended/finalized to settled, closed and unknown to closed) in both the live and snapshot paths. Original change request recorded in COORDINATION.md (CR-1).",
         src=DOC + "getting_started/market_lifecycle", repo=REPO + "strategy-desk/assets/app.js"),
    dict(id="F-02", sev="Withdrawn 2026-11-20", title="\u201cLegacy writes return 410 Gone\u201d is not confirmed by the official text (B-02) — WITHDRAWN, repo claim is correct",
         detail="Withdrawn by session arena/b62e8188-demo1 after re-reading the full official create-order-v2 page: the description now states the legacy /portfolio/orders write endpoints \u201chave been removed and now return 410 Gone with code deprecated_v1_order_endpoint\u201d. The earlier audit relied on a stale partial search-index excerpt. See corrected row B-02.",
         src=DOC + "api-reference/orders/create-order-v2", repo=REPO + "EXECUTIVE_SUMMARY.md#L27"),
    dict(id="F-03", sev="Withdrawn 2026-11-20", title="\u201cAt most 5,000 periods per request\u201d is not confirmed (B-06) — WITHDRAWN, repo claim is correct",
         detail="Withdrawn by session arena/b62e8188-demo1: the official candlesticks page description states \u201cOne request can span at most 5,000 periods\u2026 rejected with 400 bad_request\u201d. The original audit read only the first two page chunks. See corrected row B-06.",
         src=DOC + "api-reference/market/get-market-candlesticks", repo=REPO + "docs/api-verification.md"),
    dict(id="F-04", sev="Medium", title="Fee formula not verified (B-13)",
         detail="Field names are confirmed. Any edge or fee-adjusted figure needs the fee schedule read and cited line by line.",
         src="https://kalshi.com/docs/kalshi-fee-schedule.pdf", repo=REPO + "exec-desk/flagged.html"),
    dict(id="F-05", sev="Medium", title="Resolved-market coverage limited by the historical cutoff (B-12)",
         detail="Official text says settled markets before the historical cutoff are not included in nested event results. The cutoff date was not found in the text read. Resolution tracking built on nested markets may miss older results.",
         src=DOC + "api-reference/events/get-events", repo=REPO + "exec-desk/js/markets.js#L50"),
    dict(id="F-06", sev="Info", title="Per-user WebSocket hosts for fill and order updates are not used (A-03)",
         detail="Portfolio and trade tracking will need the user-ws host for fill and user_orders updates. The old warp-ws hosts are deprecated (official text). No repo file references either.",
         src=DOC + "getting_started/api_environments", repo=REPO + "docs/api-verification.md"),
    dict(id="F-07", sev="Low", title="Official docs disagree on the case of the market-closed error code (D-01)",
         detail="Confirm the exact code from a live response before any code depends on it.",
         src=DOC + "getting_started/order_errors", repo=REPO + "verified-desk/portfolio.html#L94"),
]


def esc(s):
    return s  # strings above already contain intended inline markup


def row_html(r):
    label, cls = RESULT[r["res"]]
    repo = r["repo"]
    return (
        f"<tr>"
        f"<td class='id'>{html.escape(r['id'])}</td>"
        f"<td>{html.escape(r['claim'])}</td>"
        f"<td class='repo'>{html.escape(repo)}</td>"
        f"<td><a href='{html.escape(r['src'])}' rel='noopener' target='_blank'>official page</a></td>"
        f"<td class='says'>{r['says']}</td>"
        f"<td><span class='pill {cls}'>{label}</span></td>"
        f"</tr>"
    )


FLAGGED_PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flagged for Review — Kalshi API audit</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <nav><a href="../index.html">← Hub</a><a href="index.html">Audit</a><a href="#flagged-list">Items</a></nav>
  <h1>Flagged for Review</h1>
  <p>Not blocking. {count} items from the official-source audit (session ca4f2da1). Request changes after the site is live.</p>
</header>
<main>
  <section id="flagged-list"><h2>Items</h2>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>Severity</th><th>Issue</th><th>Links</th></tr></thead>
    <tbody>{rows}</tbody></table></div>
  </section>
  <footer>Generated by <code>audit/build_audit.py</code>. Coordination record: <code>COORDINATION.md</code>, section “arena/ca4f2da1-demo1”.</footer>
</main>
</body>
</html>
"""


def build():
    counts = {k: 0 for k in RESULT}
    total = 0
    for s in SECTIONS:
        for r in s["rows"]:
            counts[r["res"]] += 1
            total += 1

    sections_html = []
    for s in SECTIONS:
        body = "\n".join(row_html(r) for r in s["rows"])
        sections_html.append(
            f"<section id='sec-{s['id']}'><h2>{html.escape(s['title'])}</h2>"
            f"<div class='tablewrap'><table><thead><tr>"
            f"<th>ID</th><th>Claim checked</th><th>Where the repo uses it</th><th>Official source</th>"
            f"<th>What the official page says (quoted)</th><th>Result</th>"
            f"</tr></thead><tbody>\n{body}\n</tbody></table></div></section>"
        )

    flag_rows = []
    for f in FLAGS:
        flag_rows.append(
            f"<tr><td class='id'>{f['id']}</td><td>{html.escape(f['sev'])}</td>"
            f"<td><strong>{html.escape(f['title'])}</strong><br>{html.escape(f['detail'])}</td>"
            f"<td><a href='{html.escape(f['src'])}' target='_blank' rel='noopener'>official source</a><br>"
            f"<a href='{html.escape(f['repo'])}' target='_blank' rel='noopener'>repo location</a></td></tr>"
        )

    cards = "".join(
        f"<div class='card {RESULT[k][1]}'><span class='n'>{counts[k]}</span><span class='l'>{RESULT[k][0]}</span></div>"
        for k in ("ok", "bad", "unv", "new")
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Official-source audit of Kalshi API claims</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <nav><a href="../index.html">← Hub</a><a href="#sec-A">Environments</a><a href="#sec-B">Endpoints</a><a href="#sec-C">Repo code</a><a href="#sec-D">Doc gaps</a><a href="#flagged">Flagged for Review</a></nav>
  <h1>Official-source audit of Kalshi API claims in this repo</h1>
  <p>Checked 2026-11-20 by session <code>ca4f2da1</code> (branch <code>arena/ca4f2da1-demo1</code>). Every row links to the official page it was checked against. <strong>Corrections 2026-11-20 (session <code>arena/b62e8188-demo1</code>):</strong> rows B-02 and B-06 were re-verified against the full official pages and moved to Confirmed (the original audit had read partial chunks); flags F-02 and F-03 are withdrawn accordingly, and F-01 is marked fixed (CR-1 applied in <code>strategy-desk/assets/app.js</code>).</p>
</header>
<main>
  <div class="cards">{cards}</div>
  <div class="method">
    <strong>Method and limits</strong>
    <ul>
      <li>{total} rows. Each quotes the official text read on 2026-11-20. Pages were read through the page-fetch tool because the sandbox shell cannot reach kalshi.co.</li>
      <li>Long pages were read in their first chunks only. Where a claim sits in an unread chunk, the row says so and is marked <em>Unverified</em>. Nothing is filled in by inference.</li>
      <li>Not covered: live numbers, WebSocket message formats, portfolio and order writes (no demo key exists), the fee formula, and the browser behaviour of the sites.</li>
      <li>Repo rows link to the file and line numbers on <code>main</code> for manual review.</li>
    </ul>
  </div>
  {''.join(sections_html)}
  <section id="flagged"><h2>Flagged for Review</h2><p><a href="flagged.html">Open the Flagged for Review page ({len(FLAGS)} items)</a> — each item links its official source and repo location.</p></section>
  <footer>Generated by <code>audit/build_audit.py</code>. Coordination record: <code>COORDINATION.md</code>, section “arena/ca4f2da1-demo1”.</footer>
</main>
</body>
</html>
"""
    out = pathlib.Path(__file__).resolve().parent / "index.html"
    out.write_text(page, encoding="utf-8")
    flagged = FLAGGED_PAGE_TEMPLATE.format(
        rows="".join(flag_rows), count=len(FLAGS))
    (pathlib.Path(__file__).resolve().parent / "flagged.html").write_text(flagged, encoding="utf-8")
    return counts, total


if __name__ == "__main__":
    counts, total = build()
    print("rows:", total, counts)
