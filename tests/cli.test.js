const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { makeTempRepo, write, commitAll } = require('./helpers');
const M = require('../scripts/lib/model');

// Capture what a command actually prints. The CLI layer is where exit codes and
// human-facing wording live, and it is the layer a user meets first.
function capture(fn) {
  const out = [], err = [];
  const log = console.log, error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try { return { code: fn(), out: out.join('\n'), err: err.join('\n') }; }
  finally { console.log = log; console.error = error; }
}

test('runMain only runs for the module that was invoked', () => {
  const { runMain } = require('../scripts/lib/cli');
  let ran = 0;
  runMain({ not: 'main' }, () => { ran++; return 0; });
  assert.strictEqual(ran, 0, 'a required module must not run its command');
  runMain(require.main, () => { ran++; return 7; });
  assert.strictEqual(ran, 1);
  assert.strictEqual(process.exitCode, 7);
  process.exitCode = 0;
});

test('status: no model is an explained failure, not a stack trace', () => {
  const { root } = makeTempRepo();
  const r = capture(() => require('../scripts/status').main([root]));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /run \/archie:inventory first/);
  assert.strictEqual(r.out, '');
});

test('status: prints coverage, stale entries and unknowns on demand', () => {
  const { root } = makeTempRepo();
  write(root, 'a.php', 'v1'); const sha = commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [{ text: 'an open question', why: 'w' }], entries: [
    { id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }],
      coverage: 'traced', traced_at_sha: sha, watch: ['a.php'] } ] });
  const { main } = require('../scripts/status');

  let r = capture(() => main([root]));
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /1 entry points · 1 documented \(100%\)/);
  assert.ok(!/an open question/.test(r.out), 'unknowns are listed only when asked');

  r = capture(() => main([root, '--unknowns']));
  assert.match(r.out, /\[inventory\] an open question/);

  write(root, 'a.php', 'v2'); commitAll(root, 'change');
  r = capture(() => main([root]));
  assert.match(r.out, /stale: e1/);
});

test('sweep: no recipe is an explained failure', () => {
  const { root } = makeTempRepo();
  const r = capture(() => require('../scripts/sweep').main([root]));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /derive one first/);
});

test('sweep: reports counts, zero probes and writes sweep.json', () => {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', "<?php\nRoute::get('/orders', 'C@i');\n");
  commitAll(root, 'routes');
  M.saveRecipe(M.storeFor(root), { stack: 'generic', probes: [
    { kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' },
    { kind: 'cli', glob: 'bin/**/*', pattern: 'nothing-here' } ] });

  let r = capture(() => require('../scripts/sweep').main([root]));
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /1 candidate hits/);
  assert.match(r.out, /⚠ 0 hits for cli probe — recipe may be wrong/);
  assert.ok(require('node:fs').existsSync(path.join(root, '.archie', 'sweep.json')));

  // Under a scope the same zero reads differently, and must not send someone off
  // to fix a recipe that is fine.
  M.saveConfig(M.storeFor(root), { scope: { label: 'Routes', paths: ['routes'] } });
  r = capture(() => require('../scripts/sweep').main([root]));
  assert.match(r.out, /within the configured scope/);
});

test('churn: no model is an explained failure; otherwise it ranks', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/churn');
  assert.strictEqual(capture(() => main([root])).code, 1);

  write(root, 'hot.php', 'v1'); commitAll(root, 'c1');
  write(root, 'hot.php', 'v2'); commitAll(root, 'c2');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'a', kind: 'http', label: 'GET /hot', evidence: [{ file: 'hot.php', line: 1 }],
      coverage: 'none', watch: [] } ] });
  const r = capture(() => main([root]));
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /1\. GET \/hot {2}· 2 commits · hot\.php:1/);
});

test('staleness: no model is an explained failure; otherwise it marks and says so', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/staleness');
  assert.strictEqual(capture(() => main([root])).code, 1);

  write(root, 'a.php', 'v1'); const sha = commitAll(root, 'a');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'e1', kind: 'http', label: 'E1', evidence: [{ file: 'a.php', line: 1 }],
      coverage: 'traced', traced_at_sha: sha, watch: ['a.php'] } ] });
  assert.match(capture(() => main([root])).out, /nothing stale/);

  write(root, 'a.php', 'v2'); commitAll(root, 'change');
  assert.match(capture(() => main([root])).out, /stale: e1/);
  assert.strictEqual(M.loadModel(M.storeFor(root)).entries[0].coverage, 'stale');
});

