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
