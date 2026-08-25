const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after } = require('node:test');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// Track every temp repo this test file created and remove them all once
// node:test has finished running that file's tests (registered lazily, once).
const tempRoots = [];
let cleanupRegistered = false;
function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-test-'));
  execFileSync('git', ['init', '-q', root]);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'commit', '--allow-empty', '-qm', 'init');
  tempRoots.push(root);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    after(() => {
      for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
    });
  }
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
