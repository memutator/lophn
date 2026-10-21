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
import type { TerminalApi } from "../../../../ipc/terminal.ts";
import type { EventClient } from "./client.ts";
import {
  createSessionEventsStore,
  NO_SESSION_EVENTS,
  type SessionEventsState,
} from "./session-events-store.ts";
import { createSessionsStore, type SessionsState } from "./sessions-store.ts";
import { createWaitingStore, type WaitingState } from "./waiting-store.ts";

interface Stores {
  readonly client: EventClient;
  readonly waiting: ReturnType<typeof createWaitingStore>;
  readonly sessions: ReturnType<typeof createSessionsStore>;
  readonly sessionEvents: ReturnType<typeof createSessionEventsStore>;
}

const EventsContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(EventsContext);
  if (!stores) throw new Error("EventsProvider is missing");
  return stores;
}

/** 창마다 한 번 마운트한다. */
export function EventsProvider(
  { client, children }: { client: EventClient; children: ReactNode },
) {
  const stores = useMemo<Stores>(() => ({
    client,
    waiting: createWaitingStore(
      client,
      () => new Date().toISOString(),
      (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null,
      { set: setTimeout, clear: clearTimeout },
    ),
    sessions: createSessionsStore(client),
    sessionEvents: createSessionEventsStore(client),
  }), [client]);
  useEffect(() => {
    const stops = [stores.waiting.start(), stores.sessions.start()];
    return () => stops.forEach((stop) => stop());
  }, [stores]);
  return (
    <EventsContext.Provider value={stores}>{children}</EventsContext.Provider>
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

export function useSessionEvents(session: string): SessionEventsState {
  const { sessionEvents } = useStores();
  useEffect(() => sessionEvents.open(session), [sessionEvents, session]);
  const get = useCallback(
    () => sessionEvents.get().get(session) ?? NO_SESSION_EVENTS,
    [sessionEvents, session],
  );
  return useSyncExternalStore(sessionEvents.subscribe, get);
}

/** store 없이 event를 직접 듣는 쪽(toast 호스트)이 쓴다. */
export function useEventClient(): EventClient {
  return useStores().client;
}
