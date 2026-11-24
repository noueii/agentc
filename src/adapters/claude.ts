import { existsSync } from "node:fs";
import { home } from "../home";
import { join } from "node:path";
import { renderFrontmatter } from "../frontmatter";
import { type Adapter, checkRequirements, header, nativeTools } from "./types";

// Claude Code subagents: ~/.claude/agents/<name>.md
// `tools:` is a true allowlist; omitting it inherits everything, so we always write it.
// MCP tools are unavailable unless listed, so leaving them out denies them.
export const claude: Adapter = {
  name: "claude",
  label: "Claude Code",
  verified: false,
  capabilities: {
    tool_allowlist: "enforce",
    mcp_deny: "enforce",
    skill_access: "enforce", // `skills:` preloads them into the subagent
    skill_restrict: "approximate", // the Skill tool may still load other installed skills
    model_select: "enforce",
  },
  toolMap: {
    read: ["Read"],
    write: ["Write"],
    edit: ["Edit"],
    grep: ["Grep"],
    glob: ["Glob"],
    list: ["Glob"], // Claude Code lists directories through Glob
    webfetch: ["WebFetch"],
    websearch: ["WebSearch"],
    todo: ["TodoWrite"],
    task: ["Agent"],
  },
  managedDirs: { agents: "agents", skills: "skills" },
  installRoot: () => process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude"),
  detect() {
    return Bun.which("claude") !== null || existsSync(this.installRoot());
  },
  compile(agent) {
    const { errors, warnings } = checkRequirements(this, agent);
    const tools = nativeTools(this, agent.tools);
    if (agent.skills.length) tools.push("Skill");

    const content = renderFrontmatter(
      {
        name: agent.name,
        description: agent.description,
        tools: tools.join(", "),
        skills: agent.skills.length ? agent.skills : undefined,
        model: agent.model.claude,
      },
      agent.prompt,
      header(agent),
    );
    return { files: [{ path: `agents/${agent.name}.md`, content }], warnings, errors };
  },
};
