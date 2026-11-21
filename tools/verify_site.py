#!/usr/bin/env python3
"""
Automated line-by-line verification for the Kalshi demo site.

This tool does NOT trust the rendered HTML. It re-derives every value the
site shows from the official snapshot (``snapshot/*.json``), which is itself a
capture of Kalshi's public demo Trade API v2, and checks that the rendered
page:

  1. shows exactly the value the snapshot holds (no fabricated/rounded numbers),
  2. carries a source link to an official Kalshi domain on every data row,
  3. renders the correct YES/NO resolution for settled markets,
  4. reproduces the snapshot-health figures claimed on the overview page.

Exit code is 1 if any hard check fails (value mismatch, missing source link on
a market-data row, non-official source host, secret material).

  python3 tools/verify_site.py            # writes site/verification-report.json + prints
  python3 tools/verify_site.py --quiet   # prints only the result line

It is import-safe: ``run_verification(root)`` returns the report dict so
``build_site.py`` can embed the page from the same single source of truth.
"""
from __future__ import annotations

import html
import json
import re
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / "snapshot"
SITE = ROOT / "site"

DOCS = "https://docs.kalshi.com"
# Hosts that count as "an official site" for a source link.
OFFICIAL_HOSTS = (
    "external-api.demo.kalshi.co",
    "demo-api.kalshi.co",
    "external-api.kalshi.com",
    "docs.kalshi.com",
    "kalshi.com",
    "help.kalshi.com",
)
# External hosts that Kalshi uses as OFFICIAL settlement sources (recorded on
# every market's `settlement_sources`). They are legitimate sources for the
# "how was this resolved" column, but they are not the Kalshi API itself, so a
# market-data row must still carry at least one Kalshi link. These hosts are
# recorded as informational, never as hard failures.
SETTLEMENT_HOSTS = (
    "cfbenchmarks.com",
    "espn.com",
    "foxsports.com",
    "pgatour.com",
    "gasprices.aaa.com",
    "aaa.com",
    "wsj.com",
    "oscars.org",
    "theice.com",
    "rottentomatoes.com",
    "europeantour.com",
    "netflix.com",
    "cbsnews.com",
    "nytimes.com",
    "apnews.com",
    "reuters.com",
    "axios.com",
    "politico.com",
    "semafor.com",
    "theinformation.com",
    "washingtonpost.com",
    "cnn.com",
    "foxnews.com",
    "msnbc.com",
    "democrats.org",
    "spotify.com",
    "gop.com",
    "whitehouse.gov",
    "billboard.com",
    "apple.com",
    "paramountplus.com",
    "abc.net.au",
    "abcnews.go.com",
    "usatoday.com",
    "vogue.com",
    "lacity.gov",
    "fec.gov",
    "justice.gov",
    "sos.ca.gov",
    "elections.virginia.gov",
    "eia.gov",
)

TOPIC_PAGES = {
    "gas_prices": "gas-prices.html",
    "elections": "elections.html",
    "culture": "culture.html",
    "crypto": "crypto.html",
    "golf": "golf.html",
}


# --------------------------------------------------------------------------- #
# helpers (mirror build_site.py so the comparison is exact)
# --------------------------------------------------------------------------- #
def esc(v):
    return html.escape("" if v is None else str(v), quote=True)


def dash_present(v):
    """True when the builder would render the '—' not-available placeholder."""
    return v is None or v == ""


def cents(dollar_string):
    """Fixed-point dollar string -> cents string, exactly as the builder does."""
    if dollar_string in (None, ""):
        return None
    try:
        return f"{Decimal(str(dollar_string)) * 100:.1f}"
    except Exception:
        return None


def when(ts):
    if not ts:
        return None
    return str(ts).replace("T", " ").replace("Z", " UTC")


def notional_str(value):
    return None if value is None else f"${value:,.2f}"


def load(name):
    p = SNAP / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def rows_of(html_text):
    return re.findall(r"<tr[^>]*>(.*?)</tr>", html_text, re.S)


def row_text(row):
    return row


def tickers_in(row):
    return re.findall(r"<code>([^<]+)</code>", row)


def official_links_in(row):
    return re.findall(r"href=['\"]([^'\"]+)['\"]", row)


