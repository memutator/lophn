// Coalesces rapid consecutive release updates so an open guest screen remounts once for the latest release instead of
// tearing down and starting a new Hermes runtime for each intermediate one. The first value (initial mount) and
// explicit immediate updates (such as Retry) apply right away with no delay.

export const GUEST_UPDATE_COALESCE_MS = 350;

export interface UpdateCoalescer<T> {
  /** Offers a new target value; the first value commits immediately, later updates settle for `delayMs`. */
  push(value: T): void;
  /** Cancels any pending update and clears committed state so the next `push` commits immediately (e.g. Retry). */
  reset(): void;
  /** Cancels any pending delayed update (call on unmount). */
  cancel(): void;
}

export function createUpdateCoalescer<T>(options: {
  delayMs?: number;
  onCommit: (value: T) => void;
  equals?: (a: T, b: T) => boolean;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}): UpdateCoalescer<T> {
  const delayMs = options.delayMs ?? GUEST_UPDATE_COALESCE_MS;
  const equals = options.equals ?? Object.is;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let hasCommitted = false;
  let committed!: T;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const stop = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    pending = null;
  };

  const commit = (value: T) => {
    stop();
    if (hasCommitted && equals(committed, value)) return;
    hasCommitted = true;
    committed = value;
    options.onCommit(value);
  };

  return {
    push(value) {
      if (!hasCommitted) {
        commit(value);
        return;
      }
      if (equals(committed, value)) {
        stop();
        return;
      }
      if (pending !== null && equals(pending.value, value)) return;
      stop();
      pending = { value };
      timer = setTimer(() => {
        const next = pending;
        timer = null;
        pending = null;
        if (next !== null) commit(next.value);
      }, delayMs);
    },
    reset() {
      stop();
      hasCommitted = false;
    },
    cancel: stop,
  };
}
