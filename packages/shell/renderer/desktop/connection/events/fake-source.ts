// gallery와 dev-mock이 쓰는 fake Gateway. CoreSource로 끼우고 시나리오를 손으로 흘린다.
import type { CoreEventMessage } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type {
  BusEvent,
  EventCondition,
  SessionSnapshot,
} from "../../../../../protocol/events/mod.ts";
import {
  busEventSchema,
  sessionSnapshotsList,
} from "../../../../../protocol/events/mod.ts";
import {
  type ActivationConsent,
  activationConsents,
} from "../../../../../protocol/apps/activation/consent.ts";
import {
  type ShareRequest,
  shareRequestList,
} from "../../../../../protocol/approvals/share-request.ts";
import {
  type Notice,
  noticesOpen,
} from "../../../../../protocol/apps/notice.ts";
import type { z } from "zod";
import type {
  MemoryRoute,
  ReadRoute,
} from "../../../../../protocol/base/route.ts";
import type { StateChange } from "../../../../../protocol/events/changes.ts";
import type { ConnectionState, CoreSource } from "../connection.ts";

/** route 하나의 답. gallery가 `fakeAnswer`로 만들어 snapshot의 answers에 넣는다. */
export interface FakeAnswer {
  readonly route: {
    readonly kind: string;
    readonly resource: string;
    readonly method: string;
  };
  answer(input: unknown): unknown;
}

/** read·memory route의 답. 값이거나 입력을 받아 값을 내는 함수다. */
export function fakeAnswer<I extends z.ZodType, O extends z.ZodType>(
  route: ReadRoute<I, O> | MemoryRoute<I, O>,
  value: z.output<O> | ((input: z.output<I>) => z.output<O>),
): FakeAnswer {
  return {
    route,
    answer: (input) =>
      typeof value === "function"
        ? (value as (input: z.output<I>) => z.output<O>)(input as z.output<I>)
        : value,
  };
}
import { matchesCondition } from "./client.ts";

/** 다시 붙을 때 read가 돌려줄 지금 상태. */
interface FakeSnapshot {
  readonly snapshots: readonly SessionSnapshot[];
  readonly consents: readonly ActivationConsent[];
  readonly shares?: readonly ShareRequest[];
  readonly notices?: readonly Notice[];
  /** 위 넷 밖의 read·memory route 답. 같은 route가 여럿이면 앞의 것이다. */
  readonly answers?: readonly FakeAnswer[];
}

export interface FakeSource extends CoreSource {
  /** Gateway가 보낸 메시지를 그대로 흘린다. 걸린 조건에 안 맞는 event는 버린다. */
  emit(message: CoreEventMessage): void;
  emitEvent(event: BusEvent): void;
  /** 연결이 끊긴다(stale). 다시 붙기 전까지 read는 unavailable이다. */
  disconnect(): void;
  /** 다시 붙고, 조건을 다시 건 것처럼 ready를 민다. 이 뒤의 read는 이 snapshot을 돌려준다. */
  reconnect(snapshot: FakeSnapshot): void;
  /** 지금 걸린 조건. */
  watched(): readonly EventCondition[];
}

const EMPTY: FakeSnapshot = { snapshots: [], consents: [] };
const COMMON = { as_of_seq: "0", next_cursor: null };

