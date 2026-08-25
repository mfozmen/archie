const fs = require('node:fs');
const path = require('node:path');
const { slug } = require('./lib/slug');
const M = require('./lib/model');

const QUESTIONS = [
  ['entry', 'Where does it enter?'], ['guards', 'Who may call it?'], ['decisions', 'What does it decide?'],
  ['data', 'What data does it touch?'], ['boundary', 'What leaves the boundary?'], ['returns', 'What does it return?'] ];
const cite = (l) => `\`${l.file}:${l.line}\``;
const participant = (claim) => claim.text.split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, '') || 'External';

function mermaidSequence(flow) {
  const lines = ['sequenceDiagram', '  participant Caller', '  participant Service'];
  const parts = [...new Set(flow.answers.boundary.map(participant))];
  parts.forEach(p => lines.push(`  participant ${p}`));
  flow.answers.entry.forEach(c => lines.push(`  Caller->>Service: ${c.text}`));
  flow.answers.boundary.forEach(c => lines.push(`  Service->>${participant(c)}: ${c.text}`));
  flow.answers.returns.forEach(c => lines.push(`  Service-->>Caller: ${c.text}`));
  return lines.join('\n');
}
function mermaidTopology(fp) {
  const lines = ['graph LR', '  service[Service]'];
  fp.processes.forEach(p => lines.push(`  ${p.name}[${p.name} · ${p.kind}] --> service`));
  fp.externals.forEach(x => lines.push(`  service --> ${x.name}[(${x.name})]`));
  return lines.join('\n');
}
function claimLine(c) {
  const tests = c.tests?.length ? ' · tests: ' + c.tests.map(cite).join(', ') : ' `(untested)`';
  return `- ${c.text} — ${cite(c.evidence)}${tests}`;
}
function flowPage(flow) {
  const out = [`# ${flow.id}`, '', flow.summary, ''];
  for (const [key, q] of QUESTIONS) {
    out.push(`## ${q}`, '');
    const claims = flow.answers[key];
    if (!claims.length) out.push(key === 'guards' ? '**no guard found ⚠**' : '_nothing recorded_');
    else claims.forEach(c => out.push(claimLine(c)));
    out.push('');
  }
  out.push('## Unknowns', '');
  flow.unknowns.forEach(u => out.push(`- ⚠ ${u.text} — ${u.why}${u.look_at ? ' · look at ' + cite(u.look_at) : ''}`));
  if (!flow.unknowns.length) out.push('_none_');
  out.push('', '```mermaid', mermaidSequence(flow), '```', '');
  return out.join('\n');
}
function renderMarkdownPages(model, flows, fp) {
  const pages = new Map();
  const flowIds = new Set(flows.map(f => f.id));
  const byId = (a, b) => a.id.localeCompare(b.id);
  const idx = ['# System map', '', `${model.entries.length} entry points`, '', '| entry point | kind | coverage |', '|---|---|---|'];
  for (const en of [...model.entries].sort(byId))
    idx.push(`| ${flowIds.has(en.id) ? `[${en.label}](${slug(en.id)}.md)` : en.label} | ${en.kind} | ${en.coverage} |`);
  const undoc = model.entries.filter(e => e.coverage === 'none');
  if (undoc.length) { idx.push('', '## Not yet documented', ''); undoc.forEach(e => idx.push(`- ${e.label}`)); }
  idx.push('', '```mermaid', mermaidTopology(fp), '```', '');
  pages.set('index.md', idx.join('\n'));
  const oq = ['# Open questions', ''];
  model.unknowns.forEach(u => oq.push(`- [inventory] ${u.text}`));
  const sortedFlows = [...flows].sort(byId);
  for (const f of sortedFlows) f.unknowns.forEach(u => oq.push(`- [${f.id}] ${u.text}`));
  pages.set('open-questions.md', oq.join('\n') + '\n');
  // Sorted, so the Map's own iteration order is a property of the model, not of
  // whatever order listFlows() happened to read the directory in.
  for (const f of sortedFlows) pages.set(slug(f.id) + '.md', flowPage(f));
  return pages;
}
if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const model = M.loadModel(root);
  if (!model) { console.error('no model — run /archie:inventory'); process.exit(1); }
  const { fingerprint } = require('./fingerprint');
  const pages = renderMarkdownPages(model, M.listFlows(root), fingerprint(root));
  const out = path.join(root, M.ARCHIE_DIR, 'wiki', 'md');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, content] of pages) fs.writeFileSync(path.join(out, name), content);
  console.log(`${pages.size} markdown pages → ${path.relative(root, out)}`);
}
module.exports = { mermaidSequence, mermaidTopology, renderMarkdownPages };
