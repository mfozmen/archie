const { tryRun, gitLines } = require('./lib/exec');
const M = require('./lib/model');
const { runMain, paths } = require('./lib/cli');

// Returns null when `sha` is unreachable — squash-merge, rebase, `git gc` of an
// unreferenced commit, or a shallow clone all make a recorded traced_at_sha vanish.
// One rewritten history must degrade ONE entry, never crash the whole report.
function changedFilesSince(root, sha) {
  if (tryRun('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`]) === null) return null;
  return gitLines(root, ['diff', '--name-only', `${sha}..HEAD`]);
}
function globToRegex(glob) {
  const re = glob.split('**/').map(part =>
    part.split('**').map(p =>
      p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join('[^/]*')
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
function main(args) {
  const { repo, store } = paths(args);
  const model = M.loadModel(store);
  if (!model) { console.error('no .archie/model.json — run /archie:inventory first'); return 1; }
  const perEntry = new Map(model.entries.filter(e => e.coverage === 'traced')
    .map(e => [e.id, changedFilesSince(repo, e.traced_at_sha)]));
  const staled = [];
  for (const en of model.entries) {
    if (en.coverage === 'traced' && markStale({ entries: [en] }, perEntry.get(en.id)).length) staled.push(en.id);
  }
  M.saveModel(store, model);
  staled.forEach(id => console.log(`stale: ${id}`));
  if (!staled.length) console.log('nothing stale');
  return 0;
}
runMain(module, main);
module.exports = { changedFilesSince, matchesWatch, markStale, main };
