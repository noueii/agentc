# agentc

**Define your coding agents once. Spawn them natively in any harness.**

## Install

Needs [Bun](https://bun.sh).

```sh
bun install -g github:noueii/agentc
agentc --version
```

To update, run the same `bun install -g` command again. To remove: `bun remove -g agentc`.

If `agentc` isn't found, Bun's global bin folder isn't on your PATH. Add it, e.g. `echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc`, and open a new shell.

<details>
<summary>Without a global install: build a standalone binary</summary>

```sh
git clone https://github.com/noueii/agentc.git
cd agentc
bun run build                          # dist/agentc, runs without Bun
mkdir -p ~/.local/bin
cp dist/agentc ~/.local/bin/           # or anywhere on your PATH
```

</details>

## Use

```sh
mkdir -p ~/my-agents/agents                     # your agents repo (one file per agent)
agentc validate --source ~/my-agents
agentc install  --source ~/my-agents            # installs into every harness found on this machine
```

Already have Claude Code agents? `agentc import --harness claude --source ~/my-agents`, or ask your agent to use the `agentc-import` skill, which `agentc install` sets up. See [Agent spec](#agent-spec) for the file format and [`examples/`](examples) for two working agents.

## What it is

agentc is a small compiler for agent definitions. You write each agent once, as a markdown file with frontmatter. agentc translates it into the native subagent format of each supported harness and installs it there. Spawning then happens through the harness's own subagent mechanism, so the harness itself enforces the agent's tool and skill restrictions. agentc never runs agents itself.

> **Status:** v0 implemented, **not yet verified against the real harnesses.** The adapters follow each harness's documented or best-known format, but no contract test has run against a real Claude Code, OpenCode, pi or omp yet. Until one does, `install` prints an UNVERIFIED warning per harness. See [Verification status](#verification-status).

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

## Quick start

```sh
bun install                                   # dev dependencies (types only; agentc has no runtime deps)
bun run src/cli.ts validate --source examples
bun run src/cli.ts install --source examples --dry-run
```

`examples/` is a small agents repo with a read-only `reviewer` (using a skill) and an `explorer`.

## CLI

```
agentc validate [--source <dir>]
agentc install  [--source <dir>] [--harness <name>[,<name>]] [--dry-run] [--skip-preflight] [--no-builtin-skills]
agentc import   --harness <name> [--source <dir>] [--from <dir>] [--force] [--json]
```

| Option | Meaning |
|---|---|
| `--source <dir>` | Agents repo containing `agents/` and `skills/`. Default: current directory |
| `--harness` | `claude`, `opencode`, `pi`, `omp`. Repeatable or comma-separated. Default: every harness detected on this machine |
| `--dry-run` | Compile into the build folder, don't touch harness folders |
| `--skip-preflight` | Skip harness checks, e.g. pi's subagent extension |
| `--no-builtin-skills` | Don't install agentc's bundled skills, and remove them if present |

Exit codes: `0` everything installed, `1` something was refused (invalid spec, strict-mode refusal, conflict, failed preflight), `2` usage error.

Tool vocabulary for `tools:`: `read`, `write`, `edit`, `grep`, `glob`, `list`, `webfetch`, `websearch`, `todo`, `task`. There is no `bash`.

## Importing existing agents

Already have agents in a harness? Convert them instead of rewriting them:

```sh
agentc import --harness claude --source ~/my-agents
```

`import` reads the harness's user-level agents (`--from` to point elsewhere), writes agentc specs into the repo, and copies the skills they reference. It never modifies the originals. Only Claude Code is supported for now.

It converts what it can and marks the rest **NEEDS REVIEW** at the top of the spec:

- **No tools list.** The agent inherited every tool. It's imported with an empty list, so `validate` fails until someone picks an allowlist.
- **Bash or MCP tools.** Dropped, because agentc denies both. Decide whether the agent still works without them, or should stay a native agent outside agentc.
- **Fields agentc doesn't carry** (e.g. `permissionMode`, `hooks`).

The [`agentc-import` skill](skills/agentc-import/SKILL.md) walks through those decisions with you: it runs the import, proposes minimal tool lists, handles bash and MCP cases, validates, moves the originals out of the way (only with your yes), and installs. It's bundled with agentc (see below), so after any `agentc install` you can just ask your agent to import your agents.

## Built-in skills

agentc ships its own skills inside the binary, so they always match the CLI version they describe. Currently there's one: `agentc-import`.

`agentc install` writes them to `~/.agentc/skills/` (or `$AGENTC_HOME/skills/`) and links them into every harness it installs for, under the same ownership rule as your agents. If you already have a skill with the same name, it's reported as a conflict and left alone. Pass `--no-builtin-skills` to skip them; that also removes links from earlier installs.

The skills call `agentc` directly, so the binary needs to be on your PATH.

## What each adapter writes

| Harness | Installs to | Restriction |
|---|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR` or `~/.claude`: `agents/<name>.md`, `skills/<skill>/` | Always writes an explicit `tools:` list (an omitted list means "inherit everything"). Adds `Skill` and `skills:` when the agent has skills. `list` maps to `Glob` |
| OpenCode | `$OPENCODE_CONFIG_DIR`, `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`: `agents/<name>.md`, `skills/<skill>/` | `mode: subagent`, a `permission:` block with `"*": deny`, an explicit deny for every known built-in, per-skill rules (`skill: {"*": deny, <skill>: allow}`), and the same allowlist in the older `tools:` map. OpenCode grants write and edit together |
| pi | `$PI_CODING_AGENT_DIR` or `~/.pi/agent`: `agents/<name>.md`, `skills/<skill>/` | `tools:` as pi tool names (`glob` → `find`, `list` → `ls`). Fails preflight unless a subagent extension is in `extensions/` |
| oh-my-pi | `~/.omp/agent`: `agents/<name>.md`, `skills/<skill>/` | `tools:` for omp's `task` tool. Only tools we're reasonably sure of are mapped (`read`, `write`, `edit`, `grep`, `glob`, `task`); anything else is refused. Model pinning is refused because `task` has no model field |

Skills are installed for every harness, but only OpenCode can stop an agent from using *other* installed skills. Elsewhere this is reported as a warning, not an error.

## Verification status

| Harness | Format | Restrictions proven by contract test |
|---|---|---|
| Claude Code | documented | no |
| OpenCode | documented; `agents/` folder name and MCP coverage of `"*"` unconfirmed | no |
| pi | reference subagent extension format | no |
| oh-my-pi | **assumed** (folder, fields and tool names) | no |

Flip an adapter's `verified` flag to `true` only after its contract test passes. The contract tests themselves are the next piece of work: spawn each compiled agent in the real harness and check that an allowed tool works, a forbidden built-in tool and a forbidden MCP tool are blocked, and its skill is available.

## Development

```sh
bun test            # unit tests (spec validation, compile output, install/prune/conflicts)
bun run build       # standalone binary for this machine: dist/agentc
bun run build:all   # binaries for macOS, Linux and Windows
```

Code layout: `src/spec.ts` (parse and validate), `src/adapters/*` (one file per harness), `src/install.ts` (build folder, symlinks, pruning), `src/import.ts` (native agents to specs), `src/builtin.ts` (bundled skills), `src/cli.ts`.

## Enforcement

Restrictions are the point of agentc, so it does not trust config alone:

- **Deny by default on every target.** Each adapter knows the full list of its harness's built-in tools and writes explicit denies for everything not allowed, including MCP tools where the harness supports it.
- **Strict mode.** If an agent needs a restriction a harness cannot enforce, `install` fails for that harness instead of installing a weaker agent.
- **Contract tests.** For each harness, a real test spawns a compiled agent and checks that an allowed tool works, a forbidden built-in tool is blocked, a forbidden MCP tool is blocked, and its skill is available.

## Tech

TypeScript on [Bun](https://bun.sh), with no runtime dependencies (YAML parsing is built into Bun). Shipped as standalone binaries built with `bun build --compile`, so no runtime is needed on developers' machines. The binary embeds the Bun runtime, so it's around 100 MB.

## Not in v0

Agent list/UI, harness plugins or slash commands, a memory system (memory can be an ordinary skill), syncing between developers, a shared team repo, model tiers. See [docs/design.md](docs/design.md) for the reasoning behind these decisions.

## Prior art

- [wshobson/agents](https://github.com/wshobson/agents): Claude Code markdown as source, per-harness generators, symlink install. agentc borrows its tool-name mappings and its install approach, and adds strict deny-by-default, a `skills` field and an omp target.
- [rulesync](https://github.com/dyoshikawa/rulesync): generates configs, including subagents, for many AI tools.
- [Outfitter](https://github.com/ai-outfitter/outfitter): a launcher that projects `.agents/` definitions into Claude Code and pi.
