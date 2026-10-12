// core가 직접 돌리는 구독자(machine principal)가 event를 받는 길(platform/api#R5, ledger#R15).
// 바깥 구독자와 같은 session(createEventSession)을 쓰되 WebSocket 대신 함수 sink를 둔다.
// 그래서 같은 events/list 읽기를 지나고, 현재 credential 재검사와 event 공개 정책(owner)을
// 그대로 받는다. 이 구독자의 자격은 ledger에 기록된 core 내부 machine credential이다.
// token이 없어서 HTTP로 이 principal이 될 수 없다.
//
// 보장은 at-least-once다. 연결(session)이 닫히면 backoff 뒤 다시 열고, 열 때마다 onSubscribed가
// 불려 구독이 비어 있던 동안의 변화를 소비자가 snapshot read로 따라잡게 한다. event는 깨우는
// 신호이고 소비자가 payload로 상태를 만들지 않는다.
import type { Result } from "../../packages/base/mod.ts";
import {
  type EventEnvelope,
  type RequestContext,
} from "../../packages/protocol/platform/mod.ts";
import {
  createEventSession,
  type EventBackend,
  type EventSession,
} from "../../packages/platform/ledger/mod.ts";

export type InternalSubscriptionDeps = {
  // ledger credential 기록에 있는 core 내부 machine 자격. principal과 credential_ref가 같다.
  context: RequestContext;
  backend: EventBackend;
  // session을 dispatcher에 올린다. 돌려받은 함수로 뺀다.
  track(session: EventSession): () => void;
  // 구독이 (다시) 열린 직후에 부른다. 구독 전에 놓친 변화는 이 안의 snapshot read가 따라잡는다.
  onSubscribed?(): void | Promise<void>;
  onEvents(events: readonly EventEnvelope[]): void | Promise<void>;
  // 다시 여는 대기. 실패가 이어지면 두 배씩 늘어 maxRetryMs에서 멈춘다.
  retryMs?: number;
  maxRetryMs?: number;
};

export type InternalSubscription = {
  // 같은 session이 받는 event를 더 듣는다. 돌려받은 함수로 뺀다(시험·진단).
  listen(listener: (events: readonly EventEnvelope[]) => void): () => void;
  // 지금 열린 session 수(0 또는 1). 시험이 재구독을 기다릴 때 쓴다.
  readonly open: boolean;
  stop(): void;
};

type EventsFrame = { type?: unknown; events?: unknown };

export function openInternalSubscription(
  deps: InternalSubscriptionDeps,
): InternalSubscription {
  const listeners = new Set<(events: readonly EventEnvelope[]) => void>();
  const initial = deps.retryMs ?? 1_000;
  const ceiling = deps.maxRetryMs ?? 10_000;
  let delay = initial;
  let stopped = false;
  let session: EventSession | undefined;
  let untrack: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  function retry() {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, delay);
    delay = Math.min(delay * 2, ceiling);
  }

  function deliver(text: string) {
    let frame: EventsFrame;
    try {
      frame = JSON.parse(text) as EventsFrame;
    } catch {
      return;
    }
    if (frame.type !== "events" || !Array.isArray(frame.events)) return;
    const events = frame.events as EventEnvelope[];
    if (!events.length) return;
    for (const listener of [...listeners]) {
      try {
        listener(events);
      } catch { /* 듣는 쪽의 오류가 구독을 멈추지 않는다 */ }
    }
    void Promise.resolve().then(() => deps.onEvents(events)).catch(() =>
      undefined
    );
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const mine = ++generation;
    // 구독은 지금 head 다음부터다. 그 전 변화는 onSubscribed의 snapshot read가 본다.
    const current = await deps.backend.current(deps.context.credential_ref);
    if (stopped || mine !== generation) return;
    if (!current.ok) return retry();
    const head = await deps.backend.read(current.value, {
      position: "0",
      inclusive: false,
      limit: 1,
    });
    if (stopped || mine !== generation) return;
    if (!head.ok) return retry();
    const from = (BigInt(head.value.head_seq) + 1n).toString();
    // 열리는 도중(첫 catch-up)에 닫히면 session이 아직 변수에 없다. 그때는 다시 열기만 한다.
    let ended = false;
    const opened: Result<EventSession> = await createEventSession(
      deps.context,
      { type: "subscribe", from_seq: from, types: [], subjects: [] },
      deps.backend,
      {
        send(text) {
          if (mine === generation) deliver(text);
          return Promise.resolve();
        },
        close() {
          // 이 session이 닫혔다. 내가 연 것이 아직 현재일 때만 다시 연다.
          if (mine !== generation || stopped) return;
          ended = true;
          release();
          retry();
        },
      },
    );
    if (stopped || mine !== generation) {
      if (opened.ok) opened.value.close();
      return;
    }
    if (!opened.ok) return retry();
    if (ended) return;
    session = opened.value;
    untrack = deps.track(session);
    delay = initial;
    try {
      await deps.onSubscribed?.();
    } catch { /* 따라잡기 실패는 소비자가 스스로 다시 시도한다 */ }
  }

  function release() {
    untrack?.();
    untrack = undefined;
    session = undefined;
  }

  void connect();
  return {
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get open() {
      return session !== undefined;
    },
    stop() {
      stopped = true;
      generation++;
      clearTimeout(timer);
      timer = undefined;
      const closing = session;
      release();
      closing?.close();
    },
  };
}
