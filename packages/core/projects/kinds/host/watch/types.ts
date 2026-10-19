// 변화 감지의 모양. 신호는 "그 project를 다시 훑으라"는 힌트일 뿐이고 변화 기록·event·화면 상태를 만들지
// 않는다.
import type { KindWatchFolder } from "../../../../../protocol/projects/mod.ts";

// project root 기준 폴더("" = root). recursive가 아니면 그 폴더 바로 아래 파일만 가리킨다.
export type WatchFolder = KindWatchFolder;

export type ActiveWatch = { key: string; folders: readonly WatchFolder[] };

export type TimerHandle = unknown;

export type Timer = {
  set(ms: number, run: () => void): TimerHandle;
  clear(handle: TimerHandle): void;
};

export type ChangeDetectorDeps = {
  timer: Timer;
  // 합침 시간(ms). 첫 신호가 창을 연다. 기본 500.
  window_ms?: number;
  // 창이 닫힐 때 한 번. key는 중복 없이 code unit 순이다.
  rescan(keys: readonly string[]): void;
};

// apply가 알려 주는 감시 폴더의 차이. 어댑터가 그대로 열고 닫는다.
export type WatchDiff = {
  start: WatchFolder[];
  stop: WatchFolder[];
};

export type ChangeDetector = {
  // 감시 대상 전체를 다시 받아 감시 폴더를 다시 정한다.
  apply(active: readonly ActiveWatch[]): WatchDiff;
  // file system 신호의 경로(root 기준)들. 어느 대상의 폴더에도 안 들면 아무것도 하지 않는다.
  signal(paths: readonly string[]): void;
  // 대기 중인 rescan을 버린다.
  close(): void;
};

// Deno.FsWatcher에서 어댑터가 쓰는 부분.
type FsEventLike = {
  kind: string;
  paths: readonly string[];
};
export type FsWatcherLike = AsyncIterable<FsEventLike> & { close(): void };
export type WatchFs = (
  absolutePath: string,
  options: { recursive: boolean },
) => FsWatcherLike;
