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

## Workflow

- Branch off `master`, one topic per branch.
- [Conventional Commits](https://www.conventionalcommits.org/) for messages.
- Open a PR — CI runs the tests and Claude posts an advisory review. The verdict
  stays with a human.
- Keep `.claude-plugin/plugin.json` and `package.json` versions in sync.

## Layout

| Path | What lives there |
|---|---|
| `scripts/` | Deterministic Node core — model store, sweep, staleness, churn, renderers |
| `skills/` | The user-facing command prose, one directory per command |
| `agents/` | The three subagent definitions and their JSON output contracts |
| `docs/specs/` | The design spec — argue against it before changing behavior |
| `docs/plans/` | The implementation plan |
| `tests/` | `node --test` suites, plus agent-contract fixtures |
