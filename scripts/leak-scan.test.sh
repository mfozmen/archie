#!/usr/bin/env bash
# Self-check for leak-scan.sh — builds a throwaway repo and asserts:
#  1) no pattern file  -> exit 0 (warn)
#  2) clean tree       -> exit 0
#  3) leaky tracked file -> exit 1
#  4) leaky unpushed commit message -> exit 1
#  5) the same leaky content under vendor/ -> exit 0 (third-party exemption)
set -euo pipefail
scan="$(cd "$(dirname "$0")" && pwd)/leak-scan.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cd "$tmp" && git init -q
git config user.email "test@example.com"
git config user.name "Test"
git config commit.gpgsign false
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

# 5: the same leaky content under vendor/ is exempt from the FILE scan.
# Drop case 4's leaky commit first — message hits are NOT exempt, and would
# otherwise fail this case for the wrong reason.
git reset -q --hard HEAD~1
mkdir -p vendor
echo "minified SecretCorp identifier" > vendor/bundle.min.js
git add vendor/bundle.min.js && git commit -qm "vendor a third-party bundle"
run && echo "PASS vendor-exempt" || { echo "FAIL vendor-exempt"; exit 1; }

# 5b: the exemption is scoped to vendor/ — the same content elsewhere still blocks.
echo "minified SecretCorp identifier" > src.js
git add src.js && git commit -qm "add source"
if run; then echo "FAIL vendor-exempt-scope"; exit 1; else echo "PASS vendor-exempt-scope"; fi

echo "all checks passed"
