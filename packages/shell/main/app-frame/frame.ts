export interface FrameTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

// 취소된 callback이 timer adapter에서 늦게 와도 새 frame의 값을 읽지 못한다.
export function latestFrame<T>(timer: FrameTimer, apply: (value: T) => void) {
  let handle: unknown;
  let serial = 0;
  let pending: T | undefined;
  return {
    schedule(value: T) {
      pending = value;
      if (handle !== undefined) return;
      const token = ++serial;
      handle = timer.set(() => {
        if (token !== serial) return;
        handle = undefined;
        const value = pending;
        pending = undefined;
        if (value !== undefined) apply(value);
      }, 16);
    },
    cancel() {
      ++serial;
      if (handle !== undefined) timer.clear(handle);
      handle = undefined;
      pending = undefined;
    },
  };
}
