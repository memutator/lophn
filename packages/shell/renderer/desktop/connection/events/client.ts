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
  let sentKey: string | null = null;
  // 서버의 ready로 확인된 조건 key. 이미 확인된 조건으로 새로 붙는 구독자는 다른 watch의 ready를 기다리지 않고 바로 읽는다.
  let confirmedKeys = new Set<string>();
  let watchQueued = false;
  // 연결된 상태에서 보낸 watch마다 그 조건 key 묶음. 서버가 watch 순서대로 ready를 답한다.
  let pendingWatches: Set<string>[] = [];
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
    sentKey = null;
    confirmedKeys.clear();
    pendingWatches = [];
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
      // 연결이 막 붙은 ready는 모두 다시 읽는다. 붙은 뒤의 ready는 watch의 답이라 확인된 조건의 미동기화 구독자만 읽는다.
      const first = !connected;
      connected = true;
      if (first) {
        confirmedKeys = new Set(mergedConditions().map(conditionKey));
        pendingWatches = [];
        for (const subscriber of [...subscribers]) {
          if (subscribers.has(subscriber)) ready(subscriber);
        }
        return;
      }
      const confirmed = pendingWatches.shift();
      confirmedKeys =
        confirmed ?? new Set(mergedConditions().map(conditionKey));
      for (const subscriber of [...subscribers]) {
        if (
          subscribers.has(subscriber) &&
          !subscriber.synced &&
          confirmedKeys.has(conditionKey(subscriber.condition))
        ) {
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
      const keys = new Set(conditions.map(conditionKey));
      const nextKey = JSON.stringify([...keys]);
      if (conditions.length > 0 && nextKey === sentKey) return;
      sentKey = conditions.length === 0 ? null : nextKey;
      const tracked = connected && conditions.length > 0 ? keys : null;
      if (tracked !== null) pendingWatches.push(tracked);
      core.watch?.(conditions)?.catch(() => {
        // watch 호출이 실패하면 대기열에서 빼서 다음 구독자를 막지 않는다. 끊겼다면 재연결 ready가 다시 맞춘다.
        if (tracked !== null) {
          const at = pendingWatches.indexOf(tracked);
          if (at !== -1) pendingWatches.splice(at, 1);
        }
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
      subscribers.add(subscriber);
      const condKey = conditionKey(condition);
      const nextKey = JSON.stringify(mergedConditions().map(conditionKey));
      if (nextKey !== sentKey) {
        queueWatch();
      }
      // 이미 서버가 확인한 조건(예: 다른 구독자가 이미 걸어 둔 StateChanged)이면 다른 watch의 ready를 기다리지 않고 바로 읽는다.
      if (connected && confirmedKeys.has(condKey)) {
        queueMicrotask(() => {
          if (subscribers.has(subscriber) && !subscriber.synced) {
            ready(subscriber);
          }
        });
      }
      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0) {
          stopCore?.();
          stopCore = null;
          connected = false;
          sentKey = null;
          confirmedKeys.clear();
          pendingWatches = [];
          queueWatch();
          return;
        }
        const afterKey = JSON.stringify(mergedConditions().map(conditionKey));
        if (afterKey !== sentKey) {
          queueWatch();
        }
      };
    },
  };
}
