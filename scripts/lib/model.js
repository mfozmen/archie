const fs = require('node:fs');
const path = require('node:path');
const { slug } = require('./slug');
const { byCodePoint } = require('./order');
const ARCHIE_DIR = '.archie';
const KINDS = ['http', 'queue', 'cron', 'cli', 'event', 'public-api'];
const COVERAGE = new Set(['none', 'traced', 'stale']);
const ANSWER_KEYS = ['entry', 'guards', 'decisions', 'data', 'boundary', 'returns'];

// Two questions that used to have one answer: where the code is, and where
// Archie writes. They were the same directory only because Archie could see one
// repository — and that is exactly what made a responsibility spanning several
// repos impossible to store, since it has no single repo to live in.
//
// From here the store functions take a *store directory*, not a repo root, and
// storeFor() is the only place that decides what that directory is. Given a
// workspace, every repo's store lives under the workspace, which leaves the
// analyzed repositories untouched: they become read-only inputs, and a repo
// that had to be cloned in order to be read needs nothing written back into it.
const dir = (store, ...p) => path.join(store, ...p);
// `name` is what this repository is called inside the workspace. It defaults to
// the directory name, which is right for repos sitting side by side — but two
// repos called `api` under different parents would land on one store and
// overwrite each other with no error anywhere. The responsibility set assigns
// the name when a repo joins it, resolving any clash once and visibly, and
// passes it here; the default is for a caller that has no set yet.
const storeFor = (repoPath, workspace, name = path.basename(repoPath)) => workspace
  ? path.join(workspace, ARCHIE_DIR, 'repos', name)
  : path.join(repoPath, ARCHIE_DIR);
function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function fail(errors) { if (errors.length) throw new Error('invalid: ' + errors.join('; ')); }
function checkLoc(loc, where, errors) {
  if (!loc || typeof loc.file !== 'string' || !loc.file || !(Number.isInteger(loc.line) && loc.line >= 1))
    errors.push(`${where}: evidence must be {file, line>=1}`);
}

function checkEntry(en, w, e) {
  if (!en.id) e.push(`${w}: id required`);
  if (!KINDS.includes(en.kind)) e.push(`${w}: kind invalid`);
  if (!en.label) e.push(`${w}: label required`);
  if (!Array.isArray(en.evidence) || en.evidence.length === 0) e.push(`${w}: evidence required`);
  else en.evidence.forEach((loc, j) => checkLoc(loc, `${w}.evidence[${j}]`, e));
  if (!COVERAGE.has(en.coverage)) e.push(`${w}: coverage invalid`);
  if (en.coverage !== 'none' && (!en.traced_at_sha || !Array.isArray(en.watch) || en.watch.length === 0))
    e.push(`${w}: traced/stale require traced_at_sha and watch[]`);
}

// Uniqueness is checked on the SLUG, not the id: two distinct ids that flatten
// to the same filename would silently overwrite each other's flows/<slug>.json
// and merge their trace state — one entry point would inherit another's evidence.
function checkEntryIds(entries, e) {
  const seen = new Map();
  for (const en of entries) {
    if (!en.id) continue;
    const s = slug(en.id);
    if (seen.has(s) && seen.get(s) !== en.id) e.push(`entries: "${en.id}" and "${seen.get(s)}" both map to flows/${s}.json`);
    else if (seen.has(s)) e.push(`entries: duplicate id "${en.id}"`);
    else seen.set(s, en.id);
  }
}

function validateModel(model) {
  const e = [];
  if (model?.version !== 1) e.push('version must be 1');
  // `|| []` was not enough: a non-array truthy entries (a string, an object)
  // survived it and then threw a raw TypeError from .entries(), which breaks the
  // "list every violation" contract on the file that enforces the honesty rule.
  // Same failure validateFlow had for answers[k] and tests[].
  const entries = Array.isArray(model?.entries) ? model.entries : [];
  if (!Array.isArray(model?.entries)) e.push('entries must be an array');
  for (const [i, en] of entries.entries()) checkEntry(en, `entries[${i}]`, e);
  checkEntryIds(entries, e);
  if (!Array.isArray(model?.unknowns)) e.push('unknowns must be an array');
  fail(e);
}

function checkClaim(c, where, e) {
  if (!c.text) e.push(`${where}: text required`);
  checkLoc(c.evidence, where, e);
  if (c.tests === undefined) return;
  if (!Array.isArray(c.tests)) e.push(`${where}.tests: must be an array`);
  else c.tests.forEach((t, j) => checkLoc(t, `${where}.tests[${j}]`, e));
}

