const { execFileSync } = require('node:child_process');
// 64 MiB: `rg --json` over a large legacy repo blows past execFileSync's 1 MiB
// default. A truncated sweep must never be mistaken for "no hits".
const MAX_BUFFER = 64 * 1024 * 1024;
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts });
}
// Returns null ONLY for a clean non-zero exit — the command ran and said no.
// A spawn failure or buffer overflow is a BROKEN TOOL, not an empty result:
// swallowing it would report "0 hits" and blame the recipe for a bug in us.
function tryRun(cmd, args, opts = {}) {
  try { return run(cmd, args, opts); }
  catch (err) {
    if (typeof err.status === 'number') return null;
    throw new Error(`${cmd} failed to run (${err.code || err.message})`);
  }
}
// Taken as a defaulted parameter rather than read inline: both answers are real
// behavior, and one test run happens on one platform. A test can ask this
// directly instead of the alternative — reassigning process.platform, which
// proves nothing about what a Windows machine actually does.
function whichCommand(platform = process.platform) { return platform === 'win32' ? 'where' : 'which'; }
function hasBin(name) {
  try { run(whichCommand(), [name]); return true; }
  catch { return false; }
}
// git quotes any path outside ASCII by default — "routes/sipari\305\237.php" —
// so a plain line split yields a path that matches nothing and the file vanishes
// from the sweep with no error anywhere. -z turns off quoting AND newline
// splitting, which also covers the rarer path containing a newline.
function gitLines(root, args) {
  const out = tryRun('git', ['-C', root, ...args, '-z']);
  return out === null ? null : out.split('\0').filter(Boolean);
}
module.exports = { run, tryRun, hasBin, whichCommand, gitLines, MAX_BUFFER };
