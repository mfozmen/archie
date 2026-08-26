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
