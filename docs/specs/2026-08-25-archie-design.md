# Archie — Design Spec

Date: 2026-08-25 · Status: approved design, pre-implementation

## 1. Problem & primary user

An engineer inherits a long-lived codebase with thin documentation and no reliable oral
history. They are expected to understand it "by reading the code", which does not scale.
Archie turns that reading into an accumulating, evidence-backed system map.

**Primary user (v1): the engineer onboarding onto the system.** Success metric: days to
productive instead of weeks. Product-facing feature catalogs and backlog generation are
explicitly out of scope for v1 (they can later be derived from the same model).

## 2. Locked constraints

| Topic | Decision |
|---|---|
| Distribution | Open source, standalone Claude Code plugin. Zero hard dependency on any company tooling. |
| Language support | Language-agnostic. No per-framework parsers shipped. |
| Environment | Opportunistic enrichment: if a knowledge base / issue tracker / grooming plugin is installed, use it; never require it. |
| Unit of analysis | Two phases: one cheap inventory pass, then selective per-flow depth, accumulating over time. |
| Trace boundary | A traced flow never follows an outbound call into another system. Outbound calls are labelled boxes at the boundary. **Locked.** |
| Analysis boundary | One repository at a time. Whether Archie *knows about* more than one is a separate question, and being answered — see #26 and §3. |
| Knowledge store | Structural model (JSON) is the single source of truth; every human-facing format is rendered from it. |
| Evidence bar | Static code (`file:line`) plus existing tests. Anything not provable goes to `unknowns[]`. No guessing, ever. |
| Architecture | Composite skill set + persistent model (a one-shot analyzer and a workflow-fleet were considered and rejected). |

## 3. Store layout

