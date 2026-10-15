// core가 직접 돌리는 구독자(machine principal) 자리.
import type { RequestContext } from "../../protocol/server/mod.ts";
import type { EventEnvelope } from "../../protocol/events/mod.ts";

// 옛 구독(ledger events/list 기반)은 Bus와 Gateway로 바뀌어 지워졌다. 이 구독은 event를 받지 않는
// 막힌 채로 남는다. 열릴 때 부르던 onSubscribed만 한 번 부르고, 쓰는 쪽은 주기 깨움으로 돈다.
// 쓰는 쪽(problems, ticket checker)을 Reactor로 바꾸는 단위가 이 file을 지운다.
export type InternalSubscriptionDeps = {
  context: RequestContext;
  // 구독이 (다시) 열린 직후에 부른다.
  onSubscribed?(): void | Promise<void>;
  onEvents(events: readonly EventEnvelope[]): void | Promise<void>;
  retryMs?: number;
  maxRetryMs?: number;
};

export type InternalSubscription = {
  listen(listener: (events: readonly EventEnvelope[]) => void): () => void;
  readonly open: boolean;
  stop(): void;
};

export function openInternalSubscription(
  deps: InternalSubscriptionDeps,
): InternalSubscription {
  const listeners = new Set<(events: readonly EventEnvelope[]) => void>();
  let stopped = false;
  void Promise.resolve().then(async () => {
    if (stopped) return;
    try {
      await deps.onSubscribed?.();
    } catch { /* 따라잡기 실패는 소비자가 스스로 다시 시도한다 */ }
  });
  return {
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: false,
    stop() {
      stopped = true;
    },
  };
}
