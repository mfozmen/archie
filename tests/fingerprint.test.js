const { test } = require('node:test');
const assert = require('node:assert');
const { makeTempRepo, write } = require('./helpers');
const { fingerprint } = require('../scripts/fingerprint');

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
  assert.ok(fp.externals.some(x => x.name === 'redis') && fp.externals.some(x => x.name === 'postgres'));
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
