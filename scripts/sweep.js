const fs = require('node:fs');
const path = require('node:path');
const { run, hasBin, gitLines } = require('./lib/exec');
const { matchesWatch } = require('./staleness');
const { inScope } = require('./scope');
const { runMain, paths } = require('./lib/cli');
const M = require('./lib/model');

const isComment = (text) => /^\s*(\/\/|#|\*|;|--)/.test(text);

// A repo with tens of thousands of tracked files blows past the OS argv limit
// (E2BIG) when the whole list is spread into rg's arguments. Chunk instead —
// deliberately NOT by letting rg walk the tree, which would make the result
// depend on whether ripgrep is installed. 100 KB is well under every platform's
// ARG_MAX and leaves room for the environment, which counts toward the same cap.
const MAX_ARGV_BYTES = 100 * 1024;
function chunkFiles(files, budget = MAX_ARGV_BYTES) {
  const chunks = [];
  let current = [], bytes = 0;
  for (const f of files) {
    const size = Buffer.byteLength(f) + 1;               // + the argv separator
    if (current.length && bytes + size > budget) { chunks.push(current); current = []; bytes = 0; }
    current.push(f); bytes += size;                      // a single oversized path still gets its own chunk
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function trackedFiles(root) {
  const files = gitLines(root, ['ls-files']);
  if (files === null) throw new Error(`git ls-files failed in ${root} — not a repository?`);
  return files.filter(f => !f.startsWith(M.ARCHIE_DIR + '/'));
}
function grepProbe(root, probe, files) {
  const hits = [];
  const re = new RegExp(probe.pattern);
  for (const f of files) {
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
function rgProbe(root, probe, files, maxArgvBytes) {
  const hits = [];
  // Chunks are path-ordered and --sort path orders within a chunk, so the
  // concatenation is the same sequence an unchunked run would produce.
  for (const chunk of chunkFiles(files, maxArgvBytes)) {
    let out;
    try {
      // --sort path costs rg its parallelism and buys determinism: git ls-files is
      // already path-sorted, so both sweep paths now emit hits in the same order.
      // No -g: ripgrep does not apply a glob filter to files named explicitly on
      // the command line, and every file here is named explicitly. Passing one
      // read as if the probe were scoped while rg searched everything given to
      // it — the whole repository, through a probe that said one directory. The
      // list is filtered before it gets here, by the same matcher the built-in
      // scan uses, so both paths answer to one glob dialect and neither delegates
      // the question to a tool that may not be installed.
      out = run('rg', ['--json', '--sort', 'path', '--no-ignore', '--hidden',
        '-e', probe.pattern, '--', ...chunk], { cwd: root });
    } catch (err) {
      if (err.status === 1) continue;              // this chunk genuinely has no matches
      throw new Error(`ripgrep failed on the ${probe.kind} probe (exit ${err.status ?? err.code}): ${probe.pattern}`);
    }
    hits.push(...out.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(j => j.type === 'match')
      .map(j => ({ kind: probe.kind, file: j.data.path.text, line: j.data.line_number, text: j.data.lines.text.trim() }))
      .filter(h => !isComment(h.text)));
  }
  return hits;
}
function sweep(root, recipe, opts = {}) {
  M.validateRecipe(recipe);
  const useRg = opts.forceGrep === undefined ? hasBin('rg') : !opts.forceGrep;
  // Filtered HERE, before any probe runs — narrowing afterwards would have spent
  // the work already. One list for both paths, so rg and grep still agree.
  const all = trackedFiles(root);
  const files = opts.scope ? all.filter(f => inScope(f, opts.scope)) : all;
  const hits = [], counts = [], zeroProbes = [];
  for (const probe of recipe.probes) {
    // Filtered here rather than inside either probe, so there is exactly one
    // answer to "which files does this glob mean" no matter which path runs.
    const matched = files.filter(f => matchesWatch(f, probe.glob));
    const h = matched.length === 0 ? []
      : useRg ? rgProbe(root, probe, matched, opts.maxArgvBytes) : grepProbe(root, probe, matched);
    hits.push(...h);
    counts.push({ ...probe, hits: h.length, files: matched.length });
    // A zero is three different facts and the sweep knows which one it holds.
    // Reported as one, it sent a real run to rewrite a recipe that was correct.
    if (h.length === 0) zeroProbes.push({ ...probe, files: matched.length });
  }
  // Configured, not "it happened to exclude something". A scope that excludes
  // nothing today is still the reason a zero means "not in your area".
  return { hits, counts, zeroProbes, scoped: Boolean(opts.scope?.paths?.length) };
}
function main(args) {
  const { repo, store } = paths(args);
  const recipe = M.loadRecipe(store);
  if (!recipe) { console.error(`no ${path.join(store, 'recipe.json')} — derive one first`); return 1; }
  const res = sweep(repo, recipe, { scope: M.loadConfig(store)?.scope });
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'sweep.json'), JSON.stringify(res.hits, null, 2) + '\n');
  for (const c of res.counts) console.log(`${c.kind.padEnd(10)} ${String(c.hits).padStart(5)}  ${c.glob} =~ ${c.pattern}`);
  // Which half of the probe found nothing is a fact, not a guess, and the two
  // halves send someone to different places. A glob that matched no file is not
  // evidence about the pattern at all — saying "the recipe may be wrong" there
  // is a claim past what was measured, and it cost a real run an afternoon.
  // Under a scope there is a third reading, and it is the likeliest one.
  for (const z of res.zeroProbes) console.log(
    z.files === 0
      ? `⚠ 0 files match the ${z.kind} glob ${z.glob}${res.scoped ? ' within the configured scope' : ''}`
        + ' — the pattern was never tried; '
        // A scope is a reason for a glob to match nothing that has nothing to do
        // with the glob. Telling someone to fix one that is fine is the same
        // misdirection as blaming the pattern, one level up.
        + (res.scoped ? 'either the scope excludes that area, or the glob is wrong'
          : 'fix the glob with /archie:recipe')
      : res.scoped
        ? `⚠ 0 hits for ${z.kind} in the ${z.files} file(s) its glob matches within the configured scope`
          + ' — either it does not exist in your area, or the pattern is wrong'
        : `⚠ 0 hits for ${z.kind} in the ${z.files} file(s) its glob matches`
          + ' — the pattern may be wrong; fix it with /archie:recipe');
  console.log(`${res.hits.length} candidate hits → ${path.join(store, 'sweep.json')}`);
  return 0;
}
runMain(module, main);
module.exports = { sweep, chunkFiles, MAX_ARGV_BYTES, main };
