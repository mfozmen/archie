const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo } = require('./helpers');
const M = require('../scripts/lib/model');

const flow = { id: 'http.POST./api/orders', summary: 'Creates an order.',
  answers: { entry: [{ text: 'Handled by OrderController.', evidence: { file: 'routes/api.php', line: 12 } }],
    guards: [], decisions: [], data: [], boundary: [], returns: [] },
  unknowns: [{ text: 'Retry policy unknown', why: 'read from env var not in repo' }],
  traced_at_sha: 'a1b2c3d' };

// A missing model.json is `null` at the call site, and a half-written one can be
// anything. Reaching validateModel with one must produce the list of what is
// wrong, not a TypeError from reading .entries off nothing.
test('a null model is reported as three violations, not crashed on', () => {
  assert.throws(() => M.validateModel(null), (err) => {
    assert.match(err.message, /version must be 1/);
    assert.match(err.message, /entries must be an array/);
    assert.match(err.message, /unknowns must be an array/);
    return true;
  });
});

test('an entry with no label and an unknown coverage state is rejected', () => {
  const bad = { version: 1, unknowns: [], entries: [
    { id: 'x', kind: 'http', label: '', evidence: [{ file: 'r.php', line: 1 }], coverage: 'documented' }] };
  assert.throws(() => M.validateModel(bad), (err) => {
    assert.match(err.message, /entries\[0\]: label required/);
    // 'documented' is not one of none/traced/stale. A coverage word the tools do
    // not know would be counted as neither traced nor untraced downstream.
    assert.match(err.message, /entries\[0\]: coverage invalid/);
    return true;
  });
});

test('a claim with evidence but no text is rejected', () => {
  assert.throws(() => M.validateFlow({ ...flow, answers: { ...flow.answers,
    guards: [{ evidence: { file: 'app/A.php', line: 3 } }] } }),
    /answers\.guards\[0\]: text required/);
});

test('an empty flow lists every missing part at once', () => {
  assert.throws(() => M.validateFlow({}), (err) => {
    assert.match(err.message, /id required/);
    assert.match(err.message, /summary required/);
    assert.match(err.message, /answers must have exactly keys/);
    assert.match(err.message, /unknowns must be an array/);
    assert.match(err.message, /traced_at_sha required/);
    return true;
  });
});

// An unknown is the honesty escape hatch: it says a question was not answered
// and why. Without the why it is just a gap with no reason attached.
test('an unknown without a why is rejected', () => {
  assert.throws(() => M.validateFlow({ ...flow, unknowns: [{ text: 'Retry policy unknown' }] }),
    /unknowns\[0\]: text and why required/);
  assert.throws(() => M.validateFlow({ ...flow, unknowns: [{ why: 'not in repo' }] }),
    /unknowns\[0\]: text and why required/);
});

test('a config that is not an object, or has a non-string language, is rejected', () => {
  assert.throws(() => M.validateConfig(null), /config must be an object/);
  assert.throws(() => M.validateConfig({ language: 7 }), /language must be a string/);
});

test('scope must be an object with non-empty string paths', () => {
  for (const bad of [null, 'app/Orders'])
    assert.throws(() => M.validateConfig({ scope: bad }), /scope must be an object/, JSON.stringify(bad));
  // An empty or non-string path would widen the sweep back to everything while
  // the config still claims to be scoped.
  for (const bad of [[''], [7]])
    assert.throws(() => M.validateConfig({ scope: { paths: bad } }),
      /scope\.paths must be non-empty strings/, JSON.stringify(bad));
});

// The responsibility set. `why` is the whole point of it: the set is where
// Archie says "this repository is yours", and an entry nobody can trace back to
// evidence is the honesty rule breaking in the config file itself.
test('a repo in the set without the evidence that put it there is rejected', () => {
  assert.throws(() => M.validateConfig({ repos: [{ name: 'orders-api' }] }),
    /repos\[0\]: why required/);
  for (const bad of ['', 7, null])
    assert.throws(() => M.validateConfig({ repos: [{ name: 'orders-api', why: bad }] }),
      /repos\[0\]: why required/, JSON.stringify(bad));
  M.validateConfig({ repos: [{ name: 'orders-api', why: '@org/payments in .github/CODEOWNERS; 84 of your commits' }] });
});

