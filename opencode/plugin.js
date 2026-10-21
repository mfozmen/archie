import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SHELL_ROOT = ROOT.replace(/\\/g, "/")

const SURFACES = ["inventory", "explain", "wiki", "status", "recipe", "config"]
const AGENTS = ["inventory-worker", "tracer", "verifier"]

const READ_PERMISSION = {
  "*": "allow",
  "*.env": "ask",
  "*.env.*": "ask",
  "*.env.example": "allow",
}

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
      read: READ_PERMISSION,
      grep: "allow",
      glob: "allow",
      list: "allow",
    },
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function mergeAgent(base, override) {
  const merged = { ...(base ?? {}), ...override }
  const basePermission = isObject(base?.permission) ? base.permission : {}
  const overridePermission = isObject(override.permission) ? override.permission : {}
  merged.permission = { ...basePermission, ...overridePermission }
  if (isObject(basePermission.read) && isObject(overridePermission.read)) {
    merged.permission.read = { ...basePermission.read, ...overridePermission.read }
  }
  return merged
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
      const mergedCommands = { ...commands }
      for (const [name, override] of Object.entries(cfg.command ?? {})) {
        mergedCommands[name] = { ...commands[name], ...override }
      }
      cfg.command = mergedCommands

      const mergedAgents = { ...agents }
      for (const [name, override] of Object.entries(cfg.agent ?? {})) {
        mergedAgents[name] = mergeAgent(agents[name], override)
      }
      cfg.agent = mergedAgents

      addSkillsPath(cfg, join(ROOT, "skills"))
    },
    "shell.env": async (_input, output) => {
      output.env.CLAUDE_PLUGIN_ROOT = SHELL_ROOT
      output.env.ARCHIE_PLUGIN_ROOT = SHELL_ROOT
    },
  }
}
