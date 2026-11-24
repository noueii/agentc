import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "../src/frontmatter";
import { importAgents } from "../src/import";
import { loadSource } from "../src/spec";

let home: string;
let dest: string;
const savedHome = process.env.HOME;
const claudeAgents = () => join(home, ".claude", "agents");

function native(file: string, content: string) {
  mkdirSync(claudeAgents(), { recursive: true });
  writeFileSync(join(claudeAgents(), file), content);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentc-home-"));
  dest = mkdtempSync(join(tmpdir(), "agentc-dest-"));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

test("clean agent imports as a valid spec, with its skill and model", () => {
  mkdirSync(join(home, ".claude", "skills", "sql"), { recursive: true });
  writeFileSync(join(home, ".claude", "skills", "sql", "SKILL.md"), "---\nname: sql\ndescription: x\n---\nrules\n");
  native("db.md", "---\nname: db\ndescription: Reviews SQL.\ntools: Read, Grep, Skill\nskills: [sql]\nmodel: sonnet\n---\nReview.\n");

  const report = importAgents("claude", { dest });
  expect(report.agents[0]!.status).toBe("clean");
  expect(report.skillsCopied).toEqual(["sql"]);

  const { source, problems } = loadSource(dest);
  expect(problems).toEqual([]);
  expect(source.agents[0]!.tools).toEqual(["read", "grep"]);
  expect(source.agents[0]!.model).toEqual({ claude: "sonnet" });
});

test("bash, MCP tools and dropped fields need review; bash and MCP are left out", () => {
  native("fixer.md", "---\nname: fixer\ndescription: x\ntools: Read, Edit, Bash(git:*), mcp__gh__pr\npermissionMode: acceptEdits\n---\nFix.\n");
  const a = importAgents("claude", { dest }).agents[0]!;
  expect(a.status).toBe("needs-review");
  expect(a.issues.map((i) => i.kind).sort()).toEqual(["bash", "dropped-field", "mcp"]);

  const text = readFileSync(join(dest, "agents", "fixer.md"), "utf8");
  expect(text).toContain("# NEEDS REVIEW");
  expect(parseFrontmatter(text).data.tools).toEqual(["read", "edit"]);
});

test("an agent with no tools list is imported with an empty list, so validate forces a decision", () => {
  native("helper.md", "---\nname: helper\ndescription: x\n---\nHelp.\n");
  expect(importAgents("claude", { dest }).agents[0]!.issues[0]!.kind).toBe("no-tools");
  expect(loadSource(dest).problems.map((p) => p.message)).toContain(`"tools" must not be empty`);
});

test("names are kebab-cased, existing specs are kept unless --force, originals untouched", () => {
  native("x.md", "---\nname: DbReviewer\ndescription: x\ntools: Read\n---\nA.\n");
  const first = importAgents("claude", { dest }).agents[0]!;
  expect(first.name).toBe("db-reviewer");
  expect(first.status).toBe("clean");

  expect(importAgents("claude", { dest }).agents[0]!.status).toBe("skipped");
  expect(importAgents("claude", { dest, force: true }).agents[0]!.status).toBe("clean");
  expect(readFileSync(join(claudeAgents(), "x.md"), "utf8")).toContain("DbReviewer");
});

test("agents already installed by agentc are skipped", () => {
  const build = join(dest, ".agentc", "build", "claude", "agents");
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "a.md"), "---\nname: a\ndescription: x\ntools: Read\n---\nA.\n");
  mkdirSync(claudeAgents(), { recursive: true });
  symlinkSync(join(build, "a.md"), join(claudeAgents(), "a.md"));

  const a = importAgents("claude", { dest }).agents[0]!;
  expect(a.status).toBe("skipped");
  expect(a.reason).toBe("already installed by agentc");
  expect(existsSync(join(dest, "agents", "a.md"))).toBe(false);
});
