const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempRepo } = require('./helpers');
const M = require('../scripts/lib/model');

const entry = { id: 'http.POST./api/orders', kind: 'http', label: 'POST /api/orders',
  evidence: [{ file: 'routes/api.php', line: 12 }], coverage: 'none', watch: [] };
const flow = { id: 'http.POST./api/orders', summary: 'Creates an order.',
  answers: { entry: [{ text: 'Handled by OrderController.', evidence: { file: 'routes/api.php', line: 12 } }],
    guards: [], decisions: [], data: [], boundary: [], returns: [] },
  unknowns: [{ text: 'Retry policy unknown', why: 'read from env var not in repo' }],
  traced_at_sha: 'a1b2c3d' };

test('model round-trips and validates', () => {
  const { root } = makeTempRepo();
  assert.strictEqual(M.loadModel(M.storeFor(root)), null);
  M.saveModel(M.storeFor(root), { version: 1, entries: [entry], unknowns: [] });
  const back = M.loadModel(M.storeFor(root));
  assert.strictEqual(back.entries[0].label, 'POST /api/orders');
  assert.ok(fs.existsSync(path.join(root, '.archie', 'model.json')));
});

test('invalid model throws with every violation listed', () => {
  const bad = { version: 1, entries: [{ id: '', kind: 'nope', label: 'x', evidence: [], coverage: 'traced', watch: [] }], unknowns: [] };
  assert.throws(() => M.validateModel(bad), (e) =>
    /id/.test(e.message) && /kind/.test(e.message) && /evidence/.test(e.message) && /traced_at_sha/.test(e.message));
});

test('flow round-trips under slug filename; bad flow throws', () => {
  const { root } = makeTempRepo();
  M.saveFlow(M.storeFor(root), flow);
  assert.ok(fs.existsSync(path.join(root, '.archie', 'flows', 'http-post-api-orders.json')));
  assert.strictEqual(M.loadFlow(M.storeFor(root), flow.id).summary, 'Creates an order.');
  assert.strictEqual(M.listFlows(M.storeFor(root)).length, 1);
  assert.throws(() => M.validateFlow({ ...flow, answers: { entry: [] } }), /answers/);
});

test('config and recipe round-trip', () => {
  const { root } = makeTempRepo();
  M.saveConfig(M.storeFor(root), { language: 'tr' });
  assert.strictEqual(M.loadConfig(M.storeFor(root)).language, 'tr');
  M.saveRecipe(M.storeFor(root), { stack: 'PHP 8 / generic', probes: [{ kind: 'http', glob: 'routes/**/*.php', pattern: 'Route::(get|post)' }] });
  assert.strictEqual(M.loadRecipe(M.storeFor(root)).probes.length, 1);
  assert.throws(() => M.saveRecipe(M.storeFor(root), { stack: 'x', probes: [{ kind: 'http' }] }), /glob|pattern/);
});

test('malformed answers value is rejected, not crashed on', () => {
  assert.throws(() => M.validateFlow({ ...flow, answers: { ...flow.answers, guards: null } }),
    /answers\.guards: must be an array/);
});

test('a malformed optional look_at is rejected', () => {
  assert.throws(() => M.validateFlow({ ...flow,
    unknowns: [{ text: 't', why: 'w', look_at: { file: 'a.php', line: 0 } }] }),
    /unknowns\[0\]\.look_at/);
});

test('a non-array tests[] on a claim is rejected, not crashed on', () => {
  assert.throws(() => M.validateFlow({ ...flow, answers: { ...flow.answers,
    entry: [{ text: 't', evidence: { file: 'a.php', line: 1 }, tests: 'nope' }] } }),
    /answers\.entry\[0\]\.tests: must be an array/);
});

test('two entries that collide on one flow filename are rejected', () => {
  const dup = (id) => ({ ...entry, id });
  assert.throws(() => M.validateModel({ version: 1, unknowns: [], entries: [dup('a.b'), dup('a.b')] }),
    /duplicate id "a\.b"/);
  // Distinct ids, same slug — the silent-overwrite case.
  assert.throws(() => M.validateModel({ version: 1, unknowns: [], entries: [dup('a.b'), dup('a/b')] }),
    /both map to flows\/a-b\.json/);
});

test('a corrupt flow file is named, not rendered and not swallowed', () => {
  const { root } = makeTempRepo();
  M.saveFlow(M.storeFor(root), flow);
  fs.writeFileSync(path.join(root, '.archie', 'flows', 'broken.json'), '{ "id": "x" }\n');
  assert.throws(() => M.listFlows(M.storeFor(root)), /flows\/broken\.json/);

  fs.writeFileSync(path.join(root, '.archie', 'flows', 'broken.json'), 'not json at all');
  assert.throws(() => M.listFlows(M.storeFor(root)), /flows\/broken\.json/);
});

test('loadFlow validates too', () => {
  const { root } = makeTempRepo();
  fs.mkdirSync(path.join(root, '.archie', 'flows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.archie', 'flows', 'a-b.json'), '{ "id": "a.b" }\n');
  assert.throws(() => M.loadFlow(M.storeFor(root), 'a.b'), /a-b\.json/);
});

