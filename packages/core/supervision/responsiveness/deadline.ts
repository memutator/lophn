// 기한은 주입된 Clock·sleep과 상관없이 실제 경과 시간(performance.now)으로 잰다.
// frozen 테스트 clock이나 끝나지 않는 sleep이 ready·stop·teardown 기한을 막지 못한다.
export type Deadline = { promise: Promise<"timeout">; cancel: () => void };

export function armTimer(ms: number): Deadline {
  const start = performance.now();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve: (value: "timeout") => void = () => {};
  const promise = new Promise<"timeout">((res) => {
    resolve = res;
  });
  const tick = () => {
    if (settled) return;
    const remaining = ms - (performance.now() - start);
    if (remaining <= 0) {
      settled = true;
      timer = undefined;
      resolve("timeout");
      return;
    }
    timer = setTimeout(tick, Math.min(remaining, 25));
  };
  timer = setTimeout(tick, Math.min(Math.max(ms, 0), 25));
  return {
    promise,
    cancel: () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

// work가 ms 안에 끝나면(성공이든 거절이든) true다. 어느 쪽이든 timer는 남기지 않는다.
export async function settledWithin(
  work: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  const timer = armTimer(ms);
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      timer.promise.then(() => false),
    ]);
  } finally {
    timer.cancel();
  }
}

// work가 ms 안에 값을 내면 그 값, 늦거나 던지면 fallback이다.
export async function valueWithin<T>(
  work: () => Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let running: Promise<T>;
  try {
    running = work();
  } catch {
    return fallback;
  }
  const timer = armTimer(ms);
  try {
    return await Promise.race([
      Promise.resolve(running).then(
        (value) => value,
        () => fallback,
      ),
      timer.promise.then(() => fallback),
    ]);
  } finally {
    timer.cancel();
  }
}

export function pause(ms: number): Promise<void> {
  return armTimer(ms).promise.then(() => {});
}
