const { tryRun } = require('./lib/exec');
const M = require('./lib/model');

// Returns null when `sha` is unreachable — squash-merge, rebase, `git gc` of an
// unreferenced commit, or a shallow clone all make a recorded traced_at_sha vanish.
// One rewritten history must degrade ONE entry, never crash the whole report.
function changedFilesSince(root, sha) {
  if (tryRun('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`]) === null) return null;
  const out = tryRun('git', ['-C', root, 'diff', '--name-only', `${sha}..HEAD`]);
  return out === null ? null : out.split('\n').filter(Boolean);
}
function globToRegex(glob) {
  const re = glob.split('**/').map(part =>
    part.split('**').map(p =>
      p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
    ).join('.*')
  ).join('(?:.*/)?');
  return new RegExp('^' + re + '$');
}
function matchesWatch(file, watchGlob) { return globToRegex(watchGlob).test(file); }
// `changed === null` means the traced SHA is gone, so we CANNOT prove the flow is
// still current. Spec honesty rule: unprovable is never treated as fine — mark it stale.
function markStale(model, changed) {
  const staled = [];
  for (const en of model.entries) {
    if (en.coverage !== 'traced') continue;
    if (changed === null || en.watch.some(g => changed.some(f => matchesWatch(f, g)))) {
      en.coverage = 'stale'; staled.push(en.id);
    }
  }
  return staled;
}
if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const model = M.loadModel(root);
  if (!model) { console.error('no .archie/model.json — run /archie:inventory first'); process.exit(1); }
  const perEntry = new Map(model.entries.filter(e => e.coverage === 'traced')
    .map(e => [e.id, changedFilesSince(root, e.traced_at_sha)]));
  const staled = [];
  for (const en of model.entries) {
    if (en.coverage === 'traced' && markStale({ entries: [en] }, perEntry.get(en.id)).length) staled.push(en.id);
  }
  M.saveModel(root, model);
  staled.forEach(id => console.log(`stale: ${id}`));
  if (!staled.length) console.log('nothing stale');
}
module.exports = { changedFilesSince, matchesWatch, markStale };
