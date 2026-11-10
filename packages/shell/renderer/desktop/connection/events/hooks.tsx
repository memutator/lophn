// component는 이 hook으로 store만 읽는다. event도 연결도 모른다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import type { TerminalApi } from "../../../../ipc/terminal.ts";
import type { EventClient } from "./client.ts";
import {
  type AcpUpdatesState,
  createAcpUpdatesStore,
  NO_ACP_UPDATES,
} from "./acp-updates-store.ts";
import { createSessionsStore, type SessionsState } from "./sessions-store.ts";
import { createWaitingStore, type WaitingState } from "./waiting-store.ts";

interface Stores {
  readonly client: EventClient;
  readonly waiting: ReturnType<typeof createWaitingStore>;
  readonly sessions: ReturnType<typeof createSessionsStore>;
  readonly acpUpdates: ReturnType<typeof createAcpUpdatesStore>;
}

const EventsContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(EventsContext);
  if (!stores) throw new Error("EventsProvider is missing");
  return stores;
}

/** 창마다 한 번 마운트한다. */
export function EventsProvider({
  client,
  children,
}: {
  client: EventClient;
  children: ReactNode;
}) {
  const stores = useMemo<Stores>(
    () => ({
      client,
      waiting: createWaitingStore(
        client,
        () => new Date().toISOString(),
        (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null,
      ),
      sessions: createSessionsStore(
        client,
        (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice ?? null,
      ),
      acpUpdates: createAcpUpdatesStore(client),
    }),
    [client],
  );
  useEffect(() => {
    const stops = [stores.waiting.start(), stores.sessions.start()];
    return () => stops.forEach((stop) => stop());
  }, [stores]);
  return (
    <EventsContext.Provider value={stores}>{children}</EventsContext.Provider>
  );
}

/**
 * core의 설정이 바뀌면 부른다. 누가 바꿨는지 가리지 않는다(이 화면, `lophn settings set`, agent, 손으로 고친 file).
 * Gateway가 다시 붙었을 때도 부른다(끊긴 동안 놓쳤을 수 있다). 설정을 읽어 그리는 곳은 여기서 다시 읽는다.
 * EventsProvider 밖(event가 없는 화면)에서는 아무것도 하지 않는다.
 */
export function useSettingsChanged(listener: () => void): void {
  const client = useContext(EventsContext)?.client;
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(
    () =>
      client?.subscribe({ types: ["SettingsChanged"] }, (message) => {
        if (
          message.kind === "ready" ||
          (message.kind === "event" && message.event.type === "SettingsChanged")
        ) {
          latest.current();
        }
      }),
    [client],
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

/**
 * workflow instance가 바뀌었다는 신호만 듣는다. 끊긴 동안 놓친 것은 화면이 열릴 때와 Refresh에서 다시 읽어 맞춘다.
 */
export function useWorkflowChanges(
  onChange: (
    instance: string,
    payload: { project: string; workflow: string },
  ) => void,
): void {
  const client = useEventClient();
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(
    () =>
      client.subscribe({ types: ["WorkflowInstanceChanged"] }, (message) => {
        if (
          message.kind === "event" &&
          message.event.type === "WorkflowInstanceChanged"
        ) {
          latest.current(message.event.subject, message.event.payload);
        }
      }),
    [client],
  );
}

/**
 * job이나 job run이 바뀌었다는 신호만 듣는다. 끊긴 동안 놓친 것은 화면이 열릴 때와 기록을 다시 열 때 읽어 맞춘다.
 */
export function useJobChanges(onChange: () => void): void {
  const client = useEventClient();
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(
    () =>
      client.subscribe({ types: ["JobChanged"] }, (message) => {
        if (message.kind === "event" && message.event.type === "JobChanged") {
          latest.current();
        }
      }),
    [client],
  );
}