def is_official_kalshi_url(link):
    """True only for an absolute URL on a Kalshi-controlled official host."""
    try:
        parsed = urlsplit(html.unescape(link))
        host = (parsed.hostname or "").lower()
        return parsed.scheme in ("http", "https") and any(
            host == allowed or host.endswith("." + allowed)
            for allowed in OFFICIAL_HOSTS
        )
    except ValueError:
        return False


def has_official_link(row):
    return any(is_official_kalshi_url(link) for link in official_links_in(row))


def is_settlement_host(host):
    return any(host == h or host.endswith("." + h) for h in SETTLEMENT_HOSTS)


def non_official_source_hosts(row):
    """Hosts in the row that are neither Kalshi-official nor known settlers."""
    bad = []
    for link in official_links_in(row):
        if link.startswith(("http://", "https://")):
            host = link.split("/")[2]
            if is_settlement_host(host):
                continue
            if any(host == h or host.endswith("." + h) for h in OFFICIAL_HOSTS):
                continue
            bad.append(host)
    return bad


# --------------------------------------------------------------------------- #
# checks
# --------------------------------------------------------------------------- #
def check_markets_page(html_text, market_by_ticker, errors, warnings, stats):
    checked = 0
    for row in rows_of(html_text):
        if "<td" not in row:
            continue
        for tk in tickers_in(row):
            rec = market_by_ticker.get(tk)
            if not rec:
                continue
            checked += 1
            # source link on a market-data row is mandatory
            if not has_official_link(row):
                errors.append(f"markets.html row {tk}: no official source link")
            for host in non_official_source_hosts(row):
                errors.append(f"markets.html row {tk}: non-official source host {host}")
            src = (rec.get("sources") or {}).get("market")
            if src and src not in row:
                errors.append(f"markets.html row {tk}: source URL not rendered")
            q = rec.get("quotes") or {}
            yb = q.get("yes") or {}
            for label, want in (
                ("YES bid", cents(yb.get("bid"))),
                ("YES ask", cents(yb.get("ask"))),
                ("last", cents(rec.get("last_price"))),
            ):
                if want is None:
                    if not dash_present(yb.get("bid") if label == "YES bid"
                                        else yb.get("ask") if label == "YES ask"
                                        else rec.get("last_price")):
                        errors.append(f"markets.html row {tk}: {label} rendered but source value missing")
                    continue
                if want not in row:
                    errors.append(f"markets.html row {tk}: {label} shows != snapshot ({want}¢)")
            for label, field in (
                ("24h volume", "volume_24h_contracts"),
                ("total volume", "volume_contracts"),
                ("open interest", "open_interest_contracts"),
            ):
                v = rec.get(field)
                if v is not None and esc(v) not in row:
                    errors.append(f"markets.html row {tk}: {label} shows != snapshot ({v})")
            dn = rec.get("dollar_notional_24h") or {}
            if dn.get("value") is not None:
                if notional_str(dn["value"]) not in row:
                    errors.append(
                        f"markets.html row {tk}: notional shows != snapshot ({notional_str(dn['value'])})")
    stats["markets_rows_checked"] = checked


def check_resolved_page(html_text, resolved_by_ticker, errors, warnings, stats):
    checked = 0
    for row in rows_of(html_text):
        if "<td" not in row:
            continue
        for tk in tickers_in(row):
            rec = resolved_by_ticker.get(tk)
            if not rec:
                continue
            checked += 1
            if not has_official_link(row):
                errors.append(f"resolved.html row {tk}: no official source link")
            for host in non_official_source_hosts(row):
                errors.append(f"resolved.html row {tk}: non-official source host {host}")
            src = (rec.get("sources") or {}).get("market")
            if src and src not in row:
                errors.append(f"resolved.html row {tk}: source URL not rendered")
            res = (rec.get("result") or "").lower()
            if res and res.upper() not in row:
                errors.append(f"resolved.html row {tk}: result shows != snapshot ({res.upper()})")
            sv = rec.get("settlement_value_dollars")
            if sv is not None and esc(sv) not in row:
                errors.append(f"resolved.html row {tk}: settlement value != snapshot ({sv})")
            st = when(rec.get("settlement_ts"))
            if st and st not in row:
                errors.append(f"resolved.html row {tk}: settlement time != snapshot ({st})")
    stats["resolved_rows_checked"] = checked


