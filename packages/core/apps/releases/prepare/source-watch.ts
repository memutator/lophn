// release 준비의 source watch(apps/releases#R3). 준비 도중 원본 변경을 감지한다.
// 도중 변화면 확정하지 않고 source_changed로 취소다. pin은 git HEAD와 지정 commit이다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { GitRunner } from "./git-extract.ts";

export type SourceWatch = {
  // 준비 시작 때의 pin. working tree 관측·commit object·경로 대조의 매개다.
  pinned: string;
  changedSince(): Promise<boolean>;
};

export type SourceWatchFailure = {
  code: "minor" | "source_changed";
};

// 준비 앞뒤의 pin 대조. pin은 준비 시작 때 한 번 고정한다.
export function pinSource(observed: string): string {
  return observed;
}

// 준비 도중과 끝의 pin이 다르면 source_changed다. 준비가 아닌 다른 원인은 모른다.
export function checkPin(
  pinned: string,
  observedNow: string,
): Result<{ changed: false }, { changed: true }> {
  return pinned === observedNow
    ? ok({ changed: false })
    : err({ changed: true });
}

export type WatchDeps = {
  // 준비 시작 때 관측한 pin.
  pinned: string;
  // 뒤의 관측. 준비 끝과 상한 check마다 부른다.
  observe(): Promise<string>;
};

// 감시값과 뒤의 관측을 대조한다. 저장 boundary 관측은 git runner가 한다.
export async function observeSourceChanged(
  deps: WatchDeps,
): Promise<boolean> {
  const observed = await deps.observe();
  return deps.pinned !== observed;
}

export type GitObservation = {
  head: string;
  commitPresent: boolean;
  dirty: boolean;
};

// HEAD·지정 commit 존재·working tree를 한 pin으로 묶는다.
export function observationPin(observed: GitObservation): string {
  return `${observed.head}\n${observed.commitPresent ? "commit" : "missing"}\n${
    observed.dirty ? "dirty" : "clean"
  }`;
}

async function gitText(
  git: GitRunner,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await git.run(args);
  if (!result.ok) return undefined;
  return new TextDecoder().decode(result.value).trim();
}

// 실제 git 관측. HEAD가 바뀌거나 commit이 사라지거나 working tree가 더러워지면 pin이 달라진다.
export async function observeGitSource(
  git: GitRunner,
  sourceRoot: string,
  commit: string,
): Promise<GitObservation | undefined> {
  const head = await gitText(git, ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (head === undefined) return undefined;
  const kind = await gitText(git, ["-C", sourceRoot, "cat-file", "-t", commit]);
  const status = await gitText(git, [
    "-C",
    sourceRoot,
    "status",
    "--porcelain",
  ]);
  if (status === undefined) return undefined;
  return {
    head,
    commitPresent: kind === "commit",
    dirty: status.length > 0,
  };
}

export function gitSourceWatch(
  git: GitRunner,
  sourceRoot: string,
  commit: string,
  pinned: string,
): SourceWatch {
  return {
    pinned,
    async changedSince() {
      const observed = await observeGitSource(git, sourceRoot, commit);
      if (observed === undefined) return true;
      return observationPin(observed) !== pinned;
    },
  };
}