> **Being revised (#26).** The store below lives inside the analyzed repository, which
> assumes the repository being read and the directory being written are the same place.
> They are not, and a responsibility spanning several repositories has no single repo to
> keep its map in. `storeFor(repoPath, workspace)` is now the one place that decides where
> a store goes; given a workspace it answers `<workspace>/.archie/repos/<name>`, which
> leaves analyzed repositories as read-only inputs. Nothing is wired to it yet — what is
> written below is still what a run produces today.


```
.archie/
  config.json       # user preferences (managed by /archie:config, never hand-edited)
  recipe.json       # search recipe for this stack (model-derived, user-correctable)
  model.json        # entry-point inventory + index — single source of truth
  flows/<id>.json   # one file per traced flow (git-diff friendly)
  tmp/              # scratch JSON on its way into the store — gitignored
  wiki/             # rendered output — gitignored; relocatable via config.output
```

`config.output` moves the rendered set anywhere inside the repository (`docs/system-map/`,
say) for teams who want the map browsable, or reviewable in pull requests. It is validated:
an absolute or escaping path is refused, since this is the one setting that turns into a
write outside the repo. Everything else in `.archie/` stays where it is — the store is the
source of truth and is not a matter of preference.

Entry-point record:

```json
{
  "id": "http.POST./api/orders/{id}/ship",
  "kind": "http | queue | cron | cli | event | public-api",
  "label": "POST /api/orders/{id}/ship",
  "evidence": [{ "file": "routes/api.php", "line": 112 }],
  "coverage": "none | traced | stale",
  "traced_at_sha": "a1b2c3d",
  "watch": ["app/Http/OrderController.php", "app/Domain/Order/*.php"]
}
```


Flow record (`flows/<slug>.json` — slug = id lowercased, non-alphanumerics → `-`):

```json
{
  "id": "http.POST./api/orders/{id}/ship",
  "summary": "Queues the order for shipment; returns 202 before any carrier call.",
  "answers": {
    "entry":    [ {"text": "...", "evidence": {"file":"...","line":1}, "tests": [{"file":"...","line":1}]} ],
    "guards":   [],
    "decisions":[],
    "data":     [],
    "boundary": [],
    "returns":  []
  },
  "unknowns": [ {"text": "...", "why": "...", "look_at": {"file":"...","line":1}} ],
  "traced_at_sha": "a1b2c3d"
}
```

Each answer entry is one claim: `text` (narrative, configured language), mandatory
`evidence`, optional `tests[]` (absence renders as `(untested)`). An empty `guards` array
is itself rendered ("no guard found ⚠"). Renderers consume exactly this shape.

**Staleness is LLM-free:** `git diff --name-only <traced_at_sha>..HEAD` intersected with
`watch[]`; any overlap marks the flow `stale`. Deterministic, seconds, zero tokens.

## 4. Command surface — four questions

### `/archie:inventory` — "What is in this system?"

Prints a per-kind count of entry points, the top-5 by git churn (commits touching their
files — churn ranking is free from git and points at the heart of the system), and writes
`model.json`. Four steps:

- **Step 0 — stack fingerprint (deterministic).** Manifests (`composer.json`,
  `package.json`, `go.mod`, `pom.xml`, …) give framework + version with certainty.
  Deployment manifests (Dockerfile, compose, k8s, Procfile) give the process list
  (web/worker/cron) and external dependencies (DB, cache, queues, object storage) — most of
  the topology diagram falls out here without reading a line of code.
- **Step 1 — recipe derivation (LLM, once, cheap).** The model's existing framework
  knowledge is converted once into a *search recipe*: `.archie/recipe.json`, a list of
  `{kind, glob, regex}` probes. The file is hand-editable and conversationally updatable via
  `/archie:recipe "<hint>"` — the escape hatch for home-grown routers.
- **Step 2 — sweep (ripgrep, zero tokens).** Every probe runs as `rg --json`. Comment-line
  hits are filtered here where possible. Per-probe hit counts are reported; **a probe with 0
  hits is surfaced as a suspicion** ("recipe may be wrong — fix with /archie:recipe"),
  never passed silently.
- **Step 3 — verify + enrich (LLM, schema-bound).** Hits become entry-point records: is it
  real, its label, the first handler stop, its `watch[]`. **Threshold rule:** under ~150
  hits, a single worker handles all; above, split on directory boundaries and fan out in
  parallel. Workers never trace chains — that is `explain`'s job. Raw source never enters
  the main context; workers return schema-validated JSON only.
- **Bootstrap mode (no recipe matches).** Work backwards from process entry files
  (`index.php`, `main.go`, `Application.java`, …), discover what can be discovered, emit a
  recipe from it. Processes whose entry points cannot be derived land in `unknowns[]` with a
  request for a recipe hint. No "never returns empty" promise — an honest contract instead.
- **Re-running is safe and additive.** Discovery owns *where* an entry point is — a moved
  route gets its new `file:line`. The existing model owns what has been *learned* about it:
  `coverage`, `traced_at_sha` and `watch[]` survive a re-run untouched. An entry the sweep
  no longer finds is never dropped: it is kept, demoted from `traced` to `stale` so it stops
  counting as documented, and recorded in `unknowns[]` — a deleted route, a renamed one and
  a recipe that stopped matching are indistinguishable from here, and only a human can say
  which. That unknown clears itself when the entry point is found again, though the entry
  stays `stale` until `explain` re-checks it.
- **Known limitation (stated, not hidden):** dynamically registered routes
  (loops, config-driven, plugin systems) do not fall out of static sweeping; they land in
  `unknowns[]` as "dynamic registration at <file:line>, count underivable".
- **v1 scope rule for `event`:** only externally triggered events (webhooks, queue
  messages) are inventory rows. Internal framework events surface inside flow pages, not as
  inventory noise.

### `/archie:explain <entry point>` — "How does this work?"

Produces one page per flow, on screen and in `.archie/flows/<id>.json`.

1. **Every flow page answers the same six questions:** Where does it enter? → Who may call
   it? → What does it decide? → What data does it touch? → What leaves the boundary? → What
   does it return? Fixed template; every answer cites `file:line`. An unanswerable question
   is never left blank — it becomes "UNKNOWN + why + where to look". ("Who may call it? —
   no guard found ⚠" is a valid and valuable answer.)
2. **An adversarial verifier checks the page.** A second agent independently opens every
   cited location; its only power is to delete or demote. Code doesn't support the claim →
   claim is dropped or demoted to UNKNOWN. When in doubt: demote. One round (plus a single
   fix round if a citation was outright wrong), then done.
3. **The approved page is persisted**; the entry point becomes `traced` with
   `traced_at_sha`, and `watch[]` is derived from the page's own citations — every file
   a claim, a test or a `look_at` names. Derived rather than self-reported, so it cannot
   be half-filled: `watch[]` is the entirety of staleness, and an empty one means the page
   rots while still claiming to be current. It undercounts deliberately — a file that was
   opened and cited nothing is absent, since no claim depends on it — which can hide new
   behavior the page ought to mention, but can never falsify what the page already says.

**Directing a trace.** `--focus "<hint>"` tells the tracer where to spend its file
budget — the answer to "you stopped too early" and "look over here". A hint says where to
look, not what to conclude: it buys attention, never belief. Anything it leads to still
needs its own `file:line`, and a hint the code does not bear out becomes an UNKNOWN saying
so rather than a claim reshaped to match what someone expected to find.

Sub-details bound for implementation: claims are matched to existing test lines where
possible (unmatched claims carry an `(untested)` tag); the tracer opens at most ~15 files —
beyond that it splits the flow into sub-flows recorded as `coverage: none`; **refresh of a
stale flow is incremental**: the old flow JSON plus the `traced_at_sha..HEAD` diff are given
to the tracer ("update this page against this diff") — refresh must be much cheaper than
first trace, or nobody refreshes and the wiki dies.

### `/archie:wiki` — "Show me everything"

**Rendering is typesetting, not writing** — a deterministic script, no LLM, zero tokens,
same model → same wiki. Produces:

1. Single-file searchable HTML (`.archie/wiki/index.html`): grouped sidebar, search,
   embedded mermaid. One file on purpose — mail it, drop it in chat, open it serverless.
2. Markdown set (`.archie/wiki/md/`) for porting to any docs platform.
3. Two diagram families from the model: **topology** (service + processes + external
   dependencies, from step-0 fingerprint + boundary answers) and per-flow **sequence
   diagrams** (from the six answers; no payload detail).
4. **OpenAPI draft** (`openapi.yaml`) from HTTP entry points: paths/methods/status codes are
   evidence-backed; body schemas only as far as derivable, the rest marked `TODO`. A draft
   is an honest skeleton, not an invented spec.

Visibility rules: untraced entry points are listed as "not yet documented" (the wiki never
pretends completeness), and UNKNOWNS are first-class — a block per page plus one aggregated
"Open questions" page.

### `/archie:status` — "Where are we?"

Pure script, no LLM: coverage percentage, stale flows (with the refresh command), open
question count (`--unknowns` lists them).

## 5. First run & configuration

- On the first Archie command in a repo without `.archie/config.json`, ask **three**
  questions, once, and never again:
  1. **Output language** (suggest a guess from the README's language).
  2. **Scope — what is the user responsible for?** On a large repo, inventorying everything
     buries the part they own. Archie proposes candidates with the evidence behind each — a
     `CODEOWNERS` assignment, how many of the user's own commits touched a directory, or, as
     a last resort, that a directory merely exists — and asks. It never picks one: a scope
     chosen silently would quietly decide what the map is allowed to contain. "The whole
     repository" is offered as a real option and is the default when nothing is chosen.
     Scope narrows the sweep itself, not its results, and **every page rendered under a
     scope says it is not a map of the whole system**.
  3. **Where the wiki is written** — defaults to `.archie/wiki/`, and may be any path inside
     the repository. A map nobody browses is a map nobody reads.

  This is a widening of the original "ask one question" rule, made deliberately: the two
  added questions decide what the map is allowed to contain and where anyone will find it,
  and guessing either produces a confidently wrong artifact. They are asked once.
- `/archie:config <request>` changes anything conversationally ("write in Turkish",
  "keep diagram labels in English"); the user never hand-edits the file.
- Language rule: narrative text follows the configured language; identifiers (paths, file
  names, symbols, ids) are never translated. Narrative lives in the flow files' `text`
  fields, so a language change never re-analyzes code — but it does require a cheap LLM
  pass that re-translates existing `text` fields in place; all structural fields survive
  untouched.
- Config lives in-repo (`.archie/config.json`) so teammates cloning the repo share it.
  A user-level default is YAGNI for v1.

## 6. Subagent placement

| Command | Agents | Why |
|---|---|---|
| inventory | Parallel fan-out (above threshold) | Real parallelism + context isolation; raw code never enters the main context |
| explain | One deep tracer + one verifier | Chain-tracing is inherently sequential; isolation still pays; the verifier's independence is the honesty mechanism |
| wiki / status | None | Deterministic template work; an LLM would only add variance |

Workers ship as the plugin's own `agents/*.md` definitions, relying only on capabilities
present in every Claude Code install.

### Model per agent

| Agent | `model:` | Why |
|---|---|---|
| `inventory-worker` | `sonnet` | High-volume fan-out over a tight schema. A wrong answer here fails **loudly** — `validateModel` rejects it — so the cheaper model's mistakes get caught by the store, not shipped into the wiki. |
| `tracer` | `opus` | Multi-file control-flow reading, where the failure is **silent**: a plausible wrong `file:line` validates fine and reads like evidence. |
| `verifier` | `opus` | Its silent failure is confirming a wrong claim — the one failure the whole design exists to prevent. It runs once per explain, so the saving from a cheaper model is negligible against that risk. |

The rule is **spend where the failure is silent**, not where the work is hard.

Aliases, not pinned model IDs: a public plugin that hard-codes `claude-opus-5` breaks on the
day that ID moves. `haiku` is deliberately unused — it is a generation behind (4.5) with a
200K context, and its only advantage over the others is price, never capability; Archie's
cheapest agent still has an honesty invariant to uphold. `fable` is unused too — the alias
exists, but the model costs twice Opus, its edge is long-horizon agentic work rather than the
bounded single-shot tasks here, and it is documented to do worse on heavily prescriptive
prompts — which is exactly what these three agents are.

Claude Code's own docs suggest `sonnet` for review-type agents, but that advice is a cost
argument ("balance of capability and cost"), and cost arguments are volume arguments. The
high-volume agent here is already on `sonnet`; the verifier is once-per-explain, where the
saving is noise and the silent-failure risk is not.

None of this is measured. It is reasoned from where the failure modes are, and the first live
run on a real legacy repo either confirms it or changes it.

Reasoning effort is deliberately **not** pinned here. Agent frontmatter has no field for it —
across 182 installed agent definitions the keys in use are `name`, `description`, `model`,
`tools`, `maxTurns`, `color`, `skills`, `memory`, `mode` — so pinning it would mean inventing a
key, and an unrecognized key is silently ignored rather than rejected. Effort stays whatever the
user's session is set to.

## 7. v1 scope line

**In:** `inventory`, `explain`, `wiki`, `status`, `recipe`, `config`.
**Out (v2+):** product-facing feature catalog, backlog/epic generation (feeding a grooming
plugin), a "do everything" wrapper command, a data-ownership map (who owns
which *data* — unrelated to `config.scope`, which merely narrows what this repo's sweep
looks at),
feature-flag/dead-code inventory.

Two entries moved off this list rather than being delivered. **Multi-repo flow tracing** stays
out and always will: it is the trace boundary above, which is locked. What is coming is not
tracing across repositories but *knowing about* several — a different thing that the old wording
conflated. **User-level config** was listed as "defaults", a convenience nobody needed; the
responsibility set that replaces it is not a default but the one piece of state that cannot live
in any single repository. See #26.

## 8. Known limits (contract, not embarrassment)

Dynamic dispatch, reflection, DI indirection, and config-driven behavior degrade to
UNKNOWNS. Evidence comes from code and tests only — no runtime observation in v1.

## 9. Implementation discipline

- **TDD.** Every deterministic component (sweep merge, staleness intersection, model
  read/write, renderers, leak scan) gets its tests written first. Prompt-only surfaces
  (skills, agent definitions) are exercised through their JSON contracts with fixtures.
- **Open-source hygiene is blocking.** See `REVIEW.md` §1: nothing company-, employer-, or
  customer-specific anywhere — files, commit messages, or release notes. All examples
  synthetic (a generic web-shop domain: orders, shipments, notifications).
- **Runtime.** All deterministic scripts are Node ≥ 18 with **zero npm dependencies**
  (`mermaid.min.js` is vendored and inlined into the single-file wiki — the no-CDN,
  works-offline guarantee). The sweep uses `rg --json` when ripgrep is present and falls
  back to plain recursive grep (degraded: no JSON, no comment filtering) when it is not.