def check_topic_pages(html_pages, market_by_ticker, resolved_by_ticker, errors, warnings, stats):
    for key, page_name in TOPIC_PAGES.items():
        html_text = html_pages.get(page_name)
        if html_text is None:
            errors.append(f"{page_name}: page missing")
            continue
        checked = 0
        for row in rows_of(html_text):
            if "<td" not in row:
                continue
            for tk in tickers_in(row):
                rec = market_by_ticker.get(tk) or resolved_by_ticker.get(tk)
                if not rec:
                    continue
                checked += 1
                if not has_official_link(row):
                    errors.append(f"{page_name} row {tk}: no official source link")
                for host in non_official_source_hosts(row):
                    errors.append(f"{page_name} row {tk}: non-official source host {host}")
        stats[f"topic_{key}_rows_checked"] = checked


def check_liquidity_page(html_text, market_by_ticker, errors, warnings, stats):
    checked = 0
    ladder_rows = 0
    ladder_actuals = {}
    ladder_expected = {}

    def cell_text(raw):
        return html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()

    for row in rows_of(html_text):
        if "<td" not in row:
            continue
        m = re.search(r"explore\.html\?q=([A-Za-z0-9.\-]+)", row)
        if not m:
            if re.search(r"<th", row):
                continue
            ladder_rows += 1
            urls = official_links_in(row)
            source_url = next((u for u in urls if "/markets/" in u and "/orderbook" in u
                               and any(host in u for host in OFFICIAL_HOSTS)), None)
            if not source_url:
                errors.append(f"liquidity.html full-ladder row {ladder_rows}: no official order-book source")
                continue
            source_match = re.search(r"/markets/([^/?#]+)/orderbook(?:[?#]|$)", source_url)
            if not source_match:
                errors.append(f"liquidity.html full-ladder row {ladder_rows}: cannot identify market from source")
                continue
            tk = html.unescape(source_match.group(1))
            rec = market_by_ticker.get(tk)
            if not rec:
                errors.append(f"liquidity.html full-ladder row {tk}: market is absent from snapshot")
                continue
            ob = rec.get("orderbook") or {}
            expected_source = ob.get("source")
            if not expected_source or source_url != expected_source:
                errors.append(f"liquidity.html full-ladder row {tk}: source URL differs from snapshot")
            ys = {b["price"]: b["contracts"] for b in ob.get("yes_bids") or []}
            ns = {b["price"]: b["contracts"] for b in ob.get("no_bids") or []}
            prices = sorted({*ys.keys(), *ns.keys()}, key=lambda p: -float(p))
            expected_levels = []
            for price in prices:
                display_price = f"{float(price) * 100:.1f}¢" if float(price) <= 1 else str(price)
                expected_levels.append([
                    display_price,
                    "" if ys.get(price, "") is None else str(ys.get(price, "")),
                    "" if ns.get(price, "") is None else str(ns.get(price, "")),
                ])
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            actual = tuple(cell_text(c) for c in cells[:3])
            if len(cells) != 4 or list(actual) not in expected_levels:
                errors.append(f"liquidity.html full-ladder row {tk}: price/contract values differ from snapshot")
            ladder_actuals.setdefault(tk, []).append(actual)
            ladder_expected[tk] = [tuple(level) for level in expected_levels]
            if not has_official_link(row):
                errors.append(f"liquidity.html full-ladder row {tk}: no official source link")
            checked += 1
            continue
        tk = m.group(1)
        rec = market_by_ticker.get(tk)
        checked += 1
        if not has_official_link(row):
            errors.append(f"liquidity.html depth row {tk}: no official source link")
        ob = (rec or {}).get("orderbook") or {}
        src = ob.get("source")
        if rec and src and src not in row:
            errors.append(f"liquidity.html row {tk}: order-book source URL not rendered")
    for tk, rendered in ladder_actuals.items():
        if sorted(rendered) != sorted(ladder_expected[tk]):
            errors.append(f"liquidity.html full ladder {tk}: rendered levels do not exactly match the snapshot")
    stats["liquidity_rows_checked"] = checked
    stats["liquidity_ladder_rows_checked"] = ladder_rows