test('a repo entry with no usable name is rejected, and a repeated one too', () => {
  assert.throws(() => M.validateConfig({ repos: [{ why: 'named in CODEOWNERS' }] }), /repos\[0\]: name required/);
  assert.throws(() => M.validateConfig({ repos: [{ name: '', why: 'named in CODEOWNERS' }] }), /repos\[0\]: name required/);
  // Two entries with one name share one store directory under the workspace, so
  // the second repository's inventory would overwrite the first in silence.
  assert.throws(() => M.validateConfig({ repos: [
    { name: 'orders-api', why: '@org/payments in CODEOWNERS' },
    { name: 'orders-api', why: '12 of your commits' },
  ] }), /repos\[1\]: duplicate name "orders-api"/);
});

// Three of these used to reach a validator as a raw TypeError instead of a named
// violation, which is why every shape is listed rather than assumed.
test('a malformed repos or declined list is named, never a TypeError', () => {
  for (const bad of [null, 'orders-api', {}])
    assert.throws(() => M.validateConfig({ repos: bad }), /repos must be an array/, JSON.stringify(bad));
  for (const bad of [null, 'orders-api', 7])
    assert.throws(() => M.validateConfig({ repos: [bad] }), /repos\[0\]: must be an object/, JSON.stringify(bad));
  for (const bad of [null, 'orders-api', {}])
    assert.throws(() => M.validateConfig({ declined: bad }), /declined must be an array/, JSON.stringify(bad));
  for (const bad of [[''], [7], [null]])
    assert.throws(() => M.validateConfig({ declined: bad }), /declined must be non-empty strings/, JSON.stringify(bad));
  M.validateConfig({ declined: ['some-other-repo'] });
});

// Declining is not a judgement about the repository, only a record that this
// person was asked. Saying both about one name leaves the set contradicting its
// own asking-log, and nothing in the config can say which half is stale.
test('a repo that is both owned and declined is rejected', () => {
  assert.throws(() => M.validateConfig({
    repos: [{ name: 'orders-api', why: '@org/payments in CODEOWNERS' }],
    declined: ['orders-api'],
  }), /repos: "orders-api" is also in declined/);
  // A nameless entry must not crash the cross-check on its way to being reported.
  assert.throws(() => M.validateConfig({ repos: [{ why: 'some evidence' }], declined: ['orders-api'] }),
    /repos\[0\]: name required/);
});

// The handle is compared against CODEOWNERS tokens, which carry the `@`. Stored
// without it, it matches nothing and the user simply never appears to be named
// anywhere — a silent wrong answer rather than an error.
test('a handle that is not a CODEOWNERS handle is rejected', () => {
  for (const bad of [null, 7, '', 'someone', '@'])
    assert.throws(() => M.validateConfig({ handle: bad }), /handle must be a CODEOWNERS handle/, JSON.stringify(bad));
  M.validateConfig({ handle: '@someone' });
});

// Every store path under a workspace hangs off this one. A relative value would
// resolve against whatever directory the command ran in, so the same workspace
// would have different stores depending on where you stood.
test('a workspace that is not an absolute path is rejected', () => {
  for (const bad of [null, 7, '', 'source', './source'])
    assert.throws(() => M.validateConfig({ workspace: bad }), /workspace must be an absolute path/, JSON.stringify(bad));
  M.validateConfig({ workspace: '/src' });
});

// The set was added to a config that already had these, and they are read by
// render, status and the sweep. Adding fields must not have moved any of them.
test('the responsibility set does not disturb language, output or scope', () => {
  M.validateConfig({ language: 'tr', output: 'docs/system-map', scope: { label: 'Orders', paths: ['app/Orders'] },
    workspace: '/src', handle: '@someone',
    repos: [{ name: 'orders-api', why: '@org/payments in .github/CODEOWNERS' }], declined: ['some-other-repo'] });
  assert.throws(() => M.validateConfig({ workspace: '/src', output: '../outside' }),
    /output must be a relative path, under the workspace/);
});

