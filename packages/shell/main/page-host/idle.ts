// page host가 열린 page 없이 쉬는 시간을 잰다. 열린 page가 하나도 없는 채로 `idleMs`가 지나면 끝낸다:
// page host가 `/host-link`를 쥐고 있으면 remote가 꺼진 기계의 core도 idle-exit하지 못한다.
// Electron을 import하지 않는다(test가 돈다).

/** 열린 page가 하나도 없는 채로 이만큼 지나면 page host가 끝난다. */
export const PAGE_HOST_IDLE_MS = 5 * 60_000;

export type Schedule = (fire: () => void, ms: number) => () => void;

export interface IdleWatch {
  /** 지금 열린 page 수를 알린다. 0이면 timer를 걸고(이미 걸려 있으면 그대로 둔다), 1 이상이면 취소한다. */
  setPages(count: number): void;
  /** 종료 때 남은 timer를 치운다. */
  stop(): void;
}

export function createIdleWatch(deps: {
  readonly idleMs?: number;
  readonly schedule: Schedule;
  readonly onIdle: () => void;
}): IdleWatch {
  const idleMs = deps.idleMs ?? PAGE_HOST_IDLE_MS;
  let cancel: (() => void) | null = null;
  let pages = 0;
  let stopped = false;

  const arm = () => {
    if (stopped || pages > 0 || cancel !== null) return;
    cancel = deps.schedule(() => {
      cancel = null;
      if (stopped || pages > 0) return;
      stopped = true;
      deps.onIdle();
    }, idleMs);
  };

  const disarm = () => {
    cancel?.();
    cancel = null;
  };

  // 뜨자마자 page가 0개이므로 바로 잰다(첫 tab_open이 실패하거나 오지 않아도 남지 않는다).
  arm();

  return {
    setPages(count) {
      pages = Math.max(0, count);
      if (pages > 0) disarm();
      else arm();
    },
    stop() {
      stopped = true;
      disarm();
    },
  };
}