test('fingerprint and scope print JSON for the skill to read', () => {
  const { root } = makeTempRepo();
  write(root, 'package.json', '{"name":"x","engines":{"node":">=18"}}');
  write(root, 'src/a.js', 'x');
  commitAll(root, 'files');
  const fp = capture(() => require('../scripts/fingerprint').main([root]));
  assert.deepStrictEqual(JSON.parse(fp.out).stackHints[0].name, 'node');

  const sc = capture(() => require('../scripts/scope').main([root]));
  assert.ok(JSON.parse(sc.out).some(c => c.path === 'src'));
});

test('render: no model is an explained failure; otherwise it writes both sets', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/render');
  assert.strictEqual(capture(() => main([root])).code, 1);

  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'http.GET./a', kind: 'http', label: 'GET /a', evidence: [{ file: 'r.php', line: 1 }],
      coverage: 'none', watch: [] } ] });
  const fs = require('node:fs');

  let r = capture(() => main([root, '--md']));
  assert.match(r.out, /markdown pages/);
  assert.ok(!fs.existsSync(path.join(root, '.archie', 'wiki', 'index.html')), '--md stops at markdown');

  r = capture(() => main([root]));
  assert.match(r.out, /openapi\.yaml/);
  assert.ok(fs.existsSync(path.join(root, '.archie', 'wiki', 'index.html')));
});

test('store: usage, unreadable input, and an unknown target all explain themselves', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/store');
  const fs = require('node:fs');

  assert.match(capture(() => main([])).err, /usage: store\.js/);
  assert.match(capture(() => main([root, 'recipe'])).err, /usage: store\.js/);
  assert.strictEqual(capture(() => main([])).code, 1);

  const p = path.join(root, 'x.json');
  fs.writeFileSync(p, 'not json');
  assert.match(capture(() => main([root, 'recipe', p])).err, /x\.json/);

  fs.writeFileSync(p, '{}');
  assert.match(capture(() => main([root, 'nonsense', p])).err, /unknown target "nonsense"/);
  fs.writeFileSync(p, '{"a":1}');
  assert.match(capture(() => main([root, 'merge-inventory', p])).err, /expects an array/);
});

// Which file a config lands in is decided by one flag, and getting it wrong is
// the failure this whole split exists to end: the setting validates, saves, and
// is reported back as changed, while the code that would act on it reads a
// different file and finds nothing. Nothing downstream can notice — both files
// are legitimate — so it has to be refused here.
test('store: the set\'s settings are refused when written to one repository', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/store');
  const fs = require('node:fs');
  const ws = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'archie-ws-'));
  const p = path.join(root, 'c.json');

  fs.writeFileSync(p, JSON.stringify({ language: 'tr', repos: [] }));
  const r = capture(() => main([root, 'config', p, '--workspace', ws]));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /repos, language belong to the whole set/);
  assert.match(r.err, /no --workspace flag/, 'the message has to say how to fix it');

  // One key, so the sentence has to read as one: "belongs", "write it".
  fs.writeFileSync(p, JSON.stringify({ language: 'tr' }));
  assert.match(capture(() => main([root, 'config', p, '--workspace', ws])).err,
    /language belongs to the whole set.*write it with/s);

  // A scope is that repository's own, so the same call is exactly right for it.
  fs.writeFileSync(p, JSON.stringify({ scope: { label: 'Orders', paths: ['app/**'] } }));
  assert.strictEqual(capture(() => main([root, 'config', p, '--workspace', ws])).code, 0);
  // And the set's settings are fine at the top, where they are read from.
  fs.writeFileSync(p, JSON.stringify({ language: 'tr' }));
  assert.strictEqual(capture(() => main([ws, 'config', p])).code, 0);
});

