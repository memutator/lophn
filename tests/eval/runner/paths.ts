import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
).replace(/[\\/]$/, "");
export const REGISTRY_DIR = fileURLToPath(
  new URL("../registry", import.meta.url),
);
export const RUNS_DIR = fileURLToPath(new URL("../runs", import.meta.url));
// 전체 기록. worktree 루트의 .dev-data다.
export const EVAL_DIR = fileURLToPath(
  new URL("../../../.dev-data/eval", import.meta.url),
);
