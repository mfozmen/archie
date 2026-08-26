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
module.exports = { runMain };
