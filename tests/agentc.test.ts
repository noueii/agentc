import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../src/adapters";
import { parseFrontmatter } from "../src/frontmatter";
import { installHarness } from "../src/install";
import { loadSource } from "../src/spec";

let home: string;
let repo: string;
const savedHome = process.env.HOME;

function agent(name: string, frontmatter: string, body = "Do the thing.") {
  mkdirSync(join(repo, "agents"), { recursive: true });
  writeFileSync(join(repo, "agents", `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`);
}

function skill(name: string) {
  mkdirSync(join(repo, "skills", name), { recursive: true });
  writeFileSync(join(repo, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
}

function load() {
  const { source, problems } = loadSource(repo);
  return { source, problems: problems.map((p) => p.message) };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentc-home-"));
  repo = mkdtempSync(join(tmpdir(), "agentc-repo-"));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.OPENCODE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("validate", () => {
  test("accepts a valid agent", () => {
    skill("go");
    agent("reviewer", "name: reviewer\ndescription: Reviews.\ntools: [read, grep]\nskills: [go]");
    expect(load().problems).toEqual([]);
  });

  test("requires an explicit, non-empty tools list", () => {
    agent("a", "name: a\ndescription: x");
    agent("b", "name: b\ndescription: x\ntools: []");
    const { problems } = load();
    expect(problems.some((p) => p.startsWith(`"tools" is required`))).toBe(true);
    expect(problems).toContain(`"tools" must not be empty`);
  });

  test("rejects bash and unknown tools", () => {
    agent("a", "name: a\ndescription: x\ntools: [read, bash, teleport]");
    const { problems } = load();
    expect(problems).toContain(`"bash" is not allowed: a shell bypasses every allowlist`);
    expect(problems).toContain(`unknown tool "teleport"`);
  });

  test("rejects missing skills, name/file mismatch, unknown fields, string model", () => {
    agent("a", "name: b\ndescription: x\ntools: [read]\nskills: [nope]\ncolor: red\nmodel: strong");
    const { problems } = load();
    expect(problems).toContain(`skill "nope" not found in skills/nope/SKILL.md`);
    expect(problems).toContain("file name must match agent name: expected b.md");
    expect(problems.some((p) => p.startsWith(`unknown field "color"`))).toBe(true);
    expect(problems.some((p) => p.startsWith(`"model" must be a map`))).toBe(true);
  });

  test("accepts a per-harness model map and rejects unknown harnesses", () => {
    agent("a", "name: a\ndescription: x\ntools: [read]\nmodel:\n  claude: opus\n  cursor: x");
    const { problems } = load();
    expect(problems).toEqual([`"model" has unknown harness "cursor" (known: claude, opencode, pi, omp)`]);
  });
});

describe("compile", () => {
  test("claude always writes an explicit tools list", () => {
    agent("a", "name: a\ndescription: x\ntools: [read, list]\nmodel:\n  claude: opus");
    const a = load().source.agents[0]!;
    const { files, errors } = ADAPTERS.claude.compile(a);
    expect(errors).toEqual([]);
    const fm = parseFrontmatter(files[0]!.content).data;
    expect(fm.tools).toBe("Read, Glob");
    expect(fm.model).toBe("opus");
  });

  test("opencode is deny-by-default with a wildcard and per-skill rules", () => {
    skill("go");
    agent("a", "name: a\ndescription: x\ntools: [read, grep]\nskills: [go]");
    const a = load().source.agents[0]!;
    const fm = parseFrontmatter(ADAPTERS.opencode.compile(a).files[0]!.content).data as any;
    expect(fm.mode).toBe("subagent");
    expect(fm.permission["*"]).toBe("deny");
    expect(fm.permission.read).toBe("allow");
    expect(fm.permission.edit).toBe("deny");
    expect(fm.permission.bash).toBe("deny");
    expect(fm.permission.skill).toEqual({ "*": "deny", go: "allow" });
    expect(fm.tools["*"]).toBe(false);
    expect(fm.tools.write).toBe(false);
  });

  test("pi maps glob/list to find/ls", () => {
    agent("a", "name: a\ndescription: x\ntools: [read, glob, list]");
    const fm = parseFrontmatter(ADAPTERS.pi.compile(load().source.agents[0]!).files[0]!.content).data;
    expect(fm.tools).toBe("read, find, ls");
  });

  test("strict: tools with no native equivalent are refused", () => {
    agent("a", "name: a\ndescription: x\ntools: [read, websearch]");
    const { errors } = ADAPTERS.pi.compile(load().source.agents[0]!);
    expect(errors).toEqual(["pi has no equivalent for tool(s): websearch"]);
  });

  test("strict: omp cannot pin a model", () => {
    agent("a", "name: a\ndescription: x\ntools: [read]\nmodel:\n  omp: some/model");
    const { errors } = ADAPTERS.omp.compile(load().source.agents[0]!);
    expect(errors).toEqual(["oh-my-pi agents cannot pin a model; remove model.omp"]);
  });
});

describe("install", () => {
  const agentsDir = () => join(home, ".claude", "agents");

  test("symlinks agents and skills, and is idempotent", () => {
    skill("go");
    agent("a", "name: a\ndescription: x\ntools: [read]\nskills: [go]");
    const first = installHarness(load().source, ADAPTERS.claude);
    expect(first.installed).toEqual(["a"]);
    expect(lstatSync(join(agentsDir(), "a.md")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "go", "SKILL.md"))).toBe(true);

    const second = installHarness(load().source, ADAPTERS.claude);
    expect(second.linked).toEqual([]);
    expect(second.unchanged.length).toBe(2);
  });

  test("removes agents deleted from the source", () => {
    agent("a", "name: a\ndescription: x\ntools: [read]");
    agent("b", "name: b\ndescription: x\ntools: [read]");
    installHarness(load().source, ADAPTERS.claude);
    rmSync(join(repo, "agents", "b.md"));
    const report = installHarness(load().source, ADAPTERS.claude);
    expect(report.pruned).toEqual([join(agentsDir(), "b.md")]);
    expect(existsSync(join(agentsDir(), "b.md"))).toBe(false);
    expect(existsSync(join(agentsDir(), "a.md"))).toBe(true);
  });

  test("never touches files it doesn't own", () => {
    mkdirSync(agentsDir(), { recursive: true });
    writeFileSync(join(agentsDir(), "a.md"), "hand-written");
    writeFileSync(join(agentsDir(), "mine.md"), "hand-written");
    agent("a", "name: a\ndescription: x\ntools: [read]");
    const report = installHarness(load().source, ADAPTERS.claude);
    expect(report.conflicts).toEqual([join(agentsDir(), "a.md")]);
    expect(readFileSync(join(agentsDir(), "a.md"), "utf8")).toBe("hand-written");
    expect(readFileSync(join(agentsDir(), "mine.md"), "utf8")).toBe("hand-written");
  });

  test("pi preflight fails without a subagent extension", () => {
    agent("a", "name: a\ndescription: x\ntools: [read]");
    const report = installHarness(load().source, ADAPTERS.pi);
    expect(report.fatal).toContain("no subagent extension was found");
    expect(existsSync(join(home, ".pi", "agent", "agents"))).toBe(false);

    mkdirSync(join(home, ".pi", "agent", "extensions", "subagent"), { recursive: true });
    expect(installHarness(load().source, ADAPTERS.pi).installed).toEqual(["a"]);
  });

  test("dry run doesn't touch harness folders", () => {
    agent("a", "name: a\ndescription: x\ntools: [read]");
    const report = installHarness(load().source, ADAPTERS.claude, { dryRun: true });
    expect(report.installed).toEqual(["a"]);
    expect(existsSync(agentsDir())).toBe(false);
  });
});
