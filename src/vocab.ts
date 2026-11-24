// agentc's own tool vocabulary. Agent specs use these names; adapters map
// them to each harness's native tool names.
//
// There is deliberately no `bash`: a shell makes any file-level allowlist
// meaningless (`sed -i` is an edit), so restricted agents never get one.

export const TOOLS = [
  "read", // read files
  "write", // create / overwrite files
  "edit", // edit existing files
  "grep", // search file contents
  "glob", // find files by pattern
  "list", // list directory contents
  "webfetch", // fetch a URL
  "websearch", // web search
  "todo", // task / todo list tool
  "task", // spawn further subagents
] as const;

export type Tool = (typeof TOOLS)[number];

export const HARNESSES = ["claude", "opencode", "pi", "omp"] as const;
export type Harness = (typeof HARNESSES)[number];

export function isTool(x: string): x is Tool {
  return (TOOLS as readonly string[]).includes(x);
}

export function isHarness(x: string): x is Harness {
  return (HARNESSES as readonly string[]).includes(x);
}
