const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write, commitAll, git } = require('./helpers');
const S = require('../scripts/scope');

test('inScope matches globs, and no scope means everything is in scope', () => {
  const scope = { label: 'Orders', paths: ['app/Orders/**', 'routes/api.php'] };
  assert.ok(S.inScope('app/Orders/Ship.php', scope));
  assert.ok(S.inScope('app/Orders/Deep/Nested.php', scope));
  assert.ok(S.inScope('routes/api.php', scope));
  assert.ok(!S.inScope('app/Billing/Invoice.php', scope));
  // A bare directory path is treated as "everything under it" — asking a person
  // to type app/Orders/** when they mean app/Orders is a tax, not a feature.
  assert.ok(S.inScope('app/Orders/Ship.php', { paths: ['app/Orders'] }));
  for (const empty of [null, undefined, { paths: [] }])
    assert.ok(S.inScope('anything/at/all.php', empty), 'no scope = no filtering');
});

test('CODEOWNERS is the strongest candidate source', () => {
  const { root } = makeTempRepo();
  write(root, '.github/CODEOWNERS', [
    '# comment',
    '/app/Orders/    @acme/orders-team @someone',
    '/app/Billing/   @acme/billing-team',
    '*               @acme/leads',
  ].join('\n'));
  write(root, 'app/Orders/Ship.php', 'x');
  commitAll(root, 'codeowners');

  const c = S.deriveCandidates(root, { teams: ['@acme/orders-team'] });
  const mine = c.filter(x => x.source === 'codeowners');
  assert.deepStrictEqual(mine.map(x => x.path), ['app/Orders']);
  assert.match(mine[0].detail, /orders-team/);
  // A catch-all owner is not evidence that this is YOUR area.
  assert.ok(!c.some(x => x.path === '*'));
});

test('git history proposes the directories you actually touch', () => {
  const { root } = makeTempRepo();
  git(root, 'config', 'user.email', 'me@example.com');
  write(root, 'app/Orders/a.php', '1'); commitAll(root, 'a');
  write(root, 'app/Orders/b.php', '1'); commitAll(root, 'b');
  write(root, 'app/Billing/c.php', '1'); commitAll(root, 'c');

  const c = S.deriveCandidates(root, { email: 'me@example.com' });
  const hist = c.filter(x => x.source === 'git-history');
  assert.strictEqual(hist[0].path, 'app/Orders');            // most-touched first
  assert.match(hist[0].detail, /2 of your 3 commits/);
  assert.ok(hist.some(x => x.path === 'app/Billing'));
});

test('with no CODEOWNERS and no history, the tree is the fallback', () => {
  const { root } = makeTempRepo();
  write(root, 'src/a.php', '1'); write(root, 'docs/b.md', '1'); commitAll(root, 'x');
  const c = S.deriveCandidates(root, { email: 'nobody@example.com' });
  assert.ok(c.length > 0);
  assert.ok(c.every(x => x.source === 'tree'));
  assert.ok(c.some(x => x.path === 'src'));
});

test('a non-ASCII path is attributed to the right directory', () => {
  const { root } = makeTempRepo();
  git(root, 'config', 'user.email', 'me@example.com');
  write(root, 'app/Orders/sipariş.php', '1'); commitAll(root, 'a');
  const hist = S.deriveCandidates(root, { email: 'me@example.com' })
    .filter(x => x.source === 'git-history');
  assert.deepStrictEqual(hist.map(x => x.path), ['app/Orders']);
});

test('a hex-named file at the repository root is not read as a commit', () => {
  const { root } = makeTempRepo();
  git(root, 'config', 'user.email', 'me@example.com');
  write(root, 'app/Orders/a.php', '1');
  write(root, 'deadbeef', '1');                       // 8 lowercase hex chars, no slash
  commitAll(root, 'a');
  const hist = S.deriveCandidates(root, { email: 'me@example.com' })
    .filter(x => x.source === 'git-history');
  assert.deepStrictEqual(hist.map(x => x.path), ['app/Orders']);
  assert.match(hist[0].detail, /of your 1 commits/);  // not 2, which a loose regex would give
});

