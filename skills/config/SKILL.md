---
name: config
description: Use when someone wants to change how Archie behaves for this repository — most often the language the narrative is written in.
---

# config — settings for this repository

Follow the preamble in the `inventory` skill (repo root, config, language rules).

`.archie/config.json` is small and managed here rather than hand-edited:

```json
{ "language": "en" }
```

## Changing a setting

Read the current config, apply the user's request conversationally, show what will
change, then write it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" config "$root"/.archie/tmp/config.json
```

## Changing the language is a translation pass, not a re-trace

Existing flows already carry proven claims. Re-tracing them to change their
language would spend the whole budget and risk losing evidence, so instead:

1. For each flow in `.archie/flows/`, translate **only** the natural-language
   fields: each claim's `text`, the flow `summary`, and each unknown's `text` and
   `why`.
2. Leave every structural field byte-identical: `id`, `evidence`, `tests`,
   `look_at`, `traced_at_sha`, and the six `answers` keys. A translation pass that
   touches a citation has corrupted the evidence.
3. Translate the narrative only. Identifiers — file paths, route labels, class
   and column names, entry-point ids — stay in the original.
4. Save each flow through `store.js`, which re-validates the shape:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" flow "$root"/.archie/tmp/flow.json
   ```

Then re-render:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.js" "$root"
```

## What config does not do

It does not change what Archie is willing to claim. No setting relaxes the
evidence rule, turns unknowns into prose, or makes `wiki` and `status` generate
content. If someone wants that, the answer is no.
