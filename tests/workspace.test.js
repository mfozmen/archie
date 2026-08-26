const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeTempRepo } = require('./helpers');
const M = require('../scripts/lib/model');
const { paths } = require('../scripts/lib/cli');

test('without a workspace the store stays beside the repository', () => {
  assert.strictEqual(M.storeFor('/src/orders-api'), path.join('/src/orders-api', '.archie'));
});

test('with a workspace every repo gets its own store under the workspace', () => {
  assert.strictEqual(M.storeFor('/src/orders-api', '/src'),
    path.join('/src', '.archie', 'repos', 'orders-api'));
  // Two repos, two stores. A shared one would have the second inventory
  // overwrite the first, silently, with no error anywhere.
  assert.notStrictEqual(M.storeFor('/src/a', '/src'), M.storeFor('/src/b', '/src'));
});

// The whole reason the store moved: a repository Archie reads is an input, not
// something it owns. If this ever writes into the repo again, a scan of code
// somebody else maintains starts leaving files behind in it.
test('a workspace run writes nothing at all into the analyzed repository', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  const before = fs.readdirSync(repo).sort();

  M.saveModel(store, { version: 1, unknowns: [], entries: [] });
  M.saveConfig(store, { language: 'en' });
  M.saveRecipe(store, { stack: 'generic', probes: [{ kind: 'http', glob: '**/*.js', pattern: 'app\\.get' }] });

  assert.deepStrictEqual(fs.readdirSync(repo).sort(), before, 'the repository must be untouched');
  assert.ok(!fs.existsSync(path.join(repo, '.archie')));
  assert.ok(fs.existsSync(path.join(store, 'model.json')));
  assert.strictEqual(M.loadConfig(store).language, 'en');
});

test('--store overrides the default, and is stripped from the positional arguments', () => {
  const r = paths(['/src/orders-api', '--store', '/src/.archie/repos/orders-api', '--unknowns']);
  assert.strictEqual(r.repo, '/src/orders-api');
  assert.strictEqual(r.store, '/src/.archie/repos/orders-api');
  // A script reading rest[1] must not pick the store path up as its next
  // positional — that is why --store is a flag and not a second argument.
  assert.deepStrictEqual(r.rest, ['/src/orders-api', '--unknowns']);
});

test('with no --store the repository is its own store, as it has always been', () => {
  const r = paths(['/src/orders-api']);
  assert.strictEqual(r.store, path.join('/src/orders-api', '.archie'));
});

test('paths falls back to the current directory when given no repository', () => {
  const r = paths([]);
  assert.strictEqual(r.repo, process.cwd());
  assert.strictEqual(r.store, path.join(process.cwd(), '.archie'));
});

// config.output is relative, and what it is relative TO changes with the store.
// Getting this wrong renders somebody's wiki into a repository they did not ask
// Archie to write to, which is the exact thing the move was meant to stop.
test('a relative output resolves against the base it is given, not the store', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  M.saveConfig(store, { output: 'system-map' });
  assert.strictEqual(M.outputDir(store, workspace), path.join(workspace, 'system-map'));
  assert.strictEqual(M.outputDir(store, repo), path.join(repo, 'system-map'));
});

test('with no configured output the wiki lands inside the store', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  M.saveConfig(store, {});
  assert.strictEqual(M.outputDir(store, workspace), path.join(store, 'wiki'));
});
