import { existsSync } from "node:fs";
import { home } from "../home";
import { join } from "node:path";
import { renderFrontmatter, type Value } from "../frontmatter";
import { type Adapter, checkRequirements, header, nativeTools } from "./types";

// OpenCode agents: <config>/agents/<name>.md with `mode: subagent`.
// OpenCode allows anything not mentioned, so we never just copy the allowlist:
// we write `"*": deny` plus an explicit deny for every built-in we know of,
// and the same again in the older `tools:` map in case a version ignores one of them.

/** Every built-in OpenCode permission key we know of. Everything not granted gets an explicit deny. */
const BUILTINS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "skill",
  "lsp",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "codesearch",
  "question",
  "external_directory",
  "doom_loop",
];

export const opencode: Adapter = {
  name: "opencode",
  label: "OpenCode",
  verified: false,
  capabilities: {
    tool_allowlist: "enforce",
    mcp_deny: "enforce", // via the "*" wildcard; MCP tools have no permission key of their own
    skill_access: "enforce",
    skill_restrict: "enforce", // skill permission accepts per-skill patterns
    model_select: "enforce",
  },
  toolMap: {
    read: ["read"],
    write: ["edit"], // OpenCode's `edit` permission covers write, edit and patch
    edit: ["edit"],
    grep: ["grep"],
    glob: ["glob"],
    list: ["list"],
    webfetch: ["webfetch"],
    websearch: ["websearch"],
    todo: ["todowrite", "todoread"],
    task: ["task"],
  },
  managedDirs: { agents: "agents", skills: "skills" },
  installRoot: () =>
    process.env.OPENCODE_CONFIG_DIR ||
    join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "opencode"),
  detect() {
    return Bun.which("opencode") !== null || existsSync(this.installRoot());
  },
  compile(agent) {
    const { errors, warnings } = checkRequirements(this, agent);
    const granted = nativeTools(this, agent.tools);

    if (agent.tools.includes("write") !== agent.tools.includes("edit"))
      warnings.push("OpenCode grants write and edit together; this agent gets both");

    const permission: Record<string, Value> = { "*": "deny" };
    const tools: Record<string, Value> = { "*": false };
    for (const key of BUILTINS) {
      if (key === "skill") continue;
      permission[key] = granted.includes(key) ? "allow" : "deny";
      tools[key] = granted.includes(key);
    }
    if (granted.includes("edit")) tools.write = tools.patch = true;
    else tools.write = tools.patch = false;

    if (agent.skills.length) {
      const skill: Record<string, Value> = { "*": "deny" };
      for (const s of agent.skills) skill[s] = "allow";
      permission.skill = skill;
      tools.skill = true;
    } else {
      permission.skill = "deny";
      tools.skill = false;
    }

    const content = renderFrontmatter(
      {
        description: agent.description,
        mode: "subagent",
        model: agent.model.opencode,
        tools,
        permission,
      },
      agent.prompt,
      header(agent),
    );
    return { files: [{ path: `agents/${agent.name}.md`, content }], warnings, errors };
  },
};
