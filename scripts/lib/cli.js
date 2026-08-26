// Every script here is both a module and a command. Keeping the command body in
// an exported main(argv) -> exitCode keeps it reachable from a test in the same
// process, which is the only place coverage can see it: a CLI exercised through
// execFileSync runs in a child, and none of it is measured.
//
// main() returns a code rather than calling process.exit, so a test can run it
// without taking the test runner down with it.
function runMain(mod, main) {
  if (require.main !== mod) return;
  process.exitCode = main(process.argv.slice(2)) || 0;
}

// Where the code is and where Archie writes are two different questions, so a
// script needs both answers. `--store <dir>` carries the second one; without it
// the store falls back beside the repository, which is where it has always been
// and what a single-repository run still wants.
//
// A flag rather than a second positional: scope.js already takes an email and
// team names positionally, and an argument that silently shifted there would
// attribute somebody's commits to the wrong directory. Flags are also stripped
// from `rest`, so a script reading rest[1] cannot pick up a store path by
// accident.
function paths(args) {
  const rest = [];
  let store = null, workspace = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store') { store = args[++i]; continue; }
    if (args[i] === '--workspace') { workspace = args[++i]; continue; }
    rest.push(args[i]);
  }
  const repo = rest.find(a => !a.startsWith('--')) || process.cwd();
  // The workspace, when there is one, is also what a relative config.output
  // resolves against. Anchoring that to the repository instead would render a
  // wiki straight back into code Archie was only supposed to read — the failure
  // moving the store exists to prevent.
  return { repo, workspace, base: workspace || repo, store: store || require('./model').storeFor(repo, workspace), rest };
}

module.exports = { runMain, paths };
