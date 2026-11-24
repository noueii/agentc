# agentc

**Define your coding agents once. Spawn them natively in any harness.**

agentc is a small compiler for agent definitions. You write each agent once, as a markdown file with frontmatter. agentc translates it into the native subagent format of each supported harness and installs it there. Spawning then happens through the harness's own subagent mechanism, so the harness itself enforces the agent's tool and skill restrictions. agentc never runs agents itself.

> **Status:** design phase (v0). Nothing is implemented yet. This README describes what v0 will be.

## Why

Every coding harness has its own subagent format, its own folder, its own tool names and its own permission model. A team where people use different harnesses ends up rewriting the same agents several times, and the restrictions drift: an agent that is read-only in one harness quietly gets full access in another.

agentc fixes that with one source of truth per agent and **deny-by-default** restrictions on every target.

## Supported harnesses (v0)

| Harness | Native mechanism | Notes |
|---|---|---|
| Claude Code | `~/.claude/agents/*.md` | Source format is close to Claude Code's own |
| OpenCode | agent file with `mode: subagent` + `permission:` block | Allowlist becomes explicit allows plus `"*": deny` |
| pi | agent files read by a pi subagent extension | pi core has no subagents; agentc checks that the extension is installed |
| oh-my-pi (omp) | agents for omp's built-in `task` tool | Format and folder still to be verified, see [docs/design.md](docs/design.md#open-questions-step-0) |

## How it works

```
my-agents/                          (each developer's own repo)
  agents/reviewer.md
  skills/go-conventions/SKILL.md
        │
   agentc install
        │   1. validate every agent
        │   2. generate native files into my-agents/.agentc/build/<harness>/   (gitignored)
        │   3. symlink them into the harness's user-level folders
        ▼
  ~/.claude/agents/   ~/.config/opencode/agent/   ~/.pi/agent/agents/   ~/.omp/agent/agents/
```

- **User-level install.** Agents are available in every project the developer opens. There are no project-specific agents.
- **Symlinks, not copies.** Updating is `git pull && agentc install`. agentc owns exactly the links that point into its build folder, so it can remove stale agents safely and never touches files you created by hand.
- **One repo per developer.** Each developer keeps their own agents repo. A shared team repo may come later.

## Agent spec

One markdown file per agent. The body is the system prompt.

```markdown
---
name: reviewer
description: Reviews Go diffs for convention violations. Use after any change over 50 lines.
tools: [read, grep, glob]
skills: [go-conventions]
---
You are a code reviewer. ...
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Unique agent name |
| `description` | yes | When to use the agent. Harnesses pick subagents by this, so treat it as part of the contract |
| `tools` | **yes** | Allowlist in agentc's own tool vocabulary. Everything not listed is denied. A missing list fails validation |
| `skills` | no | Skills the agent may use. Copied/linked from the repo's `skills/` folder |
| `model` | no | Omit to inherit the developer's current model. Or give one model per harness (see below) |

```yaml
model:
  claude: opus
  opencode: anthropic/claude-opus-5-5
  pi: anthropic/claude-opus-5-5
  # harnesses not listed inherit
```

There are no model tiers like `fast`/`strong` in v0. Each developer owns their repo, so they write the model IDs they actually have access to.

## CLI (v0)

```
agentc validate                                  # check every agent spec
agentc install [--harness claude|opencode|pi|omp] [--source <path>]
```

`install` without `--harness` installs for every harness detected on the machine.

## Enforcement

Restrictions are the point of agentc, so it does not trust config alone:

- **Deny by default on every target.** Each adapter knows the full list of its harness's built-in tools and writes explicit denies for everything not allowed, including MCP tools where the harness supports it.
- **Strict mode.** If an agent needs a restriction a harness cannot enforce, `install` fails for that harness instead of installing a weaker agent.
- **Contract tests.** For each harness, a real test spawns a compiled agent and checks that an allowed tool works, a forbidden built-in tool is blocked, a forbidden MCP tool is blocked, and its skill is available.

## Tech

TypeScript on [Bun](https://bun.sh), shipped as standalone binaries built with `bun build --compile`. No runtime needed on developers' machines.

## Not in v0

Agent list/UI, harness plugins or slash commands, a memory system (memory can be an ordinary skill), syncing between developers, a shared team repo, model tiers. See [docs/design.md](docs/design.md) for the reasoning behind these decisions.

## Prior art

- [wshobson/agents](https://github.com/wshobson/agents): Claude Code markdown as source, per-harness generators, symlink install. agentc borrows its tool-name mappings and its install approach, and adds strict deny-by-default, a `skills` field and an omp target.
- [rulesync](https://github.com/dyoshikawa/rulesync): generates configs, including subagents, for many AI tools.
- [Outfitter](https://github.com/ai-outfitter/outfitter): a launcher that projects `.agents/` definitions into Claude Code and pi.