function checkAnswers(flow, e) {
  const keys = Object.keys(flow?.answers || {}).sort(byCodePoint).join(',');
  if (keys !== [...ANSWER_KEYS].sort(byCodePoint).join(',')) {
    e.push(`answers must have exactly keys ${ANSWER_KEYS.join(',')}`);
    return;
  }
  for (const k of ANSWER_KEYS) {
    // The key-set check above proves the six names are present, not that they
    // hold arrays. A raw TypeError here would break the "throws listing every
    // violation" contract on the file that enforces the honesty invariant.
    if (!Array.isArray(flow.answers[k])) { e.push(`answers.${k}: must be an array`); continue; }
    flow.answers[k].forEach((c, i) => checkClaim(c, `answers.${k}[${i}]`, e));
  }
}

function checkFlowUnknowns(flow, e) {
  if (!Array.isArray(flow?.unknowns)) { e.push('unknowns must be an array'); return; }
  flow.unknowns.forEach((u, i) => {
    if (!u.text || !u.why) e.push(`unknowns[${i}]: text and why required`);
    // look_at is optional, but when present it is a citation like any other —
    // a malformed one must not reach the renderer as if it were evidence.
    if (u.look_at) checkLoc(u.look_at, `unknowns[${i}].look_at`, e);
  });
}

function validateFlow(flow) {
  const e = [];
  if (!flow?.id) e.push('id required');
  if (!flow?.summary) e.push('summary required');
  checkAnswers(flow, e);
  checkFlowUnknowns(flow, e);
  if (!flow?.traced_at_sha) e.push('traced_at_sha required');
  fail(e);
}

// The config decides where rendered files are written, so it is the one place a
// bad value turns into a write outside the repository. Validated like everything
// else rather than trusted because "the user typed it".
function checkOutput(output, e) {
  if (typeof output !== 'string' || !output) { e.push('output must be a non-empty string'); return; }
  if (path.isAbsolute(output) || path.normalize(output).split(path.sep)[0] === '..') {
    e.push('output must be a relative path inside the repository'); return;
  }
  // "." passes both checks above and then renders index.html straight over
  // whatever the repository keeps at its root. path.relative answers this
  // directly, with no regex to walk a trailing-separator run.
  if (path.relative('.', output) === '') e.push('output must be a subdirectory, not the repository root');
}

function checkScope(scope, e) {
  if (!scope || typeof scope !== 'object') { e.push('scope must be an object'); return; }
  if (!Array.isArray(scope.paths)) e.push('scope.paths must be an array');
  else if (scope.paths.some(p => typeof p !== 'string' || !p)) e.push('scope.paths must be non-empty strings');
  if (scope.label !== undefined && typeof scope.label !== 'string') e.push('scope.label must be a string');
}

// Every store path under a workspace is built from this value, so a relative one
// would resolve against whatever directory the command happened to be run from
// and scatter a repo's stores across as many places as it was invoked.
function checkWorkspace(w, e) {
  if (typeof w !== 'string' || !path.isAbsolute(w)) e.push('workspace must be an absolute path');
}

// Asked once, then compared against CODEOWNERS tokens, which carry the `@`. A
// handle stored without it matches nothing, and the failure is invisible: the
// user simply never appears to be named in any repository they own.
function checkHandle(h, e) {
  if (typeof h !== 'string' || !h.startsWith('@') || h === '@') e.push('handle must be a CODEOWNERS handle like @someone');
}

// The set is the one place Archie says "this is yours", so every entry carries
// the evidence that put it there, in the words the user was shown. An entry
// without a `why` is an assertion with nothing behind it — a set that accumulates
// those is the exact failure the rest of this file exists to prevent.
function checkRepos(repos, e) {
  if (!Array.isArray(repos)) { e.push('repos must be an array'); return; }
  const seen = new Set();
  repos.forEach((r, i) => {
    if (!r || typeof r !== 'object') { e.push(`repos[${i}]: must be an object`); return; }
    // A name is also a store directory: two entries sharing one would have the
    // second repository's inventory overwrite the first, with no error anywhere.
    if (typeof r.name !== 'string' || !r.name) e.push(`repos[${i}]: name required`);
    // The name IS a directory under the workspace store, so it is exactly the
    // kind of value checkOutput above refuses to take on trust. A name carrying
    // a separator or a `..` walks the store out of the workspace and into a
    // repository Archie was only ever asked to read — the one thing the whole
    // move exists to prevent. Caught here rather than at the path.join, because
    // this file is where bad values are supposed to stop.
    else if (r.name !== path.basename(r.name) || r.name === '.' || r.name === '..')
      e.push(`repos[${i}]: name must be a plain directory name, not a path`);
    else if (seen.has(r.name)) e.push(`repos[${i}]: duplicate name "${r.name}"`);
    else seen.add(r.name);
    if (typeof r.why !== 'string' || !r.why) e.push(`repos[${i}]: why required — the evidence that put this repo in the set`);
  });
}

