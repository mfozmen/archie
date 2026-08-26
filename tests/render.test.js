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

// The property that matters is independence from INPUT ORDER: listFlows() reads a
// directory, and readdirSync order is not guaranteed. Re-running with the same
// array cannot catch that; two flows fed both ways can.
test('output does not depend on the order flows arrive in', () => {
  const other = { ...flow, id: 'cli.orders.sync', summary: 'Syncs orders.' };
  const twoEntries = { ...model, entries: [...model.entries] };
  const a = R.renderMarkdownPages(twoEntries, [flow, other], fp);
  const b = R.renderMarkdownPages(twoEntries, [other, flow], fp);
  assert.deepStrictEqual([...a.entries()], [...b.entries()]);
});

test('the html view shows the same look_at citation the markdown view does', () => {
  const withLookAt = { ...flow, unknowns: [{ text: 'Retry policy', why: 'env-driven', look_at: { file: 'app/Ship.php', line: 77 } }] };
  const md = R.renderMarkdownPages(model, [withLookAt], fp).get('http-post-api-orders-id-ship.md');
  const html = R.renderHtml(model, [withLookAt], fp, '');
  assert.match(md, /look at `app\/Ship\.php:77`/);
  assert.match(html, /look at <code>app\/Ship\.php:77<\/code>/);
});

test('openapi draft: paths, params, honest TODOs', () => {
  const yaml = R.renderOpenapi(model, [flow]);
  assert.match(yaml, /openapi: 3\.0\.3/);
  assert.match(yaml, /\/api\/orders\/\{id\}\/ship:/);
  assert.match(yaml, /post:/);
  assert.match(yaml, /name: 'id'/);   // quoted: a path could contain a YAML metacharacter
  assert.match(yaml, /'202':/);            // from "202 with job id."
  assert.match(yaml, /TODO: body schema not derivable/);
  assert.match(yaml, /x-archie-evidence: 'routes\/api\.php:12'/);
});

test('html wiki is self-contained', () => {
  const html = R.renderHtml(model, [flow], fp, '/*mermaid-stub*/');
  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /\/\*mermaid-stub\*\//);
  assert.ok(!/https?:\/\//.test(html.replace(/github\.com\/mfozmen\/archie/g, ''))); // no external URLs
  assert.match(html, /orders:sync/);       // undocumented entries still listed
});

test('a scoped map says so on every surface it renders', () => {
  const scope = { label: 'Orders', paths: ['app/Orders/**'] };
  const pages = R.renderMarkdownPages(model, [flow], fp, scope);
  const index = pages.get('index.md');
  assert.match(index, /Orders/);
  assert.match(index, /scope|scoped/i);
  assert.match(index, /not a map of the whole system/i);
  assert.match(R.renderHtml(model, [flow], fp, '', scope), /not a map of the whole system/i);
  // Unscoped renders carry no such banner — it would be a false caveat.
  assert.ok(!/not a map of the whole system/i.test(R.renderMarkdownPages(model, [flow], fp).get('index.md')));
});