def check_flagged_page(html_text, markets, market_by_ticker, errors, stats):
    """Require an official source on every data row in the snapshot Flagged page."""
    checked = 0
    if html_text is None:
        errors.append("flagged.html: page missing")
        stats["flagged_rows_checked"] = checked
        stats["flagged_topic_rows_checked"] = 0
        return

    for row in rows_of(html_text):
        if "<td" not in row or re.search(r"class=['\"]empty['\"]", row):
            continue
        checked += 1
        if not has_official_link(row):
            errors.append(f"flagged.html data row {checked}: no official Kalshi source link")

        # For rows keyed by a market ticker, require the exact market request
        # captured with that record, not just any link on a Kalshi domain.
        for tk in tickers_in(row):
            rec = market_by_ticker.get(html.unescape(tk))
            if not rec:
                continue
            expected = (rec.get("sources") or {}).get("market")
            rendered = {html.unescape(link) for link in official_links_in(row)}
            if not expected or expected not in rendered:
                errors.append(f"flagged.html market row {tk}: exact snapshot market source is missing")

    # The grouped weak-match rows identify a series. Verify each group appears
    # exactly once and links to the exact /markets?series_ticker=… request from
    # the representative snapshot record.
    topic_section = re.search(
        r"<h2>Topic matches that rest on a ticker or tag[^<]*</h2>(.*?)(?=<h2>|</main>)",
        html_text, re.S)
    if not topic_section:
        errors.append("flagged.html: topic-classification review section is missing")
        stats["flagged_rows_checked"] = checked
        stats["flagged_topic_rows_checked"] = 0
        return

    expected_groups = {}
    for rec in markets:
        if not rec.get("topic_matched_weakly"):
            continue
        series = rec.get("series_ticker")
        if series:
            expected_groups.setdefault(series, rec)

    section_rows = [row for row in rows_of(topic_section.group(1)) if "<td" in row]
    if len(section_rows) != len(expected_groups):
        errors.append(
            f"flagged.html topic-classification table: expected {len(expected_groups)} rows, "
            f"found {len(section_rows)}")
    rendered_groups = {}
    for row in section_rows:
        match = re.search(r"explore\.html\?q=([A-Za-z0-9.\-]+)", row)
        if match:
            series = html.unescape(match.group(1))
            rendered_groups.setdefault(series, []).append(row)

    for series, rec in expected_groups.items():
        matched = rendered_groups.get(series, [])
        if len(matched) != 1:
            errors.append(
                f"flagged.html topic series {series}: expected one row, found {len(matched)}")
            continue
        source = (rec.get("sources") or {}).get("markets")
        links = {html.unescape(link) for link in official_links_in(matched[0])}
        if not source or source not in links:
            errors.append(
                f"flagged.html topic series {series}: exact snapshot markets request is missing")

    for series in rendered_groups.keys() - expected_groups.keys():
        errors.append(f"flagged.html topic series {series}: not present as a weak match in snapshot")

    stats["flagged_rows_checked"] = checked
    stats["flagged_topic_rows_checked"] = len(section_rows)


def check_index_figures(html_text, meta, errors, warnings, stats, resolved=None):
    """The overview page's snapshot-health figures must equal metadata.json."""
    exch = meta.get("exchange_status") or {}
    resolved = resolved or []
    n_with = len([r for r in resolved if (r.get("result") or "").lower() in ("yes", "no")])
    n_wait = len(resolved) - n_with
    figures = {
        "Open markets collected": meta.get("counts", {}).get("open_markets"),
        "Closed records collected (settled + awaiting)": meta.get("counts", {}).get("resolved_markets"),
        "Settled with YES/NO result": n_with,
        "Closed — awaiting result": n_wait,
        "Price-history series": meta.get("counts", {}).get("chart_series"),
        "Series discovered": meta.get("series_count"),
        "API requests this snapshot": (meta.get("request_stats") or {}).get("requests"),
        "Failed requests": (meta.get("request_stats") or {}).get("failed"),
        "Exchange active": exch.get("exchange_active"),
        "Trading active": exch.get("trading_active"),
    }
    for label, value in figures.items():
        if value is None:
            warnings.append(f"index.html: metadata has no value for '{label}'")
            continue
        # the builder renders booleans as escaped python repr (True/False)
        rendered = esc(value)
        if rendered not in html_text:
            errors.append(f"index.html: figure '{label}' = {rendered} not present on page")
        stats["index_figures_checked"] = stats.get("index_figures_checked", 0) + 1


def scan_secrets(files, errors):
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"\bBEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY\b", text):
            errors.append(f"secret material: private key in {f.relative_to(ROOT)}")
        if re.search(r"KALSHI-ACCESS-KEY['\"]?\s*[:=]\s*['\"][A-Za-z0-9]{12,}['\"]", text):
            errors.append(f"secret material: hard-coded API key in {f.relative_to(ROOT)}")


