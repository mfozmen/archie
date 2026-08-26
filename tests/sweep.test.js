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

// #8: the tracked-file list is spread into rg's argv, which has an OS ceiling.
test('chunkFiles splits on a byte budget without losing or reordering anything', () => {
  const { chunkFiles } = require('../scripts/sweep');
  const files = Array.from({ length: 40 }, (_, i) => `routes/r${String(i).padStart(3, '0')}.php`);
  for (const budget of [1, 20, 100, 1e9]) {
    const chunks = chunkFiles(files, budget);
    assert.ok(chunks.length >= 1, `budget=${budget}: at least one chunk`);
    assert.deepStrictEqual(chunks.flat(), files, `budget=${budget}: same files, same order`);
    // A file longer than the whole budget still has to go somewhere: it gets a
    // chunk to itself rather than being dropped.
    for (const c of chunks) {
      const bytes = c.reduce((n, f) => n + Buffer.byteLength(f) + 1, 0);
      assert.ok(c.length === 1 || bytes <= budget, `budget=${budget}: chunk within budget`);
    }
  }
  assert.deepStrictEqual(chunkFiles([], 100), []);
});

// Chunking must not change what a sweep returns — same hits, same order,
// however many chunks the list was split into.
test('a chunked sweep returns exactly what an unchunked one does', () => {
  const { root } = makeTempRepo();
  for (let i = 0; i < 40; i++) {
    write(root, `routes/r${String(i).padStart(3, '0')}.php`,
      `<?php\nRoute::get('/r${i}', 'C@i');\n// Route::post('/x','Y@z');\n`);
  }
  commitFixture(root);
  const whole = sweep(root, recipe, { forceGrep: true });
  assert.strictEqual(whole.hits.length, 40);
  if (!hasBin('rg')) { console.log('skip: ripgrep absent, chunked rg path unverified'); return; }
  assert.deepStrictEqual(sweep(root, recipe, { forceGrep: false }).hits, whole.hits);
  // 30 bytes forces roughly one file per rg invocation.
  assert.deepStrictEqual(sweep(root, recipe, { forceGrep: false, maxArgvBytes: 30 }).hits, whole.hits);
});

test('scope narrows the sweep itself, not the results afterwards', () => {
  const { root } = makeTempRepo();
  write(root, 'app/Orders/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  write(root, 'app/Billing/api.php', "<?php\nRoute::get('/invoices', 'C@i');\n");
  commitFixture(root);
  const wide = { stack: 'generic', probes: [
    { kind: 'http', glob: 'app/**/*.php', pattern: 'Route::(get|post)' } ] };

  assert.strictEqual(sweep(root, wide, { forceGrep: true }).hits.length, 2);
  const scoped = sweep(root, wide, { forceGrep: true, scope: { paths: ['app/Orders'] } });
  assert.deepStrictEqual(scoped.hits.map(h => h.file), ['app/Orders/api.php']);
  // The probe found nothing IN SCOPE. That is not a broken recipe, and saying so
  // would send someone off to fix a recipe that is fine.
  const none = sweep(root, wide, { forceGrep: true, scope: { paths: ['app/Nothing'] } });
  assert.strictEqual(none.hits.length, 0);
  assert.strictEqual(none.zeroProbes.length, 1);
  assert.strictEqual(none.scoped, true);
});

// git quotes paths outside ASCII by default ("routes/sipari\305\237.php"). Split
// that on / and you get a path that matches nothing — files silently missing
// from a sweep, with no error anywhere.
test('a non-ASCII path is swept, not quietly skipped', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/sipariş.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitFixture(root);
  const r = { stack: 'generic', probes: [{ kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' }] };
  assert.deepStrictEqual(sweep(root, r, { forceGrep: true }).hits.map(h => h.file), ['routes/sipariş.php']);
  if (hasBin('rg'))
    assert.deepStrictEqual(sweep(root, r, { forceGrep: false }).hits.map(h => h.file), ['routes/sipariş.php']);
});

test('a scope that excludes nothing is still a scope', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitFixture(root);
  const r = { stack: 'generic', probes: [{ kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' }] };
  const res = sweep(root, r, { forceGrep: true, scope: { paths: ['routes'] } });
  assert.strictEqual(res.scoped, true, 'every tracked file was in scope, but a scope was set');
  assert.strictEqual(sweep(root, r, { forceGrep: true }).scoped, false);
});

test('a sweep outside a git repository fails loudly instead of finding nothing', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-notarepo-'));
  try {
    // No tracked-file list means no sweep. Returning zero hits would blame the
    // recipe for a repository that was never there.
    assert.throws(() => sweep(notARepo, recipe, { forceGrep: true }),
      new RegExp(`git ls-files failed in ${notARepo.replace(/[.\\]/g, '\\$&')}`));
  } finally {
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});

test('sweep.js with no arguments sweeps the directory it was run in', () => {
  const path = require('node:path');
  const M = require('../scripts/lib/model');
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitFixture(root);
  M.saveRecipe(root, { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' } ] });
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sweep.js')],
    { cwd: root, encoding: 'utf8' });
  assert.match(out, /1 candidate hits/);
  assert.deepStrictEqual(JSON.parse(require('node:fs').readFileSync(path.join(root, M.ARCHIE_DIR, 'sweep.json'), 'utf8')),
    [{ kind: 'http', file: 'routes/api.php', line: 2, text: "Route::get('/orders', 'C@i');" }]);
});
