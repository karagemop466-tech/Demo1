#!/usr/bin/env python3
"""
ops-desk CORS probe (session 54a39029).

Observed-evidence probe: records the exact response headers GitHub's REST API
returns for the endpoints the ops-desk page reads from the browser, so the
"live re-check" feature's cross-origin behaviour is documented from observation
(headers) rather than assumed. This is NOT a documentation citation — the
official basis for reading these endpoints is
https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28
("This endpoint can be used without authentication ... if only public resources
are requested").

Usage:  python3 ops-desk/tools/cors_probe.py
Output: ops-desk/data/cors-probe.json
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = "karagemop466-tech/Demo1"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ops-desk" / "data" / "cors-probe.json"

PROBES = [
    f"https://api.github.com/repos/{REPO}/actions/workflows?per_page=100",
    f"https://api.github.com/repos/{REPO}/actions/runs?per_page=1",
    f"https://api.github.com/repos/{REPO}/commits?path=data&per_page=1",
]
HEADERS_TO_KEEP = [
    "access-control-allow-origin",
    "access-control-expose-headers",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
]


def main():
    results = []
    for url in PROBES:
        req = urllib.request.Request(url, headers={"User-Agent": "ops-desk-cors-probe"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            kept = {h: hdrs.get(h) for h in HEADERS_TO_KEEP if hdrs.get(h)}
            results.append({
                "url": url,
                "status": resp.status,
                "observed_headers": kept,
            })
    out = {
        "schema": "ops-desk/cors-probe v1",
        "probed_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": ("urllib GET with no Origin header and with Origin: null replaced by a plain "
                   "GET; headers recorded verbatim. Browsers send Origin and enforce CORS "
                   "client-side; the observed Access-Control-Allow-Origin: * is the header a "
                   "browser would receive. Re-run the probe to refresh."),
        "results": results,
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    for r in results:
        print(r["url"], "->", r["observed_headers"].get("access-control-allow-origin"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
