import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import importSkill from "../skills/agentc-import/SKILL.md" with { type: "text" };
import { home } from "./home";

// Skills that ship inside the agentc binary. They're embedded at build time so
// a skill always matches the CLI version it describes (flags, behaviour).
// On install they're written to ~/.agentc/skills/ and linked into each harness,
// under the same ownership rule as everything else agentc installs.

export interface BuiltinSkill {
  name: string;
  files: Record<string, string>;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [{ name: "agentc-import", files: { "SKILL.md": importSkill } }];

export function agentcHome(): string {
  return process.env.AGENTC_HOME || join(home(), ".agentc");
}

export function builtinSkillsRoot(): string {
  return join(agentcHome(), "skills");
}

/** Write the embedded skills to ~/.agentc/skills/, replacing old versions and removing retired ones. */
export function writeBuiltinSkills(): string {
  const root = builtinSkillsRoot();
  mkdirSync(root, { recursive: true });
  const names = new Set(BUILTIN_SKILLS.map((s) => s.name));

  for (const skill of BUILTIN_SKILLS) {
    const dir = join(root, skill.name);
    for (const [file, content] of Object.entries(skill.files)) {
      const path = join(dir, file);
      if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
    }
  }

  // Skills dropped in a newer agentc version: delete them so their links get pruned.
  for (const entry of readdirSync(root)) {
    if (!names.has(entry)) rmSync(join(root, entry), { recursive: true, force: true });
  }
  return root;
}
