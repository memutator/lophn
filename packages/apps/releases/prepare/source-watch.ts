// release 준비의 source watch(apps/releases#R3). 준비 도중 원본 변경을 감지한다.
// 도중 변화면 확정하지 않고 source_changed로 취소다.
import { err, ok, type Result } from "../../../base/mod.ts";

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
