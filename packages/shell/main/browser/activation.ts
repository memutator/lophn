// 사용자 입력 활동 기록. 인터넷 page가 입력 없이 popup·dialog를 띄우지 못하게 하는 창이다.
export const ACTIVATION_WINDOW_MS = 5000;

/** 시각은 인자다. shell은 packages/base의 Clock을 import하지 못한다. */
export function createActivation(clock: { nowMs(): number }) {
  const last = new Map<number, number>();
  return {
    mark(contentsId: number): void {
      last.set(contentsId, clock.nowMs());
    },
    fresh(contentsId: number): boolean {
      const at = last.get(contentsId);
      if (at === undefined) return false;
      const age = clock.nowMs() - at;
      return age >= 0 && age < ACTIVATION_WINDOW_MS;
    },
    forget(contentsId: number): void {
      last.delete(contentsId);
    },
  };
}
