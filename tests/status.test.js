const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const M = require('../scripts/lib/model');
const { statusReport } = require('../scripts/status');

test('status reports coverage, staleness, unknowns', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1'); const sha = commitAll(root, 'a');
  M.saveModel(root, { version: 1, unknowns: [{ text: 'dynamic routes at core/Dispatcher.php:40', why: 'loop-registered' }], entries: [
    { id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }], coverage: 'traced', traced_at_sha: sha, watch: ['a.php'] },
    { id: 'e2', kind: 'cli', label: 'E2', evidence: [{ file: 'a.php', line: 2 }], coverage: 'none', watch: [] } ] });
  M.saveFlow(root, { id: 'e1', summary: 's', traced_at_sha: sha,
    answers: { entry: [{ text: 't', evidence: { file: 'a.php', line: 1 } }], guards: [], decisions: [], data: [], boundary: [], returns: [] },
    unknowns: [{ text: 'retry policy', why: 'env-driven' }] });
  write(root, 'a.php', 'v2'); commitAll(root, 'change');
  const r = statusReport(root);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.traced, 0);            // e1 just went stale
  assert.strictEqual(r.stale, 1);
  assert.deepStrictEqual(r.staleIds, ['e1']);
  assert.strictEqual(r.unknowns.length, 2);   // 1 inventory + 1 flow
  assert.strictEqual(r.pct, 0);
});

test('status notices entry points the sweep finds but the model has never seen', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/known', 'C@i');\n");
  write(root, 'routes/admin.php', "<?php\nRoute::get('/admin/orders', 'A@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(root, { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(root, { version: 1, unknowns: [], entries: [
    { id: 'http.GET./known', kind: 'http', label: 'GET /known',
      evidence: [{ file: 'routes/api.php', line: 2 }], coverage: 'none', watch: [] } ] });

  const r = statusReport(root);
  // routes/admin.php produces http hits and is cited by no entry at all.
  assert.deepStrictEqual(r.inventoryDrift.unrepresented, [{ kind: 'http', file: 'routes/admin.php' }]);
});

test('a moved line in a known file is not mistaken for a new entry point', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/known', 'C@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(root, { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(root, { version: 1, unknowns: [], entries: [
    { id: 'http.GET./known', kind: 'http', label: 'GET /known',
      evidence: [{ file: 'routes/api.php', line: 999 }], coverage: 'none', watch: [] } ] });

  // Comparison is per FILE, not per line: line numbers shift on every edit, and a
  // false "new entry point" every time someone adds an import is worse than useless.
  assert.deepStrictEqual(statusReport(root).inventoryDrift.unrepresented, []);
});

test('no recipe means no drift claim, not a drift of zero', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'x'); commitAll(root, 'a');
  M.saveModel(root, { version: 1, unknowns: [], entries: [] });
  assert.strictEqual(statusReport(root).inventoryDrift, null);
});
