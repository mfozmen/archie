---
name: status
description: Use when someone asks how much of the system is documented, what has gone stale, or what questions are still open. Deterministic, LLM-free, seconds.
---

# status — "Where are we?"

Follow the preamble in the `inventory` skill (repo root, config, language rules).

## This skill has no LLM step

The report is computed by a script and printed **verbatim**. Do not summarise it,
re-order it, or reword any line of it. You may add one line after it pointing at
the next command; you may not interpret, soften or embellish the numbers. It is deterministic on purpose: it
costs no tokens, so it can be run on every branch, in a hook, or in CI without
anyone thinking about it.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/status.js" "$root"
```

Add `--unknowns` when the user asked to see the open questions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/status.js" "$root" --unknowns
```

## What it does under the hood

Before reporting, it refreshes staleness: for each traced entry it intersects
`git diff --name-only <traced_at_sha>..HEAD` with that entry's `watch[]` globs.
Any overlap marks the flow `stale`. An entry whose `traced_at_sha` is no longer
reachable — after a squash-merge, a rebase, or in a shallow clone — is also
marked stale, because its currency can no longer be proven. Unprovable is never
reported as fine.

## Inventory drift

Flow staleness catches code moving under a page that was traced. It cannot catch
a whole entry point being **added**, because nothing watches a file the model has
never heard of — and "remember to re-run the inventory" is not a mechanism.

So when a recipe exists, `status` re-runs the sweep (ripgrep, no tokens) and asks
one narrow question: is there a file producing hits of some kind that no entry of
that kind cites at all? Per **file**, never per line — line numbers shift on every
edit, and a false "new entry point" every time someone adds an import would make
the signal worthless.

This **undercounts on purpose**: a new route added to an already-known file will
not show up. Say that when it matters, rather than letting a clean drift report be
read as "the inventory is complete".

## Report

Print the script's output as-is. If anything is stale, the useful next line is
`/archie:explain "<label>"`, which refreshes it incrementally against the diff
rather than re-tracing from scratch.
