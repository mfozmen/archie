---
name: wiki
description: Use when someone wants the whole map rendered — a browsable wiki, diagrams, or an OpenAPI draft from what Archie already knows. Purely deterministic; generates no new content.
---

# wiki — "Show me everything"

Follow the preamble in the `inventory` skill (repo root, config, language rules).

## This skill writes nothing of its own

Every page is rendered from `.archie/model.json` and `.archie/flows/*.json` by a
deterministic script. **Do not generate, summarise, embellish or "improve" any
content here — there is no LLM step in this command, by design.** The same model
in must produce the same bytes out; that is what makes the wiki trustworthy and
diffable. If a page reads thin, the fix is `/archie:explain`, never prose written
at render time.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.js" "$root"
```

That writes, under `.archie/wiki/`:

- `md/index.md` — the entry-point table with coverage, plus everything not yet
  documented, and the topology diagram.
- `md/open-questions.md` — every unknown, from the inventory and from each flow.
- `md/<slug>.md` — one page per traced flow, six questions, citations, and a
  mermaid sequence diagram.
- `index.html` — the same content as one self-contained page. No CDN, no network:
  the mermaid bundle is inlined, so it opens from a file share or an air-gapped
  machine.
- `openapi.yaml` — a **draft**. Bodies are not derivable from static evidence and
  are left as visible TODOs rather than invented.

## Report

Print the output paths and offer to open `index.html`. Say plainly how much is
covered — "12 of 48 entry points documented" is more useful than a page count.
Remind the user that `.archie/wiki/` is generated and belongs in `.gitignore`;
`model.json` and `flows/` are the things worth committing.
