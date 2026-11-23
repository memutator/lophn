// flow `onEvent`의 비영속 메모리 구독 표다.
// ledger에 저장하지 않고 core 재시작 사이 event를 쌓아 두지도 않는다(job의 event 규칙과 일관).
import {
  allowAppEvent,
  allowSessionEvent,
  type EventReachChecker,
  type EventWorkspace,
} from "../events/mod.ts";

export type FlowEventSource =
  | { kind: "app"; app: string }
  | { kind: "session"; workspace?: EventWorkspace | string };

export type FlowEventDelivery = {
  subscriptionId: string;
  source: string;
  event: string;
  payload: unknown;
};

export type FlowEventSubscribeInput = {
  instance: string;
  project: string;
  source: FlowEventSource;
  event: string;
  // flow process가 보낸 subscription_id를 그대로 쓸 때 넘긴다. 비우면 registry가 발급한다.
  subscriptionId?: string;
  onEvent: (delivery: FlowEventDelivery) => void;
};

export type FlowAppEventInput = {
  // 발행 앱 id(`app_...`).
  app: string;
  // 표시용 source 이름(앱 slug). 없으면 `app`을 쓴다.
  source?: string;
  event: string;
  payload: unknown;
  // 이 event의 인과 앱 사슬.
  appChain?: readonly string[];
  // 이 event를 낳은 workflow instance 사슬(직접 tool 호출·세션 workflow_origin·상위 workflow 포함).
  originInstances?: readonly string[];
  // 다른 기계에서 온 event면 그 기계 id. flow onEvent는 이 기계 event만 받는다.
  machine?: string;
};

export type FlowSessionEventInput = {
  event: string;
  payload: unknown;
  session: {
    id: string;
    workspace: EventWorkspace | null;
    driven?: boolean;
  } | null;
};

export type FlowEventRegistryDeps = {
  reaches: EventReachChecker;
  isDrivenSession?: (sessionId: string) => boolean;
  onListenerError?: (info: {
    subscriptionId: string;
    instance: string;
    event: string;
    error: unknown;
  }) => void;
};

export type FlowEventRegistry = {
  subscribe(input: FlowEventSubscribeInput): string;
  unsubscribe(subscriptionId: string): boolean;
  unsubscribeInstance(instance: string): number;
  hasSessionSubscribers(): boolean;
  hasAppSubscribers(app: string, event: string): boolean;
  dispatchAppEvent(ev: FlowAppEventInput): number;
  dispatchSessionEvent(ev: FlowSessionEventInput): number;
  clear(): void;
};

type SubscriptionEntry = {
  id: string;
  instance: string;
  project: string;
  source: FlowEventSource;
  event: string;
  onEvent: (delivery: FlowEventDelivery) => void;
};

function matchesSessionWorkspace(
  filter: EventWorkspace | string | undefined,
  workspace: EventWorkspace | null,
): boolean {
  if (filter === undefined) return true;
  if (workspace === null) return false;
  if (typeof filter === "string") return workspace.id === filter;
  return workspace.kind === filter.kind && workspace.id === filter.id;
}

