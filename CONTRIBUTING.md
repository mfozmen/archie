# Contributing to Archie

## Ground rules

1. **TDD.** Deterministic code (anything under `scripts/`) gets its failing test
   written first. Run `npm test` — it uses the built-in `node --test` runner.
2. **Zero dependencies.** Node ≥ 18, no npm packages, runtime or dev. If you
   think you need one, open an issue first.
3. **Honesty invariants are not negotiable.** See [`REVIEW.md`](./REVIEW.md) §2 —
   no claim without evidence, the verifier may only delete or demote, and the
   rendering surfaces stay LLM-free.
4. **Workflow changes get security review.** See [`REVIEW.md`](./REVIEW.md) §3.
   The CI workflows hold real tokens; never check out untrusted code into a
   privileged run, and never reach for `pull_request_target`.
5. **Open-source hygiene is blocking.** Nothing company-, employer-, or
   customer-specific anywhere, including commit messages and release notes. All
   examples use a synthetic web-shop domain (orders, shipments, notifications).
   `scripts/leak-scan.sh` runs as a pre-push hook — enable it once with:

   ```bash
   git config core.hooksPath .githooks
   ```

   The scanner needs a local pattern file it will never see in git: create
   `.leak-patterns` (gitignored) with one case-insensitive regex per line.
   Committing that list would itself be the leak.

   The hook only sees what goes through git. Issue, PR, and release text does
   not, so write it to a file and scan that before sending — unenforced, and
   yours to remember:

   ```bash
   bash scripts/leak-scan.sh --file body.md && gh issue create --body-file body.md
   ```

## Workflow

- Branch off `master`, one topic per branch.
- [Conventional Commits](https://www.conventionalcommits.org/) for messages.
- Open a PR — CI runs the tests and Claude posts an advisory review. The verdict
  stays with a human.
- Keep `.claude-plugin/plugin.json` and `package.json` versions in sync.

## Releasing

A GitHub release is the switch that publishes the npm package. The version in
`package.json` and `.claude-plugin/plugin.json` is the version users get.

1. Bump `version` in both files, update the behavior and tests, and merge the PR
   to `master` after CI passes.
2. Create a release tagged `vX.Y.Z` on `master`. Write the notes to a file so the
   leak scanner can check them first:

   ```bash
   bash scripts/leak-scan.sh --file release-notes.md
   gh release create vX.Y.Z --target master \
     --title "vX.Y.Z — a short description" \
     --notes-file release-notes.md
   ```

3. Publishing the release starts `.github/workflows/publish.yml`. It runs the
   tests again and publishes `@mfozmen/archie` with npm trusted publishing and
   provenance. No npm token is stored in the repository.
4. Confirm the result:

   ```bash
   npm view @mfozmen/archie version dist-tags
   ```

   `latest` must point at the new version, and the npm page should show the
   provenance attestation. If the workflow fails, fix the cause and re-run that
   run with `gh run rerun <run-id>`; npm will reject publishing the same version
   twice.

### One-time trusted publisher setup

The trust is already configured for this repository. If the package is ever
recreated, npm requires it to exist before a trust can be added: publish one
bootstrap version first, then run

```bash
npx npm@latest trust github @mfozmen/archie \
  --file publish.yml --repo mfozmen/archie --allow-publish
```

Never add an `NPM_TOKEN` secret. OIDC is the authentication.

## Layout

| Path | What lives there |
|---|---|
| `scripts/` | Deterministic Node core — model store, sweep, staleness, churn, renderers |
| `skills/` | The user-facing command prose, one directory per command |
| `agents/` | The three subagent definitions and their JSON output contracts |
| `opencode/` | The opencode plugin entry point — registers the skills, commands and read-only subagents, and sets `CLAUDE_PLUGIN_ROOT` for shell execution |
| `.opencode/plugin/` | The local adapter that loads `opencode/plugin.js` when this repository is opened in opencode |
| `docs/specs/` | The design spec — the living contract. Argue against it before changing behavior, and change it in the same PR that changes behavior |
| `tests/` | `node --test` suites, plus agent-contract fixtures |
