import { dirname } from "node:path";

export const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
export const REGISTRY_DIR = new URL("../registry", import.meta.url).pathname;
export const RUNS_DIR = new URL("../runs", import.meta.url).pathname;
// 전체 기록. worktree 루트의 .dev-data다.
export const EVAL_DIR =
  new URL("../../../.dev-data/eval", import.meta.url).pathname;

// 짧은 전용 폴더. unix socket 경로가 108자를 넘지 않고, 사람이 Claude Code에서 한 번 신뢰하면 그 아래 trial 폴더마다 folder trust가 안 뜬다.
const EVAL_TMP = "/tmp/lophn-eval";

// 사람이 hook을 개발 형태로 한 번 설치하는 checkout. worktree가 아니라 주 checkout이다(worktree는 지워진다).
export async function mainCheckout(): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: REPO_ROOT,
    stdout: "piped",
  }).output();
  return dirname(new TextDecoder().decode(out.stdout).trim());
}

// 새 폴더마다 Claude Code가 folder trust를 묻는다. 사람이 TMPDIR를 정했으면 건드리지 않는다.
export async function useEvalTmp(): Promise<void> {
  if (Deno.env.get("TMPDIR")) return;
  const made = await Deno.stat(EVAL_TMP).then(() => false, () => true);
  await Deno.mkdir(EVAL_TMP, { recursive: true });
  Deno.env.set("TMPDIR", EVAL_TMP);
  if (made) {
    console.log(
      `${EVAL_TMP}를 만들었다. Claude Code에서 이 폴더를 한 번 열어 신뢰한다(그 아래 trial 폴더에는 folder trust 질문이 안 뜬다)`,
    );
  }
}
