const M = require('./lib/model');
const { changedFilesSince, markStale } = require('./staleness');

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
  return { total, traced, stale: staleIds.length, pct: total ? Math.round(100 * traced / total) : 0, staleIds, unknowns };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--')) || process.cwd();
  const r = statusReport(root);
  console.log(`${r.total} entry points · ${r.traced} documented (${r.pct}%) · ${r.stale} stale`);
  r.staleIds.forEach(id => console.log(`  stale: ${id}  → refresh with /archie:explain "${id}"`));
  console.log(`${r.unknowns.length} open questions${r.unknowns.length ? ' → --unknowns to list' : ''}`);
  if (args.includes('--unknowns')) r.unknowns.forEach(u => console.log(`  [${u.source}] ${u.text}`));
}
module.exports = { statusReport };
