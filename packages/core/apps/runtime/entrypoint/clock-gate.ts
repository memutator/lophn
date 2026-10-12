// 준비 모드의 시계. accepting 전에는 업무 시각을 열지 않는다.
import type { Clock } from "@lophn/base";

export type GatedClock = Clock & { readonly open: boolean };

export function gateClock(clock: Clock, accepting: () => boolean): GatedClock {
  return {
    get open() {
      return accepting();
    },
    now() {
      if (!accepting()) throw new Error("clock is closed until open");
      return clock.now();
    },
    nowMs() {
      if (!accepting()) throw new Error("clock is closed until open");
      return clock.nowMs();
    },
  };
}
