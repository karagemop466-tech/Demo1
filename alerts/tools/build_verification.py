#!/usr/bin/env python3
"""Generate alerts/verification.html — the line-by-line verification record.

The page lists every check that was run against the committed feed, the
official documentation each check was read from, and the result. It is
regenerated from the test suite, so the page cannot drift away from the code:

    python3 alerts/tools/build_verification.py
"""

from __future__ import annotations

import datetime as dt
import io
import json
import os
import sys
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import test_alerts  # noqa: E402

DOCS = {
    "demo_env": "https://docs.kalshi.com/getting_started/demo_env",
    "api_environments": "https://docs.kalshi.com/getting_started/api_environments",
    "market_lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
    "market_settlement": "https://docs.kalshi.com/getting_started/market_settlement",
    "orderbook_responses": "https://docs.kalshi.com/getting_started/orderbook_responses",
    "candlesticks": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    "orderbook": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    "markets": "https://docs.kalshi.com/api-reference/market/get-markets",
    "trades": "https://docs.kalshi.com/api-reference/market/get-trades",
    "fees": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
}

# Which official page each automated check leans on.
CHECK_SOURCES = {
    "test_base_url_is_the_documented_demo_endpoint": ["demo_env", "api_environments"],
    "test_every_alert_row_points_at_the_request_that_produced_it": ["candlesticks"],
    "test_every_alert_row_is_present_in_the_scanner_output": ["candlesticks"],
    "test_every_alert_meets_the_threshold": ["candlesticks"],
    "test_delta_equals_to_minus_from": ["candlesticks"],
    "test_no_alert_uses_a_window_outside_the_published_set": ["candlesticks"],
    "test_coverage_counts_match_the_arrays": ["candlesticks"],
    "test_markets_without_an_alert_are_real_markets_with_candles": ["markets"],
    "test_shortlist_covers_one_candidate_per_alerting_market": ["candlesticks"],
    "test_weights_sum_to_one": ["fees"],
    "test_scores_are_recomputable_from_the_published_components": ["fees"],
    "test_shortlist_is_sorted_by_score": ["fees"],
    "test_move_component_matches_the_published_move": ["candlesticks"],
    "test_recency_component_matches_the_published_formula": ["candlesticks"],
    "test_horizon_component_matches_close_time": ["markets"],
    "test_implied_ask_is_one_minus_the_best_no_bid": ["orderbook_responses"],
    "test_depth_component_only_counts_levels_within_the_band": ["orderbook_responses", "orderbook"],
    "test_fee_component_uses_the_published_formula": ["fees"],
    "test_published_fee_table_is_reproduced": ["fees"],
    "test_zero_fee_series_are_the_published_zero_multiplier_series": ["fees"],
    "test_resolution_fields_come_from_the_official_records": ["market_lifecycle", "market_settlement"],
    "test_feed_is_reproducible_from_the_committed_inputs": ["candlesticks"],
    "test_scan_list_bases_are_the_last_official_candle": ["candlesticks"],
}

CLAIMS = [
    ("The demo REST base used by this page is the one Kalshi recommends for the demo environment.",
     "The demo table names <code>https://external-api.demo.kalshi.co/trade-api/v2</code> as the recommended demo "
     "REST root and <code>https://demo-api.kalshi.co/trade-api/v2</code> as also supported.",
     "demo_env"),
    ("A WebSocket surface exists for the demo environment.",
     "The same table lists <code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code> and "
     "<code>wss://demo-api.kalshi.co/trade-api/ws/v2</code>. This page does not use it: the WebSocket handshake "
     "needs a signed session and no key is available here.",
     "demo_env"),
    ("Candles are published at 1, 60 and 1440 minutes only, so no seconds-resolution series exists on the REST API.",
     "The candlestick reference lists <code>period_interval</code> valid values 1, 60, 1440 and rejects anything "
     "else. A seconds view therefore has to be built from client polling and must be labelled as such.",
     "candlesticks"),
    ("A move is measured between two adjacent official candles, and the request that produced them is published.",
     "Each alert row carries the exact <code>GET /series/{series}/markets/{ticker}/candlesticks</code> request, "
     "including <code>start_ts</code>, <code>end_ts</code> and <code>period_interval</code>.",
     "candlesticks"),
    ("The order book publishes bids only; a YES ask is <code>1 − best NO bid</code>.",
     "The order-book guide states the reciprocal relationship and gives the spread calculation. The implied ask "
     "used in the depth component follows that rule and is re-checked in the test suite.",
     "orderbook_responses"),
    ("Order-book levels are <code>[price_dollars, count_fp]</code> pairs, sorted ascending, best bid last.",
     "The response structure section of the order-book guide.",
     "orderbook_responses"),
    ("“Traded dollars” is not an exchange field; it has to be computed from public trades.",
     "The trades endpoint returns <code>yes_price_dollars</code> and <code>count_fp</code> per trade. The desk sums "
     "<code>price × contracts</code> and labels the result as a computed measure.",
     "trades"),
    ("A market result is <code>yes</code>, <code>no</code> or <code>scalar</code>, and the shortlist shows all three cases honestly.",
     "The lifecycle page states that after determination the result is set to yes, no or scalar, and lists the "
     "statuses used in this feed.",
     "market_lifecycle"),
    ("Settlement pays $1 per contract to the winning side.",
     "The settlement page: yes-contract holders receive $1 per contract, no-contract holders $1 per contract. "
     "Settlement fees are zero for simple yes/no determinations.",
     "market_settlement"),
    ("The taker fee is <code>round up(M × 0.07 × C × P × (1−P))</code> and the maker fee is <code>round up(M × 0.0175 × C × P × (1−P))</code>.",
     "The published fee schedule, last updated and effective 7 July 2026. The 21-row general fee table is asserted "
     "in the test suite.",
     "fees"),
    ("The demo environment uses mock funds and its prices may not reflect real markets.",
     "The demo-environment page states this directly; the page repeats the warning in its banner and footer.",
     "demo_env"),
]