export function createFlowEventRegistry(
  deps: FlowEventRegistryDeps,
): FlowEventRegistry {
  let seq = 0;
  const byId = new Map<string, SubscriptionEntry>();
  const byInstance = new Map<string, Set<string>>();

  function removeEntry(subscriptionId: string): boolean {
    const existing = byId.get(subscriptionId);
    if (existing === undefined) return false;
    byId.delete(subscriptionId);
    const set = byInstance.get(existing.instance);
    if (set !== undefined) {
      set.delete(subscriptionId);
      if (set.size === 0) byInstance.delete(existing.instance);
    }
    return true;
  }

  function invoke(
    entry: SubscriptionEntry,
    delivery: FlowEventDelivery,
  ): boolean {
    if (!byId.has(entry.id)) return false;
    try {
      entry.onEvent(delivery);
    } catch (error) {
      deps.onListenerError?.({
        subscriptionId: entry.id,
        instance: entry.instance,
        event: delivery.event,
        error,
      });
    }
    return true;
  }

  return {
    subscribe(input) {
      const id = input.subscriptionId ?? `fsub_${++seq}`;
      // 같은 id로 다시 등록되면 이전 instance index를 정리해 중복을 남기지 않는다.
      if (byId.has(id)) removeEntry(id);
      const entry: SubscriptionEntry = {
        id,
        instance: input.instance,
        project: input.project,
        source: input.source,
        event: input.event,
        onEvent: input.onEvent,
      };
      byId.set(id, entry);
      let set = byInstance.get(input.instance);
      if (set === undefined) {
        set = new Set();
        byInstance.set(input.instance, set);
      }
      set.add(id);
      return id;
    },

    unsubscribe(subscriptionId) {
      return removeEntry(subscriptionId);
    },

    unsubscribeInstance(instance) {
      const set = byInstance.get(instance);
      if (set === undefined) return 0;
      const count = set.size;
      for (const id of set) byId.delete(id);
      byInstance.delete(instance);
      return count;
    },

    hasSessionSubscribers() {
      for (const entry of byId.values()) {
        if (entry.source.kind === "session") return true;
      }
      return false;
    },

    hasAppSubscribers(app, event) {
      for (const entry of byId.values()) {
        if (
          entry.source.kind === "app" &&
          entry.source.app === app &&
          entry.event === event
        ) {
          return true;
        }
      }
      return false;
    },

    dispatchAppEvent(ev) {
      // flow onEvent 계약에는 source machine 지정이 없어 다른 기계에서 온 event는 넘기지 않는다.
      if (ev.machine !== undefined) return 0;
      const source = ev.source ?? ev.app;
      let delivered = 0;
      for (const entry of [...byId.values()]) {
        if (entry.source.kind !== "app") continue;
        if (entry.source.app !== ev.app || entry.event !== ev.event) continue;
        const allowed = allowAppEvent({
          subscriberWorkspace: { kind: "project", id: entry.project },
          sourceApp: ev.app,
          appChain: ev.appChain,
          instanceChain: ev.originInstances,
          excludedInstance: entry.instance,
          reaches: deps.reaches,
        });
        if (!allowed) continue;
        if (
          invoke(entry, {
            subscriptionId: entry.id,
            source,
            event: ev.event,
            payload: ev.payload,
          })
        ) {
          delivered += 1;
        }
      }
      return delivered;
    },

    dispatchSessionEvent(ev) {
      const candidates = [...byId.values()].filter(
        (entry) => entry.source.kind === "session" && entry.event === ev.event,
      );
      if (candidates.length === 0) return 0;

      // 한 event에 여러 flow가 구독 중이어도 비사람 session 조회는 최대 한 번만 한다.
      let drivenCache: boolean | undefined;
      const isDrivenSession =
        deps.isDrivenSession === undefined
          ? undefined
          : (sessionId: string) => {
              if (drivenCache === undefined) {
                drivenCache = deps.isDrivenSession!(sessionId);
              }
              return drivenCache;
            };

      let delivered = 0;
      for (const entry of candidates) {
        if (entry.source.kind !== "session") continue;
        if (
          !matchesSessionWorkspace(
            entry.source.workspace,
            ev.session?.workspace ?? null,
          )
        ) {
          continue;
        }
        const allowed = allowSessionEvent({
          subscriberWorkspace: { kind: "project", id: entry.project },
          session: ev.session,
          reaches: deps.reaches,
          isDrivenSession,
        });
        if (!allowed) continue;
        if (
          invoke(entry, {
            subscriptionId: entry.id,
            source: "lophn",
            event: ev.event,
            payload: ev.payload,
          })
        ) {
          delivered += 1;
        }
      }
      return delivered;
    },

    clear() {
      byId.clear();
      byInstance.clear();
    },
  };
}
