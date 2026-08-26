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

function fromCodeowners(root, teams) {
  const found = readCodeowners(root);
  if (!found) return [];
  const out = [];
  for (const line of found.text.split('\n')) {
    const trimmed = line.replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (!owners.length) continue;
    // A catch-all owner says who to ask when nothing else matches. It is not
    // evidence that this is anybody's area in particular.
    if (pattern === '*' || pattern === '/*') continue;
    if (teams?.length && !owners.some(o => teams.includes(o))) continue;
    out.push({
      path: pattern.replace(/^\/+/, '').replace(/\/+$/, ''),
      source: 'codeowners',
      detail: `${found.rel} assigns it to ${owners.join(' ')}`,
    });
  }
  return out;
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
  const perDir = new Map();
  let sha = null, total = 0;
  const seenThisCommit = new Set();
  for (const line of log.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    if (/^[0-9a-f]{7,40}$/.test(l) && !l.includes('/')) { sha = l; total++; seenThisCommit.clear(); continue; }
    if (!sha) continue;
    const dir = path.posix.dirname(l);
    if (dir === '.' || seenThisCommit.has(dir)) continue;
    seenThisCommit.add(dir);
    perDir.set(dir, (perDir.get(dir) || 0) + 1);
  }
  return [...perDir.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir, n]) => ({ path: dir, source: 'git-history', detail: `${n} of your ${total} commits touched it` }));
}

function fromTree(root) {
  const files = gitLines(root, ['ls-files']) || [];
  const tops = new Set();
  for (const f of files) {
    const top = f.split('/')[0];
    if (f.includes('/') && !top.startsWith('.')) tops.add(top);
  }
  return [...tops].sort().map(p => ({ path: p, source: 'tree', detail: 'a top-level directory' }));
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

if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const email = process.argv[3] || (tryRun('git', ['-C', root, 'config', 'user.email']) || '').trim();
  const teams = process.argv.slice(4);
  console.log(JSON.stringify(deriveCandidates(root, { email, teams }), null, 2));
}
module.exports = { inScope, deriveCandidates, fromCodeowners, fromGitHistory, fromTree };
