import { existsSync } from "node:fs";
import { home } from "../home";
import { join } from "node:path";
import { renderFrontmatter } from "../frontmatter";
import { type Adapter, checkRequirements, header, nativeTools } from "./types";

// oh-my-pi has its own built-in subagent tool (`task`), unlike pi.
// Its agent format is NOT verified yet (open question in docs/design.md):
//  - folder assumed to be ~/.omp/agent/agents/
//  - fields assumed: name, description, tools
//  - the `task` tool is known not to support a `model` field, so pinning a model fails
//  - tool names are only mapped where we're reasonably sure; anything else fails loudly
export const omp: Adapter = {
  name: "omp",
  label: "oh-my-pi",
  verified: false,
  capabilities: {
    tool_allowlist: "enforce",
    mcp_deny: "enforce", // assumed: the tools list is exhaustive. Verify with a contract test.
    skill_access: "approximate",
    skill_restrict: "unsupported",
    model_select: "unsupported",
  },
  toolMap: {
    read: ["read"],
    write: ["write"],
    edit: ["edit"],
    grep: ["grep"],
    glob: ["glob"],
    task: ["task"],
  },
  managedDirs: { agents: "agents", skills: "skills" },
  installRoot: () => join(home(), ".omp", "agent"),
  detect() {
    return Bun.which("omp") !== null || existsSync(this.installRoot());
  },
  compile(agent) {
    const { errors, warnings } = checkRequirements(this, agent);
    const content = renderFrontmatter(
      {
        name: agent.name,
        description: agent.description,
        tools: nativeTools(this, agent.tools).join(", "),
      },
      agent.prompt,
      header(agent),
    );
    return { files: [{ path: `agents/${agent.name}.md`, content }], warnings, errors };
  },
};
