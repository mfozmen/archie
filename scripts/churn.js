const { run } = require('./lib/exec');
const M = require('./lib/model');

function fileChurn(root, files, sinceMonths = 6) {
  const want = new Set(files);
  const churn = new Map(files.map(f => [f, 0]));
  // %H, not a literal marker: git rejects a --format that is neither a known
  // name nor contains a placeholder. A SHA line can never collide with a path.
  const log = run('git', ['-C', root, 'log', `--since=${sinceMonths} months ago`, '--name-only', '--format=%H']);
  for (const line of log.split('\n')) {
    const f = line.trim();
    if (want.has(f)) churn.set(f, churn.get(f) + 1);
  }
  return churn;
}
function rankEntries(model, churnMap, n = 5) {
  return model.entries.map(en => {
    const files = [...en.evidence.map(e => e.file), ...en.watch.filter(w => !w.includes('*'))];
    const commits = Math.max(0, ...files.map(f => churnMap.get(f) ?? 0));
    return { id: en.id, label: en.label, commits, evidence: en.evidence[0] };
  }).sort((a, b) => b.commits - a.commits).slice(0, n);
}
if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const model = M.loadModel(root);
  if (!model) { console.error('no model — run /archie:inventory'); process.exit(1); }
  // Both halves of what rankEntries scores: evidence locations AND the literal
  // (non-glob) watch paths a traced entry carries, or watch files score 0.
  const files = [...new Set(model.entries.flatMap(e =>
    [...e.evidence.map(v => v.file), ...e.watch.filter(w => !w.includes('*'))]))];
  const top = rankEntries(model, fileChurn(root, files));
  top.forEach((t, i) => console.log(`${i + 1}. ${t.label}  · ${t.commits} commits · ${t.evidence.file}:${t.evidence.line}`));
}
module.exports = { fileChurn, rankEntries };
