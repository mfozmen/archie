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

test('the scope caveat reaches the pages people actually share', () => {
  const scope = { label: 'Orders', paths: ['app/Orders/**'] };
  const pages = R.renderMarkdownPages(model, [flow], fp, scope);
  // A flow page is linkable on its own and is often the only page a reader opens.
  assert.match(pages.get('http-post-api-orders-id-ship.md'), /not a map of the whole system/i);
  assert.match(pages.get('open-questions.md'), /not a map of the whole system/i);
  assert.match(R.renderOpenapi(model, [flow], scope), /not a map of the whole system/i);
  // ...and stays absent when there is nothing to caveat.
  assert.ok(!/not a map of the whole system/i.test(
    R.renderMarkdownPages(model, [flow], fp).get('http-post-api-orders-id-ship.md')));
});

test('the plain-text caveat keeps the globs it is quoting', () => {
  const scope = { label: 'Orders', paths: ['app/Orders/**', 'routes/api.php'] };
  // De-markdowning by stripping ** turned app/Orders/** into app/Orders/ — a
  // caveat that misstates the very scope it exists to disclose.
  for (const out of [R.renderOpenapi(model, [flow], scope), R.renderHtml(model, [flow], fp, '', scope)])
    assert.match(out, /app\/Orders\/\*\*/);
});

// --- branches that only an unusual model reaches ------------------------------

test('a boundary whose first word is punctuation still names a participant', () => {
  const arrow = { ...flow, answers: { ...flow.answers,
    boundary: [{ text: '→ ships to carrier API.', evidence: { file: 'app/Ship.php', line: 31 } }] } };
  const seq = R.mermaidSequence(arrow);
  assert.match(seq, /^ {2}participant External$/m);
  assert.match(seq, /Service->>External: → ships to carrier API\./);
});

test('an answer nobody recorded says so, and only guards get the warning', () => {
  const noDecisions = { ...flow, answers: { ...flow.answers, decisions: [] } };
  const md = R.renderMarkdownPages(model, [noDecisions], fp).get('http-post-api-orders-id-ship.md');
  // The empty guards list keeps its own, louder wording.
  assert.match(md, /## What does it decide\?\n\n_nothing recorded_/);
  assert.match(md, /## Who may call it\?\n\n\*\*no guard found ⚠\*\*/);
  const html = R.renderHtml(model, [noDecisions], fp, '');
  assert.match(html, /<h3>What does it decide\?<\/h3><p class="none">nothing recorded<\/p>/);
  assert.match(html, /<h3>Who may call it\?<\/h3><p class="warn">no guard found ⚠<\/p>/);
});

test('a flow with no unknowns says none rather than showing an empty list', () => {
  const noUnknowns = { ...flow, unknowns: [] };
  const md = R.renderMarkdownPages(model, [noUnknowns], fp).get('http-post-api-orders-id-ship.md');
  assert.match(md, /## Unknowns\n\n_none_/);
  assert.match(R.renderHtml(model, [noUnknowns], fp, ''), /<h3>Unknowns<\/h3><p class="none">none<\/p>/);
});

test('a scope with no label still discloses itself and its paths', () => {
  const scope = { paths: ['app/Orders/**'] };
  const index = R.renderMarkdownPages(model, [flow], fp, scope).get('index.md');
  assert.match(index, /Scoped to a subset of this repository — `app\/Orders\/\*\*`\./);
  assert.match(index, /not a map of the whole system/i);
});

test('an http entry whose label is not "<METHOD> <path>" is skipped out loud', () => {
  const odd = { ...model, entries: [...model.entries,
    { id: 'http.ships', kind: 'http', label: 'ships orders', evidence: [{ file: 'r.php', line: 3 }], coverage: 'none', watch: [] }] };
  const errs = [];
  const real = console.error;
  console.error = (m) => errs.push(m);
  let yaml;
  try { yaml = R.renderOpenapi(odd, [flow]); } finally { console.error = real; }
  assert.deepStrictEqual(errs, ['skipping http.ships: label is not "<METHOD> <path>"']);
  assert.ok(!/ships orders/.test(yaml), 'the unparseable entry is not guessed into a path');
  assert.match(yaml, /\/api\/orders\/\{id\}\/ship:/);  // the parseable one still renders
});

test('a returns claim with no status code becomes default, not a guessed 200', () => {
  const vague = { ...flow, answers: { ...flow.answers,
    returns: [{ text: 'Redirects the caller back to the order.', evidence: { file: 'app/Ship.php', line: 40 } }] } };
  const yaml = R.renderOpenapi(model, [vague]);
  assert.match(yaml, /'default':\n {10}description: 'Redirects the caller back to the order\.'/);
  assert.ok(!/'200'/.test(yaml));
});

test('inventory-level unknowns reach open-questions.md', () => {
  const withUnknown = { ...model, unknowns: [{ text: 'GET /legacy is in the inventory but the sweep no longer finds it.' }] };
  const oq = R.renderMarkdownPages(withUnknown, [flow], fp).get('open-questions.md');
  assert.match(oq, /- \[inventory\] GET \/legacy is in the inventory but the sweep no longer finds it\./);
});

test('html sections are ordered by flow id, not by the order flows arrive in', () => {
  const other = { ...flow, id: 'cli.orders.sync', summary: 'Syncs orders.' };
  const a = R.renderHtml(model, [flow, other], fp, '');
  const b = R.renderHtml(model, [other, flow], fp, '');
  assert.strictEqual(a, b);
  assert.ok(a.indexOf('<h2>cli.orders.sync</h2>') < a.indexOf('<h2>http.POST./api/orders/{id}/ship</h2>'));
});
