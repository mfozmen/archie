const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const M = require('../scripts/lib/model');
const { fileChurn, rankEntries, main } = require('../scripts/churn');

test('churn counts commits per file and ranks entries', () => {
  const { root } = makeTempRepo();
  write(root, 'hot.php', 'v1'); write(root, 'cold.php', 'v1'); commitAll(root, 'c1');
  write(root, 'hot.php', 'v2'); commitAll(root, 'c2');
  write(root, 'hot.php', 'v3'); commitAll(root, 'c3');
  const churn = fileChurn(root, ['hot.php', 'cold.php']);
  assert.strictEqual(churn.get('hot.php'), 3);
  assert.strictEqual(churn.get('cold.php'), 1);
  const model = { version: 1, unknowns: [], entries: [
    { id: 'a', kind: 'http', label: 'A', evidence: [{ file: 'cold.php', line: 1 }], coverage: 'none', watch: [] },
    { id: 'b', kind: 'http', label: 'B', evidence: [{ file: 'hot.php', line: 1 }], coverage: 'none', watch: [] } ] };
  const top = rankEntries(model, churn, 5);
  assert.deepStrictEqual(top.map(t => t.id), ['b', 'a']);
  assert.strictEqual(top[0].commits, 3);
});

test('a non-ASCII path is counted, not silently missed', () => {
  const { root } = makeTempRepo();
  write(root, 'app/sipariş.php', 'v1'); commitAll(root, 'c1');
  write(root, 'app/sipariş.php', 'v2'); commitAll(root, 'c2');
  assert.strictEqual(fileChurn(root, ['app/sipariş.php']).get('app/sipariş.php'), 2);
});

test('a file with no commits in the window scores 0, not NaN', () => {
  const model = { version: 1, unknowns: [], entries: [
    { id: 'known', kind: 'http', label: 'K', evidence: [{ file: 'hot.php', line: 1 }], coverage: 'none', watch: [] },
    { id: 'unknown', kind: 'http', label: 'U', evidence: [{ file: 'never-logged.php', line: 2 }], coverage: 'none', watch: [] } ] };
  const top = rankEntries(model, new Map([['hot.php', 3]]), 5);
  assert.deepStrictEqual(top.map(t => t.id), ['known', 'unknown']);
  assert.strictEqual(top[1].commits, 0);   // absent from the churn map, not unknown-shaped
});

test('main with no argument ranks the current directory', () => {
  const { root } = makeTempRepo();
  write(root, 'hot.php', 'v1'); write(root, 'cold.php', 'v1'); commitAll(root, 'c1');
  write(root, 'hot.php', 'v2'); commitAll(root, 'c2');
  M.saveModel(root, { version: 1, unknowns: [], entries: [
    { id: 'a', kind: 'http', label: 'Cold one', evidence: [{ file: 'cold.php', line: 1 }], coverage: 'none', watch: [] },
    { id: 'b', kind: 'http', label: 'Hot one', evidence: [{ file: 'nothing.php', line: 7 }], coverage: 'none', watch: ['hot.php', '*.md'] } ] });
  const cwd = process.cwd();
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try { process.chdir(root); code = main([]); } finally { console.log = log; process.chdir(cwd); }
  assert.strictEqual(code, 0);
  // 'Hot one' has no churn in its evidence file — it ranks first purely on its
  // literal watch path hot.php, which main must collect and score too.
  assert.deepStrictEqual(lines, ['1. Hot one  · 2 commits · nothing.php:7', '2. Cold one  · 1 commits · cold.php:1']);
});

test('a literal watch path is scored, a glob is not looked up', () => {
  const model = { version: 1, unknowns: [], entries: [{
    id: 'a', kind: 'http', label: 'A', evidence: [{ file: 'thin.php', line: 1 }],
    coverage: 'traced', watch: ['legacy.php', 'app/**/*.php'] }] };
  // legacy.php is watched literally, so its churn counts; the glob is not a
  // filename and must not be looked up (a Map hit on it would be a lie anyway).
  const top = rankEntries(model, new Map([['thin.php', 1], ['legacy.php', 9], ['app/**/*.php', 99]]), 5);
  assert.strictEqual(top[0].commits, 9);
});
