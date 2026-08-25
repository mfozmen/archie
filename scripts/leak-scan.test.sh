#!/usr/bin/env bash
# Self-check for leak-scan.sh — builds a throwaway repo and asserts:
#  1) no pattern file  -> exit 0 (warn)
#  2) clean tree       -> exit 0
#  3) leaky tracked file -> exit 1
#  4) leaky unpushed commit message -> exit 1
set -euo pipefail
scan="$(cd "$(dirname "$0")" && pwd)/leak-scan.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cd "$tmp" && git init -q
git config user.email "test@example.com"
git config user.name "Test"
git commit -q --allow-empty -m init

run() { LEAK_PATTERNS_FILE="${1:-$tmp/.leak-patterns}" bash "$scan" >/dev/null 2>&1; }

# 1: no pattern file
run /nonexistent && echo "PASS no-patterns" || { echo "FAIL no-patterns"; exit 1; }

echo 'secretcorp' > .leak-patterns
# 2: clean tree
run && echo "PASS clean" || { echo "FAIL clean"; exit 1; }

# 3: leaky tracked file
echo "calls SecretCorp API" > notes.md && git add notes.md && git commit -qm "add notes"
if run; then echo "FAIL leaky-file"; exit 1; else echo "PASS leaky-file"; fi
git rm -q notes.md && git commit -qm "remove notes"

# 4: leaky unpushed commit message (tree clean, message dirty)
git commit -q --allow-empty -m "sync with secretcorp gateway"
if run; then echo "FAIL leaky-msg"; exit 1; else echo "PASS leaky-msg"; fi

echo "all checks passed"
