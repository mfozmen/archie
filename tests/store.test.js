const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeTempRepo } = require('./helpers');
const M = require('../scripts/lib/model');

const STORE = path.join(__dirname, '..', 'scripts', 'store.js');
function store(root, ...args) {
  return execFileSync(process.execPath, [STORE, root, ...args], { encoding: 'utf8' });
}
function tmpJson(root, name, obj) {
  const p = path.join(root, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

// A route label or a claim can contain a quote. Passing JSON through argv would
// break the shell before it ever reached node; the file path is the whole point.
const quoted = "GET /it's/fine";
const entry = { id: 'http.' + quoted, kind: 'http', label: quoted,
  evidence: [{ file: "app/O'Brien.php", line: 3 }], coverage: 'none', watch: [] };
const flow = { id: 'http.' + quoted, summary: "Doesn't fail on a quote.",
  answers: { entry: [{ text: "It's handled.", evidence: { file: 'a.php', line: 1 } }],
    guards: [], decisions: [], data: [], boundary: [], returns: [] },
  unknowns: [], traced_at_sha: 'abc' };

test('store writes recipe, config, flow and model from a file', () => {
  const { root } = makeTempRepo();
  store(root, 'recipe', tmpJson(root, 'r.json',
    { stack: 'generic', probes: [{ kind: 'http', glob: '**/*.php', pattern: 'Route::' }] }));
  assert.strictEqual(M.loadRecipe(M.storeFor(root)).probes.length, 1);

  store(root, 'config', tmpJson(root, 'c.json', { language: 'tr' }));
  assert.strictEqual(M.loadConfig(M.storeFor(root)).language, 'tr');

  store(root, 'model', tmpJson(root, 'm.json', { version: 1, unknowns: [], entries: [entry] }));
  assert.strictEqual(M.loadModel(M.storeFor(root)).entries[0].label, quoted);

  store(root, 'flow', tmpJson(root, 'f.json', flow));
  assert.strictEqual(M.loadFlow(M.storeFor(root), flow.id).summary, "Doesn't fail on a quote.");
});

test('store merge-inventory merges instead of overwriting, and prints the buckets', () => {
  const { root } = makeTempRepo();
  const traced = { ...entry, coverage: 'traced', traced_at_sha: 'abc', watch: ['app/A.php'] };
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [traced] });

  const out = JSON.parse(store(root, 'merge-inventory',
    tmpJson(root, 'd.json', [entry, { ...entry, id: 'http.GET./new', label: 'GET /new' }])));
  assert.deepStrictEqual(out.added, ['http.GET./new']);
  assert.deepStrictEqual(out.kept, [entry.id]);
  assert.deepStrictEqual(out.disappeared, []);
  assert.strictEqual(M.loadModel(M.storeFor(root)).entries.find(e => e.id === entry.id).coverage, 'traced');
});

test('store refuses invalid input and says which file and why', () => {
  const { root } = makeTempRepo();
  const bad = tmpJson(root, 'bad.json', { stack: 'x', probes: [{ kind: 'http' }] });
  assert.throws(() => store(root, 'recipe', bad), (e) => /glob|pattern/.test(e.stderr));
  fs.writeFileSync(path.join(root, 'notjson.json'), 'nope');
  assert.throws(() => store(root, 'recipe', path.join(root, 'notjson.json')),
    (e) => /notjson\.json/.test(e.stderr));
  assert.throws(() => store(root, 'nonsense', bad), (e) => /unknown/i.test(e.stderr));
});
