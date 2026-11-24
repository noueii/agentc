#!/usr/bin/env bun
import { resolve } from "node:path";
import pkg from "../package.json";
import { ADAPTERS } from "./adapters";
import { importAgents, importableHarnesses } from "./import";
import { type HarnessReport, installHarness } from "./install";
import { loadSource, type Problem } from "./spec";
import { HARNESSES, type Harness, isHarness } from "./vocab";

const HELP = `agentc ${pkg.version}: define coding agents once, install them natively into each harness.

Usage:
  agentc validate [--source <dir>]
  agentc install  [--source <dir>] [--harness <name>[,<name>]] [--dry-run] [--skip-preflight]
  agentc import   --harness <name> [--source <dir>] [--from <dir>] [--force] [--json]

Options:
  --source <dir>      Agents repo (contains agents/ and skills/). Default: current directory.
  --harness <names>   ${HARNESSES.join(", ")}. Repeatable or comma-separated.
                      Default: every harness detected on this machine.
  --dry-run           Compile into the build folder but don't touch harness folders.
  --skip-preflight    Skip harness checks (e.g. pi's subagent extension).
  --from <dir>        import: folder of native agents to convert. Default: the harness's user-level agents folder.
  --force             import: overwrite agents that already exist in the source repo.
  --json              import: print the report as JSON.
  -h, --help          Show this help.
  -v, --version       Show the version.
`;

interface Args {
  command?: string;
  source: string;
  harnesses: Harness[];
  dryRun: boolean;
  skipPreflight: boolean;
  from?: string;
  force: boolean;
  json: boolean;
}

function fail(msg: string): never {
  console.error(`agentc: ${msg}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { source: ".", harnesses: [], dryRun: false, skipPreflight: false, force: false, json: false };
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
      case "--from":
        args.from = value();
        break;
      case "--force":
        args.force = true;
        break;
      case "--json":
        args.json = true;
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

function cmdImport(args: Args): number {
  if (args.harnesses.length !== 1) fail(`import needs exactly one --harness (supported: ${importableHarnesses().join(", ")})`);
  const harness = args.harnesses[0]!;
  let report;
  try {
    report = importAgents(harness, { from: args.from, dest: args.source, force: args.force });
  } catch (e) {
    fail((e as Error).message);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Importing ${ADAPTERS[harness].label} agents from ${report.from} into ${report.dest}\n`);
    for (const a of report.agents) {
      const mark = a.status === "clean" ? "✓" : a.status === "needs-review" ? "!" : "·";
      console.log(`  ${mark} ${a.name}: ${a.status}${a.reason ? ` (${a.reason})` : ""}`);
      for (const i of a.issues) console.log(`      - ${i.message}`);
    }
    if (report.skillsCopied.length) console.log(`\n  copied skills: ${report.skillsCopied.join(", ")}`);
    const review = report.agents.filter((a) => a.status === "needs-review").length;
    console.log(
      `\n${report.agents.filter((a) => a.status === "clean").length} clean, ${review} need review, ` +
        `${report.agents.filter((a) => a.status === "skipped").length} skipped. Originals were not modified.`,
    );
    if (review) console.log(`Resolve the NEEDS REVIEW notes in each file, then run: agentc validate`);
  }
  return 0;
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case "validate":
    process.exit(cmdValidate(args));
  case "install":
    process.exit(cmdInstall(args));
  case "import":
    process.exit(cmdImport(args));
  case undefined:
    console.log(HELP);
    process.exit(0);
  default:
    fail(`unknown command "${args.command}" (try --help)`);
}
