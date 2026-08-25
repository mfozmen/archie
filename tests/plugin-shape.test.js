const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const SURFACES = ['inventory', 'explain', 'wiki', 'status', 'recipe', 'config'];

test('every command has a skill and every skill mentions its script or agent', () => {
  for (const s of SURFACES) {
    assert.ok(fs.existsSync(path.join(root, 'commands', s + '.md')), s + ' command');
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
  assert.match(fs.readFileSync(path.join(root, 'commands', 'explain.md'), 'utf8'), /focus/i);
});