// A config write replaces the file, so "change the language" written back as a
// language is how the responsibility set disappears — with no error, and no
// symptom until the setup starts asking again about repositories the user
// already declined. That is the one thing declined[] exists to prevent.
test('store: a config write that would drop the responsibility set is refused', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/store');
  const fs = require('node:fs');
  const p = path.join(root, 'c.json');

  fs.writeFileSync(p, JSON.stringify({ language: 'en', repos: [{ name: 'a', why: 'named in CODEOWNERS' }], declined: ['b'] }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);

  fs.writeFileSync(p, JSON.stringify({ language: 'tr' }));
  const r = capture(() => main([root, 'config', p]));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /would drop repos, declined/);
  assert.deepStrictEqual(require('../scripts/lib/model').loadConfig(path.join(root, '.archie')).declined, ['b'],
    'the stored config must survive a refused write');

  // Round-tripped whole, the same change goes through.
  fs.writeFileSync(p, JSON.stringify({ language: 'tr', repos: [{ name: 'a', why: 'named in CODEOWNERS' }], declined: ['b'] }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);

  // The mirror mistake: a scope in the config that carries the responsibility
  // set. The flag cannot catch this one — a single-repository config holds both
  // levels — but the set itself says which config this is.
  fs.writeFileSync(p, JSON.stringify({ language: 'tr', workspace: '/src',
    repos: [{ name: 'a', why: 'named in CODEOWNERS' }], declined: ['b'], scope: { paths: ['app/**'] } }));
  const m = capture(() => main([root, 'config', p]));
  assert.strictEqual(m.code, 1);
  assert.match(m.err, /scope belongs to the repository it scopes/);


});

// The loss guard refuses a write that forgot a setting, so removing one on
// purpose needs a way to say so. Absence is the accident; null is the sentence.
test('store: a null unsets a setting the loss guard would otherwise protect', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/store');
  const fs = require('node:fs');
  const { loadConfig } = require('../scripts/lib/model');
  const p = path.join(root, 'c.json');

  fs.writeFileSync(p, JSON.stringify({ language: 'en', output: 'docs/map' }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);

  fs.writeFileSync(p, JSON.stringify({ language: 'en', output: null }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);
  const c = loadConfig(path.join(root, '.archie'));
  assert.strictEqual(c.output, undefined, 'null means remove it, not store a null');
  assert.strictEqual(c.language, 'en');
});

// Any one of the four says whose config this is: a single repository is not a set
// of one, it has no responsibility set at all. A set that has been asked nothing
// yet still has a `declined` the moment the first answer is no, and it is no less
// the set's config for having no repos in it.
test('store: any set-only key marks the config as the set\'s, not one repository\'s', () => {
  const { main } = require('../scripts/store');
  const fs = require('node:fs');
  for (const only of [{ workspace: '/src' }, { handle: '@you' }, { repos: [] }, { declined: ['b'] }]) {
    const { root } = makeTempRepo();
    const p = path.join(root, 'c.json');
    fs.writeFileSync(p, JSON.stringify({ ...only, scope: { paths: ['app/**'] } }));
    assert.match(capture(() => main([root, 'config', p])).err,
      /scope belongs to the repository it scopes/, `${Object.keys(only)[0]} alone must identify the set`);
  }
});

// A single-repository config is both levels in one file, so a scope in it is
// right — and removing one is done by leaving it out, which the loss guard must
// not read as damage.
test('store: a scope in a single-repository config is written, and removed by absence', () => {
  const { root } = makeTempRepo();
  const { main } = require('../scripts/store');
  const fs = require('node:fs');
  const p = path.join(root, 'c.json');

  fs.writeFileSync(p, JSON.stringify({ language: 'tr', scope: { label: 'Orders', paths: ['app/**'] } }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);

  fs.writeFileSync(p, JSON.stringify({ language: 'tr' }));
  assert.strictEqual(capture(() => main([root, 'config', p])).code, 0);
  assert.strictEqual(require('../scripts/lib/model').loadConfig(path.join(root, '.archie')).scope, undefined);
});

test('render says so when the vendored bundle is missing', () => {
  const { root } = makeTempRepo();
  const { readMermaid } = require('../scripts/render');
  const r = capture(() => readMermaid(root));
  assert.match(r.err, /diagrams will not render/);
  assert.strictEqual(r.code, '');
  assert.ok(readMermaid(path.join(__dirname, '..')).length > 0, 'the real bundle is found');
});
