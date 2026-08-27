# Archie

[![test](https://github.com/mfozmen/archie/actions/workflows/test.yml/badge.svg)](https://github.com/mfozmen/archie/actions/workflows/test.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_archie&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfozmen_archie)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_archie&metric=coverage)](https://sonarcloud.io/component_measures?id=mfozmen_archie&metric=coverage)
[![Maintainability](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_archie&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_archie)
[![Reliability](https://sonarcloud.io/api/project_badges/measure?project=mfozmen_archie&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=mfozmen_archie)

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
| `/archie:wiki` | **Show me everything** | A single-file searchable HTML wiki (plus a markdown set) rendered from everything learned so far: topology diagram, per-flow sequence diagrams, an honest OpenAPI draft. Undocumented entry points are listed as such, and if you scoped Archie to your own area, every page says so — the wiki never pretends to be complete. |
| `/archie:status` | **Where are we?** | Coverage (documented / total), flows gone stale since their code changed, entry points the sweep now finds that the inventory has never seen, and the open-questions count. Costs no tokens. |

Two supporting commands: `/archie:recipe` teaches Archie where *your* home-grown framework
defines its routes when the built-in detection misses, and `/archie:config` sets preferences by
conversation — output language, what you are responsible for, and where the wiki is
written. You never hand-edit a config file.

When a trace stops short of what you wanted, point it:

```
/archie:explain "POST /api/orders/{id}/ship" --focus "the retry path through the queue worker"
```

A hint says where to look, not what to conclude. It buys the tracer's attention, never its
belief — anything it finds there still needs its own `file:line`, and a hint the code does
not bear out comes back as an UNKNOWN saying so.

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

## Install

```
/plugin marketplace add mfozmen/archie
/plugin install archie@archie
```

Archie needs Claude Code, git, and Node 18 or newer. It has zero npm dependencies.
[ripgrep](https://github.com/BurntSushi/ripgrep) is used when present and falls back
to a built-in scan when it is not.

## Quickstart

Run these in the repository you want to understand. Archie writes only to `.archie/`,
plus the wiki directory you choose on the first run.

**1. What is in this system?**

```
/archie:inventory
```

On the first run it asks three questions, once: what language to write in, **what
you are responsible for**, and where to put the output. For the second it proposes
candidates with the evidence behind each — a `CODEOWNERS` assignment, how many of
your own commits touched a directory — and you confirm or edit them. Scope narrows
the sweep itself, and every page it produces — the index, each flow page, the open
questions, the OpenAPI draft — then says outright that it is **not a map of the
whole system**. Take the whole repository if you want it; scope is a
convenience, not a recommendation.

```
http         31  routes/**/*.php =~ Route::(get|post|put|patch|delete)
queue         8  app/Jobs/**/*.php =~ implements ShouldQueue
cron          3  app/Console/Kernel.php =~ ->(daily|hourly|cron)\(
cli          12  app/Console/Commands/**/*.php =~ protected \$signature

54 entry points · 4 kinds

Most-changed entry points (last 6 months):
  1. POST /api/orders/{id}/ship   · 47 commits · routes/api.php:112
  2. orders:sync                  · 31 commits · app/Console/Commands/SyncOrders.php:21
  3. shipment.notification        · 22 commits · app/Jobs/SendShipmentNotification.php:14

Start with the top one: /archie:explain "POST /api/orders/{id}/ship"
```

If a probe reports **0 hits**, Archie says which half of it found nothing: a glob that
matched no file never tried its pattern, and a pattern that found nothing in the files it
was given is a different problem. Either way `/archie:recipe "<hint>"` is what fixes it,
and either way Archie says so rather than reporting an empty inventory as an answer.

**2. How does this work?**

```
/archie:explain "POST /api/orders/{id}/ship"
```

Produces one page answering the same six questions every time, each claim cited, then
runs an adversarial pass whose only power is to delete or demote claims the code does
not support:

```
## Who may call it?

**no guard found ⚠**

## What does it decide?

- Only an order in state draft may ship; anything else is rejected. — `app/Domain/Order/Order.php:210` · tests: `tests/Feature/ShipOrderTest.php:44`

## Unknowns

- ⚠ Nothing in this repository restricts who may call this route. — No middleware on
  the route and no authorization check in the controller · look at `routes/api.php:112`
```

That empty **guards** section is not a gap in the report. It *is* the report.

**3. Show me everything**

```
/archie:wiki
```

Renders to the directory you chose (`.archie/wiki/` by default) — a markdown set, a
single self-contained `index.html` that
opens with no network, and an OpenAPI draft whose underivable parts are left as visible
TODOs. Nothing here is generated by a model: the wiki is rendered deterministically from
the model, so the same input always produces the same bytes.

**4. Where are we?**

```
/archie:status
```

```
54 entry points · 12 documented (22%) · 2 stale
  stale: http.POST./api/orders/{id}/ship  → refresh with /archie:explain "..."
9 open questions → --unknowns to list
```

Staleness costs no tokens: each traced flow records the commit it was traced at and the
files it depends on, and a plain `git diff` intersection flags it the moment the code
moves on.

## What to commit

Commit `.archie/model.json` and `.archie/flows/` — that is the knowledge, and it diffs
cleanly in review. Add `.archie/tmp/` to `.gitignore`, and the wiki directory too unless you
picked somewhere in the repo on purpose: a map reviewed in pull requests is a legitimate
reason to commit rendered output.

## Where the name came from

Two candidates, and the honest one wins.

**Architecture**, because the thing it produces is a system map. **Archaeology**, because of
what actually happens on the way there: you are not designing anything. You are brushing dirt
off something somebody else buried, working out what it was for from what is left of it, and
writing *purpose unknown* on the label more often than you would like.

The second reading is the accurate one, which makes it the one that counts. The UNKNOWNS list
is the excavation notebook.

## Status

**v0.1 — complete, partly proven.** Being precise about that, because this is a tool
about not overstating what you know:

- The deterministic half — fingerprint, sweep, churn, staleness, and every renderer — is
  covered by tests and has been run end to end against a real public repository
  (`expressjs/express`): 157 hits swept, zero-hit probes correctly surfaced as
  suspicions, model → markdown → HTML → OpenAPI all rendered.
- The agent half — `inventory-worker`, `tracer`, `verifier` — has its output contracts
  pinned by schema-validated fixtures, but has **not yet been run against a live
  codebase**. Expect the prompts to need tuning on first real use.

See the [design](./docs/specs/) for the full contract and
[open issues](https://github.com/mfozmen/archie/issues) for known limits.

## License

[MIT](./LICENSE)
