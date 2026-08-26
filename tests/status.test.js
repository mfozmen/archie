const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const M = require('../scripts/lib/model');
const { statusReport } = require('../scripts/status');

test('status reports coverage, staleness, unknowns', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1'); const sha = commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [{ text: 'dynamic routes at core/Dispatcher.php:40', why: 'loop-registered' }], entries: [
    { id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }], coverage: 'traced', traced_at_sha: sha, watch: ['a.php'] },
    { id: 'e2', kind: 'cli', label: 'E2', evidence: [{ file: 'a.php', line: 2 }], coverage: 'none', watch: [] } ] });
  M.saveFlow(M.storeFor(root), { id: 'e1', summary: 's', traced_at_sha: sha,
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
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
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
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'http.GET./known', kind: 'http', label: 'GET /known',
      evidence: [{ file: 'routes/api.php', line: 999 }], coverage: 'none', watch: [] } ] });

  // Comparison is per FILE, not per line: line numbers shift on every edit, and a
  // false "new entry point" every time someone adds an import is worse than useless.
  assert.deepStrictEqual(statusReport(root).inventoryDrift.unrepresented, []);
});

test('no recipe means no drift claim, not a drift of zero', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'x'); commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [] });
  assert.strictEqual(statusReport(root).inventoryDrift, null);
});

test('a long drift list is capped, and says how many it did not print', () => {
  const { root } = makeTempRepo();
  for (let i = 0; i < 15; i++) write(root, `routes/r${i}.php`, "<?php\nRoute::get('/x', 'C@i');\n");
  commitAll(root, 'many routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [] });

  const r = statusReport(root);
  // The report itself keeps everything — the cap is a printing concern, and a
  // caller that wants the whole list must be able to get it.
  assert.strictEqual(r.inventoryDrift.unrepresented.length, 15);

  const out = require('node:child_process').execFileSync(process.execPath,
    [require('node:path').join(__dirname, '..', 'scripts', 'status.js'), root], { encoding: 'utf8' });
  const listed = out.split('\n').filter(l => /^ {2}http: /.test(l));
  assert.strictEqual(listed.length, 10);
  assert.match(out, /5 more not shown/);
});

test('drift respects the configured scope', () => {
  const { root } = makeTempRepo();
  write(root, 'app/Orders/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  write(root, 'app/Billing/api.php', "<?php\nRoute::get('/invoices', 'C@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'app/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [] });

  assert.strictEqual(statusReport(root).inventoryDrift.unrepresented.length, 2);
  M.saveConfig(M.storeFor(root), { scope: { label: 'Orders', paths: ['app/Orders'] } });
  // Billing is not drift. It was never in scope, so it is not something the
  // inventory is behind on.
  assert.deepStrictEqual(statusReport(root).inventoryDrift.unrepresented,
    [{ kind: 'http', file: 'app/Orders/api.php' }]);
});

test('the status report says when its drift check was scoped', () => {
  const { root } = makeTempRepo();
  write(root, 'app/Orders/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  write(root, 'app/Billing/api.php', "<?php\nRoute::get('/invoices', 'C@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'app/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'http.GET./orders', kind: 'http', label: 'GET /orders',
      evidence: [{ file: 'app/Orders/api.php', line: 2 }], coverage: 'none', watch: [] } ] });
  M.saveConfig(M.storeFor(root), { scope: { label: 'Orders', paths: ['app/Orders'] } });

  const run = () => require('node:child_process').execFileSync(process.execPath,
    [require('node:path').join(__dirname, '..', 'scripts', 'status.js'), root], { encoding: 'utf8' });
  // Clean drift under a scope must not read as "nothing missing anywhere".
  assert.match(run(), /scope/i);
  assert.match(run(), /Orders/);

  M.saveConfig(M.storeFor(root), {});
  assert.ok(!/scoped to/i.test(run()), 'an unscoped run states no scope');
});

// The four cases below are about what the terminal report SAYS, so they run the
// script rather than statusReport() — the wording is the contract.
const runStatus = (root, ...args) => require('node:child_process').execFileSync(process.execPath,
  [require('node:path').join(__dirname, '..', 'scripts', 'status.js'), ...args], { cwd: root, encoding: 'utf8' });

test('two hits in one file are one drift entry, not two', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/admin.php', "<?php\nRoute::get('/a', 'A@i');\nRoute::post('/b', 'A@s');\n");
  commitAll(root, 'routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [] });
  // Drift is a per-FILE claim: "this file produces hits nothing cites". Listing
  // it once per matching line would turn one missing page into a wall of noise.
  assert.deepStrictEqual(statusReport(root).inventoryDrift.unrepresented,
    [{ kind: 'http', file: 'routes/admin.php' }]);
});

test('a sweep that cannot run is reported as unchecked, never as zero drift', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-notarepo-'));
  try {
    M.saveRecipe(M.storeFor(notARepo), { stack: 'generic', probes: [
      { kind: 'http', glob: '**/*.php', pattern: 'Route::(get|post)' } ] });
    M.saveModel(M.storeFor(notARepo), { version: 1, unknowns: [], entries: [] });
    // `git ls-files` fails outside a repository. "I could not check" and "I
    // checked and found nothing" are different claims and must read differently.
    const d = statusReport(notARepo).inventoryDrift;
    assert.match(d.error, /git ls-files failed/);
    assert.deepStrictEqual(d.unrepresented, []);
    assert.match(runStatus(notARepo), /inventory drift not checked: .*git ls-files failed/);
  } finally {
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});

test('an unlabelled scope is still announced, with a stand-in name', () => {
  const { root } = makeTempRepo();
  write(root, 'app/Orders/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'app/**/*.php', pattern: 'Route::(get|post)' } ] });
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [] });
  M.saveConfig(M.storeFor(root), { scope: { paths: ['app/Orders'] } });          // no label
  const out = runStatus(root);
  assert.match(out, /scoped to a subset of this repository — app\/Orders/);
  assert.match(out, /everything outside was never swept/);
});

test('status.js run with only flags reports on the directory it was run in', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'x'); commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [{ text: 'who calls this?', why: 'no caller found' }], entries: [] });
  // `--unknowns` is not a path. Treating it as one would look for a model in a
  // directory called "--unknowns" and report "no model" to someone who has one.
  const out = runStatus(root, '--unknowns');
  assert.match(out, /0 entry points/);
  assert.match(out, /\[inventory\] who calls this\?/);
});
