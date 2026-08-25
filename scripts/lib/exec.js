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
function hasBin(name) {
  try { run(process.platform === 'win32' ? 'where' : 'which', [name]); return true; }
  catch { return false; }
}
module.exports = { run, tryRun, hasBin, MAX_BUFFER };
