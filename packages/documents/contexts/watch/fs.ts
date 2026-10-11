import type { ChangeDetector, WatchDiff, WatchFs } from "./types.ts";

export type FsWatch = {
  // 감시 폴더의 차이를 반영한다(열고 닫는다).
  update(diff: WatchDiff): void;
  // 모든 watcher를 닫는다.
  close(): void;
};

// 얇은 Deno.watchFs 어댑터. 폴더마다 watcher 하나를 `join(root, folder)`에 `recursive` 그대로 열고,
// `access`를 뺀 event의 경로를 root 기준 상대 경로(`/` 구분)로 바꿔 detector.signal에 넘긴다.
// event를 저장하지 않고, watcher가 오류로 끝나면 그 폴더만 닫는다(힌트를 놓칠 뿐이다).
// watchFs는 시험이 바꿔 끼운다(제품은 Deno.watchFs).
export function startFsWatch(
  _options: { root: string; detector: ChangeDetector; watchFs: WatchFs },
): FsWatch {
  throw new Error("not implemented");
}
