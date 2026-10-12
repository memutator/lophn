// context 변화 감지의 모양. 규칙의 뜻은 docs/architecture/documents.md 3.2 "따라잡기"와
// documents/contexts#R23이다. 신호는 "그 context를 다시 훑으라"는 힌트일 뿐이고 변화 기록·
// event·화면 상태를 만들지 않는다.
import type { Contract } from "../../../protocol/projects/mod.ts";

// Project 루트 기준 폴더("" = 루트). recursive가 아니면 그 폴더 바로 아래 파일만 가리킨다.
export type WatchFolder = {
  path: string;
  recursive: boolean;
};

// 감시 대상 context: 적용 판의 contract. 활성 context만 넘긴다(보관된 context는 넘기지 않는다).
export type ActiveContext = {
  context: string;
  contract: Contract;
};

export type TimerHandle = unknown;

// 시험이 바꿔 끼우는 timer. 시각은 읽지 않는다.
export type Timer = {
  set(ms: number, run: () => void): TimerHandle;
  clear(handle: TimerHandle): void;
};

export type ChangeDetectorDeps = {
  timer: Timer;
  // 합침 시간(ms). 첫 신호가 창을 연다. 기본 500.
  window_ms?: number;
  // 창이 닫힐 때 한 번. context id는 중복 없이 code unit 순이다.
  rescan(contexts: readonly string[]): void;
};

// apply가 알려 주는 감시 폴더의 차이. 어댑터가 그대로 열고 닫는다.
export type WatchDiff = {
  start: WatchFolder[];
  stop: WatchFolder[];
};

export type ChangeDetector = {
  // 활성 context 전체를 다시 받아 감시 폴더를 다시 정한다(판 적용·보관·보관 해제 뒤).
  // 더는 활성이 아닌 context의 대기 중 rescan은 버린다.
  apply(active: readonly ActiveContext[]): WatchDiff;
  // 지금 감시해야 할 폴더 전체(합친 것, 정렬됨).
  folders(): WatchFolder[];
  // file system 신호의 경로(Project 기준)들. 어느 context의 폴더에도 안 들면 아무것도 하지 않는다.
  signal(paths: readonly string[]): void;
  // 대기 중인 rescan을 버린다.
  close(): void;
};

// Deno.FsWatcher에서 어댑터가 쓰는 부분.
export type FsEventLike = {
  kind: string;
  paths: readonly string[];
};
export type FsWatcherLike = AsyncIterable<FsEventLike> & { close(): void };
export type WatchFs = (
  absolutePath: string,
  options: { recursive: boolean },
) => FsWatcherLike;
