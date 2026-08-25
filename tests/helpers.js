const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after } = require('node:test');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// Track every temp repo this test file created and remove them all once the
// file's tests have finished. Registered at MODULE level on purpose: an after()
// called inside a test binds to that test's scope and fires when it ends, so
// every repo created by later tests in the same file would survive forever.
const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-test-'));
  execFileSync('git', ['init', '-q', root]);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'init');
  tempRoots.push(root);
  return { root };
}
function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function commitAll(root, msg) { git(root, 'add', '-A'); git(root, 'commit', '-qm', msg); return git(root, 'rev-parse', 'HEAD').trim(); }
module.exports = { makeTempRepo, write, commitAll, git };