// Names only, deliberately. This list exists so the same question is not asked
// twice and for nothing else: it records that this person said a repository is
// not theirs, never a claim about whose it is, so there is nothing here to
// justify and no `why` to carry.
function checkDeclined(declined, e) {
  if (!Array.isArray(declined)) { e.push('declined must be an array'); return; }
  if (declined.some(n => typeof n !== 'string' || !n)) e.push('declined must be non-empty strings');
}

function validateConfig(c) {
  const e = [];
  if (!c || typeof c !== 'object') e.push('config must be an object');
  if (c?.language !== undefined && typeof c.language !== 'string') e.push('language must be a string');
  if (c?.output !== undefined) checkOutput(c.output, e);
  if (c?.scope !== undefined) checkScope(c.scope, e);
  if (c?.workspace !== undefined) checkWorkspace(c.workspace, e);
  if (c?.handle !== undefined) checkHandle(c.handle, e);
  if (c?.repos !== undefined) checkRepos(c.repos, e);
  if (c?.declined !== undefined) checkDeclined(c.declined, e);
  // A name in both lists makes the two halves contradict each other: the set
  // says the repository is yours while the asking-log says you already said it
  // is not. Whichever is stale, only the user can say, so refuse to guess.
  if (Array.isArray(c?.repos) && Array.isArray(c?.declined)) {
    const declined = new Set(c.declined);
    for (const r of c.repos) if (r?.name && declined.has(r.name)) e.push(`repos: "${r.name}" is also in declined`);
  }
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

// Flows are written by Archie, but a half-written file, a bad merge, or a hand
// edit would otherwise reach the renderers as if it were proven evidence. Name
// the file that is wrong; do not skip it silently and do not fail somewhere
// downstream where the cause is invisible.
function readFlow(store, name) {
  const p = dir(store, 'flows', name);
  if (!fs.existsSync(p)) return null;
  let flow;
  try { flow = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { throw new Error(`${ARCHIE_DIR}/flows/${name} is not valid JSON: ${err.message}`); }
  try { validateFlow(flow); }
  catch (err) { throw new Error(`${ARCHIE_DIR}/flows/${name} is ${err.message}`); }
  return flow;
}

// Re-running the inventory must never cost you a trace. Workers only ever emit
// coverage:'none' with an empty watch[], so writing their output straight over
// model.json would silently erase every flow `explain` proved. Merge instead:
// discovery owns where the entry point IS, the existing model owns what we have
// LEARNED about it.
//
// An entry the sweep no longer finds is kept and reported, not dropped. It could
// be a deleted route — or a renamed one, or a recipe that just regressed. Which
// of those it is, only a human can say, so the honest move is to say so.
// watch[] is the whole of staleness: an entry with an empty one is never noticed
// going out of date, and its page rots while still claiming to be current. So it
// is derived from the flow rather than left to whoever writes the skill to
// remember — every file the page cites, from a claim, a test, or a look_at.
//
// This undercounts by design: a file the tracer opened and cited nothing from is
// not here. No claim depends on it, so a change there cannot falsify the page —
// but it could hide a NEW behavior the page ought to mention, and nothing will
// flag that. The honest direction to be wrong in, and stated so it is not
// mistaken for completeness.
// Split out from watchFromFlow because this walk — six answer keys, each a list
// of claims, each carrying its own evidence plus a list of tests — is where all
// the nesting lives. Next to a name, the unknowns walk below is one readable
// line instead of a fourth loop to hold in your head.
function claimFiles(answers) {
  const files = new Set();
  for (const key of ANSWER_KEYS)
    for (const c of answers?.[key] || []) {
      if (c.evidence?.file) files.add(c.evidence.file);
      for (const t of c.tests || []) if (t.file) files.add(t.file);
    }
  return files;
}

function watchFromFlow(flow) {
  const files = claimFiles(flow.answers);
  for (const u of flow.unknowns || []) if (u.look_at?.file) files.add(u.look_at.file);
  return [...files].sort(byCodePoint);
}

const MERGE_SOURCE = 'inventory-merge';

// Note what is NOT reset here: a `stale` entry stays stale on rediscovery.
// A route that vanished and came back was deleted and re-added, renamed
// twice, or moved; the old page describes code nobody re-checked, so it must
// go through explain's refresh rather than quietly reverting to `traced`.
// Discovery wins on location and label; the trace wins on everything it earned.
// handler is discovery's field outright, including when it goes away: a route
// that now dispatches to a closure has no handler, and keeping the old one
// would present a stale reading as current.
function mergeEntry(old, d) {
  const merged = { ...old, kind: d.kind, label: d.label, evidence: d.evidence };
  if (d.handler) merged.handler = d.handler; else delete merged.handler;
  return merged;
}

// Reported on stdout, a vanished entry point survives exactly as long as the
// console scrollback. Persist it as an unknown instead, so it reaches
// open-questions.md and the status count. Regenerated from scratch every run:
// no duplicates on a re-run, and it clears itself the moment the route is
// found again. Human-written unknowns are never touched.
function mergeUnknowns(existing, prev, disappeared) {
  const unknowns = (existing?.unknowns || []).filter(u => u.source !== MERGE_SOURCE);
  for (const id of disappeared) unknowns.push({
    text: `${prev.get(id).label} is in the inventory but the sweep no longer finds it.`,
    why: 'A deleted route, a renamed one, a recipe that stopped matching, and an area that a narrowed scope no longer sweeps all look identical from here — only a human can say which.',
    source: MERGE_SOURCE,
  });
  return unknowns;
}

function mergeModel(existing, discovered) {
  const prev = new Map((existing?.entries || []).map(e => [e.id, e]));
  const found = new Set(discovered.map(e => e.id));
  const added = [], kept = [];
  const entries = discovered.map(d => {
    const old = prev.get(d.id);
    if (!old) { added.push(d.id); return d; }
    kept.push(d.id);
    return mergeEntry(old, d);
  });
  const disappeared = [];
  for (const [id, old] of prev) if (!found.has(id)) {
    disappeared.push(id);
    // Keep the trace — nothing is destroyed — but stop counting it as documented.
    // The sweep can no longer find the entry point its page describes, so leaving
    // it `traced` would inflate the coverage number with a page about something
    // that may not exist. `stale` says exactly what is true: needs re-checking.
    entries.push(old.coverage === 'traced' ? { ...old, coverage: 'stale' } : old);
  }
  const unknowns = mergeUnknowns(existing, prev, disappeared);
  return { model: { version: 1, unknowns, entries }, added, kept, disappeared };
}

module.exports = {
  ARCHIE_DIR, KINDS, ANSWER_KEYS, validateModel, validateFlow, validateRecipe, validateConfig, mergeModel, watchFromFlow,
  storeFor,
  loadModel: (store) => readJson(dir(store, 'model.json')),
  saveModel: (store, m) => { validateModel(m); writeJson(dir(store, 'model.json'), m); },
  loadFlow: (store, id) => readFlow(store, slug(id) + '.json'),
  saveFlow: (store, f) => { validateFlow(f); writeJson(dir(store, 'flows', slug(f.id) + '.json'), f); },
  listFlows: (store) => fs.existsSync(dir(store, 'flows'))
    ? fs.readdirSync(dir(store, 'flows')).filter(n => n.endsWith('.json')).sort(byCodePoint).map(n => readFlow(store, n))
    : [],
  loadConfig: (store) => readJson(dir(store, 'config.json')),
  saveConfig: (store, c) => { validateConfig(c); writeJson(dir(store, 'config.json'), c); },
  // Where `wiki` renders to. `base` is what a relative config.output resolves
  // against — the repository today, the workspace once one is set. Defaults
  // inside the store so a first run writes nothing anyone has to clean up;
  // configurable because a map nobody browses is a map nobody reads.
  outputDir: (store, base) => {
    const out = readJson(dir(store, 'config.json'))?.output;
    return out ? path.join(base, out) : dir(store, 'wiki');
  },
  loadRecipe: (store) => readJson(dir(store, 'recipe.json')),
  saveRecipe: (store, r) => { validateRecipe(r); writeJson(dir(store, 'recipe.json'), r); },
};
