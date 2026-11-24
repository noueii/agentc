import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ADAPTERS } from "./adapters";
import { parseFrontmatter, renderFrontmatter, type Value } from "./frontmatter";
import type { Harness, Tool } from "./vocab";

// Converts a harness's existing native agents into agentc specs.
// Mechanical only: anything that needs a judgment call (no tools list, bash,
// MCP tools, ambiguous mappings) is recorded as an issue for a human or the
// agentc-import skill to resolve. Original agents are never modified.

export type ImportStatus = "clean" | "needs-review" | "skipped";

export interface ImportIssue {
  kind: "no-tools" | "bash" | "mcp" | "unmapped-tool" | "dropped-field" | "renamed" | "missing-skill" | "ambiguous";
  message: string;
}

export interface ImportedAgent {
  name: string;
  from: string;
  to?: string;
  status: ImportStatus;
  issues: ImportIssue[];
  /** Why the agent was skipped, when status is "skipped". */
  reason?: string;
}

export interface ImportReport {
  harness: Harness;
  from: string;
  dest: string;
  agents: ImportedAgent[];
  skillsCopied: string[];
}

export interface ImportOptions {
  /** Folder to read native agents from. Default: the harness's user-level agents folder. */
  from?: string;
  /** agentc source repo to write into. */
  dest: string;
  /** Overwrite agents that already exist in dest. */
  force?: boolean;
}

interface Importer {
  agentsDir(): string;
  skillsDir(): string;
  convert(name: string, data: Record<string, unknown>): {
    tools: Tool[] | null;
    skills: string[];
    model?: string;
    issues: ImportIssue[];
  };
}

const CLAUDE_TOOLS: Record<string, Tool | null> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  Grep: "grep",
  Glob: "glob",
  LS: "list",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  TodoWrite: "todo",
  Task: "task",
  Agent: "task",
  Skill: null, // implied by the skills list
};

const CLAUDE_KNOWN_FIELDS = new Set(["name", "description", "tools", "skills", "model"]);

const claudeImporter: Importer = {
  agentsDir: () => join(ADAPTERS.claude.installRoot(), "agents"),
  skillsDir: () => join(ADAPTERS.claude.installRoot(), "skills"),
  convert(_name, data) {
    const issues: ImportIssue[] = [];

    for (const key of Object.keys(data))
      if (!CLAUDE_KNOWN_FIELDS.has(key))
        issues.push({ kind: "dropped-field", message: `field "${key}" has no agentc equivalent and was dropped` });

    let tools: Tool[] | null = null;
    if (data.tools !== undefined && data.tools !== null) {
      const raw = Array.isArray(data.tools) ? data.tools.map(String) : String(data.tools).split(",");
      tools = [];
      for (const t of raw.map((s) => s.trim()).filter(Boolean)) {
        if (t === "Bash" || t.startsWith("Bash(")) {
          issues.push({ kind: "bash", message: `uses ${t}; agentc has no bash because a shell bypasses every allowlist` });
          continue;
        }
        if (t.startsWith("mcp__")) {
          issues.push({ kind: "mcp", message: `uses MCP tool ${t}; agentc v0 denies all MCP tools` });
          continue;
        }
        if (!(t in CLAUDE_TOOLS)) {
          issues.push({ kind: "unmapped-tool", message: `tool "${t}" has no agentc equivalent and was dropped` });
          continue;
        }
        const mapped = CLAUDE_TOOLS[t];
        if (mapped && !tools.includes(mapped)) tools.push(mapped);
      }
      if (tools.includes("glob") && !tools.includes("list"))
        issues.push({
          kind: "ambiguous",
          message: `Glob imported as "glob"; add "list" too if the agent needs directory listings on pi/omp`,
        });
    } else {
      issues.push({
        kind: "no-tools",
        message: "has no tools list, so in Claude Code it inherits every tool; agentc needs an explicit allowlist",
      });
    }

    const skills = Array.isArray(data.skills) ? data.skills.map(String) : [];
    const model = typeof data.model === "string" && data.model !== "inherit" ? data.model : undefined;
    return { tools, skills, model, issues };
  },
};

