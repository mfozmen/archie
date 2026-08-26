const M = require('./lib/model');
const { changedFilesSince, markStale } = require('./staleness');
const { sweep } = require('./sweep');
const DRIFT_PRINT_LIMIT = 10;

// Flow staleness catches code moving under a page that was traced. It cannot
// catch a whole entry point being ADDED, because nothing watches a file the
// model has never heard of — and re-running the inventory is something you have
// to remember, which means it does not happen.
//
// So re-run the sweep (ripgrep, no tokens) and ask a deliberately narrow
// question: is there a file producing hits of some kind that NO entry of that
// kind cites at all? Per file, never per line — line numbers shift on every
// edit, and crying "new entry point" whenever someone adds an import would make
// the signal worthless. This undercounts on purpose: a new route added to an
// already-known file will not show up. Undercounting is the honest failure.
function inventoryDrift(root, model) {
  const recipe = M.loadRecipe(root);
  if (!recipe) return null;                       // no recipe, no claim to make
  let hits;
  // Scoped, or every run would report the whole rest of the repository as drift,
  // forever, for an inventory that was never meant to cover it.
  try { hits = sweep(root, recipe, { scope: M.loadConfig(root)?.scope }).hits; }
  catch (err) { return { error: err.message, unrepresented: [] }; }
  const citedByKind = new Map();
  for (const en of model.entries) {
    if (!citedByKind.has(en.kind)) citedByKind.set(en.kind, new Set());
    for (const ev of en.evidence) citedByKind.get(en.kind).add(ev.file);
  }
  const seen = new Set(), unrepresented = [];
  for (const h of hits) {
    const key = `${h.kind}\u0000${h.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!citedByKind.get(h.kind)?.has(h.file)) unrepresented.push({ kind: h.kind, file: h.file });
  }
  return { unrepresented };
}

function statusReport(root) {
  const model = M.loadModel(root);
  if (!model) throw new Error('no .archie/model.json — run /archie:inventory first');
  for (const en of model.entries)
    if (en.coverage === 'traced') markStale({ entries: [en] }, changedFilesSince(root, en.traced_at_sha));
  M.saveModel(root, model);
  const total = model.entries.length;
  const traced = model.entries.filter(e => e.coverage === 'traced').length;
  const staleIds = model.entries.filter(e => e.coverage === 'stale').map(e => e.id);
  const unknowns = [
    ...model.unknowns.map(u => ({ source: 'inventory', text: u.text })),
    ...M.listFlows(root).flatMap(f => f.unknowns.map(u => ({ source: f.id, text: u.text }))),
  ];
  return { total, traced, stale: staleIds.length, pct: total ? Math.round(100 * traced / total) : 0,
    staleIds, unknowns, inventoryDrift: inventoryDrift(root, model) };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--')) || process.cwd();
  let r;
  // No model is the normal state before the first inventory, not a crash worth a
  // stack trace at someone trying the tool for the first time.
  try { r = statusReport(root); }
  catch (err) { console.error(err.message); process.exit(1); }
  console.log(`${r.total} entry points · ${r.traced} documented (${r.pct}%) · ${r.stale} stale`);
  r.staleIds.forEach(id => console.log(`  stale: ${id}  → refresh with /archie:explain "${id}"`));
  console.log(`${r.unknowns.length} open questions${r.unknowns.length ? ' → --unknowns to list' : ''}`);
  const d = r.inventoryDrift;
  if (d?.error) console.log(`inventory drift not checked: ${d.error}`);
  else if (d?.unrepresented.length) {
    console.log(`${d.unrepresented.length} file(s) produce entry-point hits that the inventory does not cite:`);
    // Capped so a barely-started inventory on a large repo cannot bury the rest
    // of the report. The count above is the real one, and the elision is stated
    // outright — a truncated list that looks complete is worse than no list.
    d.unrepresented.slice(0, DRIFT_PRINT_LIMIT).forEach(u => console.log(`  ${u.kind}: ${u.file}`));
    const rest = d.unrepresented.length - DRIFT_PRINT_LIMIT;
    if (rest > 0) console.log(`  … ${rest} more not shown`);
    console.log('  → re-run /archie:inventory (it merges; your traced flows survive)');
  }
  if (args.includes('--unknowns')) r.unknowns.forEach(u => console.log(`  [${u.source}] ${u.text}`));
}
module.exports = { statusReport };
