# Archie

Understand a legacy codebase by reading it — step by step, with evidence, never with guesses.

Archie is a [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin for the day you
inherit a system nobody can explain: years of code, thin documentation, product owners who
don't know their own features. Point Archie at the repo and it builds — incrementally, run by
run — a browsable, evidence-backed map of what the system actually does.

> [!NOTE]
> Archie is **read-only against your code** and **allergic to assumptions**. Every claim it
> writes carries a `file:line` citation backed by the code (and, where they exist, the tests).
> Anything it cannot prove goes to an explicit **UNKNOWNS** list instead of being invented —
> in a legacy system, that list is often the most valuable page of all.

## The four questions

Archie's surface is four commands, each answering one plain question:

| Command | Question | What you get |
|---|---|---|
| `/archie:inventory` | **What is in this system?** | Every entry point — HTTP endpoints, queue consumers, scheduled jobs, CLI commands — counted by kind, each with its `file:line`, ranked by git churn so you know where the heart of the system beats. Runs once, takes minutes. |
| `/archie:explain <entry point>` | **How does this work?** | A one-page trace of that flow: what it does, who may call it, what it decides, what data it touches, what leaves the boundary, what it returns — every step cited, verified claims matched to tests, gaps listed as UNKNOWNS. |
| `/archie:wiki` | **Show me everything** | A single-file searchable HTML wiki (plus a markdown set) rendered from everything learned so far: topology diagram, per-flow sequence diagrams, an honest OpenAPI draft. Undocumented entry points are listed as such — the wiki never pretends to be complete. |
| `/archie:status` | **Where are we?** | Coverage (documented / total), flows gone stale since their code changed, and the open-questions count. |

Two supporting commands: `/archie:recipe` teaches Archie where *your* home-grown framework
defines its routes when the built-in detection misses, and `/archie:config` sets preferences
(output language, etc.) by conversation — you never hand-edit a config file.

## How it stays honest

- **A structural model is the single source of truth.** Everything Archie learns lands in
  `.archie/` as evidence-carrying JSON; markdown, HTML, diagrams, and OpenAPI are *rendered*
  from it, deterministically. Same model, same wiki — no drift between formats.
- **Claims are verified adversarially.** After a flow is traced, a second agent re-opens every
  cited location with one power only: to delete or demote claims the code doesn't support.
  When in doubt, a claim is demoted to UNKNOWN — never kept on vibes.
- **Staleness is detected without an LLM.** Each traced flow records the commit it was traced
  at and the files it depends on; a plain `git diff` intersection flags it stale the moment
  the code moves on.

## How it scales to a real legacy repo

Archie is **incremental by design**. `inventory` is one cheap pass (fingerprint the stack →
derive a search recipe → sweep with ripgrep → verify hits); depth comes later, one
`explain` at a time, each producing one page. The wiki fills over weeks, not in one heroic —
and shallow — big-bang run.

Archie is **language-agnostic**: no per-framework parsers are shipped. Detection works from
manifest files and model-derived search recipes, and the recipe is yours to correct
(`/archie:recipe "routes are registered in Core/Dispatcher via the $routes array"`).

Archie is **standalone**: it needs nothing beyond Claude Code and git. When richer tools
happen to be installed (a knowledge base, an issue tracker, a grooming plugin), it uses them
opportunistically — never as a dependency.

## What Archie is not

- Not a one-shot "document my repo" button — those produce plausible prose with invented
  details; Archie would rather show you a short page and an honest UNKNOWNS list.
- Not a cross-service tracer (v1). Flows stop at the repo boundary; outbound calls are shown
  as labelled boxes.
- Not a runtime profiler. Evidence comes from code and tests, not from executing your system.

## Status

Design phase. The full design lives in [`docs/specs/`](./docs/specs/).

## License

[MIT](./LICENSE)
