import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Adapter } from "./adapters";
import type { Source } from "./spec";

export interface InstallOptions {
  dryRun?: boolean;
  skipPreflight?: boolean;
}

export interface HarnessReport {
  harness: string;
  /** Set when the whole harness was skipped (e.g. preflight failed). */
  fatal?: string;
  installed: string[];
  skipped: { agent: string; reasons: string[] }[];
  warnings: string[];
  linked: string[];
  unchanged: string[];
  pruned: string[];
  /** Destination paths agentc refused to touch because it doesn't own them. */
  conflicts: string[];
}

export function buildRoot(source: Source, adapter: Adapter): string {
  return join(resolve(source.root), ".agentc", "build", adapter.name);
}

/**
 * Compile every agent for one harness into the source repo's build folder, then
 * symlink the results into the harness's user-level folders.
 *
 * Ownership rule: agentc only ever touches symlinks that point into its own
 * build folder for this source and harness. Real files and foreign links are
 * reported as conflicts and left alone.
 */
export function installHarness(source: Source, adapter: Adapter, opts: InstallOptions = {}): HarnessReport {
  const report: HarnessReport = {
    harness: adapter.name,
    installed: [],
    skipped: [],
    warnings: [],
    linked: [],
    unchanged: [],
    pruned: [],
    conflicts: [],
  };

  if (!adapter.verified)
    report.warnings.push(
      `${adapter.label} adapter is UNVERIFIED: its output has not passed contract tests against the real harness, so restrictions are not proven yet`,
    );

  if (!opts.skipPreflight && adapter.preflight) {
    const problem = adapter.preflight();
    if (problem) {
      report.fatal = problem;
      return report;
    }
  }

  // 1. Build: compile into a fresh build folder.
  const build = buildRoot(source, adapter);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(join(build, adapter.managedDirs.agents), { recursive: true });
  mkdirSync(join(build, adapter.managedDirs.skills), { recursive: true });

  const neededSkills = new Set<string>();
  for (const agent of source.agents) {
    const result = adapter.compile(agent);
    for (const w of result.warnings) report.warnings.push(`${agent.name}: ${w}`);
    if (result.errors.length) {
      report.skipped.push({ agent: agent.name, reasons: result.errors });
      continue;
    }
    for (const f of result.files) {
      const out = join(build, f.path);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.content);
    }
    for (const s of agent.skills) neededSkills.add(s);
    report.installed.push(agent.name);
  }

  for (const name of neededSkills) {
    const skill = source.skills.get(name);
    if (skill) cpSync(skill.dir, join(build, adapter.managedDirs.skills, name), { recursive: true });
  }

  if (opts.dryRun) return report;

  // 2. Link built entries into the harness folders.
  const root = adapter.installRoot();
  for (const dir of [adapter.managedDirs.agents, adapter.managedDirs.skills]) {
    const from = join(build, dir);
    const to = join(root, dir);
    for (const entry of readdirSync(from)) linkEntry(join(from, entry), join(to, entry), build, report);
  }

  // 3. Prune links into our build folder whose target no longer exists (deleted agents/skills).
  for (const dir of [adapter.managedDirs.agents, adapter.managedDirs.skills]) {
    const to = join(root, dir);
    if (!existsSync(to)) continue;
    for (const entry of readdirSync(to)) {
      const dest = join(to, entry);
      const target = ownedTarget(dest, build);
      if (target && !existsSync(target)) {
        unlinkSync(dest);
        report.pruned.push(dest);
      }
    }
  }

  return report;
}

/** If `path` is a symlink into `build`, return its absolute target; otherwise null. */
function ownedTarget(path: string, build: string): string | null {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (!st.isSymbolicLink()) return null;
  const target = resolve(dirname(path), readlinkSync(path));
  return target.startsWith(build + sep) ? target : null;
}

function linkEntry(target: string, dest: string, build: string, report: HarnessReport) {
  let st;
  try {
    st = lstatSync(dest);
  } catch {
    st = null;
  }

  if (st) {
    const owned = ownedTarget(dest, build);
    if (!owned) {
      report.conflicts.push(dest);
      return;
    }
    if (owned === target) {
      report.unchanged.push(dest);
      return;
    }
    unlinkSync(dest);
  }

  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(target, dest);
  report.linked.push(dest);
}
