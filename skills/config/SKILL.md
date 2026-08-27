---
name: config
description: Change Archie's settings — the language, where the map is written, and what each repository's sweep covers. Use when someone wants to change how Archie behaves, most often the language the narrative is written in.
---

# config — settings

Follow the preamble in the `inventory` skill (repo root, config, language rules).

The settings are small and managed here rather than hand-edited, and they sit at
the level they belong to. What the person answered once for everything — the
language they read in, where their map goes, which repositories are theirs — is
at the top of the store. What is one repository's own — its scope — is in that
repository's store, beside its model.

```json
{ "language": "en", "output": "docs/system-map" }          → $cfgstore/config.json
{ "scope": { "label": "Orders", "paths": ["app/Orders/**"] } }  → $store/config.json
```

Writing either one where the other lives is not a tidiness problem: nothing reads
it there, so the setting is accepted, echoed back, and silently never applied.

- **`language`** — the narrative language. Identifiers are never translated.
- **`scope`** — what the user is responsible for. Narrows the sweep itself, and
  puts a "not a map of the whole system" banner on every rendered page. Omit it
  for a whole-repository map.
- **`output`** — where `wiki` renders to. Relative, and it resolves against the
  **workspace** when there is one, so a rendered map never lands inside a
  repository Archie was only asked to read. In a single-repository run it
  resolves against that repository, as before. Defaults to `wiki/` inside the
  store.

## Changing the scope

Re-derive candidates rather than asking the user to type paths from memory:

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

It is written to that repository's own store, with `"${WS[@]}"`, and — like every
config write — carries the whole object: in a single-repository run that same file
also holds the language and the output, and a write that leaves them out is
refused rather than allowed to drop them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" config "$tmp"/config.json "${WS[@]}"
```

Then say plainly what the change means. **Narrowing does not delete anything** —
entry points already in the model stay, and their traced flows stay; they simply
stop being re-discovered, and the next `/archie:inventory` will report them as
`disappeared` because the sweep no longer reaches them. Say that before writing,
not after. **Widening** costs a re-run of `/archie:inventory` to pick up the
newly-in-scope area, which merges and preserves existing traces.

## Changing the output directory

Files already rendered to the old location are **not** moved or deleted — Archie
does not delete things it did not just write. Say where the old ones are and let
the user remove them.

## Changing a setting

Read the current config, apply the user's request conversationally, show what will
change, then write **the whole object** back to the level it came from — the write
replaces the file, and the top of the store is where the responsibility set lives,
so a language change sent back as only a language takes `repos[]` and `declined[]`
with it. `store.js` refuses that, but the fix is to round-trip what you read, not
to argue with the error. To remove a setting on purpose, write it as `null` —
leaving it out is the accident the refusal is for. Which of the two lines you
run is the whole decision, so pick it by the setting, not by which one is above:

```bash
# scope — that repository's own
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" config "$tmp"/config.json "${WS[@]}"

# language, output, the responsibility set — the whole set's
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$cfg" config "$cfgtmp"/config.json
```

Run the wrong one and the setting is written, reported back as changed, and read
by nothing.

## Changing the language is a translation pass, not a re-trace

Existing flows already carry proven claims. Re-tracing them to change their
language would spend the whole budget and risk losing evidence, so instead:

The language is one setting for the whole responsibility set, so a change to it
is a pass over **every** repository in `repos[]`, not just the one you are
standing in. Translate one repository and the rest keep answering in the old
language, which is worse than not having changed it.

1. For each repository in `repos[]`, derive **that** repository's store the way the
   preamble does — one `$store` per repository, not the one you happen to be standing
   in — and for each flow in its `flows/`, translate **only** the natural-language
   fields: each claim's `text`, the flow `summary`, and each unknown's `text` and
   `why`.
2. Leave every structural field byte-identical: `id`, `evidence`, `tests`,
   `look_at`, `traced_at_sha`, and the six `answers` keys. A translation pass that
   touches a citation has corrupted the evidence.
3. Translate the narrative only. Identifiers — file paths, route labels, class
   and column names, entry-point ids — stay in the original.
4. Save each flow through `store.js`, which re-validates the shape:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$repo" flow "$tmp"/flow.json "${WS[@]}"
   ```

Then re-render:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.js" "$repo" "${WS[@]}"
```

## What config does not do

It does not change what Archie is willing to claim. No setting relaxes the
evidence rule, turns unknowns into prose, or makes `wiki` and `status` generate
content. If someone wants that, the answer is no.
