const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const W = require('../scripts/workspace');

function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-wsx-'));
  return ws;
}
function repoIn(ws, name, email = 'dev@example.com') {
  const p = path.join(ws, name);
  fs.mkdirSync(p, { recursive: true });
  execFileSync('git', ['init', '-q', p]);
  execFileSync('git', ['-C', p, 'config', 'user.email', email]);
  execFileSync('git', ['-C', p, 'config', 'user.name', 'Dev']);
  execFileSync('git', ['-C', p, 'config', 'commit.gpgsign', 'false']);
  execFileSync('git', ['-C', p, 'commit', '--allow-empty', '-qm', 'init']);
  return p;
}
const put = (p, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(p, rel)), { recursive: true });
  fs.writeFileSync(path.join(p, rel), body);
};

test('a workspace is the checkouts directly under it, and nothing else', () => {
  const ws = makeWorkspace();
  repoIn(ws, 'orders-api');
  repoIn(ws, 'billing-worker');
  fs.mkdirSync(path.join(ws, 'notes'));                       // not a repo
  fs.mkdirSync(path.join(ws, '.cache'));                      // hidden
  // A checkout nested two deep is somebody's vendored copy or a fixture, not a
  // repository this person is responsible for.
  repoIn(ws, path.join('orders-api', 'vendor-copy'));

  assert.deepStrictEqual(W.findRepos(ws), ['billing-worker', 'orders-api']);
});

test('a workspace that cannot be read is empty, not a crash', () => {
  assert.deepStrictEqual(W.findRepos(path.join(os.tmpdir(), 'archie-does-not-exist')), []);
});

test('main says so when a directory holds no checkouts at all', () => {
  const ws = makeWorkspace();
  const err = [];
  const real = console.error;
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try { code = W.main([ws]); } finally { console.error = real; }
  assert.strictEqual(code, 1);
  assert.match(err.join('\n'), /no git repositories directly under/);
});

// The bug this replaces: scope.js asks the repository it is standing in for
// "your" email, which finds that identity's commits there and misses every
// commit made under the other one.
test('identities are unioned across the workspace, not read from one repo', () => {
  const ws = makeWorkspace();
  repoIn(ws, 'a', 'work@example.com');
  repoIn(ws, 'b', 'personal@example.com');
  const ids = W.gitIdentities(ws, ['a', 'b']);
  assert.ok(ids.includes('work@example.com'));
  assert.ok(ids.includes('personal@example.com'));
});

test('commits are counted under every identity, not just the local one', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a', 'work@example.com');
  put(p, 'x.txt', '1');
  execFileSync('git', ['-C', p, 'add', '-A']);
  execFileSync('git', ['-C', p, 'commit', '-qm', 'one', '--author=Other <personal@example.com>']);

  assert.strictEqual(W.commitsBy(p, ['work@example.com']), 1);          // the init commit
  assert.strictEqual(W.commitsBy(p, ['personal@example.com']), 1);      // the authored one
  assert.strictEqual(W.commitsBy(p, ['work@example.com', 'personal@example.com']), 2);
  assert.strictEqual(W.commitsBy(p, ['nobody@example.com']), 0);
});

test('a repository with no CODEOWNERS names no teams', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  assert.deepStrictEqual(W.ownersIn(p), { teams: [], individuals: 0, codeownersFile: null });
});

// Individuals are counted and not named. They outnumbered teams roughly thirty
// to one on a real workspace, they do not answer "which team am I on", and they
// are other people's names.
test('CODEOWNERS gives teams by name and individuals only as a count', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, '.github/CODEOWNERS', [
    '# comment @org/not-a-real-owner',
    '*            @org/platform @alice',
    'app/billing/ @org/payments @bob @alice',
    'docs/        @carol',
    '',
  ].join('\n'));
  const { teams, individuals } = W.ownersIn(p);
  assert.deepStrictEqual(teams, ['@org/payments', '@org/platform']);
  assert.strictEqual(individuals, 3, 'alice, bob and carol counted once each');
  assert.ok(!JSON.stringify(teams).includes('alice'), 'individuals must not be named');
});

test('a description skips the title and the badges and takes the first real line', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, 'README.md', '# orders-api\n\n[![build](x)](y)\n<img src="z">\n\nQueues and ships orders.\n');
  assert.strictEqual(W.describe(p), 'Queues and ships orders.');
});

test('a README with nothing but a title has no description, and neither has a repo without one', () => {
  const ws = makeWorkspace();
  const bare = repoIn(ws, 'bare');
  assert.strictEqual(W.describe(bare), null);
  const titled = repoIn(ws, 'titled');
  put(titled, 'README.md', '# titled\n');
  assert.strictEqual(W.describe(titled), null);
});

test('a long first line is cut rather than carried whole', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, 'README.md', 'x'.repeat(500) + '\n');
  assert.strictEqual(W.describe(p).length, 200);
});

