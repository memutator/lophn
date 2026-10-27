// 창마다 하나. 구독자가 건 조건을 합쳐 CoreApi.watch로 통째로 걸고, main이 중계한 메시지를 조건이 맞는
// 구독자에게 한 번씩 나눠 준다. 읽기(snapshot)는 하지 않는다: 구독자가 ready를 받고 직접 읽는다.
import type { CoreEventMessage } from "../../../../ipc/core.ts";
import {
  type BusEvent,
  busEventSchema,
  type EventCondition,
} from "../../../../../protocol/events/mod.ts";
import type { ConnectionState, CoreSource } from "../connection.ts";

export type EventMessage =
  /** 조건이 걸렸다. 지금 상태를 snapshot으로 읽어 맞춘다. */
  | { kind: "ready" }
  | { kind: "event"; event: BusEvent }
  /** 끊겼다. 놓친 event가 있을 수 있으니 다음 ready 때 snapshot부터 다시 읽는다. */
  | { kind: "disconnected" };

export interface EventClient {
  /** snapshot 읽기에 쓰는 통로. */
  readonly core: CoreSource;
  subscribe(
    condition: EventCondition,
    onMessage: (message: EventMessage) => void,
  ): () => void;
}

/** 조건 일치 규칙은 eventConditionSchema 주석을 따른다. */
export function matchesCondition(
  condition: EventCondition,
  event: { readonly type: string; readonly session?: string },
): boolean {
  if (condition.session !== undefined && event.session !== condition.session) {
    return false;
  }
  return condition.types === undefined || condition.types.includes(event.type);
}

const DISCONNECTED: ReadonlySet<ConnectionState["state"]> = new Set([
  "stale",
  "failed",
  "failed-start",
  "failed-sandbox",
  "failed-schema",
]);

interface Subscriber {
  readonly condition: EventCondition;
  readonly onMessage: (message: EventMessage) => void;
}

function conditionKey(condition: EventCondition): string {
  return JSON.stringify({
    session: condition.session ?? null,
    types: condition.types ? [...condition.types].sort() : null,
  });
}

export function createEventClient(core: CoreSource): EventClient {
  const subscribers = new Set<Subscriber>();
  let connected = false;
  let appliedKey: string | null = null;
  let watchQueued = false;
  let stopCore: (() => void) | null = null;

  function mergedConditions(): EventCondition[] {
    const byKey = new Map<string, EventCondition>();
    for (const { condition } of subscribers) {
      byKey.set(conditionKey(condition), condition);
    }
    return [...byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, condition]) => condition);
  }

  function send(subscriber: Subscriber, message: EventMessage) {
    subscriber.onMessage(message);
  }

  function disconnect() {
    if (!connected) return;
    connected = false;
    for (const subscriber of [...subscribers]) {
      send(subscriber, { kind: "disconnected" });
    }
  }

  function receive(message: CoreEventMessage) {
    if (message.kind === "ready") {
      connected = true;
      for (const subscriber of [...subscribers]) {
        send(subscriber, { kind: "ready" });
      }
    } else if (message.kind === "closed") {
      disconnect();
    } else {
      const parsed = busEventSchema.safeParse(message.event);
      if (!parsed.success) {
        console.warn("dropped an event that is not a Bus event");
        return;
      }
      const event = parsed.data;
      for (const subscriber of [...subscribers]) {
        if (matchesCondition(subscriber.condition, event)) {
          send(subscriber, { kind: "event", event });
        }
      }
    }
  }

  // 한 render에서 구독이 여럿 생겨도 watch는 한 번만 건다.
  function queueWatch() {
    if (watchQueued) return;
    watchQueued = true;
    queueMicrotask(() => {
      watchQueued = false;
      const conditions = mergedConditions();
      appliedKey = JSON.stringify(conditions.map(conditionKey));
      core.watch?.(conditions)?.catch(() => {
        // 끊겼다면 main이 연결이 붙을 때 조건을 다시 걸고 ready를 민다.
      });
    });
  }

  function start() {
    const stopEvents = core.onEvent?.(receive) ?? (() => {});
    const stopState = core.subscribe((state) => {
      if (DISCONNECTED.has(state.state)) disconnect();
    });
    stopCore = () => {
      stopEvents();
      stopState();
    };
  }

  return {
    core,
    subscribe(condition, onMessage) {
      const subscriber: Subscriber = { condition, onMessage };
      if (subscribers.size === 0) start();
      const before = appliedKey;
      subscribers.add(subscriber);
      const key = JSON.stringify(mergedConditions().map(conditionKey));
      if (key !== before) {
        queueWatch();
      } else if (connected) {
        // 합친 조건이 그대로면 main이 ready를 다시 밀지 않으니 이 구독자만 읽게 한다.
        queueMicrotask(() => {
          if (subscribers.has(subscriber)) send(subscriber, { kind: "ready" });
        });
      }
      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0) {
          stopCore?.();
          stopCore = null;
          connected = false;
        }
        queueWatch();
      };
    },
  };
}
