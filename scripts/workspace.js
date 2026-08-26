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
function ownersIn(repoPath) {
  const found = readCodeowners(repoPath);
  if (!found) return { teams: [], individuals: 0 };
  const teams = new Set(), individuals = new Set();
  for (const line of found.text.split('\n')) {
    const hash = line.indexOf('#');
    const trimmed = (hash === -1 ? line : line.slice(0, hash)).trim();
    if (!trimmed) continue;
    for (const tok of trimmed.split(/\s+/).slice(1)) {
      if (!tok.startsWith('@')) continue;
      (TEAM.test(tok) ? teams : individuals).add(tok);
    }
  }
  return { teams: [...teams].sort(byCodePoint), individuals: individuals.size };
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

function gather(workspace) {
  const repos = findRepos(workspace);
  const identities = gitIdentities(workspace, repos);
  return {
    workspace,
    identities,
    repos: repos.map(name => {
      const repoPath = path.join(workspace, name);
      const { teams, individuals } = ownersIn(repoPath);
      return { name, teams, individualOwners: individuals,
        commits: commitsBy(repoPath, identities), description: describe(repoPath) };
    }),
  };
}

function main(args) {
  const workspace = args[0] || process.cwd();
  const out = gather(workspace);
  if (!out.repos.length) {
    console.error(`no git repositories directly under ${workspace} — is this the directory your checkouts live in?`);
    return 1;
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}
runMain(module, main);
module.exports = { findRepos, gitIdentities, ownersIn, commitsBy, describe, gather, main };
