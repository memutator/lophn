// 예상 밖 종료의 backoff와 crash loop 판정. IO 없는 순수 규칙이다.

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 300_000;
const CRASH_WINDOW_MS = 600_000;
export const CRASH_LIMIT = 5;

export type UnexpectedExit = { atMs: number };

// 1초·2초·4초부터 두 배씩, 최대 5분. count는 지금까지의 예상 밖 종료 수다.
export function backoffMs(count: number): number {
  const exponent = Math.min(Math.max(count, 1) - 1, 30);
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
}

// 창 안의 종료만 남긴다. 창 밖 종료는 crash loop 판정에서 빠진다.
export function recentExits(
  exits: readonly UnexpectedExit[],
  nowMs: number,
): UnexpectedExit[] {
  return exits.filter((exit) => nowMs - exit.atMs < CRASH_WINDOW_MS);
}

// 창 안에서 한도를 넘는 종료면 자동 재시작을 멈춘다.
export function crashLoop(
  exits: readonly UnexpectedExit[],
  nowMs: number,
): boolean {
  return recentExits(exits, nowMs).length > CRASH_LIMIT;
}
