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
  approvalsPending,
  type PendingApproval,
} from "../../../../../protocol/approvals/mod.ts";
import type { ConnectionState, CoreSource } from "../connection.ts";
import { matchesCondition } from "./client.ts";

/** 다시 붙을 때 read가 돌려줄 지금 상태. */
interface FakeSnapshot {
  readonly snapshots: readonly SessionSnapshot[];
  readonly approvals: readonly PendingApproval[];
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

const EMPTY: FakeSnapshot = { snapshots: [], approvals: [] };
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
      ) return;
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
      if (state.state !== "ready" || input.kind !== "read") {
        return Promise.resolve(unavailable);
      }
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
            snapshots: snapshot.snapshots.filter((s) =>
              !wanted || wanted.includes(s.session)
            ),
          },
        });
      }
      if (
        input.resource === approvalsPending.resource &&
        input.method === approvalsPending.method
      ) {
        return Promise.resolve({
          ok: true,
          value: { ...COMMON, requests: snapshot.approvals },
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
