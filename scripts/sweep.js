const fs = require('node:fs');
const path = require('node:path');
const { run, hasBin } = require('./lib/exec');
const { matchesWatch } = require('./staleness');
const M = require('./lib/model');

const isComment = (text) => /^\s*(\/\/|#|\*|;|--)/.test(text);

function trackedFiles(root) {
  return run('git', ['-C', root, 'ls-files']).split('\n').filter(Boolean)
    .filter(f => !f.startsWith(M.ARCHIE_DIR + '/'));
}
function grepProbe(root, probe, files) {
  const hits = [];
  const re = new RegExp(probe.pattern);
  for (const f of files.filter(f => matchesWatch(f, probe.glob))) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
    lines.forEach((text, i) => { if (re.test(text) && !isComment(text)) hits.push({ kind: probe.kind, file: f, line: i + 1, text: text.trim() }); });
  }
  return hits;
}
// Same file list as grepProbe — never let rg walk the tree itself, or the result
// depends on whether ripgrep is installed. --no-ignore --hidden disable rg's own
// filtering; `git ls-files` already decided what counts.
// rg exit 1 means "no match" — a real, honest zero. ANY other non-zero (2 = bad
// regex, argv too long, rg crash) is a broken tool, and reporting it as 0 hits
// would slander the recipe: the CLI would print "recipe may be wrong" when the
// recipe was fine. Same rule as staleness: unprovable is never "fine".
function rgProbe(root, probe, files) {
  let out;
  try {
    // --sort path costs rg its parallelism and buys determinism: git ls-files is
    // already path-sorted, so both sweep paths now emit hits in the same order.
    out = run('rg', ['--json', '--sort', 'path', '--no-ignore', '--hidden', '-g', probe.glob,
      '-e', probe.pattern, '--', ...files], { cwd: root });
  } catch (err) {
    if (err.status === 1) return [];               // genuinely no matches
    throw new Error(`ripgrep failed on the ${probe.kind} probe (exit ${err.status ?? err.code}): ${probe.pattern}`);
  }
  return out.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(j => j.type === 'match')
    .map(j => ({ kind: probe.kind, file: j.data.path.text, line: j.data.line_number, text: j.data.lines.text.trim() }))
    .filter(h => !isComment(h.text));
}
function sweep(root, recipe, opts = {}) {
  M.validateRecipe(recipe);
  const useRg = opts.forceGrep === undefined ? hasBin('rg') : !opts.forceGrep;
  const files = trackedFiles(root);   // ONE list for both paths
  const hits = [], counts = [], zeroProbes = [];
  for (const probe of recipe.probes) {
    const h = useRg ? rgProbe(root, probe, files) : grepProbe(root, probe, files);
    hits.push(...h);
    counts.push({ ...probe, hits: h.length });
    if (h.length === 0) zeroProbes.push(probe);
  }
  return { hits, counts, zeroProbes };
}
if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const recipe = M.loadRecipe(root);
  if (!recipe) { console.error('no .archie/recipe.json — derive one first'); process.exit(1); }
  const res = sweep(root, recipe);
  fs.mkdirSync(path.join(root, M.ARCHIE_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, M.ARCHIE_DIR, 'sweep.json'), JSON.stringify(res.hits, null, 2) + '\n');
  for (const c of res.counts) console.log(`${c.kind.padEnd(10)} ${String(c.hits).padStart(5)}  ${c.glob} =~ ${c.pattern}`);
  for (const z of res.zeroProbes) console.log(`⚠ 0 hits for ${z.kind} probe — recipe may be wrong; fix with /archie:recipe`);
  console.log(`${res.hits.length} candidate hits → .archie/sweep.json`);
}
module.exports = { sweep };
