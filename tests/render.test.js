const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../scripts/render');

const flow = { id: 'http.POST./api/orders/{id}/ship', summary: 'Queues shipment.', traced_at_sha: 'abc',
  answers: {
    entry: [{ text: 'Route dispatches to ShipController.', evidence: { file: 'routes/api.php', line: 12 } }],
    guards: [],
    decisions: [{ text: 'Only draft orders may ship.', evidence: { file: 'app/Order.php', line: 210 }, tests: [{ file: 'tests/ShipTest.php', line: 44 }] }],
    data: [{ text: 'Writes shipment_jobs.', evidence: { file: 'app/Ship.php', line: 30 } }],
    boundary: [{ text: 'Redis queue shipment.dispatch', evidence: { file: 'app/Ship.php', line: 31 } }],
    returns: [{ text: '202 with job id.', evidence: { file: 'app/Ship.php', line: 40 } }] },
  unknowns: [{ text: 'Retry policy', why: 'env-driven' }] };
const model = { version: 1, unknowns: [], entries: [
  { id: flow.id, kind: 'http', label: 'POST /api/orders/{id}/ship', evidence: [{ file: 'routes/api.php', line: 12 }], coverage: 'traced', traced_at_sha: 'abc', watch: ['app/Ship.php'] },
  { id: 'cli.orders.sync', kind: 'cli', label: 'orders:sync', evidence: [{ file: 'cli.php', line: 1 }], coverage: 'none', watch: [] } ] };
const fp = { stackHints: [], processes: [{ name: 'web', kind: 'web', source: 'Procfile' }], externals: [{ name: 'redis', source: 'docker-compose.yml' }] };

test('sequence diagram has boundary participant, no payloads', () => {
  const seq = R.mermaidSequence(flow);
  assert.match(seq, /^sequenceDiagram/);
  assert.match(seq, /participant Redis/);
  assert.match(seq, /Service-->>Caller: 202 with job id\./);
});

test('topology names processes and externals', () => {
  const topo = R.mermaidTopology(fp, [flow]);
  assert.match(topo, /^graph LR/);
  assert.match(topo, /web/); assert.match(topo, /redis/);
});

test('markdown pages: six questions, citations, untested tag, guard warning, coverage honesty', () => {
  const pages = R.renderMarkdownPages(model, [flow], fp);
  const page = pages.get('http-post-api-orders-id-ship.md');
  assert.match(page, /routes\/api\.php:12/);
  assert.match(page, /no guard found ⚠/);
  assert.match(page, /\(untested\)/);           // data claim has no tests
  assert.ok(!/Only draft orders[\s\S]*\(untested\)/.test(page.split('Writes shipment_jobs')[0])); // tested claim untagged
  assert.match(page, /## Unknowns/);
  assert.match(page, /```mermaid/);
  const index = pages.get('index.md');
  assert.match(index, /not yet documented/i);
  assert.match(index, /orders:sync/);
  assert.match(pages.get('open-questions.md'), /Retry policy/);
});

test('rendering is deterministic', () => {
  const a = R.renderMarkdownPages(model, [flow], fp);
  const b = R.renderMarkdownPages(model, [flow], fp);
  assert.deepStrictEqual([...a.entries()], [...b.entries()]);
});
