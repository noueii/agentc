#!/usr/bin/env bun
import { resolve } from "node:path";
import pkg from "../package.json";
import { ADAPTERS } from "./adapters";
import { type HarnessReport, installHarness } from "./install";
import { loadSource, type Problem } from "./spec";
import { HARNESSES, type Harness, isHarness } from "./vocab";

const HELP = `agentc ${pkg.version}: define coding agents once, install them natively into each harness.

Usage:
  agentc validate [--source <dir>]
  agentc install  [--source <dir>] [--harness <name>[,<name>]] [--dry-run] [--skip-preflight]

Options:
  --source <dir>      Agents repo (contains agents/ and skills/). Default: current directory.
  --harness <names>   ${HARNESSES.join(", ")}. Repeatable or comma-separated.
                      Default: every harness detected on this machine.
  --dry-run           Compile into the build folder but don't touch harness folders.
  --skip-preflight    Skip harness checks (e.g. pi's subagent extension).
  -h, --help          Show this help.
  -v, --version       Show the version.
`;

interface Args {
  command?: string;
  source: string;
  harnesses: Harness[];
  dryRun: boolean;
  skipPreflight: boolean;
}

function fail(msg: string): never {
  console.error(`agentc: ${msg}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { source: ".", harnesses: [], dryRun: false, skipPreflight: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => argv[++i] ?? fail(`${a} needs a value`);
    switch (a) {
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
      case "-v":
      case "--version":
        console.log(pkg.version);
        process.exit(0);
      case "--source":
        args.source = value();
        break;
      case "--harness":
        for (const h of value().split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!isHarness(h)) fail(`unknown harness "${h}" (known: ${HARNESSES.join(", ")})`);
          if (!args.harnesses.includes(h)) args.harnesses.push(h);
        }
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--skip-preflight":
        args.skipPreflight = true;
        break;
      default:
        if (a.startsWith("-")) fail(`unknown option ${a}`);
        if (args.command) fail(`unexpected argument ${a}`);
        args.command = a;
    }
  }
  return args;
}

function printProblems(problems: Problem[]) {
  for (const p of problems) console.error(`  ✗ ${p.file}: ${p.message}`);
}

function load(sourceDir: string) {
  const root = resolve(sourceDir);
  const { source, problems } = loadSource(root);
  return { root, source, problems };
}

function cmdValidate(args: Args): number {
  const { root, source, problems } = load(args.source);
  if (problems.length) {
    console.error(`${problems.length} problem(s) in ${root}:`);
    printProblems(problems);
    return 1;
  }
  console.log(`✓ ${source.agents.length} agent(s), ${source.skills.size} skill(s) valid in ${root}`);
  return 0;
}

function printReport(r: HarnessReport, dryRun: boolean) {
  const label = ADAPTERS[r.harness as Harness].label;
  console.log(`\n${label}`);
  if (r.fatal) {
    console.log(`  ✗ ${r.fatal}`);
    return;
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  for (const s of r.skipped) console.log(`  ✗ ${s.agent} not installed: ${s.reasons.join("; ")}`);
  for (const c of r.conflicts) console.log(`  ✗ conflict, not touched (not owned by agentc): ${c}`);
  if (dryRun) {
    console.log(`  · dry run: would install ${r.installed.length} agent(s): ${r.installed.join(", ") || "none"}`);
    return;
  }
  for (const p of r.pruned) console.log(`  - removed ${p}`);
  console.log(
    `  ✓ ${r.installed.length} agent(s) installed (${r.linked.length} linked, ${r.unchanged.length} unchanged, ${r.pruned.length} removed)`,
  );
}

function cmdInstall(args: Args): number {
  const { root, source, problems } = load(args.source);
  if (problems.length) {
    console.error(`Not installing: ${problems.length} problem(s) in ${root}:`);
    printProblems(problems);
    return 1;
  }

  let harnesses = args.harnesses;
  if (!harnesses.length) {
    harnesses = HARNESSES.filter((h) => ADAPTERS[h].detect());
    if (!harnesses.length) fail(`no supported harness detected; pass --harness (${HARNESSES.join(", ")})`);
  }

  let failed = false;
  for (const h of harnesses) {
    const report = installHarness(source, ADAPTERS[h], { dryRun: args.dryRun, skipPreflight: args.skipPreflight });
    printReport(report, args.dryRun);
    if (report.fatal || report.skipped.length || report.conflicts.length) failed = true;
  }
  return failed ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case "validate":
    process.exit(cmdValidate(args));
  case "install":
    process.exit(cmdInstall(args));
  case undefined:
    console.log(HELP);
    process.exit(0);
  default:
    fail(`unknown command "${args.command}" (try --help)`);
}