test('a recipe with no stack, no probes, or an unknown probe kind is rejected', () => {
  assert.throws(() => M.validateRecipe({ probes: [{ kind: 'http', glob: 'a', pattern: 'b' }] }), /stack required/);
  assert.throws(() => M.validateRecipe({ stack: 'x', probes: [] }), /probes required/);
  assert.throws(() => M.validateRecipe({ stack: 'x' }), /probes required/);
  assert.throws(() => M.validateRecipe({ stack: 'x', probes: [{ kind: 'websocket', glob: 'a', pattern: 'b' }] }),
    /probes\[0\]: kind invalid/);
});

test('loadFlow on an entry that was never traced is null, not an error', () => {
  const { root } = makeTempRepo();
  M.saveFlow(M.storeFor(root), flow);
  assert.strictEqual(M.loadFlow(M.storeFor(root), 'http.GET./never-traced'), null);
});

// watchFromFlow runs on whatever explain hands it. A flow that cites nothing
// must come back with an empty watch list rather than throwing — the caller
// decides what an empty watch means, and validateFlow reports the shape.
test('watchFromFlow on a flow with no answers and no unknowns is empty', () => {
  assert.deepStrictEqual(M.watchFromFlow({}), []);
});

test('watchFromFlow reads the sections that are present and ignores absent ones', () => {
  assert.deepStrictEqual(M.watchFromFlow({ answers: { data: [{ evidence: { file: 'app/Ship.php', line: 1 } }] } }),
    ['app/Ship.php']);
});

test('a handler that moved takes discovery\'s new value, not the traced one', () => {
  const old = { id: 'x', kind: 'http', label: 'GET /x', evidence: [{ file: 'r.php', line: 1 }],
    coverage: 'traced', traced_at_sha: 'abc', watch: ['a.php'], handler: 'app/Old.php' };
  const found = { id: 'x', kind: 'http', label: 'GET /x', evidence: [{ file: 'r.php', line: 2 }],
    coverage: 'none', watch: [], handler: 'app/New.php' };
  const { model } = M.mergeModel({ version: 1, unknowns: [], entries: [old] }, [found]);
  assert.strictEqual(model.entries[0].handler, 'app/New.php');
  // ...while everything the trace earned survives the re-sweep.
  assert.strictEqual(model.entries[0].coverage, 'traced');
  assert.strictEqual(model.entries[0].traced_at_sha, 'abc');
});

test('a non-array entries is listed as a violation, not crashed on', () => {
  // A truthy non-array survived the `|| []` guard and threw a raw TypeError from
  // .entries(), which is the one thing this validator must never do.
  for (const entries of ['x', { a: 1 }, 42]) {
    assert.throws(() => M.validateModel({ version: 1, entries, unknowns: [] }),
      (err) => /entries must be an array/.test(err.message) && !(err instanceof TypeError),
      JSON.stringify(entries));
  }
});

// A repo name is a directory under the workspace store. checkOutput refuses to
// take config.output on trust for exactly this reason, and a name is no
// different: one carrying a separator or a `..` walks the store out of the
// workspace and into a repository Archie was only asked to read.
test('a repo name that is a path, not a name, is refused', () => {
  for (const name of ['../../etc', 'a/b', '.', '..']) {
    assert.throws(() => M.validateConfig({ repos: [{ name, why: 'w' }] }),
      /name must be a plain directory name/, `accepted ${JSON.stringify(name)}`);
    // And it really would have escaped: this is the trap, not just the guard.
    if (name.includes('..'))
      assert.ok(!M.storeFor('/ws/x', '/ws', name).startsWith('/ws/.archie/repos/'),
        `${name} stays inside the store, so the guard would be pointless`);
  }
  assert.doesNotThrow(() => M.validateConfig({ repos: [{ name: 'orders-api', why: 'w' }] }));
});