test('ordering does not depend on the machine locale', () => {
  const { byCodePoint } = require('../scripts/lib/order');
  // Turkish 'ş' is beyond 'z' in code-point order. Whatever the host locale
  // thinks, the answer has to be the same everywhere, or two machines render
  // two different wikis from one model.
  assert.deepStrictEqual(['zebra', 'sipariş', 'app'].sort(byCodePoint), ['app', 'sipariş', 'zebra']);
  assert.strictEqual(byCodePoint('a', 'a'), 0);
});

test('directories with equal commit counts tie-break by name, not by locale', () => {
  const { root } = makeTempRepo();
  git(root, 'config', 'user.email', 'me@example.com');
  // One commit each, so ordering is decided entirely by the tie-break.
  write(root, 'zebra/a.php', '1'); commitAll(root, 'z');
  write(root, 'sipariş/a.php', '1'); commitAll(root, 's');
  write(root, 'app/a.php', '1'); commitAll(root, 'a');
  const hist = S.deriveCandidates(root, { email: 'me@example.com' })
    .filter(x => x.source === 'git-history');
  assert.deepStrictEqual(hist.map(x => x.path), ['app', 'sipariş', 'zebra']);
});

test('a CODEOWNERS pattern with no owner on it is not a candidate', () => {
  const { root } = makeTempRepo();
  // A pattern line with nothing after it owns nothing. It says no team is
  // responsible for that path, which is the opposite of evidence that you are.
  write(root, '.github/CODEOWNERS', ['/app/Orphan/', '/app/Orders/  @acme/orders-team'].join('\n'));
  write(root, 'app/Orders/Ship.php', 'x');
  commitAll(root, 'codeowners');
  const owned = S.fromCodeowners(root).map(x => x.path);
  assert.deepStrictEqual(owned, ['app/Orders']);
});

test('outside a git repository the tree fallback is empty, not a crash', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-notarepo-'));
  try {
    // `git ls-files` fails here. Proposing nothing is the honest answer; the
    // alternative is a stack trace at someone who ran /archie:scope one
    // directory too high.
    assert.deepStrictEqual(S.fromTree(notARepo), []);
    assert.deepStrictEqual(S.deriveCandidates(notARepo, { email: 'me@example.com' }), []);
    // Same through the CLI on a machine with NO git identity at all — the
    // config lookup exits non-zero and there is no email to fall back on. That
    // must produce no candidates, not a crash on a missing string.
    const out = require('node:child_process').execFileSync(process.execPath,
      [path.join(__dirname, '..', 'scripts', 'scope.js')],
      { cwd: notARepo, encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
    assert.deepStrictEqual(JSON.parse(out), []);
  } finally {
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});

test('scope.js with no arguments scopes the directory it was run in', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const { root } = makeTempRepo();
  git(root, 'config', 'user.email', 'me@example.com');
  write(root, 'app/Orders/a.php', '1'); commitAll(root, 'a');
  const script = path.join(__dirname, '..', 'scripts', 'scope.js');
  // No root argument and no email argument: cwd is the repo, and the email comes
  // from that repo's own git config.
  const out = JSON.parse(execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }));
  assert.deepStrictEqual(out, S.deriveCandidates(root, { email: 'me@example.com' }));
  assert.ok(out.some(c => c.source === 'git-history' && c.path === 'app/Orders'),
    'the configured user.email was used, not nobody');
});

test('a path before any commit is ignored, not credited to the previous one', () => {
  const sha = 'a'.repeat(40), other = 'b'.repeat(40);
  // Real git never emits this. The guard exists so that if it ever did, the
  // stray path would not inflate whichever directory happened to come last.
  const stray = S.countByDirectory(['app/Orders/leaked.php', sha, 'app/Billing/a.php'].join('\n'));
  assert.deepStrictEqual(stray.map(c => c.path), ['app/Billing']);

  const normal = S.countByDirectory([sha, 'app/Orders/a.php', other, 'app/Orders/b.php'].join('\n'));
  assert.deepStrictEqual(normal.map(c => c.path), ['app/Orders']);
  assert.match(normal[0].detail, /2 of your 2 commits/);
});
