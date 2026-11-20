#!/usr/bin/env python3
"""
resolve_board.py — conflict resolver for the shared COORDINATION.md board.

The board is append-only in spirit: every session adds a section at the end, so the
same region collides on almost every rebase. This resolver keeps BOTH sides of each
conflict — upstream section first, then this session's — and never drops text.

Guards, because silently mangling the board is worse than a conflict:
  * refuses to run on any file other than COORDINATION.md;
  * iterates to a fixpoint, so a second region (including one whose "ours" side is
    empty, which git emits when a rebase reapplies a pure-append commit) is handled;
  * refuses to write if any `## Session …` / `## Tasks …` / `## Publish record …`
    section header present in the conflicted file would disappear from the result.

Usage:
  python3 tools/resolve_board.py COORDINATION.md
  git add COORDINATION.md && git rebase --continue
"""
from __future__ import annotations

import re
import sys

OURS = "<<<<<<< "
SEP = "======="
THEIRS = ">>>>>>> "


def fold(lines):
    """Resolve one pass of conflict regions; return (lines, regions_resolved)."""
    out, i, n = [], 0, 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith(OURS):
            ours, theirs, side = [], [], "ours"
            i += 1
            while i < len(lines) and not lines[i].startswith(THEIRS):
                if lines[i].startswith(SEP):
                    side = "theirs"
                elif side == "ours":
                    ours.append(lines[i])
                else:
                    theirs.append(lines[i])
                i += 1
            i += 1  # past the >>>>>>> line
            if ours and theirs:
                out.extend(ours + [""] + theirs)
            else:                       # one side empty: keep whichever has text
                out.extend(ours or theirs)
            n += 1
            continue
        out.append(ln)
        i += 1
    return out, n


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "COORDINATION.md"
    if not path.endswith("COORDINATION.md"):
        print(f"refusing to resolve {path}: only the shared board is handled here", file=sys.stderr)
        return 2
    text = open(path, encoding="utf-8").read()
    if OURS not in text:
        print(f"{path}: no conflict markers, nothing to do")
        return 0
    lines = text.split("\n")
    total = 0
    for _ in range(25):
        lines, n = fold(lines)
        total += n
        if n == 0:
            break
    result = "\n".join(lines)
    if OURS in result or THEIRS in result:
        print("refusing: markers remain, resolve this region by hand", file=sys.stderr)
        return 4
    heads = re.compile(r"^##[^#].*$", re.M)
    before = set(heads.findall(text))
    after = set(heads.findall(result))
    lost = before - after
    if lost:
        print(f"refusing: {len(lost)} section header(s) would be dropped: "
              + "; ".join(sorted(lost)[:3]), file=sys.stderr)
        return 3
    result = re.sub(r"\n{4,}", "\n\n\n", result)
    open(path, "w", encoding="utf-8").write(result)
    print(f"{path}: kept both sides of {total} conflict region(s); {len(result.splitlines())} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
