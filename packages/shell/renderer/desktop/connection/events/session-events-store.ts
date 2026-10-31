// 열어 둔 대화 탭의 session별 agent event. event는 저장하지 않으니 처음과 ready 뒤에 session snapshot을
// 읽어 대기 요청을 맞추고, 그 사이 놓친 대화 기록은 대화가 read로 다시 읽는다. event는 탭이 열린 동안 log에
// 쌓고, 쓰는 쪽은 접은 개수 뒤만 `since`로 읽는다(delta가 초당 여럿 와도 배열을 복사하지 않는다).
import type {
  AgentEvent,
  SessionSnapshot,
} from "../../../../../protocol/events/mod.ts";
import type { EventClient } from "./client.ts";
import { readSessionSnapshots } from "./snapshots.ts";
import { createValueStore, syncOnReady } from "./store.ts";

export interface SessionEventsState {
  /** 이 session을 연 뒤 받은 agent event 수. */
  readonly count: number;
  /** `from`번째부터 이 state의 `count` 전까지. log는 탭이 열린 동안 남는다. */
  readonly since: (from: number) => readonly AgentEvent[];
  readonly status: "loading" | "live" | "reconnecting";
  /** ready 뒤 snapshot을 맞춘 횟수. 끊김 없이 다시 걸린 ready도 센다. */
  readonly synced: number;
  /** 마지막으로 읽은 session snapshot. 아직 못 읽었으면 null. */
  readonly snapshot: SessionSnapshot | null;
}

export const NO_SESSION_EVENTS: SessionEventsState = {
  count: 0,
  since: () => [],
  status: "loading",
  synced: 0,
  snapshot: null,
};

interface SessionEventsStore {
  get(): ReadonlyMap<string, SessionEventsState>;
  subscribe(listener: () => void): () => void;
  /** 대화 탭을 연다. 반환 함수가 닫는다. 같은 session을 여럿이 열어도 구독은 하나다. */
  open(session: string): () => void;
}

export function createSessionEventsStore(
  client: EventClient,
): SessionEventsStore {
  const state = createValueStore<ReadonlyMap<string, SessionEventsState>>(
    new Map(),
  );
  const opened = new Map<string, { count: number; stop: () => void }>();

  function update(session: string, patch: Partial<SessionEventsState>) {
    const current = state.get().get(session);
    if (!current) return;
    state.set(new Map(state.get()).set(session, { ...current, ...patch }));
  }

  function start(session: string) {
    state.set(new Map(state.get()).set(session, NO_SESSION_EVENTS));
    const log: AgentEvent[] = [];
    return client.subscribe(
      { session },
      syncOnReady({
        read: async () => {
          const snapshots = await readSessionSnapshots(client.core, [session]);
          return snapshots === null
            ? null
            : {
                snapshot: snapshots.find((s) => s.session === session) ?? null,
              };
        },
        replace: ({ snapshot }) => update(session, { snapshot }),
        apply: (event) => {
          if (!("session" in event) || !state.get().has(session)) return;
          log.push(event);
          const count = log.length;
          update(session, { count, since: (from) => log.slice(from, count) });
        },
        onStatus: (status) => {
          if (status === "synced") {
            update(session, {
              status: "live",
              synced: (state.get().get(session)?.synced ?? 0) + 1,
            });
          } else if (status === "disconnected") {
            update(session, { status: "reconnecting" });
          }
        },
      }),
    );
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    open(session) {
      let entry = opened.get(session);
      if (!entry) {
        entry = { count: 0, stop: start(session) };
        opened.set(session, entry);
      }
      entry.count++;
      const mine = entry;
      return () => {
        if (--mine.count > 0) return;
        mine.stop();
        opened.delete(session);
        const next = new Map(state.get());
        next.delete(session);
        state.set(next);
      };
    },
  };
}
