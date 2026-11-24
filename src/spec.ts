import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { HARNESSES, type Harness, isHarness, isTool, type Tool } from "./vocab";

export interface Agent {
  name: string;
  description: string;
  tools: Tool[];
  skills: string[];
  /** Concrete model ID per harness. Harnesses not listed inherit. */
  model: Partial<Record<Harness, string>>;
  prompt: string;
  sourcePath: string;
}

export interface Skill {
  name: string;
  dir: string;
}

export interface Source {
  root: string;
  agents: Agent[];
  skills: Map<string, Skill>;
}

export interface Problem {
  file: string;
  message: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KNOWN_FIELDS = new Set(["name", "description", "tools", "skills", "model"]);

/** Read and validate every agent and skill in a source repo. Never throws on bad specs; returns problems. */
export function loadSource(root: string): { source: Source; problems: Problem[] } {
  const problems: Problem[] = [];
  const skills = loadSkills(root, problems);
  const agents: Agent[] = [];

  const agentsDir = join(root, "agents");
  if (!existsSync(agentsDir)) {
    problems.push({ file: agentsDir, message: "no agents/ folder found" });
    return { source: { root, agents, skills }, problems };
  }

  const seen = new Map<string, string>();
  for (const file of readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const path = join(agentsDir, file);
    const before = problems.length;
    const agent = parseAgent(path, skills, problems);
    if (!agent || problems.length > before) continue;
    const dup = seen.get(agent.name);
    if (dup) {
      problems.push({ file: path, message: `duplicate agent name "${agent.name}" (also in ${dup})` });
      continue;
    }
    seen.set(agent.name, path);
    agents.push(agent);
  }

  return { source: { root, agents, skills }, problems };
}

function loadSkills(root: string, problems: Problem[]): Map<string, Skill> {
  const skills = new Map<string, Skill>();
  const dir = join(root, "skills");
  if (!existsSync(dir)) return skills;
  for (const name of readdirSync(dir).sort()) {
    const skillDir = join(dir, name);
    if (!statSync(skillDir).isDirectory()) continue;
    if (!existsSync(join(skillDir, "SKILL.md"))) {
      problems.push({ file: skillDir, message: "skill folder has no SKILL.md" });
      continue;
    }
    if (!NAME.test(name)) {
      problems.push({ file: skillDir, message: `skill folder name "${name}" must be kebab-case` });
      continue;
    }
    skills.set(name, { name, dir: skillDir });
  }
  return skills;
}

function parseAgent(path: string, skills: Map<string, Skill>, problems: Problem[]): Agent | null {
  const err = (message: string) => problems.push({ file: path, message });

  let data: Record<string, unknown>;
  let body: string;
  try {
    ({ data, body } = parseFrontmatter(readFileSync(path, "utf8")));
  } catch (e) {
    err((e as Error).message);
    return null;
  }

  for (const key of Object.keys(data)) {
    if (!KNOWN_FIELDS.has(key)) err(`unknown field "${key}" (allowed: ${[...KNOWN_FIELDS].join(", ")})`);
  }

  // name
  const name = data.name;
  if (typeof name !== "string" || !name) err(`"name" is required`);
  else {
    if (!NAME.test(name)) err(`"name" must be kebab-case, got "${name}"`);
    if (basename(path, ".md") !== name) err(`file name must match agent name: expected ${name}.md`);
  }

  // description
  const description = data.description;
  if (typeof description !== "string" || !description.trim()) err(`"description" is required`);

  // tools: required, non-empty, known vocabulary. Deny-by-default depends on this.
  const tools: Tool[] = [];
  if (!("tools" in data)) err(`"tools" is required (everything not listed is denied, so the list must be explicit)`);
  else if (!Array.isArray(data.tools)) err(`"tools" must be a list, e.g. [read, grep, glob]`);
  else if (data.tools.length === 0) err(`"tools" must not be empty`);
  else {
    for (const t of data.tools) {
      if (typeof t !== "string") err(`"tools" entries must be strings`);
      else if (t === "bash") err(`"bash" is not allowed: a shell bypasses every allowlist`);
      else if (!isTool(t)) err(`unknown tool "${t}"`);
      else if (!tools.includes(t)) tools.push(t);
    }
  }

  // skills: optional, must exist in the repo's skills/ folder
  const agentSkills: string[] = [];
  if ("skills" in data) {
    if (!Array.isArray(data.skills)) err(`"skills" must be a list`);
    else
      for (const s of data.skills) {
        if (typeof s !== "string") err(`"skills" entries must be strings`);
        else if (!skills.has(s)) err(`skill "${s}" not found in skills/${s}/SKILL.md`);
        else if (!agentSkills.includes(s)) agentSkills.push(s);
      }
  }

  // model: omit (inherit) or a map of harness -> model ID
  const model: Partial<Record<Harness, string>> = {};
  if ("model" in data && data.model !== null) {
    const m = data.model;
    if (typeof m === "string")
      err(`"model" must be a map of harness to model ID (e.g. claude: opus), or omitted to inherit. Model IDs differ per harness.`);
    else if (typeof m !== "object" || Array.isArray(m)) err(`"model" must be a map of harness to model ID`);
    else
      for (const [h, id] of Object.entries(m as Record<string, unknown>)) {
        if (!isHarness(h)) err(`"model" has unknown harness "${h}" (known: ${HARNESSES.join(", ")})`);
        else if (typeof id !== "string" || !id.trim()) err(`"model.${h}" must be a non-empty string`);
        else model[h] = id.trim();
      }
  }

  if (!body) err("agent body (the system prompt) is empty");

  if (typeof name !== "string" || typeof description !== "string") return null;
  return { name, description: description.trim(), tools, skills: agentSkills, model, prompt: body, sourcePath: path };
}
