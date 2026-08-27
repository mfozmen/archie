const path = require('node:path');
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
// The glob dialect a recipe is written in. It has to be ripgrep's, because a
// recipe is written once and then read by whichever of the two sweep paths is
// available — and a glob that means different things to them makes the inventory
// depend on whether ripgrep is installed, which is the one thing the sweep is
// built not to do. `{a,b}` cost a real run every entry point in a repository
// that keeps its code in two top-level directories: the fallback read the braces
// as literal characters, matched nothing, and the sweep reported the recipe as
// probably wrong.
function globToRegex(glob) {
  let re = '', depth = 0;
  for (let i = 0; i < glob.length;) {
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 3; }
    else if (glob.startsWith('**', i)) { re += '.*'; i += 2; }
    else if (glob[i] === '*') { re += '[^/]*'; i += 1; }
    else if (glob[i] === '?') { re += '[^/]'; i += 1; }
    else if (glob[i] === '{') { re += '(?:'; depth += 1; i += 1; }
    else if (glob[i] === '}' && depth) { re += ')'; depth -= 1; i += 1; }
    // A comma is only an alternation inside braces. Outside them it is a
    // character in a filename, and files are named like that.
    else if (glob[i] === ',' && depth) { re += '|'; i += 1; }
    else { re += glob[i].replace(/[.+?^${}()|[\]\\]/, String.raw`\$&`); i += 1; }
  }
  // An unclosed brace is a typo, and a regex built from it would either throw
  // here or quietly match the wrong thing. Say which glob, since the recipe that
  // holds it may have a dozen.
  if (depth) throw new Error(`glob has an unclosed { : ${glob}`);
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
  if (!model) { console.error(`no ${path.join(store, 'model.json')} — run /archie:inventory first`); return 1; }
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