IRREGULARITIES = [
    ("AL-01", "The fee schedule's prose and its own table disagree on rounding",
     "The PDF says the fee is rounded up “to a centicent”, but its 21-row table only reproduces when the total is "
     "rounded up to a whole cent. The desk uses the table's rule (whole cent) because that is what the published "
     "numbers show, and publishes the discrepancy rather than choosing silently.",
     "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
     "Ask Kalshi support to confirm; the difference is sub-cent per order."),
    ("AL-02", "Multipliers were transcribed for the series this feed uses only",
     "The published non-standard fee table is long and its PDF text extraction is partly garbled. Only KXAAAGASM (1) "
     "and KXBTCY (0) were transcribed, because KXBTCY is the only non-default series in this feed. Any other series "
     "falls back to the document's default M = 1, which is an assumption rather than a verified value.",
     "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
     "Transcribe the full table once it is available in a machine-readable form."),
    ("AL-03", "Candle coverage is 10 markets, not the whole five-topic universe",
     "The committed snapshot holds official candles for 10 markets (the top market of each topic plus a few "
     "comparators). Every alert on this page comes from those 10 markets. The live poller scans the same list, so a "
     "wide swing in a market outside the list will not appear here.",
     "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
     "Widen the collector's candle coverage, or scan the top markets by traded notional on every poll."),
    ("AL-04", "Two of the ten candle markets produced no alert at all",
     "The two golf markets never moved by $0.10 or more between adjacent candles in the scanned windows. They are "
     "listed explicitly on the page rather than silently omitted.",
     "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
     "Nothing to fix — a quiet market is a legitimate result."),
    ("AL-05", "The model score is a ranking, not a probability",
     "The QLM score uses only official API fields, but it cannot estimate the chance that an event resolves YES, "
     "because no official field carries a probability. It is published with its weights and its limits so a reader "
     "can disagree with it explicitly.",
     "https://docs.kalshi.com/getting_started/market_settlement",
     "Compare the score against realised settlement results once enough markets have resolved."),
    ("AL-06", "Live polling could not be exercised from the build sandbox",
     "This sandbox has no route to *.kalshi.co, so the live poller's behaviour against the real API was verified "
     "by unit test and by code review only. The page shows the exact request it tried and keeps working from the "
     "committed feed when a request fails.",
     "https://docs.kalshi.com/getting_started/api_environments",
     "Open the published page from a normal network to see the live path run."),
    ("AL-07", "The model score normalises depth and notional against the other candidates in the same snapshot",
     "Those two components are therefore relative, not absolute: the same market can score differently in a "
     "different snapshot. The absolute values are shown next to every score so the reader can see the inputs.",
     "https://docs.kalshi.com/api-reference/market/get-trades",
     "Fix the scale to a published constant once the feed covers enough markets."),
]


def run_checks():
    """Run the feed test suite and return (test names, {name: FAIL})."""
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(test_alerts.FeedTests)
    names = [t.id().split(".")[-1] for t in suite]
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=0).run(suite)
    statuses = {}
    for test, _ in list(result.errors) + list(result.failures):
        statuses[test.id().split(".")[-1]] = "FAIL"
    return names, statuses


