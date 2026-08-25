const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const { fileChurn, rankEntries } = require('../scripts/churn');

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
