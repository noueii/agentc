// Minimal frontmatter handling: parse with Bun's built-in YAML, emit with a
// small block-style serializer so generated files are predictable and diffable.

export interface Parsed {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(text: string): Parsed {
  const m = FENCE.exec(text);
  if (!m) throw new Error("missing frontmatter (file must start with a --- block)");
  const raw = Bun.YAML.parse(m[1] ?? "");
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { data: (raw ?? {}) as Record<string, unknown>, body: (m[2] ?? "").trim() };
}

type Value = string | number | boolean | Value[] | { [k: string]: Value };

function scalar(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  // Quote anything that YAML could misread (or that contains special chars).
  return /^[A-Za-z0-9_][A-Za-z0-9_\-./ ]*$/.test(v) &&
    !/^(true|false|null|yes|no|on|off|~)$/i.test(v) &&
    !/\s$/.test(v)
    ? v
    : JSON.stringify(v);
}

function emit(key: string, v: Value, indent: string, out: string[]) {
  const k = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
  if (Array.isArray(v)) {
    if (v.length === 0) return void out.push(`${indent}${k}: []`);
    out.push(`${indent}${k}:`);
    for (const item of v) {
      if (typeof item === "object") throw new Error("nested arrays/objects in lists are not supported");
      out.push(`${indent}  - ${scalar(item)}`);
    }
  } else if (typeof v === "object") {
    out.push(`${indent}${k}:`);
    for (const [ck, cv] of Object.entries(v)) emit(ck, cv, indent + "  ", out);
  } else {
    out.push(`${indent}${k}: ${scalar(v)}`);
  }
}

export function renderFrontmatter(
  data: Record<string, Value | undefined>,
  body: string,
  headerComment?: string,
): string {
  const out: string[] = ["---"];
  if (headerComment) for (const line of headerComment.split("\n")) out.push(`# ${line}`);
  for (const [k, v] of Object.entries(data)) if (v !== undefined) emit(k, v, "", out);
  out.push("---", "", body.trim(), "");
  return out.join("\n");
}

export type { Value };
