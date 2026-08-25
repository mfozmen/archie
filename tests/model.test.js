const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempRepo } = require('./helpers');
const M = require('../scripts/lib/model');

const entry = { id: 'http.POST./api/orders', kind: 'http', label: 'POST /api/orders',
  evidence: [{ file: 'routes/api.php', line: 12 }], coverage: 'none', watch: [] };
const flow = { id: 'http.POST./api/orders', summary: 'Creates an order.',
  answers: { entry: [{ text: 'Handled by OrderController.', evidence: { file: 'routes/api.php', line: 12 } }],
    guards: [], decisions: [], data: [], boundary: [], returns: [] },
  unknowns: [{ text: 'Retry policy unknown', why: 'read from env var not in repo' }],
  traced_at_sha: 'a1b2c3d' };

test('model round-trips and validates', () => {
  const { root } = makeTempRepo();
  assert.strictEqual(M.loadModel(root), null);
  M.saveModel(root, { version: 1, entries: [entry], unknowns: [] });
  const back = M.loadModel(root);
  assert.strictEqual(back.entries[0].label, 'POST /api/orders');
  assert.ok(fs.existsSync(path.join(root, '.archie', 'model.json')));
});

test('invalid model throws with every violation listed', () => {
  const bad = { version: 1, entries: [{ id: '', kind: 'nope', label: 'x', evidence: [], coverage: 'traced', watch: [] }], unknowns: [] };
  assert.throws(() => M.validateModel(bad), (e) =>
    /id/.test(e.message) && /kind/.test(e.message) && /evidence/.test(e.message) && /traced_at_sha/.test(e.message));
});

test('flow round-trips under slug filename; bad flow throws', () => {
  const { root } = makeTempRepo();
  M.saveFlow(root, flow);
  assert.ok(fs.existsSync(path.join(root, '.archie', 'flows', 'http-post-api-orders.json')));
  assert.strictEqual(M.loadFlow(root, flow.id).summary, 'Creates an order.');
  assert.strictEqual(M.listFlows(root).length, 1);
  assert.throws(() => M.validateFlow({ ...flow, answers: { entry: [] } }), /answers/);
});

test('config and recipe round-trip', () => {
  const { root } = makeTempRepo();
  M.saveConfig(root, { language: 'tr' });
  assert.strictEqual(M.loadConfig(root).language, 'tr');
  M.saveRecipe(root, { stack: 'PHP 8 / generic', probes: [{ kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' }] });
  assert.strictEqual(M.loadRecipe(root).probes.length, 1);
  assert.throws(() => M.saveRecipe(root, { stack: 'x', probes: [{ kind: 'http' }] }), /glob|pattern/);
});

test('malformed answers value is rejected, not crashed on', () => {
  assert.throws(() => M.validateFlow({ ...flow, answers: { ...flow.answers, guards: null } }),
    /answers\.guards: must be an array/);
});

test('a malformed optional look_at is rejected', () => {
  assert.throws(() => M.validateFlow({ ...flow,
    unknowns: [{ text: 't', why: 'w', look_at: { file: 'a.php', line: 0 } }] }),
    /unknowns\[0\]\.look_at/);
});

test('a non-array tests[] on a claim is rejected, not crashed on', () => {
  assert.throws(() => M.validateFlow({ ...flow, answers: { ...flow.answers,
    entry: [{ text: 't', evidence: { file: 'a.php', line: 1 }, tests: 'nope' }] } }),
    /answers\.entry\[0\]\.tests: must be an array/);
});

test('two entries that collide on one flow filename are rejected', () => {
  const dup = (id) => ({ ...entry, id });
  assert.throws(() => M.validateModel({ version: 1, unknowns: [], entries: [dup('a.b'), dup('a.b')] }),
    /duplicate id "a\.b"/);
  // Distinct ids, same slug — the silent-overwrite case.
  assert.throws(() => M.validateModel({ version: 1, unknowns: [], entries: [dup('a.b'), dup('a/b')] }),
    /both map to flows\/a-b\.json/);
});

test('a corrupt flow file is named, not rendered and not swallowed', () => {
  const { root } = makeTempRepo();
  M.saveFlow(root, flow);
  fs.writeFileSync(path.join(root, '.archie', 'flows', 'broken.json'), '{ "id": "x" }\n');
  assert.throws(() => M.listFlows(root), /flows\/broken\.json/);

  fs.writeFileSync(path.join(root, '.archie', 'flows', 'broken.json'), 'not json at all');
  assert.throws(() => M.listFlows(root), /flows\/broken\.json/);
});

test('loadFlow validates too', () => {
  const { root } = makeTempRepo();
  fs.mkdirSync(path.join(root, '.archie', 'flows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.archie', 'flows', 'a-b.json'), '{ "id": "a.b" }\n');
  assert.throws(() => M.loadFlow(root, 'a.b'), /a-b\.json/);
});