const IMPORTERS: Partial<Record<Harness, Importer>> = { claude: claudeImporter };

export function importableHarnesses(): Harness[] {
  return Object.keys(IMPORTERS) as Harness[];
}

function toKebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A symlink pointing into some agentc build folder: already managed by agentc. */
function isAgentcLink(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    return resolve(dirname(path), readlinkSync(path)).includes(`${"/"}.agentc${"/"}build${"/"}`);
  } catch {
    return false;
  }
}

export function importAgents(harness: Harness, opts: ImportOptions): ImportReport {
  const importer = IMPORTERS[harness];
  if (!importer) throw new Error(`import from ${harness} is not supported yet (supported: ${importableHarnesses().join(", ")})`);

  const from = resolve(opts.from ?? importer.agentsDir());
  const dest = resolve(opts.dest);
  const report: ImportReport = { harness, from, dest, agents: [], skillsCopied: [] };
  if (!existsSync(from)) throw new Error(`no agents folder at ${from}`);

  for (const file of readdirSync(from).sort()) {
    if (!file.endsWith(".md")) continue;
    const path = join(from, file);
    const entry: ImportedAgent = { name: basename(file, ".md"), from: path, status: "clean", issues: [] };
    report.agents.push(entry);

    if (isAgentcLink(path)) {
      entry.status = "skipped";
      entry.reason = "already installed by agentc";
      continue;
    }

    let data: Record<string, unknown>;
    let body: string;
    try {
      ({ data, body } = parseFrontmatter(readFileSync(path, "utf8")));
    } catch (e) {
      entry.status = "skipped";
      entry.reason = `could not parse: ${(e as Error).message}`;
      continue;
    }

    const originalName = typeof data.name === "string" && data.name ? data.name : entry.name;
    const name = toKebab(originalName);
    entry.name = name;
    if (name !== originalName)
      entry.issues.push({ kind: "renamed", message: `renamed "${originalName}" to "${name}" (agentc names are kebab-case)` });

    const out = join(dest, "agents", `${name}.md`);
    entry.to = out;
    if (existsSync(out) && !opts.force) {
      entry.status = "skipped";
      entry.reason = `${out} already exists (use --force to overwrite)`;
      continue;
    }

    const converted = importer.convert(name, data);
    entry.issues.push(...converted.issues);

    // Bring referenced skills along, if dest doesn't have them yet.
    for (const s of converted.skills) {
      const destSkill = join(dest, "skills", s);
      if (existsSync(join(destSkill, "SKILL.md"))) continue;
      const srcSkill = join(importer.skillsDir(), s);
      if (existsSync(join(srcSkill, "SKILL.md")) && !isAgentcLink(srcSkill)) {
        cpSync(srcSkill, destSkill, { recursive: true, dereference: true });
        if (!report.skillsCopied.includes(s)) report.skillsCopied.push(s);
      } else {
        entry.issues.push({ kind: "missing-skill", message: `skill "${s}" not found in ${importer.skillsDir()}` });
      }
    }

    const description =
      typeof data.description === "string" && data.description.trim() ? data.description.trim() : `TODO: describe when to use ${name}`;

    // Renames, hints and cosmetic fields are informational; everything else needs a decision.
    const review = entry.issues.filter(
      (i) =>
        i.kind !== "renamed" && i.kind !== "ambiguous" && !(i.kind === "dropped-field" && /"color"/.test(i.message)),
    );
    entry.status = review.length ? "needs-review" : "clean";

    const fm: Record<string, Value | undefined> = {
      name,
      description,
      tools: converted.tools ?? [],
      skills: converted.skills.length ? converted.skills : undefined,
      model: converted.model ? { [harness]: converted.model } : undefined,
    };
    const headerLines = [`Imported by agentc from ${path}`];
    if (entry.status === "needs-review")
      headerLines.push("NEEDS REVIEW, then delete these comment lines:", ...review.map((i) => `- ${i.message}`));

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderFrontmatter(fm, body || "TODO: system prompt", headerLines.join("\n")));
  }

  return report;
}
