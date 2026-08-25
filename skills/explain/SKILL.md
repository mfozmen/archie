---
name: explain
description: Use when someone asks how a specific endpoint, job, command or webhook works end to end. Traces one entry point, verifies every claim against the code, and writes .archie/flows/<slug>.json.
---

# explain — "How does this work?"

Follow the preamble in the `inventory` skill (repo root, config, language rules).

## 1. Resolve the argument to one entry point

Load `.archie/model.json`. No model → tell the user to run `/archie:inventory`
first and stop. Fuzzy-match the argument against entry-point labels and ids. More
than one plausible match → ask the user which one with AskUserQuestion, listing
the candidates. Never guess between two entry points.

## 1b. A focus hint, when the user gave one

`/archie:explain "<entry>" --focus "<hint>"` — anything after `--focus` is the
user telling the tracer where to spend its 15-file budget:

```
/archie:explain "POST /api/orders/{id}/ship" --focus "the retry path through the queue worker"
/archie:explain "orders:sync" --focus "you stopped at the repository layer last time; go into the mapper"
```

Pass the hint through to the tracer verbatim, labelled as a hint. **A hint says
where to look, not what to conclude.** It buys attention, never belief: a claim
the hint suggested still needs its own `file:line`, and a hint that turns out to
be wrong about the code produces an unknown saying so, not a claim shaped to
match it. If the user's hint and the code disagree, the code wins and the page
says the hint was not borne out.

This is also the answer to "you stopped too early". The tracer splits past 15
files into sub-flows recorded as `coverage: "none"`; a focus hint on the next run
points it at the branch that matters instead of the one it happened to reach
first.

## 2. Trace it

Dispatch the **tracer** agent with the repo root, the entry-point record, the
current HEAD sha (`git -C "$root" rev-parse HEAD`), and the focus hint if there
was one. The agents hold no shell —
`Read`, `Grep`, `Glob` and nothing else — so anything they cannot read out of a
file has to arrive in the prompt.

If the entry's coverage is `stale`, make it a **refresh** instead of a fresh
trace — pass the previous flow JSON and the diff:

```bash
git -C "$root" cat-file -e <traced_at_sha>^{commit} && git -C "$root" diff <traced_at_sha>..HEAD
```

Refresh must be much cheaper than the first trace, or nobody refreshes and the
wiki dies. The tracer re-verifies only what the diff touched.

**If `traced_at_sha` is unreachable — after a squash-merge, a rebase, a `git gc`,
or in a shallow clone — there is no diff to refresh against.** Do not pass a
partial or empty diff and call the result a refresh: that would carry forward
claims nobody re-checked. Say plainly that the recorded SHA is gone, and fall
back to a fresh trace.

## 3. Verify it adversarially

Dispatch the **verifier** agent on the tracer's output. Its only powers are to
delete a claim or demote it to an unknown; it can never add or reword one. That
asymmetry is the whole point — it is the one step that cannot introduce a
fabrication.

If the verifier **deleted** anything, run **one** corrective tracer round on just
those claims, then stop. One round, plus one fix round. Not a loop.

## 4. Persist

Strip `_verifier_log` (show it to the user, do not save it), then:

Write the flow to a file and store it — via a file, never as a command-line
argument, since a claim like "it's rejected" would break a shell-quoted one:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" flow /tmp/archie-flow.json
```

Then, and only then, update this entry in the model:

- `coverage` → `"traced"`.
- `traced_at_sha` → `git -C "$root" rev-parse HEAD`.
- `watch[]` → **do not hand-build this.** Derive it from the flow so it cannot be
  forgotten or half-filled:

  ```bash
  node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/model').watchFromFlow(require('/tmp/archie-flow.json')).join('\n')"
  ```

  It returns every file the page cites — from a claim, from a test, from a
  `look_at`. **This is the field that makes staleness work.** An empty `watch[]`
  means the flow will never be noticed going out of date, and the page will
  quietly rot while claiming to be current.

  It undercounts on purpose: a file the tracer opened and cited nothing from is
  not in it. No claim depends on such a file, so a change there cannot falsify the
  page — but it could hide new behavior the page ought to mention, and nothing
  will flag that. Say so if the user asks what staleness does and does not catch.

With all three set, write the model out and store it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/store.js" "$root" model /tmp/archie-model.json
```

Use `model`, not `merge-inventory`: you are editing one entry of the model you
just read, not folding in a fresh discovery pass.

## 5. Show it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.js" "$root" --md
```

then print `.archie/wiki/md/<slug>.md`.

## The honesty rules, restated because this is where they bite

- Six questions, always all six: where does it enter, who may call it, what does
  it decide, what data does it touch, what leaves the boundary, what does it
  return.
- An unanswerable question is never left blank — it becomes an unknown with a
  reason and a place to look.
- **"Who may call it? — no guard found ⚠" is a valid and valuable answer.** Do
  not let anyone, including yourself, soften it into a plausible guard.
- Outbound calls to other services are labelled, never followed.
