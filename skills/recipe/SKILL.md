---
name: recipe
description: Correct the search recipe when the sweep missed your framework's entry points. Use when the inventory reported a zero-hit probe or does not understand a home-grown router. Edits the per-repo search recipe.
---

# recipe — fix what the sweep looks for

Follow the preamble in the `inventory` skill (repo root, config, language rules).

This is the escape hatch. Archie has no per-framework parsers by design: an LLM
derives a ripgrep recipe once, and ripgrep does the sweeping. When a codebase
registers its routes in a way no model has seen, the recipe is what you correct —
not the tool.

## 1. Read what is there

```bash
cat "$store"/recipe.json
```

No recipe yet → tell the user to run `/archie:inventory` first and stop.

## 2. Apply the user's hint as concrete probe edits

The hint is usually one of: a probe that found nothing, a directory the sweep
never looked in, or a registration idiom the recipe does not match. Turn it into
`{ kind, glob, pattern }` changes and **show the user the diff before writing**.
Keep patterns as tight as the idiom allows — a probe matching half the codebase
costs more than a probe that misses.

## 3. Save it

Write the corrected recipe to a file, then store it — via a file, never as a
command-line argument, since a pattern is full of characters a shell will eat:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" recipe "$tmp"/recipe.json "${WS[@]}"
```

It rejects a probe missing a `kind`, `glob` or `pattern`, naming the file and the
reason.

## 4. Try it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.js" "$repo" "${WS[@]}"
```

Report the new per-probe counts against the old ones, and offer to re-run
`/archie:inventory` to fold the new hits into the model. Existing traced flows
survive: inventory adds entry points, it does not discard what `explain` proved.

## If a probe still returns zero

Say so. A zero-hit probe after a correction means the idiom is still not what we
think it is — the honest move is another hint from the user, or an entry in
`model.unknowns`, never a pattern loosened until it matches something.
