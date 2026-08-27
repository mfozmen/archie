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

// The default name is the directory name, and two repos called `api` under
// different parents would collide on it. Naming is the responsibility set's job
// precisely so the clash is resolved once, where a human can see it.
test('an explicit name keeps same-named repos from sharing one store', () => {
  const a = M.storeFor('/src/team-a/api', '/src', 'team-a-api');
  const b = M.storeFor('/src/team-b/api', '/src', 'team-b-api');
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, path.join('/src', '.archie', 'repos', 'team-a-api'));
  // Without the name they would be the same directory — this is the trap.
  assert.strictEqual(M.storeFor('/src/team-a/api', '/src'), M.storeFor('/src/team-b/api', '/src'));
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

// Given both, they answer the same question differently. `--store` is the more
// specific answer — a directory, named outright — so it wins for both levels
// rather than leaving the config somewhere the caller never mentioned.
test('an explicit --store answers for both levels, workspace or not', () => {
  const r = paths(['/src/orders-api', '--store', '/tmp/s', '--workspace', '/src']);
  assert.strictEqual(r.store, '/tmp/s');
  assert.strictEqual(r.configStore, '/tmp/s');
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
  const top = M.storeFor(workspace);
  M.saveConfig(top, { output: 'system-map' });
  assert.strictEqual(M.outputDir({ store, base: workspace, configStore: top, repo, workspace }),
    path.join(workspace, 'system-map', path.basename(store)));
  assert.strictEqual(M.outputDir({ store, base: repo, configStore: top, repo }),
    path.join(repo, 'system-map'));
});

test('with no configured output the wiki lands inside the store', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  M.saveConfig(M.storeFor(workspace), {});
  assert.strictEqual(M.outputDir({ store, base: workspace, configStore: M.storeFor(workspace), repo, workspace }),
    path.join(store, 'wiki'));
});

// The unit test above proves outputDir() honours the base it is handed. This
// one proves render's main() hands it the right one — which is where the bug
// would actually live, and where a wiki configured with a relative output would
// otherwise be written straight back into the repository Archie only read.
//
// It writes the setting where the setup writes it: the top of the store, not the
// repository's own. Written to the repository's store, as this test used to do,
// it passed while every real run ignored the setting entirely — render was
// reading a file the setup never wrote.
test('render sends a configured output to the workspace, never into the repo', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  M.saveConfig(M.storeFor(workspace), { output: 'system-map' });
  M.saveModel(store, { version: 1, unknowns: [], entries: [
    { id: 'http.GET./x', kind: 'http', label: 'GET /x',
      evidence: [{ file: 'routes.js', line: 1 }], coverage: 'none' }] });

  const before = fs.readdirSync(repo).sort();
  const code = require('../scripts/render').main([repo, '--workspace', workspace]);

  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(path.join(workspace, 'system-map', path.basename(store), 'md')),
    'wiki belongs in the workspace, under this repository\'s name');
  assert.deepStrictEqual(fs.readdirSync(repo).sort(), before, 'the repository must be untouched');
});

// A message that names a path is only worth printing if it is the path the file
// is actually at. Once --store exists, "no .archie/model.json" sends someone to
// look in a directory Archie never wrote to.
test('a missing store file is reported at the path it was actually looked for', () => {
  const { root: repo } = makeTempRepo();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  const store = M.storeFor(repo, workspace);
  const err = [];
  const real = console.error;
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try { code = require('../scripts/staleness').main([repo, '--workspace', workspace]); }
  finally { console.error = real; }

  assert.strictEqual(code, 1);
  assert.ok(err.join('\n').includes(path.join(store, 'model.json')),
    `error names the wrong path: ${err.join('\n')}`);
});


// The whole bug was reading `output` from the wrong store, so a caller that
// forgets to say which store it means should hear that, not a TypeError from
// inside path.join naming a variable it never passed.
test('outputDir says which store is missing rather than failing downstream', () => {
  assert.throws(() => M.outputDir({ store: '/src/.archie', base: '/src' }),
    /store the settings were written to/);
});

// One output setting, one for the whole set, and every repository rendering
// through it. Written to `<workspace>/system-map/md/index.md` by name, the second
// repository silently replaces the first — the same collision `tmp/` is scoped
// per repository to avoid, and with no error, because overwriting a file it
// wrote itself looks exactly like re-rendering.
test('two repositories sharing one configured output do not overwrite each other', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-ws-'));
  M.saveConfig(M.storeFor(workspace), { output: 'system-map', repos: [] });
  const out = [];
  for (const name of ['orders-api', 'billing-api']) {
    const { root: repo } = makeTempRepo();
    const store = M.storeFor(repo, workspace);
    M.saveModel(store, { version: 1, unknowns: [], entries: [
      { id: `http.GET./${name}`, kind: 'http', label: `GET /${name}`,
        evidence: [{ file: 'routes.js', line: 1 }], coverage: 'none' }] });
    assert.strictEqual(require('../scripts/render').main([repo, '--workspace', workspace]), 0);
    out.push(M.outputDir({ store, base: workspace, configStore: M.storeFor(workspace), repo, workspace }));
  }
  assert.notStrictEqual(out[0], out[1], 'both repositories rendered to the same directory');
  for (const dir of out) assert.ok(fs.existsSync(path.join(dir, 'md', 'index.md')), `${dir} was overwritten`);
  assert.notStrictEqual(fs.readFileSync(path.join(out[0], 'md', 'index.md'), 'utf8'),
    fs.readFileSync(path.join(out[1], 'md', 'index.md'), 'utf8'));
});
