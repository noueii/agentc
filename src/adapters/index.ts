import type { Harness } from "../vocab";
import { claude } from "./claude";
import { omp } from "./omp";
import { opencode } from "./opencode";
import { pi } from "./pi";
import type { Adapter } from "./types";

export const ADAPTERS: Record<Harness, Adapter> = { claude, opencode, pi, omp };
export type { Adapter } from "./types";
