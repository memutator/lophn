export const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
export const REGISTRY_DIR = new URL("../registry", import.meta.url).pathname;
export const RUNS_DIR = new URL("../runs", import.meta.url).pathname;
// 전체 기록. worktree 루트의 .dev-data다.
export const EVAL_DIR =
  new URL("../../../.dev-data/eval", import.meta.url).pathname;
