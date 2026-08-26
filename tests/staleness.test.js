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
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [{
    id: 'http.POST./api/orders', kind: 'http', label: 'POST /api/orders',
    evidence: [{ file: 'routes/api.php', line: 1 }], coverage: 'traced',
    traced_at_sha: sha, watch: ['app/Http/*.php'] }] });
  write(root, 'app/Http/OrderController.php', '<?php // v2');
  commitAll(root, 'change controller');
  const model = M.loadModel(M.storeFor(root));
  const staled = S.markStale(model, S.changedFilesSince(root, sha));
  assert.deepStrictEqual(staled, ['http.POST./api/orders']);
  assert.strictEqual(model.entries[0].coverage, 'stale');
});

test('an unreachable traced SHA degrades that entry, it does not crash', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1'); commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [{
    id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }],
    coverage: 'traced', traced_at_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', watch: ['a.php'] }] });
  const model = M.loadModel(M.storeFor(root));
  const changed = S.changedFilesSince(root, model.entries[0].traced_at_sha);
  assert.strictEqual(changed, null);                       // unreachable, reported as such
  assert.deepStrictEqual(S.markStale(model, changed), ['e1']); // unprovable => stale, never "fine"
});

test('unrelated change does not stale', () => {
  const { root } = makeTempRepo();
  write(root, 'watched.php', 'a'); const sha = commitAll(root, 'w');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [{
    id: 'cli.orders.sync', kind: 'cli', label: 'orders:sync',
    evidence: [{ file: 'watched.php', line: 1 }], coverage: 'traced',
    traced_at_sha: sha, watch: ['watched.php'] }] });
  write(root, 'other.php', 'b'); commitAll(root, 'o');
  const model = M.loadModel(M.storeFor(root));
  assert.deepStrictEqual(S.markStale(model, S.changedFilesSince(root, sha)), []);
  assert.strictEqual(model.entries[0].coverage, 'traced');
});

test('a non-ASCII watched path still goes stale', () => {
  const { root } = makeTempRepo();
  write(root, 'app/sipariş.php', 'v1');
  const sha = commitAll(root, 'add');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [{
    id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'app/sipariş.php', line: 1 }],
    coverage: 'traced', traced_at_sha: sha, watch: ['app/*.php'] }] });
  write(root, 'app/sipariş.php', 'v2'); commitAll(root, 'change');
  const model = M.loadModel(M.storeFor(root));
  assert.deepStrictEqual(S.markStale(model, S.changedFilesSince(root, sha)), ['e1']);
});

test('an entry that was never traced is never staled, not even by an unreachable SHA', () => {
  const model = { version: 1, unknowns: [], entries: [
    { id: 'untraced', kind: 'http', label: 'U', evidence: [{ file: 'a.php', line: 1 }],
      coverage: 'none', watch: ['a.php'] },
    { id: 'already-stale', kind: 'http', label: 'S', evidence: [{ file: 'a.php', line: 1 }],
      coverage: 'stale', watch: ['a.php'] } ] };
  // changed === null stales every TRACED entry; entries with no trace to invalidate
  // must keep their own coverage word instead of being relabelled 'stale'.
  assert.deepStrictEqual(S.markStale(model, null), []);
  assert.strictEqual(model.entries[0].coverage, 'none');
  assert.strictEqual(model.entries[1].coverage, 'stale');
});

test('main with no argument runs against the current directory', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1');
  const sha = commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [{
    id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }],
    coverage: 'traced', traced_at_sha: sha, watch: ['a.php'] }] });
  write(root, 'a.php', 'v2'); commitAll(root, 'change');
  const cwd = process.cwd();
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try { process.chdir(root); code = S.main([]); } finally { console.log = log; process.chdir(cwd); }
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(lines, ['stale: e1']);
  assert.strictEqual(M.loadModel(M.storeFor(root)).entries[0].coverage, 'stale'); // and it was persisted
});