test('mergeModel keeps what explain proved and reports what moved', () => {
  const traced = { id: 'http.GET./a', kind: 'http', label: 'GET /a',
    evidence: [{ file: 'routes/api.php', line: 10 }], coverage: 'traced',
    traced_at_sha: 'abc', watch: ['app/A.php'] };
  const gone = { id: 'http.GET./gone', kind: 'http', label: 'GET /gone',
    evidence: [{ file: 'routes/api.php', line: 99 }], coverage: 'traced',
    traced_at_sha: 'abc', watch: ['app/Gone.php'] };
  const existing = { version: 1, unknowns: [], entries: [traced, gone] };

  // The sweep re-found /a at a new line, and found a brand-new /b.
  const discovered = [
    { id: 'http.GET./a', kind: 'http', label: 'GET /a', evidence: [{ file: 'routes/api.php', line: 14 }], coverage: 'none', watch: [] },
    { id: 'http.GET./b', kind: 'http', label: 'GET /b', evidence: [{ file: 'routes/api.php', line: 20 }], coverage: 'none', watch: [] },
  ];

  const { model, added, kept, disappeared } = M.mergeModel(existing, discovered);
  const byId = Object.fromEntries(model.entries.map(e => [e.id, e]));

  // The whole point: a re-run must not throw away a trace.
  assert.strictEqual(byId['http.GET./a'].coverage, 'traced');
  assert.strictEqual(byId['http.GET./a'].traced_at_sha, 'abc');
  assert.deepStrictEqual(byId['http.GET./a'].watch, ['app/A.php']);
  // ...but the fresh sweep's location wins: the code moved, the citation follows.
  assert.deepStrictEqual(byId['http.GET./a'].evidence, [{ file: 'routes/api.php', line: 14 }]);

  assert.strictEqual(byId['http.GET./b'].coverage, 'none');
  // An entry the sweep no longer finds is REPORTED, never silently dropped.
  assert.ok(byId['http.GET./gone']);
  assert.deepStrictEqual(added, ['http.GET./b']);
  assert.deepStrictEqual(kept, ['http.GET./a']);
  assert.deepStrictEqual(disappeared, ['http.GET./gone']);
  M.validateModel(model);
});

test('mergeModel on a first run is just the discovered set', () => {
  const discovered = [{ id: 'x', kind: 'cli', label: 'x', evidence: [{ file: 'a.php', line: 1 }], coverage: 'none', watch: [] }];
  const { model, added, kept, disappeared } = M.mergeModel(null, discovered);
  assert.strictEqual(model.entries.length, 1);
  assert.deepStrictEqual([added, kept, disappeared], [['x'], [], []]);
});

test('a handler that disappears is cleared, not carried over', () => {
  const old = { id: 'x', kind: 'http', label: 'GET /x', evidence: [{ file: 'r.php', line: 1 }],
    coverage: 'traced', traced_at_sha: 'abc', watch: ['a.php'], handler: 'app/Old.php' };
  const rediscovered = { id: 'x', kind: 'http', label: 'GET /x',
    evidence: [{ file: 'r.php', line: 2 }], coverage: 'none', watch: [] };
  const { model } = M.mergeModel({ version: 1, unknowns: [], entries: [old] }, [rediscovered]);
  assert.ok(!('handler' in model.entries[0]));
  assert.strictEqual(model.entries[0].coverage, 'traced');   // the trace still survives
});

test('a disappeared entry becomes a persistent unknown, and clears when it returns', () => {
  const gone = { id: 'http.GET./gone', kind: 'http', label: 'GET /gone',
    evidence: [{ file: 'r.php', line: 9 }], coverage: 'traced', traced_at_sha: 'abc', watch: ['a.php'] };
  const other = { id: 'http.GET./a', kind: 'http', label: 'GET /a',
    evidence: [{ file: 'r.php', line: 1 }], coverage: 'none', watch: [] };
  const human = { text: 'dynamic routes somewhere', why: 'loop-registered' };

  let m = M.mergeModel({ version: 1, unknowns: [human], entries: [gone, other] }, [other]).model;
  const generated = m.unknowns.filter(u => u.source === 'inventory-merge');
  assert.strictEqual(generated.length, 1);
  assert.match(generated[0].text, /GET \/gone/);
  assert.ok(m.unknowns.some(u => u.text === human.text), 'a human-written unknown is never touched');
  M.validateModel(m);

  // Re-running must not stack duplicates.
  m = M.mergeModel(m, [other]).model;
  assert.strictEqual(m.unknowns.filter(u => u.source === 'inventory-merge').length, 1);

  // The route comes back — the unknown clears itself.
  m = M.mergeModel(m, [other, gone]).model;
  assert.strictEqual(m.unknowns.filter(u => u.source === 'inventory-merge').length, 0);
  assert.ok(m.unknowns.some(u => u.text === human.text));
});

