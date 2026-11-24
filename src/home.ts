import { homedir } from "node:os";

/** The user's home folder. Reads HOME first: Bun caches os.homedir(), so it ignores HOME changes at runtime. */
export function home(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}
