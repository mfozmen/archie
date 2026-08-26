const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../scripts/lib/model');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'agent-contracts', n), 'utf8'));

test('inventory-worker fixture entries satisfy the model schema', () => {
  const entries = fx('inventory-worker.json');
  assert.ok(Array.isArray(entries) && entries.length >= 2);
  M.validateModel({ version: 1, entries, unknowns: [] }); // throws on violation
});

test('tracer fixture is a valid flow, and still the shape tracer.md promises', () => {
  const flow = fx('tracer.json');
  assert.doesNotThrow(() => M.validateFlow(flow));
  // The schema only checks the key SET. tracer.md asks for the six questions in
  // a fixed order, and the wiki renders them in that order.
  assert.deepStrictEqual(Object.keys(flow.answers), M.ANSWER_KEYS);
  // The whole point of this fixture: guards is left EMPTY rather than filled
  // with a plausible-sounding authorization claim, and the missing guard is
  // written up as an unknown that says where it is missing. A fixture that
  // quietly grew a guard would still validate, and would stop demonstrating the
  // one behavior the prompt spends its worked example on.
  assert.deepStrictEqual(flow.answers.guards, []);
  assert.ok(flow.unknowns.some(u => /restricts who may call/i.test(u.text)),
    'the empty guards must be accounted for in unknowns');
  // "Every unknown needs a why and, where you can name one, a look_at" — the
  // schema makes look_at optional, the fixture is the example of naming one.
  assert.ok(flow.unknowns.length >= 1);
  for (const u of flow.unknowns)
    assert.ok(u.look_at?.file && Number.isInteger(u.look_at.line), `unknown without a look_at: ${u.text}`);
});

test('verifier fixture: valid flow + audit log with only legal actions', () => {
  const out = fx('verifier.json');
  const { _verifier_log, ...flow } = out;
  M.validateFlow(flow);
  assert.ok(_verifier_log.length >= 1);
  assert.ok(_verifier_log.every(l => ['confirmed', 'demoted', 'deleted'].includes(l.action)));
});

test('agent prompt files carry their hard rules', () => {
  const read = (n) => fs.readFileSync(path.join(__dirname, '..', 'agents', n), 'utf8');
  assert.match(read('tracer.md'), /at most 15 files/);
  assert.match(read('tracer.md'), /forbidden/);
  assert.match(read('verifier.md'), /never add, rephrase/);
  assert.match(read('verifier.md'), /When in doubt, demote/);
  assert.match(read('inventory-worker.md'), /ONLY a JSON array/);
});
