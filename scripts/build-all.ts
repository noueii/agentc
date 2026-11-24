// Build standalone agentc binaries for every supported platform into dist/.
// Cross-compiling downloads the Bun runtime for each target on first use.
import { $ } from "bun";

const targets = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64", "bun-windows-x64"];

for (const target of targets) {
  const out = `dist/agentc-${target.replace("bun-", "")}`;
  console.log(`building ${out}`);
  await $`bun build src/cli.ts --compile --minify --target=${target} --outfile ${out}`;
}