test('gather reports every repo with the evidence behind it and decides nothing', () => {
  const ws = makeWorkspace();
  const a = repoIn(ws, 'orders-api', 'work@example.com');
  put(a, 'CODEOWNERS', '* @org/payments\n');
  put(a, 'README.md', 'Ships orders.\n');
  repoIn(ws, 'unowned', 'work@example.com');

  const out = W.gather(ws);
  assert.strictEqual(out.workspace, ws);
  assert.deepStrictEqual(out.repos.map(r => r.name), ['orders-api', 'unowned']);

  const orders = out.repos[0];
  assert.deepStrictEqual(orders.teams, ['@org/payments']);
  assert.strictEqual(orders.description, 'Ships orders.');
  assert.ok(orders.commits >= 1);

  // Nothing is filtered out for lacking evidence. A repo you are responsible for
  // but have never committed to and that names no team still has to be offered,
  // or it can never be added.
  assert.deepStrictEqual(out.repos[1].teams, []);
});

test('main prints the gathered evidence as JSON', () => {
  const ws = makeWorkspace();
  repoIn(ws, 'orders-api');
  const out = [];
  const real = console.log;
  console.log = (...a) => out.push(a.join(' '));
  let code;
  try { code = W.main([ws]); } finally { console.log = real; }
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(out.join('\n')).repos.map(r => r.name), ['orders-api']);
});

// CODEOWNERS also accepts a bare email as an owner, which is neither a team nor
// an @-handle. It must not be counted as either.
test('an email owner is neither a team nor an individual handle', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, 'CODEOWNERS', '* dev@example.com @org/platform\n');
  assert.deepStrictEqual(W.ownersIn(p), { teams: ['@org/platform'], individuals: 0, codeownersFile: 'CODEOWNERS' });
});

test('a lowercase readme and an extensionless README are both read', () => {
  const ws = makeWorkspace();
  const lower = repoIn(ws, 'lower');
  put(lower, 'readme.md', 'Lowercase works.\n');
  assert.strictEqual(W.describe(lower), 'Lowercase works.');

  const plain = repoIn(ws, 'plain');
  put(plain, 'README', 'No extension works.\n');
  assert.strictEqual(W.describe(plain), 'No extension works.');
});

// A directory with a .git that git cannot read is not a repository to count
// commits in. Returning zero is right; throwing would take the whole sweep down
// because one checkout was mid-clone or corrupt.
test('a directory git refuses to read counts as no commits, not an error', () => {
  const ws = makeWorkspace();
  const broken = path.join(ws, 'broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, '.git'), 'gitdir: /nowhere\n');
  assert.deepStrictEqual(W.findRepos(ws), ['broken']);
  assert.strictEqual(W.commitsBy(broken, ['dev@example.com']), 0);
});

test('a repo with no configured email contributes no identity', () => {
  const ws = makeWorkspace();
  const p = path.join(ws, 'noemail');
  fs.mkdirSync(p, { recursive: true });
  require('node:child_process').execFileSync('git', ['init', '-q', p]);
  const ids = W.gitIdentities(ws, ['noemail']);
  assert.ok(!ids.includes(''), 'an empty email must never become an identity');
});

test('with no argument the workspace is the directory it was run in', () => {
  const ws = makeWorkspace();
  repoIn(ws, 'orders-api');
  const cwd = process.cwd();
  const out = [];
  const real = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try { process.chdir(ws); assert.strictEqual(W.main([]), 0); }
  finally { process.chdir(cwd); console.log = real; }
  assert.deepStrictEqual(JSON.parse(out.join('\n')).repos.map(r => r.name), ['orders-api']);
});

// Badges are the common case, but a README opening with a plain docs link is
// just as useless as a description — and it is not a badge.
test('a leading markdown link is skipped like a badge is', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, 'README.md', '# a\n\n[Documentation](https://example.com/docs)\n\nHandles refunds.\n');
  assert.strictEqual(W.describe(p), 'Handles refunds.');
});

// The two callers read a CODEOWNERS line the same way and decide about it
// differently. This pins the difference so neither drifts into the other.
test('a catch-all owner counts for a repository and not for a directory', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, 'CODEOWNERS', '* @org/payments\n');
  // At repo level a catch-all says the repository is in that team's world.
  assert.deepStrictEqual(W.ownersIn(p).teams, ['@org/payments']);
  // At directory level it says only who to ask by default, which is not
  // evidence that any particular directory is theirs.
  assert.deepStrictEqual(require('../scripts/scope').fromCodeowners(p), []);
});

// "Assigned to that team" is a claim as soon as the skill shows it, and a claim
// in this project names where it was read. CODEOWNERS lives in one of three
// places, so which one is not something to leave the reader guessing.
test('a team assignment carries the file it was read from', () => {
  const ws = makeWorkspace();
  const p = repoIn(ws, 'a');
  put(p, '.github/CODEOWNERS', '* @org/payments\n');
  assert.strictEqual(W.ownersIn(p).codeownersFile, '.github/CODEOWNERS');
  assert.strictEqual(W.gather(ws).repos[0].codeownersFile, '.github/CODEOWNERS');
});
