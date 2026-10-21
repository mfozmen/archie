const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const SURFACES = ['inventory', 'explain', 'wiki', 'status', 'recipe', 'config'];
const AGENTS = ['inventory-worker', 'tracer', 'verifier'];

async function load() {
  return import(pathToFileURL(path.join(root, 'opencode', 'plugin.js')).href);
}

function frontmatter(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const body = source.slice(match[0].length);
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].trim();
  }
  return { data, body };
}

test('opencode plugin exposes exactly one plugin entry point', async () => {
  const mod = await load();
  // The loader treats every exported function as a plugin; exporting the same
  // function under two names would register it twice.
  assert.deepStrictEqual(Object.keys(mod), ['ArchiePlugin']);
  assert.strictEqual(typeof mod.ArchiePlugin, 'function');
});

test('opencode plugin registers the six /archie commands from the skills', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const cfg = {};
  await hooks.config(cfg);

  for (const name of SURFACES) {
    const cmd = cfg.command[`archie:${name}`];
    const skill = frontmatter(path.join(root, 'skills', name, 'SKILL.md'));
    assert.ok(cmd, `/archie:${name} is missing`);
    assert.strictEqual(cmd.description, skill.data.description);
    assert.ok(cmd.template.endsWith(skill.body), `${name}: the skill body must be preserved verbatim`);
    assert.match(cmd.template, /\$ARGUMENTS/, `${name}: opencode must pass the user's arguments`);
    assert.match(cmd.template, /`task` tool/, `${name}: subagent dispatch must be explained`);
    assert.ok(!cmd.template.startsWith('---'), `${name}: frontmatter leaked into the template`);
  }
});

test('opencode plugin registers the three read-only subagents', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const cfg = {};
  await hooks.config(cfg);

  for (const name of AGENTS) {
    const spec = frontmatter(path.join(root, 'agents', `${name}.md`));
    const agent = cfg.agent[name];
    assert.ok(agent, `${name} is missing`);
    assert.strictEqual(agent.description, spec.data.description);
    assert.strictEqual(agent.prompt, spec.body);
    assert.strictEqual(agent.mode, 'subagent');
    // The verifier's guarantee rests on holding no writing tool. Deny
    // everything, then allow only what Read/Grep/Glob/List can do.
    assert.strictEqual(agent.permission['*'], 'deny');
    assert.deepStrictEqual(agent.permission.read, {
      '*': 'allow',
      '*.env': 'ask',
      '*.env.*': 'ask',
      '*.env.example': 'allow',
    });
    for (const tool of ['grep', 'glob', 'list'])
      assert.strictEqual(agent.permission[tool], 'allow', `${name}: ${tool} must be allowed`);
    for (const tool of ['bash', 'edit', 'write', 'task', 'webfetch', 'websearch'])
      assert.notStrictEqual(agent.permission[tool], 'allow', `${name}: ${tool} must not be allowed`);
  }
});

test('opencode plugin lets the user override a command or agent', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const cfg = {
    command: { 'archie:explain': { description: 'mine' } },
    agent: { tracer: { description: 'my tracer', mode: 'subagent', prompt: 'MY PROMPT' } },
  };
  await hooks.config(cfg);

  assert.strictEqual(cfg.command['archie:explain'].description, 'mine');
  assert.ok(cfg.command['archie:explain'].template.length > 200, 'a partial command override keeps its template');
  assert.ok(cfg.command['archie:inventory'].template.length > 200, 'other commands still registered');
  assert.strictEqual(cfg.agent.tracer.prompt, 'MY PROMPT');
  assert.strictEqual(cfg.agent.tracer.permission['*'], 'deny', 'an agent override cannot drop the read-only baseline');
  assert.ok(cfg.agent.verifier.prompt.length > 200, 'other agents still registered');
});

test('a partial agent override keeps the read-only definition', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const cfg = { agent: { tracer: { model: 'anthropic/claude-sonnet-4-5' } } };
  await hooks.config(cfg);

  const spec = frontmatter(path.join(root, 'agents', 'tracer.md'));
  assert.strictEqual(cfg.agent.tracer.model, 'anthropic/claude-sonnet-4-5');
  assert.strictEqual(cfg.agent.tracer.mode, 'subagent');
  assert.strictEqual(cfg.agent.tracer.prompt, spec.body);
  assert.strictEqual(cfg.agent.tracer.permission['*'], 'deny');
  assert.strictEqual(cfg.agent.tracer.permission.read['*.env'], 'ask');
});

test('a partial permission override keeps the deny-all baseline and the .env rules', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const cfg = { agent: { verifier: { permission: { read: { 'src/**': 'allow' } } } } };
  await hooks.config(cfg);

  assert.strictEqual(cfg.agent.verifier.permission['*'], 'deny');
  assert.strictEqual(cfg.agent.verifier.permission.read['*'], 'allow');
  assert.strictEqual(cfg.agent.verifier.permission.read['src/**'], 'allow');
  assert.strictEqual(cfg.agent.verifier.permission.read['*.env'], 'ask');
  assert.strictEqual(cfg.agent.verifier.permission.grep, 'allow');
});

test('a user-defined agent is added without touching the Archie agents', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const mine = { description: 'mine', mode: 'subagent', prompt: 'MINE' };
  const cfg = { agent: { mine } };
  await hooks.config(cfg);

  assert.strictEqual(cfg.agent.mine.prompt, 'MINE');
  assert.strictEqual(cfg.agent['inventory-worker'].permission['*'], 'deny');
});

test('opencode plugin adds the skills directory without dropping existing settings', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const skillsRoot = path.join(root, 'skills');

  const object = { skills: { urls: ['https://example.test/skills'] } };
  await hooks.config(object);
  assert.deepStrictEqual(object.skills.urls, ['https://example.test/skills']);
  assert.deepStrictEqual(object.skills.paths, [skillsRoot]);

  const array = { skills: [skillsRoot] };
  await hooks.config(array);
  assert.deepStrictEqual(array.skills, [skillsRoot]);

  const empty = {};
  await hooks.config(empty);
  assert.deepStrictEqual(empty.skills.paths, [skillsRoot]);
});

test('opencode plugin tells every shell where the plugin lives', async () => {
  const { ArchiePlugin } = await load();
  const hooks = await ArchiePlugin({});
  const output = { env: {} };
  await hooks['shell.env']({ cwd: root }, output);

  const expected = root.replace(/\\/g, '/');
  assert.strictEqual(output.env.CLAUDE_PLUGIN_ROOT, expected);
  assert.strictEqual(output.env.ARCHIE_PLUGIN_ROOT, expected);
  assert.ok(!output.env.CLAUDE_PLUGIN_ROOT.includes('\\'), 'paths in shell must survive node -p');
});

test('the local opencode adapter and package entry point resolve to the plugin', () => {
  const adapter = fs.readFileSync(path.join(root, '.opencode', 'plugin', 'archie.ts'), 'utf8');
  assert.match(adapter, /opencode\/plugin\.js/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.main, './opencode/plugin.js');
  assert.ok(fs.existsSync(path.join(root, 'opencode', 'plugin.js')));
});
