const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitLines, whichCommand, hasBin } = require('../scripts/lib/exec');

// `which` does not exist on Windows and `where` does not exist anywhere else, so
// picking the wrong one makes hasBin() answer "no" for every binary installed —
// and sweep would silently fall back to the grep path forever. One test run only
// ever happens on one platform, so the platform is a parameter.
test('the binary-probe command is chosen by platform, both answers pinned', () => {
  assert.strictEqual(whichCommand('win32'), 'where');
  assert.strictEqual(whichCommand('darwin'), 'which');
  assert.strictEqual(whichCommand('linux'), 'which');
  // And the default really is this machine's platform, not a hardcoded guess.
  assert.strictEqual(whichCommand(), process.platform === 'win32' ? 'where' : 'which');
  // The chosen command has to actually work here, or hasBin lies about everything.
  assert.strictEqual(hasBin('git'), true);
  assert.strictEqual(hasBin('archie-no-such-binary-xyz'), false);
});

// tryRun's own contract (null = clean non-zero, throw = broken tool) is pinned in
// staleness.test.js. This is the layer above: gitLines must carry the null
// through instead of turning it into an empty list, or "git is not usable here"
// reads as "this repository tracks no files" everywhere upstream.
test('gitLines passes a failed git command through as null, never as an empty list', () => {
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-notarepo-'));
  try {
    assert.strictEqual(gitLines(notARepo, ['ls-files']), null);
  } finally {
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});
