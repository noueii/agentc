---
name: agentc-import
description: Convert the user's existing harness agents (e.g. ~/.claude/agents) into agentc specs, resolving everything the mechanical import can't decide. Use when the user wants to move their agents to agentc, import agents, or adopt agentc with agents they already have.
---

# Import existing agents into agentc

agentc defines each agent once (`agents/<name>.md` in the user's agents repo) and installs it natively into Claude Code, OpenCode, pi and oh-my-pi with a deny-by-default tool allowlist. This skill moves the user's existing agents into that format.

`agentc import` does the mechanical conversion. Your job is the part it can't do: the decisions. Work with the user; don't make security decisions for them silently.

## Rules

- **Never modify or delete the original agents** without the user's explicit yes for that specific step.
- **Least privilege.** When proposing a tools list, give the agent only what its prompt shows it needs. When unsure, propose less and say what it would lose.
- **No bash.** agentc's vocabulary has no bash on purpose: a shell bypasses every allowlist. Don't look for workarounds.
- Valid tools: `read`, `write`, `edit`, `grep`, `glob`, `list`, `webfetch`, `websearch`, `todo`, `task`.

## Steps

### 0. Check agentc is available

Run `agentc --version`. If the command isn't found, stop and tell the user agentc isn't on their PATH: they need to install the agentc binary (or add it to PATH) before importing. Don't try to install it yourself.

### 1. Find the agents repo

Ask which folder is the user's agentc agents repo (it holds `agents/` and `skills/`). If they don't have one, offer to create one, e.g. `~/my-agents`, and `git init` it. Run every command below with `--source <that folder>`.

### 2. Run the import

```sh
agentc import --harness claude --source <repo> --json
```

Only `claude` is supported for now. Read the JSON report. Each agent has a `status`:

- `clean`: converted with nothing to decide. Still glance at its tools list.
- `needs-review`: has `issues` you must resolve with the user (below).
- `skipped`: see `reason`. "already installed by agentc" is fine. "already exists" means a spec with that name is already in the repo; only re-import with `--force` if the user says so.

Give the user a short summary first: how many clean, how many need review, and the main reasons.

### 3. Resolve each agent that needs review

Go one agent at a time. Read the generated spec in `<repo>/agents/<name>.md` and the original at the `from` path. For each issue:

| Issue | What to do |
|---|---|
| `no-tools` | The original inherited every tool. Read its prompt, propose a minimal list with a one-line reason per tool, and get the user's choice. |
| `bash` | Bash was dropped. Check what the prompt used it for. If the agent can do its job with the remaining tools, say so. If it truly needs a shell (running tests, git, builds), tell the user plainly that this agent can't be a restricted agentc agent and should stay a native agent outside agentc. Then delete its spec from the repo if they agree. |
| `mcp` | agentc v0 denies all MCP tools. Same choice: work without the MCP tool, or keep the agent native. |
| `unmapped-tool` | The tool has no agentc equivalent. Explain what the agent loses. |
| `dropped-field` | Explain what the field did (e.g. `permissionMode`, `hooks`, `mcpServers`) and that agentc doesn't carry it. Usually acceptable; flag it if the agent relied on it. |
| `missing-skill` | The skill wasn't found. Ask where it lives, or remove it from `skills:`. |

Also check the `description`: harnesses choose subagents by it, so it should say when to use the agent. Replace any `TODO` description.

Apply the agreed changes to the spec, then **delete the `# Imported by agentc` / `# NEEDS REVIEW` comment lines** at the top of its frontmatter.

### 4. Validate

```sh
agentc validate --source <repo>
```

Fix every problem it reports before going on.

### 5. Deal with the originals

After install, agentc symlinks each agent into `~/.claude/agents/`. An original file with the same name will be reported as a conflict and left in place, so the old version keeps running.

List the originals that now have an agentc version. Ask the user whether to move them out of the way, and only on a clear yes, move (don't delete) them:

```sh
mkdir -p ~/.claude/agents.pre-agentc
mv ~/.claude/agents/<name>.md ~/.claude/agents.pre-agentc/
```

Agents the user decided to keep native stay where they are.

### 6. Install

```sh
agentc install --source <repo> --dry-run
agentc install --source <repo>
```

Report what was installed per harness, any agent refused on a harness and why (e.g. a tool with no equivalent there), and remind the user that the agents repo is theirs to commit.

## Finish

Tell the user in a few lines: which agents moved to agentc, which stayed native and why, and where the moved originals are.
