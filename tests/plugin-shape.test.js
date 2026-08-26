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
  for (const s of SURFACES) {
    const skill = fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(!/node -e/.test(skill), s + ' must not inline a node -e writer');
    // node -p is allowed, but only to READ. The moment it saves, it is passing
    // data on a command line again, which is the thing store.js exists to stop.
    for (const m of skill.matchAll(/node -p [^\n]+/g))
      assert.ok(!/save/i.test(m[0]), `${s}: node -p must not write (${m[0].slice(0, 60)})`);
    for (const m of skill.matchAll(/store\.js"? "\$root" (\S+)/g))
      assert.ok(['recipe', 'config', 'model', 'flow', 'merge-inventory'].includes(m[1]),
        `${s}: store.js target "${m[1]}" is not one store.js accepts`);
  }
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
