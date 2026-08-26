const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write } = require('./helpers');
const { fingerprint, main } = require('../scripts/fingerprint');

test('empty repo fingerprints empty', () => {
  const { root } = makeTempRepo();
  assert.deepStrictEqual(fingerprint(root), { stackHints: [], processes: [], externals: [] });
});

test('node + compose + procfile fingerprint', () => {
  const { root } = makeTempRepo();
  write(root, 'package.json', JSON.stringify({ name: 'shop', engines: { node: '>=18' }, dependencies: { express: '^4' } }));
  write(root, 'docker-compose.yml', [
    'services:', '  api:', '    build: .', '  redis:', '    image: redis:7', '  db:', '    image: postgres:15'
  ].join('\n'));
  write(root, 'Procfile', 'web: node server.js\nworker: node worker.js\ncron: node cron.js\n');
  const fp = fingerprint(root);
  assert.ok(fp.stackHints.some(h => h.name === 'node' && h.version === '>=18'));
  assert.ok(fp.stackHints.some(h => h.name === 'express'));
  assert.ok(fp.externals.some(x => x.name === 'redis'), 'redis is an external');
  assert.ok(fp.externals.some(x => x.name === 'postgres'), 'postgres is an external');
  const kinds = Object.fromEntries(fp.processes.map(p => [p.name, p.kind]));
  assert.strictEqual(kinds.web, 'web'); assert.strictEqual(kinds.worker, 'worker'); assert.strictEqual(kinds.cron, 'cron');
  assert.ok(fp.processes.some(p => p.name === 'api'));
});

test('a compose file without services: does not suppress a later valid one', () => {
  const { root } = makeTempRepo();
  write(root, 'docker-compose.yml', 'version: "3"\n');           // legacy, no services:
  write(root, 'compose.yml', 'services:\n  api:\n    build: .\n');
  assert.ok(fingerprint(root).processes.some(p => p.name === 'api'));
});

test('php, go, jvm, python and ruby manifests are all recognised', () => {
  const { root } = makeTempRepo();
  write(root, 'composer.json', JSON.stringify({ require: {
    php: '^8.2', 'laravel/framework': '^11', 'symfony/console': '^7', 'other/pkg': '^1' } }));
  write(root, 'go.mod', 'module example.com/shop\n\ngo 1.22\n');
  write(root, 'pom.xml', '<project/>');
  write(root, 'requirements.txt', 'flask\n');
  write(root, 'Gemfile', "source 'https://rubygems.org'\n");
  const names = fingerprint(root).stackHints.map(h => h.name);
  assert.deepStrictEqual(names.sort(),
    ['go', 'jvm', 'laravel/framework', 'php', 'python', 'ruby', 'symfony/console'].sort());
  assert.ok(!names.includes('other/pkg'), 'only framework packages become hints');
});

test('an unparseable manifest is skipped, never guessed at', () => {
  const { root } = makeTempRepo();
  write(root, 'package.json', '{ this is not json');
  write(root, 'composer.json', '{ nor is this');
  assert.deepStrictEqual(fingerprint(root), { stackHints: [], processes: [], externals: [] });
});

test('go.mod without a go directive yields a null version rather than a guess', () => {
  const { root } = makeTempRepo();
  write(root, 'go.mod', 'module example.com/shop\n');
  assert.deepStrictEqual(fingerprint(root).stackHints, [{ file: 'go.mod', name: 'go', version: null }]);
});

test('a dev-dependency framework still counts, and compose without services is ignored', () => {
  const { root } = makeTempRepo();
  write(root, 'package.json', JSON.stringify({ devDependencies: { fastify: '^4' } }));
  write(root, 'docker-compose.yml', 'version: "3"\nnetworks:\n  default:\n');
  const fp = fingerprint(root);
  assert.ok(fp.stackHints.some(h => h.name === 'fastify' && h.version === '^4'));
  assert.deepStrictEqual(fp.processes, []);
});

test('a top-level key ends the service scan, so its children are not services', () => {
  const { root } = makeTempRepo();
  write(root, 'docker-compose.yml', [
    'services:', '  api:', '    build: .', 'volumes:', '  dbdata:', '  cache:'
  ].join('\n'));
  // volumes: is column 0, so the scan stops there — dbdata/cache are volumes, not processes.
  assert.deepStrictEqual(fingerprint(root).processes,
    [{ name: 'api', kind: 'unknown', source: 'docker-compose.yml' }]);
});

test('main with no argument fingerprints the current directory', () => {
  const { root } = makeTempRepo();
  write(root, 'go.mod', 'module example.com/shop\n\ngo 1.22\n');
  const cwd = process.cwd();
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try { process.chdir(root); code = main([]); } finally { console.log = log; process.chdir(cwd); }
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(lines.join('\n')), fingerprint(root));
  assert.deepStrictEqual(JSON.parse(lines.join('\n')).stackHints,
    [{ file: 'go.mod', name: 'go', version: '1.22' }]);
});

test('a composer.json with no require block still yields php, with a null version', () => {
  const { root } = makeTempRepo();
  write(root, 'composer.json', JSON.stringify({ name: 'shop/app' }));
  assert.deepStrictEqual(fingerprint(root).stackHints,
    [{ file: 'composer.json', name: 'php', version: null }]);
});

test('an unrecognised Procfile process is kind "unknown", never guessed at', () => {
  const { root } = makeTempRepo();
  write(root, 'Procfile', 'release: php artisan migrate\nqueue: php artisan queue:work\n');
  assert.deepStrictEqual(fingerprint(root).processes, [
    { name: 'release', kind: 'unknown', source: 'Procfile' },
    { name: 'queue', kind: 'worker', source: 'Procfile' },
  ]);
});
