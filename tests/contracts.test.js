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

test('tracer fixture is a valid flow', () => { M.validateFlow(fx('tracer.json')); });

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
