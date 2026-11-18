// component는 이 hook으로 store만 읽는다. event도 연결도 모른다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { TerminalRuntime } from "../../../../../protocol/coding-agent/terminals.ts";
import { TERMINAL_SESSION_PREFIX } from "../../../../../protocol/lophn-agent/session-tag.ts";
import type { EventClient } from "./client.ts";
import {
  type AcpUpdatesState,
  createAcpUpdatesStore,
  NO_ACP_UPDATES,
} from "./acp-updates-store.ts";
import { createSessionsStore, type SessionsState } from "./sessions-store.ts";
import { createUnseenStore, type UnseenState } from "./unseen-store.ts";
import { createWaitingStore, type WaitingState } from "./waiting-store.ts";

/** 기계 하나의 event 연결과 그 위의 store. 범위(`MachineScope`)가 기계마다 하나를 들고 context로 준다. */
export interface EventStores {
  readonly client: EventClient;
  readonly waiting: ReturnType<typeof createWaitingStore>;
  readonly sessions: ReturnType<typeof createSessionsStore>;
  readonly unseen: ReturnType<typeof createUnseenStore>;
  readonly acpUpdates: ReturnType<typeof createAcpUpdatesStore>;
  /**
   * store를 돌린다. 같은 기계의 범위가 여럿 서도(그 기계의 탭 여럿) 한 번만 돌고, 마지막으로 멈출 때 멈춘다.
   * 반환 함수가 멈춘다.
   */
  start(): () => void;
}

const EventsContext = createContext<EventStores | null>(null);

function useStores(): EventStores {
  const stores = useContext(EventsContext);
  if (!stores) throw new Error("EventsProvider is missing");
  return stores;
}

/** 창의 터미널 탭 store. 탭 점이 쓰도록 못 본 터미널(`term:<탭>`의 탭)을 넣어 주고, 대기 목록이 core가 알린 runtime을 듣는다. */
export interface UnseenTerminals {
  noteUnseen(terminalRefs: ReadonlySet<string>): void;
  onRuntime(listener: (runtime: TerminalRuntime) => void): () => void;
}

/** event 연결 하나 위에 store를 짓는다. 터미널 탭이 있는 기계는 `terminals`를 준다. */
export function createEventStores(
  client: EventClient,
  terminals?: UnseenTerminals,
): EventStores {
  const unseen = createUnseenStore(client);
  const waiting = createWaitingStore(
    client,
    () => new Date().toISOString(),
    terminals ?? null,
    unseen,
  );
  const sessions = createSessionsStore(client, unseen);
  let users = 0;
  let stop: (() => void) | null = null;
  function run(): () => void {
    const stops = [waiting.start(), sessions.start(), unseen.start()];
    if (terminals !== undefined) {
      const note = () => terminals.noteUnseen(unseenTerminalRefs(unseen.get()));
      note();
      stops.push(unseen.subscribe(note));
    }
    return () => stops.forEach((one) => one());
  }
  return {
    client,
    waiting,
    sessions,
    unseen,
    acpUpdates: createAcpUpdatesStore(client),
    start() {
      if (users++ === 0) stop = run();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        if (--users === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
}

/**
 * store를 context로 준다. 지은 `stores`를 받거나(desktop의 기계 범위) event 연결로 여기서 짓는다(폰, gallery).
 * 마운트한 동안 store가 돈다.
 */
export function EventsProvider(
  props: { children: ReactNode } & (
    | { stores: EventStores }
    | { client: EventClient; terminals?: UnseenTerminals }
  ),
) {
  const given = "stores" in props ? props.stores : null;
  const client = "client" in props ? props.client : null;
  const terminals = "client" in props ? props.terminals : undefined;
  const stores = useMemo(
    () => given ?? createEventStores(client!, terminals),
    [given, client, terminals],
  );
  useEffect(() => stores.start(), [stores]);
  return (
    <EventsContext.Provider value={stores}>
      {props.children}
    </EventsContext.Provider>
  );
}

export function useWaiting(): WaitingState {
  const { waiting } = useStores();
  return useSyncExternalStore(waiting.subscribe, waiting.get);
}

export function useSessions(): SessionsState {
  const { sessions } = useStores();
  return useSyncExternalStore(sessions.subscribe, sessions.get);
}

export function useUnseen(): UnseenState {
  const { unseen } = useStores();
  return useSyncExternalStore(unseen.subscribe, unseen.get);
}

/** 못 본 끝을 열지 않고 지운다(알림 panel의 Finished 줄 [x]). */
export function useDismissUnseen(): (session: string) => void {
  return useStores().unseen.dismiss;
}

function unseenTerminalRefs(state: UnseenState): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const session of state.marks.keys()) {
    if (session.startsWith(TERMINAL_SESSION_PREFIX)) {
      refs.add(session.slice(TERMINAL_SESSION_PREFIX.length));
    }
  }
  return refs;
}

export function useAcpUpdates(session: string): AcpUpdatesState {
  const { acpUpdates } = useStores();
  useEffect(() => acpUpdates.open(session), [acpUpdates, session]);
  const get = useCallback(
    () => acpUpdates.get().get(session) ?? NO_ACP_UPDATES,
    [acpUpdates, session],
  );
  return useSyncExternalStore(acpUpdates.subscribe, get);
}

/** provider가 없는 자리(wireframes gallery, 테스트)에서는 null이다. 없어도 그려야 하는 쪽이 쓴다. */
export function useOptionalEventClient(): EventClient | null {
  return useContext(EventsContext)?.client ?? null;
}

/** store 없이 event를 직접 듣는 쪽(toast 호스트)이 쓴다. */
export function useEventClient(): EventClient {
  return useStores().client;
}
