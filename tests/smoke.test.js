// tests/smoke.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll } = require('./helpers');
const { execFileSync } = require('node:child_process');

test('helpers build a real git repo', () => {
  const { root } = makeTempRepo();
  write(root, 'a.txt', 'hello');
  commitAll(root, 'add a');
  const out = execFileSync('git', ['-C', root, 'log', '--oneline'], { encoding: 'utf8' });
  assert.match(out, /add a/);
});
