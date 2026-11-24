import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../src/adapters";
import { installHarness } from "../src/install";
import { loadSource } from "../src/spec";

let home: string;
let repo: string;
const savedHome = process.env.HOME;
const skillLink = () => join(home, ".claude", "skills", "agentc-import");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentc-home-"));
  repo = mkdtempSync(join(tmpdir(), "agentc-repo-"));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.AGENTC_HOME;
  mkdirSync(join(repo, "agents"));
  writeFileSync(join(repo, "agents", "a.md"), "---\nname: a\ndescription: x\ntools: [read]\n---\nA.\n");
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const install = (builtinSkills?: boolean) =>
  installHarness(loadSource(repo).source, ADAPTERS.claude, { builtinSkills });

test("install writes the bundled skill to ~/.agentc and links it into the harness", () => {
  const report = install();
  expect(report.builtins).toEqual(["agentc-import"]);
  expect(lstatSync(skillLink()).isSymbolicLink()).toBe(true);
  expect(readlinkSync(skillLink())).toBe(join(home, ".agentc", "skills", "agentc-import"));
  expect(readFileSync(join(skillLink(), "SKILL.md"), "utf8")).toContain("name: agentc-import");
});

test("is idempotent and restores an edited copy", () => {
  install();
  const file = join(home, ".agentc", "skills", "agentc-import", "SKILL.md");
  writeFileSync(file, "tampered");
  const second = install();
  expect(second.linked).toEqual([]);
  expect(readFileSync(file, "utf8")).toContain("name: agentc-import");
});

test("--no-builtin-skills removes the link", () => {
  install();
  const report = install(false);
  expect(report.builtins).toEqual([]);
  expect(report.pruned).toContain(skillLink());
  expect(existsSync(skillLink())).toBe(false);
});

test("a user's own skill with the same name is never replaced", () => {
  mkdirSync(skillLink(), { recursive: true });
  writeFileSync(join(skillLink(), "SKILL.md"), "mine");
  const report = install();
  expect(report.conflicts).toContain(skillLink());
  expect(report.builtins).toEqual([]);
  expect(readFileSync(join(skillLink(), "SKILL.md"), "utf8")).toBe("mine");
});