export function createFakeSource(initial: FakeSnapshot = EMPTY): FakeSource {
  let snapshot = initial;
  let state: ConnectionState = { state: "ready", confirmedAt: 0 };
  let conditions: readonly EventCondition[] = [];
  const stateListeners = new Set<(state: ConnectionState) => void>();
  const eventListeners = new Set<(message: CoreEventMessage) => void>();

  function setState(next: ConnectionState) {
    state = next;
    for (const listener of [...stateListeners]) listener(next);
  }

  function emit(message: CoreEventMessage) {
    if (message.kind === "event") {
      const parsed = busEventSchema.safeParse(message.event);
      if (
        parsed.success &&
        !conditions.some((c) => matchesCondition(c, parsed.data))
      )
        return;
    }
    for (const listener of [...eventListeners]) listener(message);
  }

  return {
    subscribe(listener) {
      stateListeners.add(listener);
      listener(state);
      return () => {
        stateListeners.delete(listener);
      };
    },
    current: () => state,
    call(input): Promise<CoreReply> {
      const unavailable = {
        ok: false,
        error: { code: "unavailable", message: "fake gateway" },
      };
      if (state.state !== "ready") return Promise.resolve(unavailable);
      const found = snapshot.answers?.find(
        ({ route }) =>
          route.kind === input.kind &&
          route.resource === input.resource &&
          route.method === input.method,
      );
      if (found) {
        return Promise.resolve({ ok: true, value: found.answer(input.body) });
      }
      if (input.kind !== "read") return Promise.resolve(unavailable);
      if (
        input.resource === sessionSnapshotsList.resource &&
        input.method === sessionSnapshotsList.method
      ) {
        const wanted = (input.body as { sessions?: string[] } | undefined)
          ?.sessions;
        return Promise.resolve({
          ok: true,
          value: {
            ...COMMON,
            snapshots: snapshot.snapshots.filter(
              (s) => !wanted || wanted.includes(s.session),
            ),
          },
        });
      }
      if (
        input.resource === activationConsents.resource &&
        input.method === activationConsents.method
      ) {
        return Promise.resolve({
          ok: true,
          value: { ...COMMON, consents: snapshot.consents },
        });
      }
      if (
        input.resource === shareRequestList.resource &&
        input.method === shareRequestList.method
      ) {
        return Promise.resolve({
          ok: true,
          value: { ...COMMON, requests: snapshot.shares ?? [] },
        });
      }
      if (
        input.resource === noticesOpen.resource &&
        input.method === noticesOpen.method
      ) {
        return Promise.resolve({
          ok: true,
          value: { ...COMMON, notices: snapshot.notices ?? [] },
        });
      }
      return Promise.resolve(unavailable);
    },
    watch(next) {
      conditions = next;
      // 조건이 걸리면 Gateway가 ready를 보낸다.
      if (state.state === "ready") {
        queueMicrotask(() => emit({ kind: "ready" }));
      }
      return Promise.resolve();
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    emit,
    emitEvent: (event) => emit({ kind: "event", event }),
    disconnect: () => setState({ state: "stale", confirmedAt: 0 }),
    reconnect(next) {
      snapshot = next;
      setState({ state: "ready", confirmedAt: 0 });
      emit({ kind: "ready" });
    },
    watched: () => conditions,
  };
}

/** fake 쓰기가 바뀐 것을 알리는 구독. 해제는 반환 함수다. */
export type StateChanges = (
  listener: (changes: StateChange[]) => void,
) => () => void;

/** answers를 먼저 보고 없으면 원래 연결로 간다. changes가 알리는 것은 `StateChanged`로 흘린다. */
export function answering(
  answers: readonly FakeAnswer[],
  ...changes: StateChanges[]
): (source: CoreSource) => CoreSource {
  return (source) => ({
    ...source,
    call(input) {
      const found = answers.find(
        ({ route }) =>
          route.kind === input.kind &&
          route.resource === input.resource &&
          route.method === input.method,
      );
      return found
        ? Promise.resolve({ ok: true, value: found.answer(input.body) })
        : source.call(input);
    },
    onEvent(listener: (message: CoreEventMessage) => void) {
      const stopInner = source.onEvent?.(listener) ?? (() => {});
      const stops = changes.map((subscribe) =>
        subscribe((list) =>
          listener({
            kind: "event",
            event: {
              type: "StateChanged",
              subject: null,
              at: new Date().toISOString(),
              payload: { changes: list },
            },
          }),
        ),
      );
      return () => {
        stopInner();
        for (const stop of stops) stop();
      };
    },
  });
}
