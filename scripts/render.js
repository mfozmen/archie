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
function flowPage(flow, scope) {
  const note = scopeNote(scope);
  // On the flow page too, not only the index: a flow page is linkable on its own
  // and is frequently the only page a reader ever opens.
  const out = [`# ${flow.id}`, '', ...(note ? ['> ' + note, ''] : []), flow.summary, ''];
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
// A scoped map is a map of one area. Left unsaid, a reader takes an inventory of
// 12 endpoints as the system having 12 endpoints — the exact wrong belief for a
// tool that exists to stop people being confidently wrong about a codebase.
function scopeNote(scope, markdown = true) {
  if (!scope?.paths?.length) return null;
  // Built for each medium rather than de-markdowned with a regex: stripping `**`
  // from the rendered string also ate it out of a glob like app/Orders/**, so the
  // caveat misstated the very scope it exists to disclose.
  const b = markdown ? '**' : '';
  const c = markdown ? '`' : '';
  const what = scope.label ? `${b}${scope.label}${b}` : 'a subset of this repository';
  return `Scoped to ${what} — ${scope.paths.map(p => `${c}${p}${c}`).join(', ')}. ` +
    `This is ${b}not a map of the whole system${b}: anything outside those paths was never swept.`;
}

function renderMarkdownPages(model, flows, fp, scope) {
  const pages = new Map();
  const flowIds = new Set(flows.map(f => f.id));
  const byId = (a, b) => a.id.localeCompare(b.id);
  const note = scopeNote(scope);
  const idx = ['# System map', ''];
  if (note) idx.push('> ' + note, '');
  idx.push(`${model.entries.length} entry points`, '', '| entry point | kind | coverage |', '|---|---|---|');
  for (const en of [...model.entries].sort(byId))
    idx.push(`| ${flowIds.has(en.id) ? `[${en.label}](${slug(en.id)}.md)` : en.label} | ${en.kind} | ${en.coverage} |`);
  const undoc = model.entries.filter(e => e.coverage === 'none');
  if (undoc.length) { idx.push('', '## Not yet documented', ''); undoc.forEach(e => idx.push(`- ${e.label}`)); }
  idx.push('', '```mermaid', mermaidTopology(fp), '```', '');
  pages.set('index.md', idx.join('\n'));
  const oq = ['# Open questions', '', ...(note ? ['> ' + note, ''] : [])];
  model.unknowns.forEach(u => oq.push(`- [inventory] ${u.text}`));
  const sortedFlows = [...flows].sort(byId);
  for (const f of sortedFlows) f.unknowns.forEach(u => oq.push(`- [${f.id}] ${u.text}`));
  pages.set('open-questions.md', oq.join('\n') + '\n');
  // Sorted, so the Map's own iteration order is a property of the model, not of
  // whatever order listFlows() happened to read the directory in.
  for (const f of sortedFlows) pages.set(slug(f.id) + '.md', flowPage(f, scope));
  return pages;
}

// --- OpenAPI draft -----------------------------------------------------------
// String-assembled on purpose: a YAML library would be the first npm dependency,
// and this emits a fixed, shallow shape. It is a DRAFT — everything it cannot
// prove from static evidence is left as a visible TODO rather than invented.
const yamlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function renderOpenapi(model, flows, scope) {
  const flowById = new Map(flows.map(f => [f.id, f]));
  const paths = new Map();
  for (const en of [...model.entries].sort((a, b) => a.id.localeCompare(b.id))) {
    if (en.kind !== 'http') continue;
    const m = en.label.match(/^([A-Z]+) (\/\S*)$/);
    if (!m) { console.error(`skipping ${en.id}: label is not "<METHOD> <path>"`); continue; }
    const [, method, urlPath] = m;
    if (!paths.has(urlPath)) paths.set(urlPath, []);
    paths.get(urlPath).push({ method: method.toLowerCase(), en, flow: flowById.get(en.id) });
  }
  const note = scopeNote(scope);
  const out = ['openapi: 3.0.3', 'info:', "  title: 'Archie draft'", "  version: '0.1.0'"];
  if (note) out.push(`  description: ${yamlStr(scopeNote(scope, false))}`);
  out.push('paths:');
  for (const [urlPath, ops] of paths) {
    out.push(`  ${urlPath}:`);
    const params = [...urlPath.matchAll(/\{([^}]+)\}/g)].map(x => x[1]);
    for (const { method, en, flow } of ops) {
      out.push(`    ${method}:`);
      out.push(`      description: ${yamlStr(flow?.summary || 'Not yet documented')}`);
      out.push(`      x-archie-evidence: ${yamlStr(`${en.evidence[0].file}:${en.evidence[0].line}`)}`);
      if (params.length) {
        out.push('      parameters:');
        for (const name of params)
          out.push(`        - name: ${yamlStr(name)}`, '          in: path', '          required: true', '          schema:', '            type: string');
      }
      out.push('      # TODO: body schema not derivable from static evidence');
      out.push('      responses:');
      const returns = flow?.answers.returns ?? [];
      if (!returns.length) out.push("        'default':", "          description: 'Not yet documented'");
      else for (const c of returns) {
        const code = (c.text.match(/\b(\d{3})\b/) || [])[1];
        out.push(`        ${code ? `'${code}'` : "'default'"}:`, `          description: ${yamlStr(c.text)}`);
      }
    }
  }
  return out.join('\n') + '\n';
}