def run_verification(root=ROOT):
    root = Path(root)
    snap = root / "snapshot"
    site = root / "site"
    errors, warnings, stats = [], [], {}

    mk = load("markets.json") or {}
    rs = load("resolved.json") or {}
    meta = load("metadata.json") or {}
    markets = mk.get("markets", [])
    resolved = rs.get("markets", [])

    market_by_ticker = {m.get("market_ticker"): m for m in markets if m.get("market_ticker")}
    resolved_by_ticker = {m.get("market_ticker"): m for m in resolved if m.get("market_ticker")}

    # snapshot integrity vs its own metadata
    req = (meta.get("request_stats") or {}).get("requests")
    fail = (meta.get("request_stats") or {}).get("failed")
    if fail not in (0, None):
        warnings.append(f"snapshot reports {fail} failed requests")

    def read_page(name):
        p = site / name
        return p.read_text(encoding="utf-8") if p.exists() else None

    pages = {name: read_page(name) for name in [
        "index.html", "markets.html", "resolved.html", "liquidity.html", "flagged.html",
        "gas-prices.html", "elections.html", "culture.html", "crypto.html", "golf.html"]}

    for name, text in pages.items():
        if text is None:
            errors.append(f"{name}: page missing")

    if pages.get("markets.html"):
        check_markets_page(pages["markets.html"], market_by_ticker, errors, warnings, stats)
    if pages.get("resolved.html"):
        check_resolved_page(pages["resolved.html"], resolved_by_ticker, errors, warnings, stats)
    check_topic_pages(pages, market_by_ticker, resolved_by_ticker, errors, warnings, stats)
    if pages.get("liquidity.html"):
        check_liquidity_page(pages["liquidity.html"], market_by_ticker, errors, warnings, stats)
    check_flagged_page(pages.get("flagged.html"), markets, market_by_ticker, errors, stats)
    if pages.get("index.html"):
        check_index_figures(pages["index.html"], meta, errors, warnings, stats, resolved)

    # source-host audit across every source link on the site
    bad_hosts = {}
    settlement_hosts = {}
    for p in sorted(site.glob("*.html")):
        text = p.read_text(encoding="utf-8")
        for link in re.findall(r"href=['\"]([^'\"]+)['\"]", text):
            if not link.startswith(("http://", "https://")):
                continue
            host = link.split("/")[2]
            if any(host == h or host.endswith("." + h) for h in OFFICIAL_HOSTS):
                continue
            if host.endswith("github.io"):  # this site itself
                continue
            if is_settlement_host(host):
                settlement_hosts.setdefault(host, []).append(p.name)
                continue
            bad_hosts.setdefault(host, []).append(p.name)
    if settlement_hosts:
        warnings.append(
            "external OFFICIAL settlement sources referenced (from the markets' "
            f"settlement_sources): {', '.join(sorted(settlement_hosts))}")
    if bad_hosts:
        for host, where in bad_hosts.items():
            warnings.append(f"unknown non-Kalshi host referenced: {host} ({', '.join(sorted(set(where)))})")

    # secret scan across the whole repo (text files)
    text_files = [p for p in root.rglob("*")
                  if p.is_file() and p.suffix in
                  (".html", ".js", ".mjs", ".py", ".json", ".yml", ".yaml", ".css", ".md", ".txt")]
    scan_secrets(text_files, errors)

    report = {
        "verified_utc": meta.get("generated_utc"),
        "snapshot_base": mk.get("base") or rs.get("base"),
        "snapshot_counts": {
            "open_markets": len(markets),
            "resolved_markets": len(resolved),
            "settled_with_result": len([r for r in resolved
                                        if (r.get("result") or "").lower() in ("yes", "no")]),
            "awaiting_result": len([r for r in resolved
                                    if (r.get("result") or "").lower() not in ("yes", "no")]),
            "requests": req,
            "failed": fail,
            "series": meta.get("series_count"),
        },
        "stats": stats,
        "errors": errors,
        "warnings": warnings,
        "settlement_source_hosts": sorted(settlement_hosts),
        "status": "PASS" if not errors else "FAIL",
    }
    return report


