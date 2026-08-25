// tests/smoke.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const { execFileSync } = require('node:child_process');

test('helpers build a real git repo', () => {
  const { root } = makeTempRepo();
  write(root, 'a.txt', 'hello');
  const sha = commitAll(root, 'add a');
  assert.match(sha, /^[0-9a-f]{40}$/, 'commitAll returns 40-hex SHA');
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.strictEqual(sha, head, 'returned SHA equals HEAD');
  const out = execFileSync('git', ['-C', root, 'log', '--oneline'], { encoding: 'utf8' });
  assert.match(out, /add a/);
});
