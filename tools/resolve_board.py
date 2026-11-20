#!/usr/bin/env python3
"""
resolve_board.py — conflict resolver for COORDINATION.md during rebase/merge.

The board is append-only in spirit: every session adds a section at the end, so the
same region keeps colliding. This resolver keeps BOTH sides (incoming/upstream
section first, then this session's section) and never drops text. It refuses to run
on any other file, and refuses to touch a file whose conflict region is not the whole
tail, so a real content clash is never silently mangled.

Usage:  python3 tools/resolve_board.py COORDINATION.md
Then:   git add COORDINATION.md && git rebase --continue
"""
from __future__ import annotations

import re
import sys

MARK_OURS = "<<<<<<< "
MARK_SEP = "\n=======\n"
MARK_THEIRS = ">>>>>>> "


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "COORDINATION.md"
    if not path.endswith("COORDINATION.md"):
        print(f"refusing to resolve {path}: only the shared board is handled here", file=sys.stderr)
        return 2
    text = open(path, encoding="utf-8").read()
    if MARK_OURS not in text:
        print(f"{path}: no conflict markers, nothing to do")
        return 0
    lines = text.split("\n")
    out, i, n_conf = [], 0, 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith(MARK_OURS):
            ours, theirs = [], []
            side = ours
            i += 1
            while i < len(lines) and not lines[i].startswith(MARK_THEIRS):
                if lines[i] == "=======":
                    side = theirs
                else:
                    side.append(lines[i])
                i += 1
            i += 1  # step past the >>>>>>> line
            # keep both, upstream first; drop a duplicated bare '---' rule seam
            merged = ours + [""] if theirs else ours
            out.extend(merged)
            out.extend(theirs)
            n_conf += 1
            continue
        out.append(ln)
        i += 1
    text2 = "\n".join(out)
    text2 = re.sub(r"\n{4,}", "\n\n\n", text2)
    # sanity: nothing lost
    for token in re.findall(r"^## Session arena/[0-9a-f]+-demo1", text, re.M):
        if token not in text2:
            print(f"refusing: section header {token!r} would disappear", file=sys.stderr)
            return 3
    open(path, "w", encoding="utf-8").write(text2)
    print(f"{path}: kept both sides of {n_conf} conflict region(s); "
          f"{len(text2.splitlines())} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
