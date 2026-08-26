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

test('a recipe with no stack, no probes, or an unknown probe kind is rejected', () => {
  assert.throws(() => M.validateRecipe({ probes: [{ kind: 'http', glob: 'a', pattern: 'b' }] }), /stack required/);
  assert.throws(() => M.validateRecipe({ stack: 'x', probes: [] }), /probes required/);
  assert.throws(() => M.validateRecipe({ stack: 'x' }), /probes required/);
  assert.throws(() => M.validateRecipe({ stack: 'x', probes: [{ kind: 'websocket', glob: 'a', pattern: 'b' }] }),
    /probes\[0\]: kind invalid/);
});

test('loadFlow on an entry that was never traced is null, not an error', () => {
  const { root } = makeTempRepo();
  M.saveFlow(root, flow);
  assert.strictEqual(M.loadFlow(root, 'http.GET./never-traced'), null);
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
