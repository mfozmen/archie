const fs = require('node:fs');
const path = require('node:path');
const { runMain } = require('./lib/cli');
const EXTERNAL_IMAGES = /redis|postgres|mysql|mariadb|mongo|rabbitmq|kafka|elasticsearch|memcached|minio|localstack/;
const FRAMEWORK_DEPS = ['express', 'fastify', 'koa', 'next'];
// Manifests we can only prove exist — presence is the whole signal, no version.
const PRESENCE_MANIFESTS = [['pom.xml', 'jvm'], ['build.gradle', 'jvm'],
  ['requirements.txt', 'python'], ['pyproject.toml', 'python'], ['Gemfile', 'ruby']];
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const PROC_KINDS = [[/^(worker|queue)/, 'worker'], [/^(cron|scheduler|clock)/, 'cron']];

function readIf(root, rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function nodeHints(root) {
  const pkg = readIf(root, 'package.json');
  if (!pkg) return [];
  try {
    const j = JSON.parse(pkg);
    const hints = [{ file: 'package.json', name: 'node', version: j.engines?.node ?? null }];
    for (const d of FRAMEWORK_DEPS) if (j.dependencies?.[d] || j.devDependencies?.[d])
      hints.push({ file: 'package.json', name: d, version: j.dependencies?.[d] ?? j.devDependencies?.[d] });
    return hints;
  } catch { return []; /* unparseable manifest: skip, fingerprint stays honest */ }
}
function phpHints(root) {
  const composer = readIf(root, 'composer.json');
  if (!composer) return [];
  try {
    const j = JSON.parse(composer);
    const hints = [{ file: 'composer.json', name: 'php', version: j.require?.php ?? null }];
    for (const k of Object.keys(j.require || {}))
      if (k === 'laravel/framework' || k.startsWith('symfony/'))
        hints.push({ file: 'composer.json', name: k, version: j.require[k] });
    return hints;
  } catch { return []; /* unparseable manifest: skip, fingerprint stays honest */ }
}
function goHints(root) {
  const gomod = readIf(root, 'go.mod');
  if (!gomod) return [];
  return [{ file: 'go.mod', name: 'go', version: (gomod.match(/^go (.+)$/m) || [])[1] ?? null }];
}
function presenceHints(root) {
  return PRESENCE_MANIFESTS
    .filter(([file]) => readIf(root, file) !== null)
    .map(([file, name]) => ({ file, name, version: null }));
}
// The first compose file that actually declares services: wins. A candidate
// without a services: key is skipped, never allowed to suppress a valid one
// later in the list.
function composeUnits(root) {
  for (const source of COMPOSE_FILES) {
    const compose = readIf(root, source);
    if (!compose) continue;
    const lines = compose.split('\n');
    const svcIdx = lines.findIndex(l => /^services:\s*$/.test(l));
    if (svcIdx === -1) continue;
    return scanServices(lines.slice(svcIdx + 1), source);
  }
  return { processes: [], externals: [] };
}

// ponytail: 2-space-indent service scan, not a YAML parser — upgrade if real files break it
function scanServices(lines, source) {
  let processes = [];
  const externals = [];
  let current = null;
  for (const l of lines) {
    if (/^\S/.test(l)) break;          // a top-level key ends the services block
    const svc = l.match(/^ {2}(\w[\w-]*):\s*$/);
    if (svc) { current = svc[1]; processes.push({ name: svc[1], kind: 'unknown', source }); continue; }
    const img = l.match(/^\s+image:\s*(\S+)/);
    const ext = img && current && img[1].match(EXTERNAL_IMAGES);
    if (!ext) continue;
    // A known backing service is not a process of ours: it is an external.
    processes = processes.filter(p => p.name !== current);
    externals.push({ name: ext[0], source });
  }
  return { processes, externals };
}

// A plain loop, not find()?.[1] ?? — every path returns a string, and it is
// obvious that it does.
function procKind(name) {
  if (name === 'web') return 'web';
  for (const [re, kind] of PROC_KINDS) if (re.test(name)) return kind;
  return 'unknown';
}
function procfileProcesses(root) {
  const proc = readIf(root, 'Procfile');
  if (!proc) return [];
  const processes = [];
  for (const l of proc.split('\n')) {
    const m = l.match(/^(\w[\w-]*):.+$/);
    if (m) processes.push({ name: m[1], kind: procKind(m[1]), source: 'Procfile' });
  }
  return processes;
}
function fingerprint(root) {
  const compose = composeUnits(root);
  return {
    stackHints: [...nodeHints(root), ...phpHints(root), ...goHints(root), ...presenceHints(root)],
    processes: [...compose.processes, ...procfileProcesses(root)],
    externals: compose.externals,
  };
}
function main(args) {
  console.log(JSON.stringify(fingerprint(args[0] || process.cwd()), null, 2));
  return 0;
}
runMain(module, main);
module.exports = { fingerprint, main };
