#!/usr/bin/env node
// What are you responsible for?
//
// On a big legacy repo, inventorying everything buries the part someone actually
// owns and spends the budget getting there. Scope narrows the sweep — at the
// sweep, not afterwards, or the tokens are already gone.
//
// Archie never picks a scope for you. It proposes candidates with the evidence
// behind each one and asks; a scope guessed silently would quietly decide what
// the map is allowed to contain.
const fs = require('node:fs');
const path = require('node:path');
const { tryRun, gitLines } = require('./lib/exec');
const { matchesWatch } = require('./staleness');
const { runMain } = require('./lib/cli');
const { byCodePoint } = require('./lib/order');

const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

// No scope means no filtering. "Everything" is the honest default for a tool
// whose job is to find what you did not know was there.
function inScope(file, scope) {
  const paths = scope?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return true;
  return paths.some(p => /[*?]/.test(p) ? matchesWatch(file, p) : file === p || file.startsWith(p.replace(/\/$/, '') + '/'));
}

function readCodeowners(root) {
  for (const rel of CODEOWNERS_PATHS) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return { rel, text: fs.readFileSync(p, 'utf8') };
  }
  return null;
}

// Split out so fromCodeowners stays one loop, and so the trimming is done with
// indexOf/split rather than regexes a scanner has to reason about backtracking in.
function parseOwnersLine(line, teams) {
  const hash = line.indexOf('#');
  const trimmed = (hash === -1 ? line : line.slice(0, hash)).trim();
  if (!trimmed) return null;
  const [pattern, ...owners] = trimmed.split(/\s+/);
  if (!owners.length) return null;
  // A catch-all owner says who to ask when nothing else matches. It is not
  // evidence that this is anybody's area in particular.
  if (pattern === '*' || pattern === '/*') return null;
  if (teams?.length && !owners.some(o => teams.includes(o))) return null;
  return { path: trimSlashes(pattern), owners };
}

const trimSlashes = (s) => {
  let a = 0, b = s.length;
  while (a < b && s[a] === '/') a++;
  while (b > a && s[b - 1] === '/') b--;
  return s.slice(a, b);
};

function fromCodeowners(root, teams) {
  const found = readCodeowners(root);
  if (!found) return [];
  const out = [];
  for (const line of found.text.split('\n')) {
    const entry = parseOwnersLine(line, teams);
    if (entry) out.push({ ...entry, source: 'codeowners', detail: `${found.rel} assigns it to ${entry.owners.join(' ')}` });
  }
  return out.map(({ owners, ...rest }) => rest);
}

// What you have actually touched beats what an ownership file says you own, in
// the cases where they disagree — but it is a weaker claim about intent, so it
// ranks second.
function fromGitHistory(root, email, sinceMonths = 12) {
  if (!email) return [];
  // core.quotePath=false for the same reason churn.js needs it: a quoted
  // "app/sipari\305\237.php" keeps its leading quote through dirname and
  // becomes a candidate called "app, mis-attributing the directory silently.
  const log = tryRun('git', ['-C', root, '-c', 'core.quotePath=false', 'log',
    `--since=${sinceMonths} months ago`, `--author=${email}`, '--format=%H', '--name-only']);
  if (!log) return [];
  return countByDirectory(log);
}

// The parse is its own function so the malformed-log guard below is reachable
// from a test: `git log --format=%H --name-only` always emits the SHA before any
// path, so a real log never arrives with sha unset — but a caller can hand this
// one that does, which is the whole reason the guard exists.
function countByDirectory(log) {
  const perDir = new Map();
  let sha = null, total = 0;
  const seenThisCommit = new Set();
  for (const line of log.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    // Exactly 40: --format=%H always emits a full SHA, and a looser pattern would
    // read a short lowercase-hex filename at the repository root as a commit.
    if (/^[0-9a-f]{40}$/.test(l)) { sha = l; total++; seenThisCommit.clear(); continue; }
    // A path before any SHA is malformed output. Dropping the guard would
    // attribute stray lines to whatever directory was seen last.
    if (!sha) continue;
    const dir = path.posix.dirname(l);
    if (dir === '.' || seenThisCommit.has(dir)) continue;
    seenThisCommit.add(dir);
    perDir.set(dir, (perDir.get(dir) || 0) + 1);
  }
  return [...perDir.entries()]
    // Most-touched first; ties broken by name. byCodePoint, not localeCompare:
    // two directories with equal commit counts must order the same way on every
    // machine, whatever ICU data it happens to carry.
    .sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]))
    .map(([dir, n]) => ({ path: dir, source: 'git-history', detail: `${n} of your ${total} commits touched it` }));
}

function fromTree(root) {
  const files = gitLines(root, ['ls-files']) || [];
  const tops = new Set();
  for (const f of files) {
    const top = f.split('/')[0];
    if (f.includes('/') && !top.startsWith('.')) tops.add(top);
  }
  return [...tops].sort(byCodePoint).map(p => ({ path: p, source: 'tree', detail: 'a top-level directory' }));
}

// Ordered by how strong the claim is. The tree is a last resort: it says nothing
// about ownership, only that a directory exists.
function deriveCandidates(root, { email, teams } = {}) {
  const owned = fromCodeowners(root, teams);
  const touched = fromGitHistory(root, email);
  if (owned.length || touched.length) {
    const seen = new Set(owned.map(o => o.path));
    return [...owned, ...touched.filter(t => !seen.has(t.path))];
  }
  return fromTree(root);
}

function main(args) {
  const root = args[0] || process.cwd();
  const email = args[1] || (tryRun('git', ['-C', root, 'config', 'user.email']) || '').trim();
  console.log(JSON.stringify(deriveCandidates(root, { email, teams: args.slice(2) }), null, 2));
  return 0;
}
runMain(module, main);
module.exports = { inScope, deriveCandidates, fromCodeowners, fromGitHistory, fromTree, countByDirectory, readCodeowners, main };
