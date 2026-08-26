#!/usr/bin/env node
// What are you responsible for, across all of it?
//
// Nobody's responsibility is one repository, so the question Archie has to ask
// first is which repositories are yours. This script does not answer that. It
// gathers the evidence an answer can be built from and prints it, and the skill
// above it does the matching — because the matching is reading a sentence like
// "I'm on the payments team" against an owner token, which a regex is bad at and
// a model is good at.
//
// Everything here is deterministic and says where each fact came from. Nothing
// here decides anything.
const fs = require('node:fs');
const path = require('node:path');
const { tryRun } = require('./lib/exec');
const { readCodeowners } = require('./scope');
const { runMain } = require('./lib/cli');
const { byCodePoint } = require('./lib/order');
const { ownersLine } = require('./lib/codeowners');

// One level down only. A workspace is a directory of checkouts, not a tree to
// crawl: descending further finds vendored copies and nested test fixtures and
// calls them repositories someone is responsible for.
function findRepos(workspace) {
  let names;
  try { names = fs.readdirSync(workspace, { withFileTypes: true }); }
  catch { return []; }
  return names
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .filter(n => fs.existsSync(path.join(workspace, n, '.git')))
    .sort(byCodePoint);
}

// Every email this person commits under, not the one configured where we happen
// to be standing. Identities differ per checkout — work on one, open source on
// another — and asking a single repository for "your" email finds their commits
// in that repository and misses them everywhere else.
function gitIdentities(workspace, repos) {
  const emails = new Set();
  const global = (tryRun('git', ['config', '--global', 'user.email']) || '').trim();
  if (global) emails.add(global);
  for (const r of repos) {
    const e = (tryRun('git', ['-C', path.join(workspace, r), 'config', 'user.email']) || '').trim();
    if (e) emails.add(e);
  }
  return [...emails].sort(byCodePoint);
}

// The teams a CODEOWNERS names anywhere in the repo, deduplicated. Not which
// paths they own — at this level the question is only whether this repo is in a
// team's world at all.
//
// Teams only. A CODEOWNERS also names individuals, and on a real workspace those
// outnumbered teams roughly thirty to one, with a single repo listing fifty-one
// of them. They are not the signal — "which team am I on" is not answered by a
// list of colleagues — and they are other people's names, which is not something
// to copy into a prompt, a proposal or anything that might get pasted somewhere.
// The count still goes out, so the omission is visible rather than silent.
const TEAM = /^@[^/]+\/.+/;
function ownersIn(repoPath, handle) {
  const found = readCodeowners(repoPath);
  // The file it came from, because CODEOWNERS lives in one of three places and
  // "assigned to that team" becomes a claim the moment the skill shows it. A
  // claim in this project names where it was read; that rule does not start
  // applying only once the text reaches a page.
  if (!found) return { teams: [], individuals: 0, youAreNamed: null, codeownersFile: null };
  const teams = new Set(), individuals = new Set();
  let you = false;
  for (const line of found.text.split('\n')) {
    const parsed = ownersLine(line);
    if (!parsed) continue;
    // Unlike scope.js, a catch-all is kept: `* @org/payments` does not say which
    // directory is theirs, but it does say the repository is in their world,
    // which is the whole question at this level.
    for (const tok of parsed.owners) {
      if (!tok.startsWith('@')) continue;
      // The one individual worth naming is the person asking. Everybody else
      // stays a count — this is their own entry in a file, not a colleague's.
      if (handle && tok.toLowerCase() === handle.toLowerCase()) you = true;
      (TEAM.test(tok) ? teams : individuals).add(tok);
    }
  }
  // null, not false, when no handle was given: "we did not look" and "we looked
  // and you are not there" are different facts, and only one of them is evidence.
  return { teams: [...teams].sort(byCodePoint), individuals: individuals.size,
    youAreNamed: handle ? you : null, codeownersFile: found.rel };
}

// Commits by any of the person's identities, in a window. Counted, never used to
// include or exclude on its own: you can be responsible for a repository you have
// never committed to, so a zero here is not evidence of anything.
function commitsBy(repoPath, emails, sinceMonths = 12) {
  let total = 0;
  for (const e of emails) {
    const n = tryRun('git', ['-C', repoPath, 'rev-list', '--count',
      `--since=${sinceMonths} months ago`, `--author=${e}`, 'HEAD']);
    if (n) total += Number(n.trim()) || 0;
  }
  return total;
}

const HEADING = /^#{1,6}\s+/;
// The first line of a README that says something, for matching a description
// against words like "billing" or "notifications". Skips the title heading,
// which is usually just the repo name again, and any line opening with a link
// or a tag: badges, a docs link, a centred logo. A sentence describing what
// something does does not start with `[` or `<`.
function describe(repoPath) {
  for (const name of ['README.md', 'readme.md', 'README']) {
    const p = path.join(repoPath, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n', 40)) {
      const line = raw.trim();
      if (!line || HEADING.test(line) || line.startsWith('[') || line.startsWith('<')) continue;
      return line.length > 200 ? line.slice(0, 200) : line;
    }
    return null;
  }
  return null;
}

// `handle` is the person's own CODEOWNERS name, which nothing local can derive:
// the file names @handles and git knows emails. It is asked once and kept in the
// workspace config. Worth the question — on a real workspace only 15 of 45 repos
// named a team at all, while 20 named individuals and nothing else, so without it
// the strongest available signal for those twenty is simply not read.
function gather(workspace, { handle } = {}) {
  const repos = findRepos(workspace);
  const identities = gitIdentities(workspace, repos);
  return {
    workspace,
    identities,
    repos: repos.map(name => {
      const repoPath = path.join(workspace, name);
      const { teams, individuals, youAreNamed, codeownersFile } = ownersIn(repoPath, handle);
      return { name, teams, individualOwners: individuals, youAreNamed, codeownersFile,
        commits: commitsBy(repoPath, identities), description: describe(repoPath) };
    }),
  };
}

function main(args) {
  const workspace = args[0] || process.cwd();
  const out = gather(workspace, { handle: args[1] });
  if (!out.repos.length) {
    console.error(`no git repositories directly under ${workspace} — is this the directory your checkouts live in?`);
    return 1;
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}
runMain(module, main);
module.exports = { findRepos, gitIdentities, ownersIn, commitsBy, describe, gather, main };
