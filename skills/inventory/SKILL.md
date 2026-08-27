---
name: inventory
description: Inventory every entry point across the repositories you are responsible for — what is in this system? Use when someone asks what is in a codebase, what its entry points are, or wants a first map of an unfamiliar or legacy system. Sweeps for entry points and writes the model.
---

# inventory — "What is in this system?"

## Preamble (every Archie skill does this first)

**1. Where are you standing?** Two cases, and the first is just the second with
one repository in it — do not treat them as different features.

```bash
root="$(git rev-parse --show-toplevel 2>/dev/null)"
```

- **It printed a path.** You are inside one repository. The store is
  `$repo/.archie`, as it has always been.
  ```bash
  repo="$root"; WS=()
  ```
- **It failed.** You are in a directory that holds repositories — the normal way
  to run Archie, because nobody's responsibility is one repo. Each repository's
  store lives under the workspace, and **the repositories themselves are never
  written to**. If the directory holds no repositories either, say so and stop;
  that is neither case.
  ```bash
  ws="$PWD"; WS=(--workspace "$ws")
  ```
  There is no single `$repo` here yet. The rest of this skill is written for
  **one** repository, and in a workspace you run it once per repository in the
  set. Report per repository as you go rather than only at the end: on a set of
  any size, a silent run looks like a hung one.

**Per repository**, before anything that touches that repo's data — and not
before, since `$repo` does not exist until here:

```bash
repo="$ws/<name>"       # in the single case this was already set above
store="$(node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/model').storeFor('$repo', '${ws:-}')")"
tmp="$store/tmp"
mkdir -p "$tmp"
```

`$store` is where that repository's data lives, and every path this skill reads
or writes hangs off it — asked for, never assembled, because where it lands is
exactly what changes between the two cases. `$tmp` is inside it and never a
shared path: two repositories writing scratch to one directory would overwrite
each other's half-written files.

`"${WS[@]}"` goes on **every** script call that reads or writes one
repository's data — model, flow, recipe, sweep. It is empty in the single case,
so one line works for both and neither is a special case.

**Config is the exception, and getting it wrong costs the user the whole
feature.** The config is not one repository's data: it holds the responsibility
set, which spans them. It lives at the top of the store, so it is addressed by
the workspace itself — with **no** `--workspace`, because that flag is what
sends a path down into `repos/<name>/`.

```bash
cfg="${ws:-$root}"      # the workspace, or the single repository
cfgstore="$(node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/model').storeFor('$cfg')")"
cfgtmp="$cfgstore/tmp"
mkdir -p "$cfgtmp"
```

Write it with `"$cfg"` and no `"${WS[@]}"`. Pass the flag here and the set lands
inside one repository's store while the check below looks at the top — so first
run never finds it, and the whole point of `declined[]` (never asking twice) is
lost silently.

**2. Config.** `$cfgstore/config.json`. Missing → run the **first-run setup**
below. It decides what the map is allowed to contain, so ask; do not pick for
the user.

**3. Language.** Narrative text is written in the configured language.
Identifiers — file paths, route labels, class names, entry-point ids — are
**never** translated.

## First-run setup — asked once

### In a workspace: which repositories are yours?

Gather the evidence first. This script reads and decides nothing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/workspace.js" "$ws" "$handle"
```

**Ask for the handle before you run it**, once: *"What is your CODEOWNERS
handle, so I can see where you are named directly?"* It cannot be derived —
`CODEOWNERS` names `@handles` and git knows emails, and guessing a mapping
between them would be inventing evidence. Without it, `youAreNamed` comes back
`null`, meaning *not looked at* rather than *no*.

Then ask the real question in the user's own words: **"Which parts of this are
you responsible for?"** A team, a product, an area — whatever they say. Match
that sentence against the gathered evidence yourself; that judgement is why a
model is doing this and not a regex.

Rank what you propose by how strong the evidence is:

1. `youAreNamed` — they are in that repository's `CODEOWNERS` by name.
2. `teams` matching what they described.
3. `commits` — they have worked in it.

Show each proposal **with the evidence for it**, naming the `codeownersFile` it
was read from. A proposal with no evidence to show is not a proposal, it is a
guess.

Then **ask what is missing.** This is not a politeness step and must not be
trimmed as one: both signals undercount by construction. You can be responsible
for a repository you have never committed to, and on a real workspace only a
third named a team at all. The set cannot be completed without the user.

Store the answer as `repos` (each with the `why` that put it there) and
`declined` (offered, and they said no). `declined` exists **only** so the same
question is not asked twice — it is not permanent, hides nothing, and records
that the person said "not mine", never a claim about whose it is.

### Every run, in a workspace: anything new?

Re-run `workspace.js`. A repository in neither list is one nobody has been asked
about — a fresh clone, or a checkout that was not there at setup. Ask about that
one, once, with its evidence, and write the answer to whichever list it belongs
in. Do not re-ask about anything already in either list.

### Both cases

**Language.** Which language should the narrative be written in? Guess a default
from the READMEs `workspace.js` reported and offer it. Asked once for the whole
set, not per repository — it is how this person reads, not a property of a
checkout. Identifiers are never translated.

**Scope inside a repository.** Within a repo you own, `scope.js` still narrows
which directories the sweep reads. Offer it; take "the whole repository" when
chosen. Scope is a convenience, not something to talk anyone into.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scope.js" "$repo"
```

