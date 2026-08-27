const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const SURFACES = ['inventory', 'explain', 'wiki', 'status', 'recipe', 'config'];

// There are no commands/*.md wrappers: a skill is already invocable as
// /archie:<name>, and shipping both put two entries per name in the slash
// picker. This asserts the surface stays skill-only — a reintroduced wrapper
// would silently double the menu again.
test('every surface is a skill, with no command wrapper beside it', () => {
  assert.ok(!fs.existsSync(path.join(root, 'commands')), 'commands/ must not come back');
  for (const s of SURFACES) {
    const skill = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(skill.length > 200, s + ' skill non-trivial');
    if (['wiki', 'status'].includes(s)) assert.match(skill, /scripts\/(render|status)\.js/);
    if (s === 'inventory') assert.match(skill, /inventory-worker/);
    if (s === 'explain') { assert.match(skill, /tracer/); assert.match(skill, /verifier/); }
  }
});

test('wiki and status skills forbid LLM content generation', () => {
  for (const s of ['wiki', 'status'])
    assert.match(fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8'), /deterministic|no LLM/i);
});

// The verifier's whole value is that it is the one step which cannot introduce a
// fabrication. That guarantee cannot rest on prose alone while the agent holds a
// tool that writes.
test('no agent is granted a tool that can write', () => {
  for (const a of ['inventory-worker', 'tracer', 'verifier']) {
    const src = fs.readFileSync(path.join(root, 'agents', a + '.md'), 'utf8');
    const tools = (src.match(/^tools:\s*(.+)$/m) || [])[1];
    assert.ok(tools, a + ' declares a tools list');
    for (const banned of ['Bash', 'Write', 'Edit', 'NotebookEdit'])
      assert.ok(!new RegExp('\\b' + banned + '\\b').test(tools), `${a} must not be granted ${banned}`);
  }
});

// Directing a trace must never become a way to lower the evidence bar: a focus
// hint says where to look, not what to conclude.
test('the focus hint is documented as steering, never as evidence', () => {
  const explain = fs.readFileSync(path.join(root, 'skills', 'explain', 'SKILL.md'), 'utf8');
  const tracer = fs.readFileSync(path.join(root, 'agents', 'tracer.md'), 'utf8');
  for (const [name, src] of [['explain skill', explain], ['tracer', tracer]]) {
    assert.match(src, /focus/i, name + ' documents the focus hint');
    assert.match(src, /where to look, not what to (conclude|find)/i,
      name + ' states that a hint is not evidence');
  }
});

// Every write to .archie/ goes through store.js, from a file. Inline `node -e`
// with JSON in argv breaks on the first apostrophe in a route label or a claim.
test('no skill writes to .archie by hand', () => {
  let seen = 0;
  for (const s of SURFACES) {
    const skill = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(!/node -e/.test(skill), s + ' must not inline a node -e writer');
    // node -p is allowed, but only to READ. The moment it saves, it is passing
    // data on a command line again, which is the thing store.js exists to stop.
    for (const m of skill.matchAll(/node -p [^\n]+/g))
      assert.ok(!/save/i.test(m[0]), `${s}: node -p must not write (${m[0].slice(0, 60)})`);
    // Matched on the variable NAME, not on one particular name. The previous
    // version looked for "$root", every skill was renamed to "$repo", and this
    // loop then matched nothing at all — a check that had stopped checking and
    // stayed green for it. The count below is the part that makes that visible.
    let checked = 0;
    for (const m of skill.matchAll(/store\.js"? "\$\w+" (\S+)/g)) {
      checked++;
      assert.ok(['recipe', 'config', 'model', 'flow', 'merge-inventory'].includes(m[1]),
        `${s}: store.js target "${m[1]}" is not one store.js accepts`);
    }
    seen += checked;
  }
  // A silent test is worse than a failing one: it reports success for work it
  // never did. If a rename ever empties the pattern again, this is what says so.
  assert.ok(seen >= 5, `store.js call sites found: ${seen} — the pattern has gone stale`);
});

// A fixed /tmp path collides between two sessions working on two repositories.
test('scratch files are scoped to the repository', () => {
  for (const s of SURFACES) {
    const skill = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(!/\/tmp\/archie/.test(skill), s + ' must not use a fixed /tmp path');
  }
});

// A store-touching script call that forgets "${WS[@]}" writes into the analyzed
// repository instead of the workspace — silently, and only in workspace mode,
// which is the one case nobody tests by hand. It is the exact failure moving the
// store was meant to prevent, so it is checked mechanically rather than by
// reading the prose carefully.
const STORE_SCRIPTS = ['store', 'sweep', 'render', 'status', 'churn', 'staleness'];
test('every store-touching call in every skill carries the workspace argument', () => {
  for (const s of SURFACES) {
    const src = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    for (const line of src.split('\n')) {
      const m = line.match(/scripts\/(\w+)\.js"([^\n]*)/);
      if (!m || !STORE_SCRIPTS.includes(m[1])) continue;
      // The config is the one thing that is NOT one repository's data — it
      // holds the responsibility set, which spans them — so it is addressed by
      // the workspace itself. Passing --workspace here is what sends it down
      // into repos/<name>/, where the first-run check will never find it and
      // every run asks the questions again.
      if (/ config /.test(m[2])) {
        assert.ok(!m[2].includes('${WS[@]}'),
          `${s}: the config write must NOT carry "\${WS[@]}" — ${line.trim()}`);
        assert.match(m[2], /"\$cfg"/, `${s}: the config write must target $cfg — ${line.trim()}`);
        continue;
      }
      assert.ok(m[2].includes('${WS[@]}'), `${s}: ${m[1]}.js call is missing "\${WS[@]}" — ${line.trim()}`);
      assert.ok(!m[2].includes('"$root"'), `${s}: ${m[1]}.js still takes $root — ${line.trim()}`);
    }
  }
});

// The preamble is the only place that decides where Archie writes, so the claim
// the whole workspace design rests on has to survive an edit to it.
test('the preamble promises that analyzed repositories are not written to', () => {
  const pre = fs.readFileSync(path.join(root, 'skills', 'inventory', 'SKILL.md'), 'utf8');
  assert.match(pre, /never\s+written\s+to/i);
  assert.match(pre, /WS=\(--workspace/, 'the workspace argument must be defined in the preamble');
  assert.match(pre, /WS=\(\)/, 'the single-repository case must define it empty, not omit it');
});

// Both discovery signals undercount by construction — you can be responsible for
// a repository you never committed to, and most repos name no team at all. The
// step that repairs that reads like a confirmation prompt, so it says in the
// prompt itself that it is not one.
test('asking what is missing is marked as load-bearing, not a courtesy', () => {
  const pre = fs.readFileSync(path.join(root, 'skills', 'inventory', 'SKILL.md'), 'utf8');
  assert.match(pre, /not a politeness step|must not be\s*\n?trimmed/i);
  assert.match(pre, /undercount/i, 'the reason must be stated, or the rule is arbitrary');
});

// A stored "no" is there to stop a repeated question and nothing else. Written
// loosely it reads like a verdict on ownership, which Archie has no evidence for.
test('declined is described as a memory of the asking, not a claim about ownership', () => {
  const pre = fs.readFileSync(path.join(root, 'skills', 'inventory', 'SKILL.md'), 'utf8');
  assert.match(pre, /not asked twice|same\s+question is not asked/i);
  assert.match(pre, /not permanent|never a claim about whose/i);
});

// Every skill uses $repo and $tmp in its commands. The preamble is the only
// place either is defined, and a command referring to an unset variable does not
// fail loudly — it writes to a path built from an empty string.
test('the preamble defines every variable the skills go on to use', () => {
  const pre = fs.readFileSync(path.join(root, 'skills', 'inventory', 'SKILL.md'), 'utf8');
  for (const v of ['repo=', 'ws=', 'tmp=', 'WS=']) assert.ok(pre.includes(v), `preamble never sets ${v}`);
  // The workspace case has no single repository, so it has to say what $repo
  // means there rather than leaving it to be guessed from the single-repo line.
  assert.match(pre, /once per repository|repo="\$ws\//,
    'the preamble must say what $repo is when there is a workspace');
});

// $root is what `git rev-parse --show-toplevel` printed, and it is only set on
// the single-repository branch of the preamble. Anywhere else it is empty in a
// workspace, so a command using it runs against the wrong directory or none at
// all. Four such uses survived a rename in one PR by not being script calls —
// they were `git -C "$root"` and a raw `cat "$root/.archie/..."` — which is why
// this looks for the variable rather than for a shape of command.
test('$root appears only where the preamble defines it', () => {
  for (const s of SURFACES) {
    const src = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!line.includes('$root')) return;
      const inPreamble = s === 'inventory' && /repo="\$root"|cfg="\$\{ws:-\$root\}"/.test(line);
      assert.ok(inPreamble, `${s}:${i + 1} uses $root outside the preamble — ${line.trim()}`);
    });
  }
});

// The first-run setup asks three things, and the language question is the one
// that goes missing: it is a single paragraph, it has no script call to anchor
// it, and every later run reads `language` out of a config the user was never
// asked to fill. It vanished once already, in a restructuring, and nothing
// failed.
test('the first-run setup still asks which language to write in', () => {
  const src = fs.readFileSync(path.join(root, 'skills', 'inventory', 'SKILL.md'), 'utf8');
  const setup = src.split('## First-run setup')[1];
  assert.ok(setup, 'the first-run setup section is gone entirely');
  assert.match(setup, /\*\*Language\.\*\*/,
    'first-run setup no longer asks for a language, but config still carries one');
});

// The store is not beside the repository any more, so any path written as
// `.archie/<something>` names a location that only exists in the single case.
// The first version of this looked only for quoted shell paths, and missed two
// stale lines of prose in one skill that were wrong in exactly the same way —
// a reader follows a sentence as readily as a command. So: no member of the
// store is addressed by that name at all, in code or in text. `$repo/.archie`
// with nothing after it is left alone; that is the preamble explaining the
// single case, not a path anything reads.
test('no skill names a path inside .archie', () => {
  for (const s of SURFACES) {
    const src = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    for (const m of src.matchAll(/\.archie\/\S+/g))
      assert.fail(`${s}: store path built by hand — ${m[0]}. Ask storeFor() instead.`);
  }
});
