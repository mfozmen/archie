const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const M = require('../scripts/lib/model');
const S = require('../scripts/staleness');

test('matchesWatch handles * and **', () => {
  assert.ok(S.matchesWatch('app/Http/OrderController.php', 'app/Http/*.php'));
  assert.ok(S.matchesWatch('app/Domain/Order/Ship.php', 'app/Domain/**/*.php'));
  assert.ok(!S.matchesWatch('app/Http/Sub/Deep.php', 'app/Http/*.php'));
});

test('tryRun separates a clean non-zero exit from a broken command', () => {
  const { tryRun } = require('../scripts/lib/exec');
  assert.strictEqual(tryRun('git', ['-C', '/nonexistent-repo-xyz', 'status']), null); // ran, said no
  assert.throws(() => tryRun('archie-no-such-binary-xyz', []), /failed to run/);       // never silently null
});

test('traced entry goes stale when a watched file changes after trace', () => {
  const { root } = makeTempRepo();
  write(root, 'app/Http/OrderController.php', '<?php // v1');
  const sha = commitAll(root, 'add controller');
  M.saveModel(root, { version: 1, unknowns: [], entries: [{
    id: 'http.POST./api/orders', kind: 'http', label: 'POST /api/orders',
    evidence: [{ file: 'routes/api.php', line: 1 }], coverage: 'traced',
    traced_at_sha: sha, watch: ['app/Http/*.php'] }] });
  write(root, 'app/Http/OrderController.php', '<?php // v2');
  commitAll(root, 'change controller');
  const model = M.loadModel(root);
  const staled = S.markStale(model, S.changedFilesSince(root, sha));
  assert.deepStrictEqual(staled, ['http.POST./api/orders']);
  assert.strictEqual(model.entries[0].coverage, 'stale');
});

test('an unreachable traced SHA degrades that entry, it does not crash', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1'); commitAll(root, 'a');
  M.saveModel(root, { version: 1, unknowns: [], entries: [{
    id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }],
    coverage: 'traced', traced_at_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', watch: ['a.php'] }] });
  const model = M.loadModel(root);
  const changed = S.changedFilesSince(root, model.entries[0].traced_at_sha);
  assert.strictEqual(changed, null);                       // unreachable, reported as such
  assert.deepStrictEqual(S.markStale(model, changed), ['e1']); // unprovable => stale, never "fine"
});

test('unrelated change does not stale', () => {
  const { root } = makeTempRepo();
  write(root, 'watched.php', 'a'); const sha = commitAll(root, 'w');
  M.saveModel(root, { version: 1, unknowns: [], entries: [{
    id: 'cli.orders.sync', kind: 'cli', label: 'orders:sync',
    evidence: [{ file: 'watched.php', line: 1 }], coverage: 'traced',
    traced_at_sha: sha, watch: ['watched.php'] }] });
  write(root, 'other.php', 'b'); commitAll(root, 'o');
  const model = M.loadModel(root);
  assert.deepStrictEqual(S.markStale(model, S.changedFilesSince(root, sha)), []);
  assert.strictEqual(model.entries[0].coverage, 'traced');
});
