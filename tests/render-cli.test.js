const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../scripts/lib/model');
const { main } = require('../scripts/render');
const { makeTempRepo, write, commitAll } = require('./helpers');

// main() prints a one-line summary; swallow it so the branch under test is the
// only thing this file reports on.
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

function repoWithModel() {
  const { root } = makeTempRepo();
  write(root, 'routes/api.php', '<?php');
  commitAll(root, 'files');
  M.saveModel(M.storeFor(root), { version: 1, unknowns: [], entries: [
    { id: 'http.GET./a', kind: 'http', label: 'GET /a', evidence: [{ file: 'routes/api.php', line: 1 }],
      coverage: 'none', watch: [] } ] });
  return root;
}

// The renderer is also run as `node scripts/render.js` with no path at all.
test('with no path argument the renderer maps the current directory', () => {
  const root = repoWithModel();
  const cwd = process.cwd();
  let code;
  try { process.chdir(root); code = quiet(() => main([])); } finally { process.chdir(cwd); }
  assert.strictEqual(code, 0);
  // fs.realpathSync: macOS temp dirs are symlinks, and main() writes through the
  // resolved path.
  const md = path.join(fs.realpathSync(root), '.archie', 'wiki', 'md', 'index.md');
  assert.match(fs.readFileSync(md, 'utf8'), /^# System map/);
});

// The scope caveat is only honest if the configured scope actually reaches the
// pages — a render that ignores config.json would ship an unscoped-looking map.
test('a configured scope reaches every file the renderer writes', () => {
  const root = repoWithModel();
  M.saveConfig(M.storeFor(root), { scope: { label: 'Orders', paths: ['app/Orders/**'] } });
  assert.strictEqual(quiet(() => main([root])), 0);
  const wiki = path.join(root, '.archie', 'wiki');
  const read = (p) => fs.readFileSync(path.join(wiki, p), 'utf8');
  for (const f of ['md/index.md', 'md/open-questions.md', 'index.html', 'openapi.yaml'])
    assert.match(read(f), /not a map of the whole system/i, f);
  assert.match(read('md/index.md'), /app\/Orders\/\*\*/);
});
