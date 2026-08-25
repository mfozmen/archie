const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { makeTempRepo, write } = require('./helpers');
const { hasBin } = require('../scripts/lib/exec');
const { sweep } = require('../scripts/sweep');

const recipe = { stack: 'generic', probes: [
  { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' },
  { kind: 'queue', glob: 'jobs/**/*.php', pattern: 'implements ShouldQueue' } ] };

function commitFixture(root) {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
}

test('sweep finds hits, filters comments, reports zero-probes', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', [
    "<?php",
    "Route::get('/orders', 'OrderController@index');",
    "// Route::post('/orders/legacy', 'Legacy@x');  — dead, commented",
    "Route::post('/orders', 'OrderController@store');" ].join('\n'));
  commitFixture(root);
  const res = sweep(root, recipe);
  assert.strictEqual(res.hits.length, 2);
  assert.deepStrictEqual(res.hits.map(h => h.line), [2, 4]);
  assert.ok(res.hits.every(h => h.kind === 'http' && h.file === 'routes/api.php'));
  assert.strictEqual(res.counts.find(c => c.kind === 'http').hits, 2);
  assert.strictEqual(res.zeroProbes.length, 1);
  assert.strictEqual(res.zeroProbes[0].kind, 'queue');
});

// The equivalence test: without it, "same model in -> same output out" is a wish.
// Multi-file on purpose: with one file, any hit order looks deterministic, so a
// single-file fixture cannot catch rg parallelising the file list out of order.
test('rg and grep paths agree on the same fixture', () => {
  const { root } = makeTempRepo();
  for (const name of ['api', 'admin', 'internal', 'public', 'webhooks']) {
    write(root, `routes/${name}.php`,
      `<?php\nRoute::get('/${name}/orders', 'C@i');\n// Route::post('/x','Y@z');\nRoute::post('/${name}/orders', 'C@s');\n`);
  }
  commitFixture(root);
  const viaGrep = sweep(root, recipe, { forceGrep: true });
  assert.strictEqual(viaGrep.hits.length, 10);
  if (!hasBin('rg')) { console.log('skip: ripgrep absent, rg path unverified'); return; }
  const viaRg = sweep(root, recipe, { forceGrep: false }).hits;
  assert.deepStrictEqual(viaGrep.hits, viaRg);
  // States the contract outright. Whether rg happens to parallelise this fixture
  // out of order is scheduling-dependent and cannot be forced from a test, so the
  // equivalence check above can pass by luck; this cannot.
  const key = (h) => `${h.file}:${String(h.line).padStart(6, '0')}`;
  assert.deepStrictEqual(viaRg.map(key), [...viaRg.map(key)].sort());
});

// A tool failure must never masquerade as an honest zero.
test('a broken probe pattern raises; it is never reported as zero hits', () => {
  if (!hasBin('rg')) { console.log('skip: ripgrep absent'); return; }
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitFixture(root);
  // Valid in JS RegExp, rejected by rg's Rust engine (exit 2, not 1).
  const bad = { stack: 'generic', probes: [{ kind: 'http', glob: '**/*.php', pattern: 'Route(?=::)' }] };
  assert.throws(() => sweep(root, bad, { forceGrep: false }), /ripgrep failed/);
});
