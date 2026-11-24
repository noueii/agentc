import { existsSync } from "node:fs";
import { home } from "../home";
import { join } from "node:path";
import { renderFrontmatter } from "../frontmatter";
import { type Adapter, checkRequirements, header, nativeTools } from "./types";

// pi has no built-in subagents. Agents are read by a subagent extension;
// v0 targets the reference one shipped in pi's repo (examples/extensions/subagent),
// which reads <config>/agents/<name>.md and passes `tools` to the child pi process.
//
// Careful: that extension treats a missing or empty `tools` as "all tools",
// which is why agentc refuses specs without an explicit, non-empty list.

const EXTENSION_CANDIDATES = ["extensions/subagent", "extensions/subagent.ts", "extensions/subagent/index.ts"];

export const pi: Adapter = {
  name: "pi",
  label: "pi",
  verified: false,
  capabilities: {
    tool_allowlist: "enforce",
    mcp_deny: "enforce", // pi core has no MCP, so there is nothing to leak
    skill_access: "approximate", // the child pi discovers installed skills on its own
    skill_restrict: "unsupported",
    model_select: "enforce",
  },
  // pi core tools: read, bash, edit, write, grep, find, ls
  toolMap: {
    read: ["read"],
    write: ["write"],
    edit: ["edit"],
    grep: ["grep"],
    glob: ["find"],
    list: ["ls"],
  },
  managedDirs: { agents: "agents", skills: "skills" },
  installRoot: () => process.env.PI_CODING_AGENT_DIR || join(home(), ".pi", "agent"),
  detect() {
    return Bun.which("pi") !== null || existsSync(this.installRoot());
  },
  preflight() {
    const root = this.installRoot();
    if (EXTENSION_CANDIDATES.some((p) => existsSync(join(root, p)))) return null;
    return (
      `pi has no built-in subagents and no subagent extension was found in ${join(root, "extensions")}. ` +
      `Install pi's reference subagent extension (examples/extensions/subagent) so these agents can be spawned, ` +
      `or pass --skip-preflight if you load it from somewhere else.`
    );
  },
  compile(agent) {
    const { errors, warnings } = checkRequirements(this, agent);
    const content = renderFrontmatter(
      {
        name: agent.name,
        description: agent.description,
        tools: nativeTools(this, agent.tools).join(", "),
        model: agent.model.pi,
      },
      agent.prompt,
      header(agent),
    );
    return { files: [{ path: `agents/${agent.name}.md`, content }], warnings, errors };
  },
};