test('a disappeared entry stops counting as documented', () => {
  const gone = { id: 'g', kind: 'http', label: 'GET /gone', evidence: [{ file: 'r.php', line: 9 }],
    coverage: 'traced', traced_at_sha: 'abc', watch: ['a.php'] };
  const { model } = M.mergeModel({ version: 1, unknowns: [], entries: [gone] }, []);
  const back = model.entries[0];
  // Its trace is kept — nothing is destroyed — but the sweep cannot find the
  // entry point any more, so calling the page current would inflate coverage.
  assert.strictEqual(back.coverage, 'stale');
  assert.strictEqual(back.traced_at_sha, 'abc');
  assert.deepStrictEqual(back.watch, ['a.php']);
  M.validateModel(model);
});

test('a disappeared entry that was never traced is left alone', () => {
  const gone = { id: 'g', kind: 'http', label: 'GET /gone', evidence: [{ file: 'r.php', line: 9 }],
    coverage: 'none', watch: [] };
  const { model } = M.mergeModel({ version: 1, unknowns: [], entries: [gone] }, []);
  assert.strictEqual(model.entries[0].coverage, 'none');
});

test('an entry that vanished and came back stays stale until it is re-checked', () => {
  const traced = { id: 'g', kind: 'http', label: 'GET /gone', evidence: [{ file: 'r.php', line: 9 }],
    coverage: 'traced', traced_at_sha: 'abc', watch: ['a.php'] };
  const rediscovered = { id: 'g', kind: 'http', label: 'GET /gone',
    evidence: [{ file: 'r.php', line: 3 }], coverage: 'none', watch: [] };

  const afterVanish = M.mergeModel({ version: 1, unknowns: [], entries: [traced] }, []).model;
  assert.strictEqual(afterVanish.entries[0].coverage, 'stale');

  const afterReturn = M.mergeModel(afterVanish, [rediscovered]).model;
  // Deliberately NOT back to 'traced'. A route that disappeared and returned was
  // deleted and re-added, renamed twice, or moved — the old page describes code
  // nobody re-checked. It stays stale so explain refreshes it against the diff.
  assert.strictEqual(afterReturn.entries[0].coverage, 'stale');
  assert.strictEqual(afterReturn.entries[0].traced_at_sha, 'abc');
  assert.deepStrictEqual(afterReturn.entries[0].evidence, [{ file: 'r.php', line: 3 }]);
});

test('watchFromFlow collects every file the page actually depends on', () => {
  const f = { ...flow, answers: { ...flow.answers,
    entry: [{ text: 't', evidence: { file: 'routes/api.php', line: 12 },
              tests: [{ file: 'tests/ShipTest.php', line: 44 }] }],
    data: [{ text: 'd', evidence: { file: 'app/Ship.php', line: 30 } },
           { text: 'd2', evidence: { file: 'app/Ship.php', line: 31 } }] },
    unknowns: [{ text: 'u', why: 'w', look_at: { file: 'config/queue.php', line: 18 } }] };
  assert.deepStrictEqual(M.watchFromFlow(f),
    ['app/Ship.php', 'config/queue.php', 'routes/api.php', 'tests/ShipTest.php']);
});

test('watchFromFlow never returns empty for a flow with any citation', () => {
  assert.ok(M.watchFromFlow(flow).length > 0);
});

test('config validates scope and output, and refuses to escape the repo', () => {
  const { root } = makeTempRepo();
  M.saveConfig(M.storeFor(root), { language: 'tr', output: 'docs/system-map',
    scope: { label: 'Orders', paths: ['app/Orders/**'] } });
  assert.strictEqual(M.loadConfig(M.storeFor(root)).output, 'docs/system-map');

  assert.throws(() => M.saveConfig(M.storeFor(root), { output: 42 }), /output/);
  // Rendered output is written without asking. It must not be able to land
  // outside the repository, whatever ends up in the config file.
  for (const bad of ['../elsewhere', '/etc/archie', 'docs/../../out'])
    assert.throws(() => M.saveConfig(M.storeFor(root), { output: bad }), /output/, bad);
  assert.throws(() => M.saveConfig(M.storeFor(root), { scope: { paths: 'app' } }), /scope/);
  assert.throws(() => M.saveConfig(M.storeFor(root), { scope: { paths: ['app'], label: 7 } }), /scope/);
});

test('outputDir defaults to the wiki directory under .archie', () => {
  const { root } = makeTempRepo();
  assert.strictEqual(M.outputDir(M.storeFor(root), root), path.join(root, '.archie', 'wiki'));
  M.saveConfig(M.storeFor(root), { output: 'docs/system-map' });
  assert.strictEqual(M.outputDir(M.storeFor(root), root), path.join(root, 'docs', 'system-map'));
});

test('output must not resolve to the repository root', () => {
  const { root } = makeTempRepo();
  // "." passes an isAbsolute/".." check and then renders index.html over
  // whatever the repository already has at its root.
  for (const bad of ['.', './', '', '././.'])
    assert.throws(() => M.saveConfig(M.storeFor(root), { output: bad }), /output/, JSON.stringify(bad));
  M.saveConfig(M.storeFor(root), { output: './docs/map' });
  assert.strictEqual(M.outputDir(M.storeFor(root), root), path.join(root, 'docs', 'map'));
});
