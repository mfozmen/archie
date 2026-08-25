const fs = require('node:fs');
const path = require('node:path');
const { slug } = require('./slug');
const ARCHIE_DIR = '.archie';
const KINDS = ['http', 'queue', 'cron', 'cli', 'event', 'public-api'];
const COVERAGE = ['none', 'traced', 'stale'];
const ANSWER_KEYS = ['entry', 'guards', 'decisions', 'data', 'boundary', 'returns'];

const dir = (root, ...p) => path.join(root, ARCHIE_DIR, ...p);
function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function fail(errors) { if (errors.length) throw new Error('invalid: ' + errors.join('; ')); }
function checkLoc(loc, where, errors) {
  if (!loc || typeof loc.file !== 'string' || !loc.file || !(Number.isInteger(loc.line) && loc.line >= 1))
    errors.push(`${where}: evidence must be {file, line>=1}`);
}

function validateModel(model) {
  const e = [];
  if (!model || model.version !== 1) e.push('version must be 1');
  if (!Array.isArray(model?.entries)) e.push('entries must be an array');
  for (const [i, en] of (model?.entries || []).entries()) {
    const w = `entries[${i}]`;
    if (!en.id) e.push(`${w}: id required`);
    if (!KINDS.includes(en.kind)) e.push(`${w}: kind invalid`);
    if (!en.label) e.push(`${w}: label required`);
    if (!Array.isArray(en.evidence) || en.evidence.length === 0) e.push(`${w}: evidence required`);
    else en.evidence.forEach((loc, j) => checkLoc(loc, `${w}.evidence[${j}]`, e));
    if (!COVERAGE.includes(en.coverage)) e.push(`${w}: coverage invalid`);
    if (en.coverage !== 'none' && (!en.traced_at_sha || !Array.isArray(en.watch) || en.watch.length === 0))
      e.push(`${w}: traced/stale require traced_at_sha and watch[]`);
  }
  // Uniqueness is checked on the SLUG, not the id: two distinct ids that flatten
  // to the same filename would silently overwrite each other's flows/<slug>.json
  // and merge their trace state — one entry point would inherit another's evidence.
  const seen = new Map();
  for (const en of (model?.entries || [])) {
    if (!en.id) continue;
    const s = slug(en.id);
    if (seen.has(s) && seen.get(s) !== en.id) e.push(`entries: "${en.id}" and "${seen.get(s)}" both map to flows/${s}.json`);
    else if (seen.has(s)) e.push(`entries: duplicate id "${en.id}"`);
    else seen.set(s, en.id);
  }
  if (!Array.isArray(model?.unknowns)) e.push('unknowns must be an array');
  fail(e);
}

function validateFlow(flow) {
  const e = [];
  if (!flow?.id) e.push('id required');
  if (!flow?.summary) e.push('summary required');
  const keys = Object.keys(flow?.answers || {}).sort().join(',');
  if (keys !== [...ANSWER_KEYS].sort().join(',')) e.push(`answers must have exactly keys ${ANSWER_KEYS.join(',')}`);
  else for (const k of ANSWER_KEYS) {
    // The key-set check above proves the six names are present, not that they
    // hold arrays. A raw TypeError here would break the "throws listing every
    // violation" contract on the file that enforces the honesty invariant.
    if (!Array.isArray(flow.answers[k])) { e.push(`answers.${k}: must be an array`); continue; }
    for (const [i, c] of flow.answers[k].entries()) {
      if (!c.text) e.push(`answers.${k}[${i}]: text required`);
      checkLoc(c.evidence, `answers.${k}[${i}]`, e);
      if (c.tests !== undefined) {
        if (!Array.isArray(c.tests)) e.push(`answers.${k}[${i}].tests: must be an array`);
        else c.tests.forEach((t, j) => checkLoc(t, `answers.${k}[${i}].tests[${j}]`, e));
      }
    }
  }
  if (!Array.isArray(flow?.unknowns)) e.push('unknowns must be an array');
  else for (const [i, u] of flow.unknowns.entries()) {
    if (!u.text || !u.why) e.push(`unknowns[${i}]: text and why required`);
    // look_at is optional, but when present it is a citation like any other —
    // a malformed one must not reach the renderer as if it were evidence.
    if (u.look_at) checkLoc(u.look_at, `unknowns[${i}].look_at`, e);
  }
  if (!flow?.traced_at_sha) e.push('traced_at_sha required');
  fail(e);
}

function validateRecipe(r) {
  const e = [];
  if (!r?.stack) e.push('stack required');
  if (!Array.isArray(r?.probes) || r.probes.length === 0) e.push('probes required');
  else for (const [i, p] of r.probes.entries()) {
    if (!KINDS.includes(p.kind)) e.push(`probes[${i}]: kind invalid`);
    if (!p.glob) e.push(`probes[${i}]: glob required`);
    if (!p.pattern) e.push(`probes[${i}]: pattern required`);
  }
  fail(e);
}

module.exports = {
  ARCHIE_DIR, KINDS, ANSWER_KEYS, validateModel, validateFlow, validateRecipe,
  loadModel: (root) => readJson(dir(root, 'model.json')),
  saveModel: (root, m) => { validateModel(m); writeJson(dir(root, 'model.json'), m); },
  loadFlow: (root, id) => readJson(dir(root, 'flows', slug(id) + '.json')),
  saveFlow: (root, f) => { validateFlow(f); writeJson(dir(root, 'flows', slug(f.id) + '.json'), f); },
  listFlows: (root) => fs.existsSync(dir(root, 'flows'))
    ? fs.readdirSync(dir(root, 'flows')).filter(n => n.endsWith('.json')).map(n => readJson(dir(root, 'flows', n)))
    : [],
  loadConfig: (root) => readJson(dir(root, 'config.json')),
  saveConfig: (root, c) => writeJson(dir(root, 'config.json'), c),
  loadRecipe: (root) => readJson(dir(root, 'recipe.json')),
  saveRecipe: (root, r) => { validateRecipe(r); writeJson(dir(root, 'recipe.json'), r); },
};
