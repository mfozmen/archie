#!/usr/bin/env bash
# leak-scan.sh — block pushes that contain proprietary phrasing.
#
# The pattern list is DELIBERATELY not in this repo: committing the list of internal
# names would itself leak them. Patterns live in a local, gitignored file — one
# case-insensitive regex per line, comments with '#':
#
#   default:  <repo>/.leak-patterns   (gitignored)
#   override: LEAK_PATTERNS_FILE=/path/to/file
#
# Scans (1) all tracked files EXCEPT vendor/, (2) all commit messages not yet on
# any remote. Exits 1 on any hit. If no pattern file exists, warns and exits 0.
#
# vendor/ is exempt from the FILE scan only: it holds verbatim third-party
# artifacts we did not author, where a hit is an accident of minified identifiers
# colliding with a pattern that has no word boundary — not a leak. The exemption
# is reported, never silent, and commit messages are still scanned in full.
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
patterns_file="${LEAK_PATTERNS_FILE:-$repo_root/.leak-patterns}"

if [[ ! -f "$patterns_file" ]]; then
  echo "leak-scan: WARNING — no pattern file at $patterns_file; scan skipped." >&2
  exit 0
fi

# strip comments/blank lines
patterns="$(grep -v -e '^\s*#' -e '^\s*$' "$patterns_file" || true)"
[[ -z "$patterns" ]] && { echo "leak-scan: pattern file empty; scan skipped." >&2; exit 0; }

vendor_skipped="$(git ls-files -- vendor/ | wc -l | tr -d ' ')"
[[ "$vendor_skipped" != "0" ]] && \
  echo "leak-scan: skipping $vendor_skipped vendored file(s) under vendor/ (third-party, not authored here)." >&2

fail=0
while IFS= read -r pat; do
  # 1) tracked files
  if hits="$(git grep -I -i -n -E -- "$pat" -- ':!vendor/' 2>/dev/null)"; then
    echo "leak-scan: BLOCK — pattern matched in tracked files:" >&2
    echo "$hits" | sed 's/^/  /' >&2
    fail=1
  fi
  # 2) unpushed commit messages (all local branches vs all remotes)
  if msgs="$(git log --branches --not --remotes --format='%h %s %b' 2>/dev/null \
      | grep -i -n -E -- "$pat" || true)"; [[ -n "$msgs" ]]; then
    echo "leak-scan: BLOCK — pattern matched in unpushed commit message(s):" >&2
    echo "$msgs" | sed 's/^/  /' >&2
    fail=1
  fi
done <<< "$patterns"

if [[ "$fail" -eq 1 ]]; then
  echo "leak-scan: push blocked. Genericize the content (see REVIEW.md §1)." >&2
  exit 1
fi
echo "leak-scan: clean."