// --- Single-file HTML wiki ---------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtml(model, flows, fp, mermaidJs, scope) {
  const flowById = new Map(flows.map(f => [f.id, f]));
  const entries = [...model.entries].sort((a, b) => a.id.localeCompare(b.id));
  const nav = [];
  for (const kind of [...new Set(entries.map(e => e.kind))].sort()) {
    nav.push(`<h3>${esc(kind)}</h3><ul>`);
    for (const en of entries.filter(e => e.kind === kind))
      nav.push(`<li data-name="${esc(en.label.toLowerCase())}">` +
        (flowById.has(en.id) ? `<a href="#${esc(slug(en.id))}">${esc(en.label)}</a>` : esc(en.label)) +
        ` <span class="badge ${esc(en.coverage)}">${esc(en.coverage)}</span></li>`);
    nav.push('</ul>');
  }
  const note = scopeNote(scope);
  const sections = [`<section id="overview"><h1>System map</h1>` +
    (note ? `<p class="warn">${esc(scopeNote(scope, false))}</p>` : '') +
    `<p>${entries.length} entry points</p>` +
    `<pre class="mermaid">${esc(mermaidTopology(fp))}</pre></section>`];
  for (const f of [...flows].sort((a, b) => a.id.localeCompare(b.id))) {
    const body = [`<section id="${esc(slug(f.id))}"><h2>${esc(f.id)}</h2><p>${esc(f.summary)}</p>`];
    for (const [key, q] of QUESTIONS) {
      body.push(`<h3>${esc(q)}</h3>`);
      const claims = f.answers[key];
      if (!claims.length) body.push(key === 'guards' ? '<p class="warn">no guard found ⚠</p>' : '<p class="none">nothing recorded</p>');
      else body.push('<ul>' + claims.map(c => `<li>${esc(c.text)} <code>${esc(c.evidence.file)}:${c.evidence.line}</code>` +
        (c.tests?.length ? ' <span class="tested">tested</span>' : ' <span class="untested">(untested)</span>') + '</li>').join('') + '</ul>');
    }
    body.push('<h3>Unknowns</h3>');
    body.push(f.unknowns.length
      ? '<ul>' + f.unknowns.map(u => `<li class="warn">⚠ ${esc(u.text)} — ${esc(u.why)}` +
          (u.look_at ? ` · look at <code>${esc(u.look_at.file)}:${u.look_at.line}</code>` : '') + '</li>').join('') + '</ul>'
      : '<p class="none">none</p>');
    body.push(`<pre class="mermaid">${esc(mermaidSequence(f))}</pre></section>`);
    sections.push(body.join(''));
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Archie — system map</title>
<style>
:root{color-scheme:light dark}
body{margin:0;display:flex;font:15px/1.5 system-ui,sans-serif}
nav{width:20rem;flex:0 0 20rem;padding:1rem;overflow:auto;height:100vh;border-right:1px solid #8884}
main{flex:1;padding:1rem 2rem;overflow:auto;height:100vh}
nav ul{list-style:none;padding:0;margin:0 0 1rem}
nav li{padding:.15rem 0}
#filter{width:100%;padding:.4rem;margin-bottom:1rem}
.badge{font-size:.75em;padding:0 .35em;border:1px solid #8884;border-radius:3px}
.badge.stale{color:#b45309}.badge.none{color:#6b7280}.badge.traced{color:#15803d}
.warn{color:#b45309}.none{color:#6b7280;font-style:italic}
.untested{color:#b45309;font-size:.85em}.tested{color:#15803d;font-size:.85em}
code{background:#8881;padding:0 .25em;border-radius:3px}
section{border-bottom:1px solid #8884;padding-bottom:1rem;margin-bottom:1rem}
</style></head><body>
<nav><input id="filter" placeholder="filter entry points">${nav.join('')}</nav>
<main>${sections.join('')}</main>
<script>
document.getElementById('filter').addEventListener('input', function (e) {
  var q = e.target.value.toLowerCase();
  document.querySelectorAll('nav li').forEach(function (li) {
    li.style.display = li.dataset.name.indexOf(q) === -1 ? 'none' : '';
  });
});
</script>
<script>${mermaidJs}</script>
<script>if (window.mermaid) mermaid.initialize({ startOnLoad: true });</script>
</body></html>
`;
}

if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const model = M.loadModel(root);
  if (!model) { console.error('no model — run /archie:inventory'); process.exit(1); }
  const { fingerprint } = require('./fingerprint');
  const flows = M.listFlows(root);
  const fp = fingerprint(root);
  const scope = M.loadConfig(root)?.scope;
  const pages = renderMarkdownPages(model, flows, fp, scope);
  const wiki = M.outputDir(root);
  const out = path.join(wiki, 'md');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, content] of pages) fs.writeFileSync(path.join(out, name), content);
  console.log(`${pages.size} markdown pages → ${path.relative(root, out)}`);
  if (process.argv.includes('--md')) return;

  // Say so rather than shipping a wiki whose diagrams silently never render.
  const vendored = path.join(__dirname, '..', 'vendor', 'mermaid.min.js');
  let mermaidJs = '';
  if (fs.existsSync(vendored)) mermaidJs = fs.readFileSync(vendored, 'utf8');
  else console.error('vendor/mermaid.min.js missing — diagrams will not render in index.html');
  fs.writeFileSync(path.join(wiki, 'index.html'), renderHtml(model, flows, fp, mermaidJs, scope));
  fs.writeFileSync(path.join(wiki, 'openapi.yaml'), renderOpenapi(model, flows, scope));
  console.log(`wiki → ${path.relative(root, path.join(wiki, 'index.html'))}, openapi.yaml`);
}
module.exports = { mermaidSequence, mermaidTopology, renderMarkdownPages, renderOpenapi, renderHtml };
