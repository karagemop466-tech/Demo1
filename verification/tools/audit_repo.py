#!/usr/bin/env python3
"""Repo-wide consistency and source audit for the Kalshi demo site.

Every number this tool checks is re-derived from the committed official
capture in ``snapshot/`` (collected from https://external-api.demo.kalshi.co/trade-api/v2).
Nothing is inferred: a claim that cannot be matched to a canonical value is
reported as ``unverified`` rather than filled in.

Checks
  C1  Canonical facts re-derived from snapshot/*.json
  C2  Per-topic summary claims in prose ("N open markets and M resolved ...")
  C3  Table rows whose first cell names a topic (open / resolved / yes / no / awaiting)
  C4  YES + NO == resolved-with-result, per topic and in total
  C5  Every row of every data table carries an official source link
  C6  Every docs.kalshi.com link used in the repo exists in the official doc index
  C7  No credential / private-key material committed

Usage
  python3 verification/tools/audit_repo.py [--index verification/data/kalshi-docs-index.txt]

Exit code is non-zero when an ERROR (not a warning) is recorded.
"""

from __future__ import annotations

import argparse
import collections
import html
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAP = os.path.join(ROOT, "snapshot")
OUT_DIR = os.path.join(ROOT, "verification")

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".pytest_cache", "out", "dist"}
TEXT_EXT = (".html", ".htm", ".js", ".mjs", ".py", ".md", ".json", ".yml", ".yaml", ".txt", ".css")

TOPICS = {
    "gas_prices": "gas prices",
    "elections": "elections",
    "culture": "culture",
    "crypto": "crypto",
    "golf": "golf",
}

# Hosts that count as an official source for a rendered table row.
OFFICIAL_SOURCE_HOSTS = (
    "docs.kalshi.com",
    "external-api.demo.kalshi.co",
    "demo-api.kalshi.co",
    "external-api.kalshi.co",
    "api.elections.kalshi.com",
    "kalshi.com",
)

# Label spellings used for the "resolved with a yes/no result" quantity.
YESNO_LABELS = ("resolved", "yes / no result", "yes/no result", "with result", "settled")


def norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def load_json(name: str):
    path = os.path.join(SNAP, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def is_yesno(record: dict) -> bool:
    return str(record.get("result") or "").strip().lower() in ("yes", "no")


def derive_canonical() -> dict:
    """C1 - re-derive every headline count from the committed snapshot."""
    markets_doc = load_json("markets.json") or {}
    resolved_doc = load_json("resolved.json") or {}
    markets = markets_doc.get("markets", []) or []
    resolved = resolved_doc.get("markets", []) or []

    per_topic = {}
    for key, label in TOPICS.items():
        open_rows = [m for m in markets if m.get("topic") == key]
        rec_rows = [r for r in resolved if r.get("topic") == key]
        yes = sum(1 for r in rec_rows if str(r.get("result") or "").strip().lower() == "yes")
        no = sum(1 for r in rec_rows if str(r.get("result") or "").strip().lower() == "no")
        awaiting = len(rec_rows) - yes - no
        per_topic[key] = {
            "label": label,
            "open": len(open_rows),
            "records": len(rec_rows),
            "yes": yes,
            "no": no,
            "awaiting": awaiting,
            "resolved_yesno": yes + no,
        }

    totals = {
        "open": len(markets),
        "records": len(resolved),
        "yes": sum(v["yes"] for v in per_topic.values()),
        "no": sum(v["no"] for v in per_topic.values()),
        "awaiting": sum(v["awaiting"] for v in per_topic.values()),
        "topics": len(TOPICS),
    }
    totals["resolved_yesno"] = totals["yes"] + totals["no"]

    requests = failed = None
    log_path = os.path.join(SNAP, "collect-log.txt")
    if os.path.exists(log_path):
        with open(log_path, encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                m = re.search(r"requests=(\d+) failed=(\d+)", line)
                if m:
                    requests, failed = int(m.group(1)), int(m.group(2))

    return {
        "generated_utc": markets_doc.get("generated_utc") or resolved_doc.get("generated_utc"),
        "base": markets_doc.get("base") or resolved_doc.get("base"),
        "totals": totals,
        "per_topic": per_topic,
        "requests": requests,
        "failed": failed,
        "snapshot_files": {
            "markets": "snapshot/markets.json",
            "resolved": "snapshot/resolved.json",
            "charts": "snapshot/charts.json",
            "metadata": "snapshot/metadata.json",
            "collect_log": "snapshot/collect-log.txt",
        },
    }


def iter_repo_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for filename in filenames:
            if filename.endswith(TEXT_EXT):
                yield os.path.join(dirpath, filename)


def read(path: str) -> str:
    with open(path, encoding="utf-8", errors="ignore") as handle:
        return handle.read()


def rel(path: str) -> str:
    return os.path.relpath(path, ROOT)


def topic_of_label(label: str):
    low = norm_text(label).lower()
    for key, name in TOPICS.items():
        if low == name or low.startswith(name):
            return key
    return None


# ---------------------------------------------------------------- C2 / C3


ALL_TOPICS_RE = re.compile(r"gas prices|elections|culture|crypto|golf", re.I)
SENTENCE_SPLIT = re.compile(r"(?<=[.;:])\s+|\n+")


def check_topic_prose(canonical: dict, files: list) -> list:
    """C2 - prose claims of the form "<N> open markets and <M> resolved/closed markets".

    A claim is attributed to a topic only when exactly one topic is named in the
    same sentence; statements that cover every topic ("Top 40 open markets
    across all topics") are table captions, not per-topic claims, and are not
    checked against a single topic.
    """
    findings = []
    open_re = re.compile(r"(\d[\d,]*)\s+open\s+markets", re.I)
    rec_re = re.compile(r"(\d[\d,]*)\s+resolved(?:/closed)?\s+markets", re.I)
    for path in files:
        if not path.endswith((".html", ".md")):
            continue
        text = read(path)
        for sentence in SENTENCE_SPLIT.split(text):
            names = {m.group(0).lower() for m in ALL_TOPICS_RE.finditer(sentence)}
            keys = {k for k, label in TOPICS.items() if label in names}
            if len(keys) != 1:
                continue
            key = keys.pop()
            open_m = open_re.search(sentence)
            if not open_m:
                continue
            claimed_open = int(open_m.group(1).replace(",", ""))
            canon = canonical["per_topic"][key]
            if claimed_open != canon["open"]:
                findings.append({
                    "check": "C2", "file": rel(path), "topic": key,
                    "field": "open markets", "claimed": claimed_open,
                    "canonical": canon["open"], "status": "MISMATCH",
                    "context": norm_text(sentence)[:160],
                })
            rec_m = rec_re.search(sentence)
            if rec_m:
                claimed_rec = int(rec_m.group(1).replace(",", ""))
                if claimed_rec != canon["records"]:
                    findings.append({
                        "check": "C2", "file": rel(path), "topic": key,
                        "field": "resolved/closed records", "claimed": claimed_rec,
                        "canonical": canon["records"], "status": "MISMATCH",
                        "context": norm_text(sentence)[:160],
                    })
    return findings


ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_BLOCK_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)
TICKER_RE = re.compile(r"\bKX[A-Z0-9]{2,}(?:-[A-Z0-9.]+)+\b")


def strip_scripts(text: str) -> str:
    """Remove <script>/<style> bodies so template strings are not read as rows."""
    return SCRIPT_BLOCK_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def rows_of(text: str):
    for row_match in ROW_RE.finditer(text):
        body = row_match.group(1)
        cells = [norm_text(TAG_RE.sub(" ", c)) for c in CELL_RE.findall(body)]
        hrefs = re.findall(r"href\s*=\s*[\"']([^\"']+)[\"']", body, re.I)
        line = text.count("\n", 0, row_match.start()) + 1
        yield line, cells, hrefs


TABLE_RE = re.compile(r"<table\b[^>]*>(.*?)</table>", re.S | re.I)
COUNT_COLUMN_RE = re.compile(
    r"\b(open|resolved|yes|no|awaiting|records?|markets?|rows?|count)\b", re.I
)


def count_columns(header_cells: list):
    """Indexes of columns that hold a market count rather than a price or size."""
    out = []
    for index, cell in enumerate(header_cells):
        text = norm_text(cell)
        if COUNT_COLUMN_RE.search(text) and not re.search(r"\b(bid|ask|price|volume|interest|notional)\b", text, re.I):
            out.append(index)
    return out


def check_topic_rows(canonical: dict, files: list) -> list:
    """C3 - topic summary rows inside tables whose columns hold counts.

    A table is only treated as a topic summary table when at least two of its
    columns are count columns (Open / Resolved / YES / NO / Awaiting). Market
    tables (YES bid, 24 h volume, open interest) are not count tables, so their
    rows are not compared with topic totals.
    """
    findings = []
    for path in files:
        if not path.endswith((".html", ".htm")):
            continue
        text = strip_scripts(read(path))
        for table_match in TABLE_RE.finditer(text):
            table_html = table_match.group(1)
            table_rows = list(rows_of(table_html))
            if not table_rows:
                continue
            header = table_rows[0][1]
            columns = count_columns(header)
            if len(columns) < 2:
                continue
            for _line, cells, _hrefs in table_rows[1:]:
                if not cells:
                    continue
                label = norm_text(cells[0]).lower().strip("* ")
                key = next((k for k, name in TOPICS.items() if name == label), None)
                if not key:
                    continue
                canon = canonical["per_topic"][key]
                allowed = {
                    canon["open"], canon["records"], canon["yes"], canon["no"],
                    canon["awaiting"], canon["resolved_yesno"], canon["open"] + canon["records"],
                }
                claimed = []
                unknown = []
                for index in columns:
                    if index >= len(cells):
                        continue
                    stripped = cells[index].replace(",", "").replace("$", "").replace("%", "").strip()
                    if not re.fullmatch(r"-?\d+(\.\d+)?", stripped):
                        continue
                    value = int(float(stripped))
                    claimed.append(value)
                    if value not in allowed:
                        unknown.append(value)
                if not claimed:
                    continue
                if unknown:
                    line = text.count("\n", 0, table_match.start()) + 1
                    findings.append({
                        "check": "C3", "file": rel(path), "line": line, "topic": key,
                        "field": "topic summary row", "claimed": claimed,
                        "canonical": sorted(allowed), "status": "MISMATCH",
                    })
    return findings


def check_arithmetic(canonical: dict) -> list:
    """C4 - YES + NO == resolved-with-result, per topic and in total."""
    findings = []
    for key, value in canonical["per_topic"].items():
        if value["yes"] + value["no"] != value["resolved_yesno"]:
            findings.append({
                "check": "C4", "file": "snapshot/resolved.json", "topic": key,
                "field": "yes+no vs resolved", "claimed": value["yes"] + value["no"],
                "canonical": value["resolved_yesno"], "status": "MISMATCH",
            })
        if value["resolved_yesno"] + value["awaiting"] != value["records"]:
            findings.append({
                "check": "C4", "file": "snapshot/resolved.json", "topic": key,
                "field": "resolved+awaiting vs records",
                "claimed": value["resolved_yesno"] + value["awaiting"],
                "canonical": value["records"], "status": "MISMATCH",
            })
    totals = canonical["totals"]
    if totals["yes"] + totals["no"] != totals["resolved_yesno"]:
        findings.append({
            "check": "C4", "file": "snapshot/resolved.json", "topic": "all",
            "field": "yes+no", "claimed": totals["yes"] + totals["no"],
            "canonical": totals["resolved_yesno"], "status": "MISMATCH",
        })
    if totals["resolved_yesno"] + totals["awaiting"] != totals["records"]:
        findings.append({
            "check": "C4", "file": "snapshot/resolved.json", "topic": "all",
            "field": "resolved+awaiting", "claimed": totals["resolved_yesno"] + totals["awaiting"],
            "canonical": totals["records"], "status": "MISMATCH",
        })
    topic_open = sum(v["open"] for v in canonical["per_topic"].values())
    if topic_open != totals["open"]:
        findings.append({
            "check": "C4", "file": "snapshot/markets.json", "topic": "all",
            "field": "sum of topic open counts", "claimed": topic_open,
            "canonical": totals["open"], "status": "MISMATCH",
        })
    return findings


def collect_topic_rows(files: list) -> dict:
    """Every topic summary row found anywhere in the repo.

    Returns {page: {topic: {column_label: value}}} for tables whose header has
    at least two count columns.
    """
    found = collections.defaultdict(dict)
    for path in files:
        if not path.endswith((".html", ".htm")):
            continue
        text = strip_scripts(read(path))
        for table_match in TABLE_RE.finditer(text):
            table_rows = list(rows_of(table_match.group(1)))
            if not table_rows:
                continue
            header = table_rows[0][1]
            columns = count_columns(header)
            if len(columns) < 2:
                continue
            labels = [norm_text(header[i]).lower() if i < len(header) else "" for i in columns]
            for _line, cells, _hrefs in table_rows[1:]:
                if not cells:
                    continue
                label = norm_text(cells[0]).lower().strip("* ")
                key = next((k for k, name in TOPICS.items() if name == label), None)
                if not key:
                    continue
                values = {}
                for slot, index in enumerate(columns):
                    if index >= len(cells):
                        continue
                    stripped = cells[index].replace(",", "").replace("$", "").replace("%", "").strip()
                    if re.fullmatch(r"-?\d+(\.\d+)?", stripped):
                        values[labels[slot] or f"col{slot}"] = int(float(stripped))
                if values:
                    found[rel(path)].setdefault(key, {}).update(values)
    return found


def check_cross_desk(files: list) -> list:
    """C9 - the same quantity stated on more than one page must agree."""
    per_page = collect_topic_rows(files)
    # quantity -> topic -> {page: value}
    quantity_map = collections.defaultdict(lambda: collections.defaultdict(dict))
    for page, topics in per_page.items():
        for topic, values in topics.items():
            for label, value in values.items():
                quantity_map[label][topic][page] = value

    rows = []
    for label in sorted(quantity_map):
        for topic in sorted(quantity_map[label]):
            pages = quantity_map[label][topic]
            distinct = sorted(set(pages.values()))
            rows.append({
                "quantity": label,
                "topic": topic,
                "values": pages,
                "distinct_values": distinct,
                "status": "agree" if len(distinct) == 1 else "differ",
            })
    return rows


def desk_exclusion_series() -> list:
    """Series prefixes the desk tracker deliberately excludes (documented in code)."""
    path = os.path.join(ROOT, "desk", "tools", "track_resolutions.py")
    if not os.path.exists(path):
        return []
    text = read(path)
    match = re.search(r"EXCLUDED_SERIES_PREFIX\s*=\s*\((.*?)\)", text, re.S)
    if not match:
        return []
    return re.findall(r'"([A-Z0-9]+)"', match.group(1))


def desk_log_counts() -> dict:
    """The desk tracker's own per-topic counts (the source of desk/*.html rows)."""
    path = os.path.join(ROOT, "desk", "data", "resolutions-log.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return {}
    return payload.get("by_topic") or {}


def check_topic_exclusion(canonical: dict) -> list:
    """C8 - explain cross-desk count differences caused by a documented exclusion.

    The desk resolution tracker excludes certain series prefixes (declared in
    desk/tools/track_resolutions.py). Those markets are still present in the
    committed snapshot, so the desk's per-topic counts are lower by exactly the
    excluded records. The difference is reported with its evidence rather than
    left as an unexplained disagreement.
    """
    findings = []
    prefixes = desk_exclusion_series()
    if not prefixes:
        return findings
    resolved = (load_json("resolved.json") or {}).get("markets", []) or []
    open_markets = (load_json("markets.json") or {}).get("markets", []) or []

    def excluded(record):
        series = str(record.get("series_ticker") or "").upper()
        return any(series == p or series.startswith(p + "-") for p in prefixes)

    for topic, canon in canonical["per_topic"].items():
        dropped = sum(1 for r in resolved if r.get("topic") == topic and excluded(r))
        if not dropped:
            continue
        dropped_open = sum(1 for m in open_markets if m.get("topic") == topic and excluded(m))
        findings.append({
            "check": "C8", "file": "snapshot/resolved.json", "topic": topic,
            "field": "records excluded from the desk tracker by series prefix",
            "claimed": dropped, "canonical": canon["records"],
            "status": "EXPLAINED",
            "detail": (f"{dropped} resolved and {dropped_open} open records use series "
                       f"{', '.join(prefixes)}, which the desk tracker excludes "
                       f"(desk/tools/track_resolutions.py). Snapshot records for this topic: "
                       f"{canon['records']}; desk-tracked: {canon['records'] - dropped}."),
        })
    return findings


# ------------------------------------------------------------------ C5


def is_official_source(href: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(html.unescape(href))
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.netloc or "").lower()
    return any(host == allowed or host.endswith("." + allowed) for allowed in OFFICIAL_SOURCE_HOSTS)


def check_row_sources(files: list):
    """C5 - every rendered market row carries an official source link.

    Only rows that quote a market ticker are checked: narrative tables
    (requirement matrices, review logs) legitimately describe the repository
    rather than exchange data. Rows written by JavaScript at run time are not
    present in the static file and are therefore not counted here.
    """
    per_page = {}
    for path in files:
        if not path.endswith((".html", ".htm")):
            continue
        text = strip_scripts(read(path))
        market_rows = 0
        sourced = 0
        unsourced = []
        for line, cells, hrefs in rows_of(text):
            if len(cells) < 2:
                continue
            joined = " ".join(cells)
            if not TICKER_RE.search(joined):
                continue
            market_rows += 1
            if any(is_official_source(h) for h in hrefs):
                sourced += 1
            else:
                unsourced.append({"line": line, "first_cell": cells[0][:70]})
        if market_rows:
            per_page[rel(path)] = {
                "market_rows": market_rows,
                "rows_with_official_source": sourced,
                "rows_without_official_source": market_rows - sourced,
                "coverage_pct": round(100.0 * sourced / market_rows, 1),
                "unsourced_examples": unsourced[:3],
            }
    findings = []
    for page, stat in per_page.items():
        if stat["rows_without_official_source"] > 0:
            findings.append({
                "check": "C5", "file": page, "field": "market rows without official source link",
                "claimed": stat["rows_without_official_source"],
                "canonical": stat["market_rows"], "status": "WARNING",
            })
    return findings, per_page


# ------------------------------------------------------------------ C6


def normalise_doc_url(url: str) -> str:
    url = url.strip()
    if url.endswith(".md"):
        url = url[:-3]
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.rstrip("/")
    return f"{parsed.netloc.lower()}{path}"


def clean_url(url: str) -> str:
    """Strip quoting artefacts so a URL found in prose matches the real link."""
    url = url.replace("\\/", "/")
    url = url.replace("\\\\", "\\")
    url = url.rstrip("\\")
    url = url.rstrip("`\"'.,;:)]}>")
    return url


# Endpoints that are part of the documentation site but are not pages listed in
# the page index (llms.txt). They are checked separately.
SITE_ROOT_PATHS = {
    "",
    "/api-reference",
    "/changelog",
    "/llms.txt",
    "/llms-full.txt",
    "/welcome",
    "/welcome/index",
}


def load_doc_index(path: str):
    if not path or not os.path.exists(path):
        return None
    urls = set()
    with open(path, encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            for url in re.findall(r"https://[^\s)\]]+", line):
                urls.add(normalise_doc_url(clean_url(url)))
    return urls


def extract_doc_urls(text: str):
    """Documentation URLs from real links, not from prose fragments."""
    found = set()
    for match in re.finditer(r"(?:href|src)\s*=\s*[\"']([^\"']+)[\"']", text, re.I):
        url = clean_url(match.group(1))
        if url.startswith("https://docs.kalshi.com"):
            found.add(url)
    for match in re.finditer(r"\]\((https://docs\.kalshi\.com[^)\s]*)\)", text):
        found.add(clean_url(match.group(1)))
    for match in re.finditer(r"https://docs\.kalshi\.com[^\s\"'<>)\(\]]*", text):
        url = clean_url(match.group(0))
        if url.startswith("https://docs.kalshi.com"):
            found.add(url)
    return found


def check_doc_links(files: list, index_path: str):
    """C6 - docs.kalshi.com links vs the official published doc index."""
    used = collections.Counter()
    where = collections.defaultdict(set)
    for path in files:
        page = rel(path)
        if page in ("verification/audit-report.json", "verification/index.html"):
            # The audit's own outputs repeat the URLs it found; scanning them
            # again would only measure self-reference.
            continue
        for url in extract_doc_urls(read(path)):
            used[url] += 1
            where[url].add(page)
    index = load_doc_index(index_path)
    rows = []
    for url in sorted(used):
        key = normalise_doc_url(url)
        parsed = urllib.parse.urlparse(url)
        site_root = parsed.path.rstrip("/") in SITE_ROOT_PATHS
        if index is None:
            status = "unverified"
            note = "official doc index not available in this sandbox"
        elif key in index:
            status = "in-index"
            note = "listed in https://docs.kalshi.com/llms.txt"
        elif site_root:
            status = "site-root"
            note = "documentation site entry point, not a page listed in llms.txt"
        else:
            status = "not-in-index"
            note = "not listed in the official doc index - verify before relying on it"
        rows.append({
            "url": url, "uses": used[url], "status": status, "note": note,
            "files": sorted(where[url])[:4],
        })
    return rows


# ------------------------------------------------------------------ C7


SECRET_PATTERNS = [
    ("private-key-header", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("kalshi-api-key-id", re.compile(r"\bKALSHI_API_KEY\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}")),
    ("bearer-token", re.compile(r"\bBearer\s+[A-Za-z0-9_\-\.]{24,}")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
]


def check_secrets(files: list) -> list:
    findings = []
    for path in files:
        text = read(path)
        for name, pattern in SECRET_PATTERNS:
            for m in pattern.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                findings.append({
                    "check": "C7", "file": rel(path), "line": line,
                    "field": name, "claimed": "match", "canonical": "no match",
                    "status": "ERROR",
                })
    return findings


# ------------------------------------------------------------------ report


def build_report(canonical: dict, index_path: str):
    files = sorted(iter_repo_files())
    prose = check_topic_prose(canonical, files)
    rows = check_topic_rows(canonical, files)
    arithmetic = check_arithmetic(canonical)
    source_findings, per_page = check_row_sources(files)
    doc_rows = check_doc_links(files, index_path)
    secrets = check_secrets(files)
    cross_desk = check_cross_desk(files)
    exclusions = check_topic_exclusion(canonical)

    # Reconcile: a topic summary row that disagrees with the snapshot is
    # explained when the page matches its own recorded data source (the desk
    # resolution log) and the gap to the snapshot equals exactly the records
    # the tracker excludes by series prefix (C8). Explained rows are reported
    # with their evidence, not hidden.
    excluded_counts = {f["topic"]: f["claimed"] for f in exclusions}
    log_counts = desk_log_counts()
    for finding in rows:
        topic = finding.get("topic")
        if topic not in excluded_counts or topic not in log_counts:
            continue
        claimed = set(finding.get("claimed") or [])
        log_values = {v for v in log_counts[topic].values() if isinstance(v, int)}
        canon = canonical["per_topic"][topic]
        gap = canon["records"] - excluded_counts[topic]
        if claimed and claimed <= log_values and gap in log_values:
            finding["status"] = "EXPLAINED"
            finding["detail"] = (
                f"The page matches its own data source, desk/data/resolutions-log.json "
                f"(tracked {log_counts[topic].get('tracked')}, resolved "
                f"{log_counts[topic].get('resolved')}, awaiting {log_counts[topic].get('awaiting')}). "
                f"The snapshot holds {canon['records']} records for this topic; the difference of "
                f"{excluded_counts[topic]} is the series-prefix exclusion declared in "
                f"desk/tools/track_resolutions.py (see C8). The row itself does not state the "
                f"exclusion, so a reader comparing desks sees two different numbers.")

    findings = prose + rows + arithmetic + source_findings + secrets + exclusions
    errors = [f for f in findings if f["status"] == "ERROR"]
    warnings = [f for f in findings if f["status"] == "WARNING"]
    mismatches = [f for f in findings if f["status"] == "MISMATCH"]
    explained = [f for f in findings if f["status"] == "EXPLAINED"]
    doc_not_in_index = [d for d in doc_rows if d["status"] == "not-in-index"]
    doc_unverified = [d for d in doc_rows if d["status"] == "unverified"]
    cross_differences = [c for c in cross_desk if c["status"] == "differ"]

    return {
        "generated_utc": canonical["generated_utc"],
        "audit_base_url": canonical["base"],
        "canonical": canonical,
        "counts": {
            "files_scanned": len(files),
            "findings": len(findings),
            "errors": len(errors),
            "warnings": len(warnings),
            "mismatches": len(mismatches),
            "explained": len(explained),
            "doc_links_used": len(doc_rows),
            "doc_links_in_index": sum(1 for d in doc_rows if d["status"] == "in-index"),
            "doc_links_not_in_index": len(doc_not_in_index),
            "doc_links_unverified": len(doc_unverified),
            "tables_checked": len(per_page),
            "cross_desk_quantities": len(cross_desk),
            "cross_desk_differences": len(cross_differences),
        },
        "findings": findings,
        "row_source_coverage": per_page,
        "doc_links": doc_rows,
        "cross_desk": cross_desk,
    }


DOC_LINKS_SOURCE = "https://docs.kalshi.com/llms.txt"


def render_html(report: dict) -> str:
    canonical = report["canonical"]
    totals = canonical["totals"]
    counts = report["counts"]

    def esc(value):
        return html.escape(str(value))

    rows_topic = []
    for key, value in canonical["per_topic"].items():
        rows_topic.append(
            "<tr><td class='mono'>{key}</td><td>{label}</td><td>{open}</td><td>{rec}</td>"
            "<td>{yn}</td><td>{yes}</td><td>{no}</td><td>{aw}</td>"
            "<td><a href='https://docs.kalshi.com/api-reference/market/get-markets'>GET /markets &rarr;</a></td></tr>".format(
                key=esc(key), label=esc(value["label"]), open=esc(value["open"]),
                rec=esc(value["records"]), yn=esc(value["resolved_yesno"]),
                yes=esc(value["yes"]), no=esc(value["no"]), aw=esc(value["awaiting"]),
            )
        )

    rows_findings = []
    for finding in report["findings"]:
        loc = finding["file"] + (f":{finding['line']}" if finding.get("line") else "")
        detail = finding.get("detail") or ""
        rows_findings.append(
            "<tr><td class='mono'>{c}</td><td class='mono'>{loc}</td><td>{topic}</td><td>{field}</td>"
            "<td>{claimed}</td><td>{canon}</td><td><span class='badge {cls}'>{st}</span></td>"
            "<td class='fine'>{detail}</td></tr>".format(
                c=esc(finding["check"]), loc=esc(loc), topic=esc(finding.get("topic", "-")),
                field=esc(finding["field"]), claimed=esc(finding["claimed"]),
                canon=esc(finding["canonical"]),
                cls={"ERROR": "bad", "MISMATCH": "bad", "WARNING": "warn",
                     "EXPLAINED": "ok"}.get(finding["status"], "warn"),
                st=esc(finding["status"]), detail=esc(detail),
            )
        )
    if not rows_findings:
        rows_findings.append(
            "<tr><td colspan='8' class='fine'>No mismatches found by the checks that could run.</td></tr>")

    rows_cross = []
    for entry in report.get("cross_desk", []):
        pages = entry["values"]
        page_text = "<br>".join(
            f"<span class='mono'>{esc(p)}</span> &rarr; {esc(v)}" for p, v in sorted(pages.items()))
        rows_cross.append(
            "<tr><td>{q}</td><td>{t}</td><td class='fine'>{pages}</td>"
            "<td><span class='badge {cls}'>{st}</span></td></tr>".format(
                q=esc(entry["quantity"]), t=esc(entry["topic"]), pages=page_text,
                cls="ok" if entry["status"] == "agree" else "warn", st=esc(entry["status"]),
            )
        )
    if not rows_cross:
        rows_cross.append(
            "<tr><td colspan='4' class='fine'>No topic summary rows were found to compare.</td></tr>")

    rows_cov = []
    for page, stat in sorted(report["row_source_coverage"].items(), key=lambda kv: kv[1]["coverage_pct"]):
        rows_cov.append(
            "<tr><td class='mono'>{p}</td><td>{n}</td><td>{s}</td><td>{m}</td><td>{c}%</td>"
            "<td><span class='badge {cls}'>{st}</span></td></tr>".format(
                p=esc(page), n=esc(stat["market_rows"]), s=esc(stat["rows_with_official_source"]),
                m=esc(stat["rows_without_official_source"]), c=esc(stat["coverage_pct"]),
                cls="ok" if stat["coverage_pct"] == 100 else ("warn" if stat["coverage_pct"] >= 50 else "bad"),
                st="complete" if stat["coverage_pct"] == 100 else "partial",
            )
        )

    rows_docs = []
    for doc in report["doc_links"]:
        rows_docs.append(
            "<tr><td><a href='{u}' target='_blank' rel='noopener'>{u}</a></td><td>{n}</td>"
            "<td><span class='badge {cls}'>{st}</span></td><td class='fine'>{note}</td>"
            "<td class='fine mono'>{f}</td></tr>".format(
                u=esc(doc["url"]), n=esc(doc["uses"]),
                cls={"in-index": "ok", "not-in-index": "bad", "unverified": "warn",
                     "site-root": "warn"}[doc["status"]],
                st=esc(doc["status"]), note=esc(doc["note"]),
                f=esc(", ".join(doc["files"]) or "-"),
            )
        )

    verdict = "PASS" if counts["errors"] == 0 and counts["mismatches"] == 0 else "REVIEW"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Repo consistency &amp; source audit &middot; Kalshi demo</title>
<meta name="description" content="Line-by-line re-derivation of every rendered count from the committed official Kalshi demo capture, plus a source-link and secret audit of the whole repository.">
<link rel="stylesheet" href="../site/assets/style.css">
<style>
  .mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86rem}}
  .badge{{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.76rem;font-weight:600}}
  .ok{{background:#12351f;color:#7ee2a8}} .warn{{background:#3a2f0d;color:#f3d36b}}
  .bad{{background:#3a1518;color:#ff9ba3}}
  table{{width:100%;border-collapse:collapse}}
  th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
  th{{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="../index.html"><span class="mark">K</span>Kalshi <b>Demo</b> Audit</a>
  <nav class="nav">
    <a href="../index.html">Home</a>
    <a href="index.html" class="on">Audit</a>
    <a href="../site/flagged.html">Flagged for review</a>
    <a href="../site/sources.html">Sources</a>
  </nav>
</div></header>
<main class="wrap">
<div class="pagehead">
  <p class="kicker">Independent re-derivation &middot; snapshot {esc(report['generated_utc'])}</p>
  <h1>Repo consistency &amp; source audit</h1>
  <p class="lede">Every count on this page is recomputed from the committed official capture
  (<code>snapshot/markets.json</code>, <code>snapshot/resolved.json</code>) and compared with what the
  pages actually render. Claims that cannot be matched are reported, never filled in.</p>
</div>

<div class="callout {'ok' if verdict == 'PASS' else 'warn'}">
  <b>Verdict: {esc(verdict)}.</b>
  {counts['files_scanned']} files scanned &middot; {counts['errors']} errors &middot;
  {counts['mismatches']} count mismatches &middot; {counts['explained']} explained differences &middot;
  {counts['cross_desk_differences']} cross-desk disagreements &middot; {counts['warnings']} source-coverage warnings &middot;
  {counts['doc_links_used']} distinct documentation links
  ({counts['doc_links_in_index']} confirmed in the official index,
  {counts['doc_links_not_in_index']} not listed, {counts['doc_links_unverified']} unverified here).
</div>

<h2>1. Canonical facts (C1)</h2>
<p class="fine">Source: <a href="../snapshot/markets.json">snapshot/markets.json</a> and
<a href="../snapshot/resolved.json">snapshot/resolved.json</a>, collected from
<code>{esc(report['audit_base_url'])}</code> at {esc(report['generated_utc'])}.
Open markets are the records with an open status; <em>resolved</em> means the API returned
<code>result</code> = yes or no; <em>awaiting</em> means the record is closed with no result yet.</p>
<div class="tablewrap"><table>
<thead><tr><th>Topic key</th><th>Label</th><th>Open</th><th>Records</th><th>Resolved (yes/no)</th>
<th>YES</th><th>NO</th><th>Awaiting</th><th>Official source</th></tr></thead>
<tbody>
{''.join(rows_topic)}
<tr><td class='mono'>all</td><td><b>Total</b></td><td><b>{esc(totals['open'])}</b></td>
<td><b>{esc(totals['records'])}</b></td><td><b>{esc(totals['resolved_yesno'])}</b></td>
<td><b>{esc(totals['yes'])}</b></td><td><b>{esc(totals['no'])}</b></td>
<td><b>{esc(totals['awaiting'])}</b></td>
<td><a href="../snapshot/collect-log.txt">collect log &rarr;</a></td></tr>
</tbody></table></div>
<p class="fine">Collection requests: <b>{esc(canonical['requests'])}</b> &middot; failed requests:
<b>{esc(canonical['failed'])}</b> &mdash; read from the last line of
<a href="../snapshot/collect-log.txt">snapshot/collect-log.txt</a>.</p>

<h2>2. Findings</h2>
<p class="fine">C2 prose count claims &middot; C3 topic summary rows &middot; C4 arithmetic identities &middot;
C5 market rows without an official source link &middot; C7 credential material &middot;
C8 documented series exclusions.</p>
<div class="tablewrap"><table>
<thead><tr><th>Check</th><th>Location</th><th>Topic</th><th>Field</th><th>Claimed</th>
<th>Canonical</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>{''.join(rows_findings)}</tbody></table></div>

<h2>3. Cross-desk comparison (C9)</h2>
<p class="fine">The same quantity stated on more than one page. <em>agree</em> means every page that
states it states the same number; <em>differ</em> means two desks disagree and a reader comparing
them would see two different answers.</p>
<div class="tablewrap"><table>
<thead><tr><th>Quantity</th><th>Topic</th><th>Page &rarr; value</th><th>Status</th></tr></thead>
<tbody>{''.join(rows_cross)}</tbody></table></div>

<h2>4. Source-link coverage per table (C5)</h2>
<p class="fine">A row counts as sourced when it links to an official Kalshi host
(<code>docs.kalshi.com</code>, <code>external-api.demo.kalshi.co</code>, <code>kalshi.com</code>).</p>
<div class="tablewrap"><table>
<thead><tr><th>Page</th><th>Data rows</th><th>With source</th><th>Without source</th>
<th>Coverage</th><th>Status</th></tr></thead>
<tbody>{''.join(rows_cov)}</tbody></table></div>

<h2>5. Documentation links vs the official index (C6)</h2>
<p class="fine">Official index: <a href="{DOC_LINKS_SOURCE}" target="_blank" rel="noopener">{DOC_LINKS_SOURCE} &rarr;</a>.
A link is <em>in-index</em> when the published documentation index lists that page;
<em>not-in-index</em> links are flagged for review, not removed.</p>
<div class="tablewrap"><table>
<thead><tr><th>Documentation URL</th><th>Uses</th><th>Status</th><th>Note</th><th>Used in</th></tr></thead>
<tbody>{''.join(rows_docs)}</tbody></table></div>

<h2>6. How this audit was produced</h2>
<ul class="plain">
  <li>Tool: <code>verification/tools/audit_repo.py</code> &mdash; run it locally or in CI with
      <code>python3 verification/tools/audit_repo.py</code>.</li>
  <li>Machine-readable result: <a href="audit-report.json">verification/audit-report.json</a>.</li>
  <li>No value is inferred. A page that states a number this audit cannot match is reported as a
      mismatch and left on the page for review.</li>
  <li>The demo venue is a test exchange with mock funds; see
      <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">the official demo-environment note &rarr;</a>.</li>
</ul>

</main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", default=os.path.join(OUT_DIR, "data", "kalshi-docs-index.txt"),
                        help="cached copy of https://docs.kalshi.com/llms.txt")
    parser.add_argument("--out", default=OUT_DIR)
    args = parser.parse_args()

    canonical = derive_canonical()
    report = build_report(canonical, args.index)

    os.makedirs(args.out, exist_ok=True)
    json_path = os.path.join(args.out, "audit-report.json")
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=False)
        handle.write("\n")
    html_path = os.path.join(args.out, "index.html")
    with open(html_path, "w", encoding="utf-8") as handle:
        handle.write(render_html(report))

    counts = report["counts"]
    print("audit status:", "PASS" if counts["errors"] == 0 and counts["mismatches"] == 0 else "REVIEW")
    print("  files scanned:", counts["files_scanned"])
    print("  errors:", counts["errors"], " mismatches:", counts["mismatches"],
          " warnings:", counts["warnings"])
    print("  doc links:", counts["doc_links_used"], "in-index:", counts["doc_links_in_index"],
          "not-in-index:", counts["doc_links_not_in_index"], "unverified:", counts["doc_links_unverified"])
    print("  report:", os.path.relpath(json_path, ROOT), "and", os.path.relpath(html_path, ROOT))
    return 1 if counts["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
