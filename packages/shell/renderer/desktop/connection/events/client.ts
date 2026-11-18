// 창마다 하나. 구독자가 건 조건을 합쳐 CoreApi.watch로 통째로 걸고, main이 중계한 메시지를 조건이 맞는
// 구독자에게 한 번씩 나눠 준다. 읽기(snapshot)는 하지 않는다: 구독자가 ready를 받고 직접 읽는다.
// 연결이 새로 붙은 뒤의 첫 ready는 모든 구독자에게 가고, 그 뒤의 ready(이 창이 건 watch의 답. main이 이 창에만 보낸다)는
// 아직 ready를 못 받은 구독자에게만 간다. 기존 구독자는 서버가 동기로 다시 구독해 event를 잃지 않는다.
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
  "failed-start",
  "failed-schema",
]);

interface Subscriber {
  readonly condition: EventCondition;
  readonly onMessage: (message: EventMessage) => void;
  /** 연결이 붙은 뒤 이 구독자의 조건이 걸렸다는 ready를 받았다. */
  synced: boolean;
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
  // 보낸 watch마다 그 ready를 기다리는 구독자. 서버가 watch 순서대로 ready를 답한다.
  let inflight: Subscriber[][] = [];
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
    inflight = [];
    for (const subscriber of [...subscribers]) {
      subscriber.synced = false;
      send(subscriber, { kind: "disconnected" });
    }
  }

  function ready(subscriber: Subscriber) {
    subscriber.synced = true;
    send(subscriber, { kind: "ready" });
  }

  function receive(message: CoreEventMessage) {
    if (message.kind === "ready") {
      // 연결이 막 붙은 ready는 모두 다시 읽는다. 붙은 뒤의 ready는 watch의 답이라 아직 맞추지 않은 구독자만 읽는다. 연결이 붙기
      // 전에 보낸 watch의 답은 답할 watch를 몰라도 맞춘 구독자에게 다시 가지 않는다(창이 뜰 때 읽기가 두 번 몰리지 않게).
      const first = !connected;
      const answered = first ? undefined : (inflight.shift() ?? []);
      connected = true;
      for (const subscriber of [...(answered ?? subscribers)]) {
        if (subscribers.has(subscriber) && (first || !subscriber.synced)) {
          ready(subscriber);
        }
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
      if (connected) {
        inflight.push([...subscribers].filter((one) => !one.synced));
      }
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
      const subscriber: Subscriber = { condition, onMessage, synced: false };
      if (subscribers.size === 0) start();
      const before = appliedKey;
      subscribers.add(subscriber);
      const key = JSON.stringify(mergedConditions().map(conditionKey));
      if (key !== before) {
        queueWatch();
      } else if (connected && !watchQueued) {
        // 합친 조건이 그대로면 main이 ready를 다시 밀지 않으니 이 구독자만 읽게 한다. 같은 조건을 건 watch의 ready가
        // 아직 오는 중이면 그 ready를 기다린다(서버가 아직 조건을 걸지 않았을 수 있다).
        const waiting = inflight.at(-1);
        if (waiting) waiting.push(subscriber);
        else {
          queueMicrotask(() => {
            if (subscribers.has(subscriber)) ready(subscriber);
          });
        }
      }
      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0) {
          stopCore?.();
          stopCore = null;
          connected = false;
          inflight = [];
        }
        queueWatch();
      };
    },
  };
}
