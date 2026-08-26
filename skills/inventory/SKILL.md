---
name: inventory
description: Inventory every entry point in this repository — what is in this system? Use when someone asks what is in a codebase, what its entry points are, or wants a first map of an unfamiliar or legacy repository. Sweeps for entry points and writes .archie/model.json.
---

# inventory — "What is in this system?"

## Preamble (every Archie skill does this first)

1. `root="$(git rev-parse --show-toplevel)"`. Not a git repository → say so and stop.
2. If `$root/.archie/config.json` is missing, run the **first-run setup** below.
   It is three questions, asked once, and it decides what the map will contain —
   so ask them rather than picking for the user.
3. Narrative text is written in the configured language. Identifiers — file paths,
   route labels, class names, entry-point ids — are **never** translated.

## First-run setup — three questions, asked once

**1. Language.** Which language should the narrative be written in? Guess a
default from the repo's README and offer it. Identifiers are never translated.

**2. Scope — what are you responsible for?** On anything larger than a small
service, inventorying everything buries the part the user actually owns. Propose
candidates rather than guessing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scope.js" "$root"
```

Each candidate carries the evidence for it: a `CODEOWNERS` assignment, how many
of the user's own commits touched the directory, or — only when neither exists —
that it is simply a top-level directory. Show them with that evidence, ask which
apply, and let the user add, remove or edit paths freely. **Offer "the whole
repository" as a real option** and take it when chosen; scope is a convenience,
not something to talk anyone into.

If the user names a team (`@acme/orders-team`), pass it so `CODEOWNERS` can be
filtered to their team's areas:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scope.js" "$root" "$(git -C "$root" config user.email)" @acme/orders-team
```

**3. Where should the wiki be written?** Default is `.archie/wiki/`, which keeps
generated files out of the way. Offer something browsable in the repo —
`docs/system-map/` is a good suggestion — because a map nobody opens is a map
nobody reads. Whatever is chosen must be inside the repository; `store.js`
refuses anything else.

Then write and store the answers:

```json
{ "language": "en",
  "output": "docs/system-map",
  "scope": { "label": "Orders", "paths": ["app/Orders/**", "routes/api.php"] } }
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" config "$root"/.archie/tmp/config.json
```

Omit `scope` entirely for a whole-repository map — an empty `paths` and no
`scope` mean the same thing, and neither adds a caveat to the rendered pages.
Every later run reads this file; `/archie:config` changes any of it.

Scratch JSON goes under `$root/.archie/tmp/` (`mkdir -p` it first), never a fixed
path in `/tmp`: two
Archie sessions on two different repositories would otherwise write the same file
at the same time. (Two sessions on the *same* repository are not supported — they
would race on `model.json` itself, which no temp path can fix.) `.archie/tmp/` is
generated, like `.archie/wiki/`, and belongs in `.gitignore`.

## The rule that outranks everything else

Never state how the system behaves without a `file:line` you actually read.
Anything you cannot prove goes into `unknowns[]` with a reason. A short honest
inventory is the product; a long plausible one is the failure mode.

## Step 0 — fingerprint (deterministic, no tokens)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fingerprint.js" "$root"
```

Manifests give the stack; deployment files give the process list and the external
dependencies. Most of the topology falls out here without reading any code.

## Step 1 — derive the recipe (LLM, once)

From the fingerprint, write `.archie/recipe.json`:

```json
{ "stack": "<what you concluded>", "probes": [{ "kind": "http", "glob": "routes/**/*.php", "pattern": "Route::(get|post|put|patch|delete)" }] }
```

`kind` is one of `http`, `queue`, `cron`, `cli`, `event`, `public-api`. Write it with:

Write it to a file, then store it. **Always via a file, never as a command-line
argument** — a route label or a pattern containing a quote would break the shell
before node ever saw it, and a real model runs to hundreds of entries.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" recipe "$root"/.archie/tmp/recipe.json
```

Show the recipe to the user. It is hand-editable, and `/archie:recipe "<hint>"`
is the escape hatch for a home-grown router the model has never seen.

## Step 2 — sweep (ripgrep, no tokens)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.js" "$root"
```

The sweep reads the configured scope itself and narrows the file list before any
probe runs — filtering afterwards would have spent the work already.

Print the per-probe counts and **every zero-hit warning verbatim**. A probe with
0 hits means the recipe is probably wrong; never let it pass silently. The hits
land in `.archie/sweep.json`.

## Step 3 — classify the hits (subagents, schema-bound)

Read `.archie/sweep.json` and dispatch the **inventory-worker** agent:

- **≤ 150 hits:** one dispatch with the whole array.
- **> 150 hits:** split on top-level directory boundaries and dispatch the
  batches in parallel, one agent per batch.

Give each worker the repo root and its batch verbatim. Workers return **only** a
JSON array of entry-point records; raw source never enters this conversation.

Concatenate the workers' arrays into one discovered set — call it
`$DISCOVERED_JSON` below.

**Every dispatch must have returned before you merge.** The merge in Step 4
compares the discovered set against the whole existing model, so a partial set
makes every entry point that a missing worker would have reported look like it
vanished from the codebase. If any dispatch failed or returned something that is
not a JSON array, say so and stop — re-run that batch. Never merge what you have
so far.
## Step 4 — merge into what is already known

**Never write the workers' output straight over `model.json`.** Workers only ever
emit `coverage: "none"` with an empty `watch[]`, so overwriting would silently
erase every flow `/archie:explain` has proved. Merge:

Write the discovered set to a file, then merge:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" merge-inventory "$root"/.archie/tmp/discovered.json
```

It prints `{added, kept, disappeared}`.

`mergeModel` gives discovery the last word on **where** an entry point is (a moved
route gets its new `file:line`) and the existing model the last word on what has
been **learned** about it (`coverage`, `traced_at_sha`, `watch[]` all survive).
`store.js` validates and will reject a record missing evidence, or two ids
that collide on one flow filename. Fix the data, never the validator.

Each disappeared entry is also written into `model.unknowns` by the merge, so it
reaches `open-questions.md` and the `status` count rather than living only in this
conversation's scrollback. It clears itself as soon as the sweep finds the entry
point again.

**Report all three buckets, and report `disappeared` loudly.** An entry point that
was in the model and is no longer found by the sweep is one of three things and
only a human can say which: the route was deleted, the route was renamed, or the
recipe just regressed. Archie keeps the entry rather than dropping it, names it,
and says exactly that — a silently shrinking inventory is the worst possible
outcome, because it looks like progress.

## Bootstrap mode — when every probe returns zero

Do not return an empty inventory as if it were an answer. Work backwards from the
process entry files the fingerprint found (`index.php`, `main.go`,
`Application.java`, `manage.py`, …), read outward from there, emit a recipe from
what you actually find, and record every process whose entry points you could not
derive in `model.unknowns` with a request for a recipe hint.

## Known limitation, stated rather than hidden

Routes registered dynamically — in a loop, from config, by a plugin system — do
not fall out of static sweeping. Record them as an unknown: `"dynamic
registration at <file:line>, count underivable"`.

## Report

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/churn.js" "$root"
```

Print: the count per kind, the top 5 entry points by git churn, and one line
pointing at where to start — churn is free from git and lands on the heart of
the system. Then tell the user that `/archie:explain "<label>"` is the next step.
