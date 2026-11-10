// 앱 view preload bridge(`lophnApp`)의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts의 `LophnAppCalls`·`LophnAppAgents`·`LophnAppSessions`).
import type {
  AgentCard,
  CallRow,
  CallSendInput,
  CallSent,
} from "./call-types.ts";
import type {
  SessionFilter,
  SessionInfo,
  SessionResult,
  SessionStatus,
} from "./session-types.ts";

export interface AppBridge {
  sessions?: {
    list(
      filter?: SessionFilter,
    ): Promise<SessionResult<{ sessions: SessionInfo[] }>>;
    status(session: string): Promise<SessionResult<SessionStatus>>;
    stop(session: string): Promise<SessionResult<{ stopped: boolean }>>;
    end(session: string): Promise<SessionResult<{ ended: boolean }>>;
  };
  calls?: {
    send(input: CallSendInput): Promise<SessionResult<CallSent>>;
    read(call: string): Promise<SessionResult<{ call: CallRow }>>;
    cancel(
      call: string,
      reason?: string,
    ): Promise<SessionResult<{ call: string; state: string }>>;
    list(session: string): Promise<SessionResult<{ calls: CallRow[] }>>;
  };
  agents?: {
    list(): Promise<SessionResult<{ agents: AgentCard[] }>>;
  };
  events?: {
    subscribe(
      source: string,
      event: string,
      listener: (payload: unknown) => void,
    ): () => void;
  };
}

export function appBridge(): AppBridge | undefined {
  return (globalThis as { lophnApp?: AppBridge }).lophnApp;
}

export const BRIDGE_UNAVAILABLE = {
  ok: false,
  error: { code: "unavailable", message: "app bridge is unavailable" },
} as const;