def esc(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def main():
    names, statuses = run_checks()
    total = len(names)
    failed = len(statuses)

    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    rows_html = []
    for name in names:
        state = statuses.get(name, "PASS")
        srcs = CHECK_SOURCES.get(name, [])
        links = " ".join(
            '<a class="src" href="%s" target="_blank" rel="noopener">↗ %s</a>' % (DOCS[s], s)
            for s in srcs) or "—"
        rows_html.append(
            "<tr><td class='mono'>%s</td><td><span class='badge %s'>%s</span></td><td>%s</td></tr>"
            % (esc(name), "bad" if state == "FAIL" else "ok", state, links))

    claims_html = []
    for claim, evidence, src in CLAIMS:
        claims_html.append(
            "<tr><td>%s</td><td>%s</td><td><a class='src' href='%s' target='_blank' rel='noopener'>↗ %s</a></td></tr>"
            % (claim, evidence, DOCS[src], src))

    irr_html = []
    for code, title, detail, src, action in IRREGULARITIES:
        irr_html.append(
            "<tr id='%s'><td class='mono'>%s</td><td><b>%s</b></td><td>%s</td>"
            "<td><a class='src' href='%s' target='_blank' rel='noopener'>↗ source</a></td><td>%s</td></tr>"
            % (code.lower(), code, esc(title), detail, src, esc(action)))

    html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Line-by-line verification · Kalshi Demo Alerts</title>
<meta name="description" content="Every claim and every number on the live alert chat page, checked against the official Kalshi documentation and the committed official responses.">
<link rel="stylesheet" href="assets/alerts.css">
</head>
<body>
<header class="top"><div class="wrap bar">
  <a class="brand" href="index.html"><span class="mark">K</span> Kalshi <b>Demo</b> · Alerts</a>
  <nav class="main" aria-label="Main navigation">
    <a href="index.html">Alert chat</a>
    <a href="verification.html" aria-current="page">Verification</a>
    <a href="../index.html">Home</a>
    <a href="../integration/flagged-review.html">Flagged for review</a>
  </nav>
</div></header>
<main class="wrap">
  <section class="head">
    <p class="kicker">Generated %s by alerts/tools/build_verification.py</p>
    <h1>Line-by-line verification</h1>
    <p class="lead">This page is regenerated from the test suite, so it cannot drift away from the code. Every
      automated check below was executed against the committed official responses; every written claim was re-read
      from the official documentation page it links to.</p>
    <div class="banner ok"><b>%d of %d automated checks pass.</b> Regenerate with
      <code>python3 alerts/tools/build_verification.py</code>; the test suite is
      <code>python3 alerts/tools/test_alerts.py</code>.</div>
  </section>

  <section>
    <h2>Automated checks</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Check</th><th>Result</th><th>Official documentation read</th></tr></thead>
      <tbody>%s</tbody>
    </table></div>
  </section>

  <section>
    <h2>Written claims, re-read from the official documentation</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Claim made on the page</th><th>What the official source says</th><th>Source</th></tr></thead>
      <tbody>%s</tbody>
    </table></div>
  </section>

  <section>
    <h2>Irregularities found while verifying</h2>
    <p class="fine">None of these block the page. Each one is published so a reviewer can settle it.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>ID</th><th>Finding</th><th>Detail</th><th>Source</th><th>How to settle it</th></tr></thead>
      <tbody>%s</tbody>
    </table></div>
  </section>

  <section>
    <h2>What could not be verified here</h2>
    <ul class="plain">
      <li><b>Live API calls from the build sandbox.</b> This environment has no route to <code>*.kalshi.co</code>,
        so the live poller's behaviour against the real API was checked by unit test and code review, not by a
        live request. The page shows the request it tried and falls back to the committed feed.</li>
      <li><b>Account data.</b> No Kalshi demo API key exists in this project, so balance, positions and fills are
        blank everywhere and no order was ever sent. Reading them needs a signed request, which needs a key:
        <a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noopener">API-key guidance ↗</a>.</li>
      <li><b>Realised ROI.</b> The score in the model card is a ranking. Realised ROI needs settled markets, which
        the demo exchange produces over weeks; the simulation ledger pages track that separately.</li>
    </ul>
  </section>
</main>
<footer class="foot"><div class="wrap">
  <p class="fine">Generated %s · <a href="index.html">alert chat</a> ·
    <a href="../integration/flagged-review.html">Flagged for review</a> ·
    <a href="README.md">build notes</a></p>
</div></footer>
</body>
</html>
""" % (now, total - failed, total, "\n".join(rows_html), "\n".join(claims_html),
       "\n".join(irr_html), now)

    out = os.path.join(REPO, "alerts", "verification.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote %s (%d checks, %d failing)" % (out, total, failed))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
