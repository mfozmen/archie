---
name: inventory
description: Use when someone asks what is in a codebase, what its entry points are, or wants a first map of an unfamiliar or legacy repository. Sweeps for entry points and writes .archie/model.json.
---

# inventory — "What is in this system?"

## Preamble (every Archie skill does this first)

1. `root="$(git rev-parse --show-toplevel)"`. Not a git repository → say so and stop.
2. If `$root/.archie/config.json` is missing, ask **one** question: which language
   should the narrative be written in? Guess a default from the repo's README and
   offer it. Write the answer to `.archie/config.json` as `{"language":"<code>"}`.
3. Narrative text is written in the configured language. Identifiers — file paths,
   route labels, class names, entry-point ids — are **never** translated.

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

```bash
node -e 'require(process.argv[1]+"/scripts/lib/model").saveRecipe(process.argv[2], JSON.parse(process.argv[3]))' \
  "${CLAUDE_PLUGIN_ROOT}" "$root" "$RECIPE_JSON"
```

Show the recipe to the user. It is hand-editable, and `/archie:recipe "<hint>"`
is the escape hatch for a home-grown router the model has never seen.

## Step 2 — sweep (ripgrep, no tokens)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.js" "$root"
```

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
Merge the arrays and save:

```bash
node -e 'require(process.argv[1]+"/scripts/lib/model").saveModel(process.argv[2], JSON.parse(process.argv[3]))' \
  "${CLAUDE_PLUGIN_ROOT}" "$root" "$MODEL_JSON"
```

`saveModel` validates and will reject a record missing evidence, or two ids that
collide on one flow filename. Fix the data, never the validator.

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
