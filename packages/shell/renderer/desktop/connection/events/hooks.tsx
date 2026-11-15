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

interface Stores {
  readonly client: EventClient;
  readonly waiting: ReturnType<typeof createWaitingStore>;
  readonly sessions: ReturnType<typeof createSessionsStore>;
  readonly unseen: ReturnType<typeof createUnseenStore>;
  readonly acpUpdates: ReturnType<typeof createAcpUpdatesStore>;
}

const EventsContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(EventsContext);
  if (!stores) throw new Error("EventsProvider is missing");
  return stores;
}

/** 창의 터미널 탭 store. 탭 점이 쓰도록 못 본 터미널(`term:<탭>`의 탭)을 넣어 준다. */
export interface UnseenTerminals {
  noteUnseen(terminalRefs: ReadonlySet<string>): void;
}

/** 창마다 한 번 마운트한다. */
export function EventsProvider({
  client,
  terminals,
  children,
}: {
  client: EventClient;
  terminals?: UnseenTerminals;
  children: ReactNode;
}) {
  const stores = useMemo<Stores>(() => {
    const unseen = createUnseenStore(client);
    return {
      client,
      waiting: createWaitingStore(
        client,
        () => new Date().toISOString(),
        (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null,
        unseen,
      ),
      sessions: createSessionsStore(client, unseen),
      unseen,
      acpUpdates: createAcpUpdatesStore(client),
    };
  }, [client]);
  useEffect(() => {
    const stops = [
      stores.waiting.start(),
      stores.sessions.start(),
      stores.unseen.start(),
    ];
    return () => stops.forEach((stop) => stop());
  }, [stores]);
  useEffect(() => {
    if (terminals === undefined) return;
    const note = () =>
      terminals.noteUnseen(unseenTerminalRefs(stores.unseen.get()));
    note();
    return stores.unseen.subscribe(note);
  }, [stores, terminals]);
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
