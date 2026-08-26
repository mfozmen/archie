const fs = require('node:fs');
const path = require('node:path');
const { runMain } = require('./lib/cli');
const EXTERNAL_IMAGES = /redis|postgres|mysql|mariadb|mongo|rabbitmq|kafka|elasticsearch|memcached|minio|localstack/;
const FRAMEWORK_DEPS = ['express', 'fastify', 'koa', 'next'];

function readIf(root, rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function fingerprint(root) {
  const out = { stackHints: [], processes: [], externals: [] };
  const pkg = readIf(root, 'package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      out.stackHints.push({ file: 'package.json', name: 'node', version: j.engines?.node ?? null });
      for (const d of FRAMEWORK_DEPS) if (j.dependencies?.[d] || j.devDependencies?.[d])
        out.stackHints.push({ file: 'package.json', name: d, version: j.dependencies?.[d] ?? j.devDependencies?.[d] });
    } catch { /* unparseable manifest: skip, fingerprint stays honest */ }
  }
  const composer = readIf(root, 'composer.json');
  if (composer) {
    try {
      const j = JSON.parse(composer);
      out.stackHints.push({ file: 'composer.json', name: 'php', version: j.require?.php ?? null });
      for (const k of Object.keys(j.require || {}))
        if (k === 'laravel/framework' || k.startsWith('symfony/'))
          out.stackHints.push({ file: 'composer.json', name: k, version: j.require[k] });
    } catch { /* unparseable manifest: skip, fingerprint stays honest */ }
  }
  const gomod = readIf(root, 'go.mod');
  if (gomod) out.stackHints.push({ file: 'go.mod', name: 'go', version: (gomod.match(/^go (.+)$/m) || [])[1] ?? null });
  for (const [file, name] of [['pom.xml', 'jvm'], ['build.gradle', 'jvm'], ['requirements.txt', 'python'], ['pyproject.toml', 'python'], ['Gemfile', 'ruby']])
    if (readIf(root, file) !== null) out.stackHints.push({ file, name, version: null });

  for (const composeName of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const compose = readIf(root, composeName);
    if (!compose) continue;
    // ponytail: 2-space-indent service scan, not a YAML parser — upgrade if real files break it
    const lines = compose.split('\n');
    const svcIdx = lines.findIndex(l => /^services:\s*$/.test(l));
    // continue, not break: a first candidate without a services: key must not
    // suppress a valid compose file later in the list.
    if (svcIdx === -1) continue;
    let current = null;
    for (const l of lines.slice(svcIdx + 1)) {
      if (/^\S/.test(l)) break;
      const svc = l.match(/^  (\w[\w-]*):\s*$/);
      if (svc) { current = { name: svc[1] }; out.processes.push({ name: svc[1], kind: 'unknown', source: composeName }); continue; }
      const img = l.match(/^\s+image:\s*(\S+)/);
      if (img && current && EXTERNAL_IMAGES.test(img[1])) {
        out.processes = out.processes.filter(p => p.name !== current.name);
        out.externals.push({ name: (img[1].match(EXTERNAL_IMAGES) || [])[0], source: composeName });
      }
    }
    break;
  }
  const proc = readIf(root, 'Procfile');
  if (proc) for (const l of proc.split('\n')) {
    const m = l.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!m) continue;
    const kind = m[1] === 'web' ? 'web' : /^(worker|queue)/.test(m[1]) ? 'worker' : /^(cron|scheduler|clock)/.test(m[1]) ? 'cron' : 'unknown';
    out.processes.push({ name: m[1], kind, source: 'Procfile' });
  }
  return out;
}
function main(args) {
  console.log(JSON.stringify(fingerprint(args[0] || process.cwd()), null, 2));
  return 0;
}
runMain(module, main);
module.exports = { fingerprint, main };