When the user has named a team — and in a workspace they already did, answering
which repositories are theirs — pass it, so `CODEOWNERS` is read for that team's
areas rather than the whole file. The email argument is what git history is
matched against; it defaults to that checkout's own, which is not always the one
they commit under:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scope.js" "$repo" "$(git -C "$repo" config user.email)" @org/orders-team
```

A scope belongs to the repository it scopes, so it is written to **that
repository's** store, with `"${WS[@]}"` — not into the answers below:

```json
{ "scope": { "label": "Orders", "paths": ["app/Orders/**", "routes/api.php"] } }
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" config "$tmp"/config.json "${WS[@]}"
```

**Where the wiki is written.** Default is inside the store, which keeps
generated files out of everyone's way. Offer something browsable —
`system-map/` under the workspace, or `docs/system-map/` in the single-repo
case. A relative `output` resolves against the workspace when there is one, so
in workspace mode it never lands inside a repository Archie only read, and each
repository's map goes in its own directory under it — one setting, one place to
look, and no repository rendering over another's pages.

Then write and store the answers:

```json
{ "workspace": "/abs/path/to/checkouts",
  "handle": "@you",
  "repos": [{ "name": "orders-api", "why": "@org/payments in .github/CODEOWNERS; 84 of your commits" }],
  "declined": ["something-else"],
  "language": "en",
  "output": "system-map" }
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$cfg" config "$cfgtmp"/config.json
```

Omit `scope` entirely for a whole-repository map — an empty `paths` and no
`scope` mean the same thing, and neither adds a caveat to the rendered pages.
Every later run reads these; `/archie:config` changes any of them.

Scratch JSON goes under `tmp/` inside that repository's store (`mkdir -p` it
first), never a fixed path in `/tmp`: two Archie sessions on two different
repositories would otherwise write the same file at the same time. (Two sessions
on the *same* repository are not supported — they would race on `model.json`
itself, which no temp path can fix.)

In the single-repository case the store is `$repo/.archie`, so `tmp/` and
`wiki/` are generated files inside the repo and belong in its `.gitignore`. In a
workspace they are under the workspace instead, and there is nothing to ignore —
Archie writes nothing into the repositories it reads.

## The rule that outranks everything else

Never state how the system behaves without a `file:line` you actually read.
Anything you cannot prove goes into `unknowns[]` with a reason. A short honest
inventory is the product; a long plausible one is the failure mode.

## Step 0 — fingerprint (deterministic, no tokens)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fingerprint.js" "$repo"
```

Manifests give the stack; deployment files give the process list and the external
dependencies. Most of the topology falls out here without reading any code.

## Step 1 — derive the recipe (LLM, once)

From the fingerprint, write `$store/recipe.json`:

```json
{ "stack": "<what you concluded>", "probes": [{ "kind": "http", "glob": "routes/**/*.php", "pattern": "Route::(get|post|put|patch|delete)" }] }
```

`kind` is one of `http`, `queue`, `cron`, `cli`, `event`, `public-api`. Write it with:

Write it to a file, then store it. **Always via a file, never as a command-line
argument** — a route label or a pattern containing a quote would break the shell
before node ever saw it, and a real model runs to hundreds of entries.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" recipe "$tmp"/recipe.json "${WS[@]}"
```

Show the recipe to the user. It is hand-editable, and `/archie:recipe "<hint>"`
is the escape hatch for a home-grown router the model has never seen.

## Step 2 — sweep (ripgrep, no tokens)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.js" "$repo" "${WS[@]}"
```

The sweep reads the configured scope itself and narrows the file list before any
probe runs — filtering afterwards would have spent the work already.

Print the per-probe counts and **every zero-hit warning verbatim** — verbatim
because the warning says which half of the probe found nothing, and summarising
it back into "the recipe is wrong" is how someone rewrites a pattern that was
never tried. Never let a zero pass silently. The hits land in `$store/sweep.json`.

## Step 3 — classify the hits (subagents, schema-bound)

Read `$store/sweep.json` and dispatch the **inventory-worker** agent:

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
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" merge-inventory "$tmp"/discovered.json "${WS[@]}"
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
node "${CLAUDE_PLUGIN_ROOT}/scripts/churn.js" "$repo" "${WS[@]}"
```

Print: the count per kind, the top 5 entry points by git churn, and one line
pointing at where to start — churn is free from git and lands on the heart of
the system. Then tell the user that `/archie:explain "<label>"` is the next step.