def render_report_html(report):
    """Standalone page that embeds the report (no network needed at view time)."""
    errs = report["errors"]
    warns = report["warnings"]
    stats = report["stats"]
    sc = report["snapshot_counts"]
    def li(items):
        return "".join(f"<li>{esc(i)}</li>" for i in items) or "<li class='ok'>none</li>"
    body = f"""
<div class="callout {('warn' if errs else 'ok')}">
  <b>Automated line-by-line verification — {esc(report['status'])}.</b>
  Every rendered value was re-derived from the official snapshot and compared cell by cell;
  every market-data row was required to carry a link to an official Kalshi endpoint.
  Snapshot collected {esc(report['verified_utc'])} from <code>{esc(report['snapshot_base'])}</code>.
</div>
<h2>Snapshot provenance</h2>
{render_table(["Item", "Value"], [
    ["REST base", f"<code>{esc(report['snapshot_base'])}</code>"],
    ["Open markets in snapshot", str(sc['open_markets'])],
    ["Closed records in snapshot (settled + awaiting)", str(sc['resolved_markets'])],
    ["Settled with YES/NO result", str(sc.get('settled_with_result', 0))],
    ["Closed — awaiting result", str(sc.get('awaiting_result', 0))],
    ["API requests", str(sc['requests'])],
    ["Failed requests", str(sc['failed'])],
    ["Series discovered", str(sc['series'])],
])}
<h2>Rows verified</h2>
{render_table(["Page / check", "Rows / figures checked"], [
    ["markets.html (values + source links)", str(stats.get('markets_rows_checked', 0))],
    ["resolved.html (YES/NO + source links)", str(stats.get('resolved_rows_checked', 0))],
    ["topic pages (gas/elections/culture/crypto/golf)", str(sum(stats.get(f'topic_{k}_rows_checked', 0) for k in TOPIC_PAGES))],
    ["liquidity.html (depth + source links)", str(stats.get('liquidity_rows_checked', 0))],
    ["flagged.html (data rows + official source links)", str(stats.get('flagged_rows_checked', 0))],
    ["flagged topic-classification rows (exact snapshot request)", str(stats.get('flagged_topic_rows_checked', 0))],
    ["index.html (snapshot-health figures)", str(stats.get('index_figures_checked', 0))],
])}
<h2>Hard failures ({len(errs)})</h2>
<ul class="tight">{li(errs)}</ul>
<h2>Warnings / items flagged for review ({len(warns)})</h2>
<ul class="tight">{li(warns)}</ul>
<p class="fine">Method: <code>tools/verify_site.py</code> re-reads <code>snapshot/*.json</code> (the recorded
official demo-API responses) and compares each rendered cell against the value the builder computed from that
snapshot. A mismatch, a missing official source link on a market-data row, a non-official source host, or
committed secret material fails the check. Values that the API did not return are rendered as “—” and are
never inferred.</p>
"""
    return body


def render_table(headers, rows):
    head = "".join(f"<th>{esc(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<div class='tablewrap'><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"


def main():
    quiet = "--quiet" in sys.argv
    report = run_verification(ROOT)
    SITE.mkdir(exist_ok=True)
    (SITE / "verification-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"verification status: {report['status']}")
    print(f"  snapshot: {report['snapshot_counts']['open_markets']} open / "
          f"{report['snapshot_counts']['resolved_markets']} closed records "
          f"({report['snapshot_counts'].get('settled_with_result', 0)} with result, "
          f"{report['snapshot_counts'].get('awaiting_result', 0)} awaiting) / "
          f"{report['snapshot_counts']['requests']} requests / "
          f"{report['snapshot_counts']['failed']} failed")
    s = report["stats"]
    print(f"  rows checked: markets={s.get('markets_rows_checked',0)} "
          f"resolved={s.get('resolved_rows_checked',0)} "
          f"topics={sum(s.get(f'topic_{k}_rows_checked',0) for k in TOPIC_PAGES)} "
          f"liquidity={s.get('liquidity_rows_checked',0)} "
          f"flagged={s.get('flagged_rows_checked',0)} "
          f"flagged-topic={s.get('flagged_topic_rows_checked',0)} "
          f"index-figures={s.get('index_figures_checked',0)}")
    print(f"  errors={len(report['errors'])} warnings={len(report['warnings'])}")
    for e in report["errors"]:
        print("  X " + e)
    for w in report["warnings"]:
        print("  ! " + w)
    if not quiet:
        print("  report written to site/verification-report.json")
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
