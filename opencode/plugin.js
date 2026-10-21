import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SHELL_ROOT = ROOT.replace(/\\/g, "/")

const SURFACES = ["inventory", "explain", "wiki", "status", "recipe", "config"]
const AGENTS = ["inventory-worker", "tracer", "verifier"]

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const OPENCODE_NOTE =
  "opencode adapter: `CLAUDE_PLUGIN_ROOT` is set for every shell; use the `question` " +
  "tool where this text says AskUserQuestion, and dispatch the named Archie subagents " +
  "with the `task` tool.\n\nUser arguments (may be empty): $ARGUMENTS\n\n---\n\n"

function frontmatter(source) {
  const match = source.match(FRONTMATTER)
  const data = {}
  for (const line of (match ? match[1] : "").split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (entry) data[entry[1]] = entry[2].trim()
  }
  return { data, body: match ? source.slice(match[0].length) : source }
}

function command(name) {
  const source = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8")
  const { data, body } = frontmatter(source)
  return {
    description: data.description || `Archie: ${name}`,
    template: OPENCODE_NOTE + body,
  }
}

function agent(name) {
  const source = readFileSync(join(ROOT, "agents", `${name}.md`), "utf8")
  const { data, body } = frontmatter(source)
  return {
    description: data.description || `Archie: ${name}`,
    mode: "subagent",
    prompt: body,
    permission: {
      "*": "deny",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
    },
  }
}

function addSkillsPath(cfg, skillsRoot) {
  const skills = cfg.skills
  if (Array.isArray(skills)) {
    if (!skills.includes(skillsRoot)) skills.push(skillsRoot)
    return
  }
  const paths = Array.isArray(skills?.paths) ? skills.paths : []
  if (!paths.includes(skillsRoot)) paths.push(skillsRoot)
  cfg.skills = { ...(skills && typeof skills === "object" ? skills : {}), paths }
}

export const ArchiePlugin = async () => {
  const commands = {}
  for (const name of SURFACES) commands[`archie:${name}`] = command(name)

  const agents = {}
  for (const name of AGENTS) agents[name] = agent(name)

  return {
    config: async (cfg) => {
      cfg.command = { ...commands, ...(cfg.command ?? {}) }
      cfg.agent = { ...agents, ...(cfg.agent ?? {}) }
      addSkillsPath(cfg, join(ROOT, "skills"))
    },
    "shell.env": async (_input, output) => {
      output.env.CLAUDE_PLUGIN_ROOT = SHELL_ROOT
      output.env.ARCHIE_PLUGIN_ROOT = SHELL_ROOT
    },
  }
}
