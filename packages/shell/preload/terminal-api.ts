// shell renderer가 쓰는 터미널 통로. 채널 이름과 Electron event는 closure 안에만 있다.
// 출력은 renderer가 snapshot으로 당겨 읽는다. 터미널 출력을 다른 곳으로 보내지 않는다.
import {
  TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL,
  TERMINAL_AGENT_SESSIONS_CHANNEL,
  TERMINAL_BRIDGE_ACK_CHANNEL,
  TERMINAL_BRIDGE_OPEN_CHANNEL,
  TERMINAL_CLOSE_CHANNEL,
  TERMINAL_FOCUS_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_LINK_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_REVEAL_CHANNEL,
  TERMINAL_SNAPSHOT_CHANNEL,
  TERMINAL_STATE_CHANNEL,
  type TerminalAgentSessionsChanged,
  type TerminalApi,
  type TerminalBridgeOpen,
  type TerminalCall,
  type TerminalReveal,
  type TerminalRuntime,
} from "../ipc/terminal.ts";

interface TerminalTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

const unavailable = {
  ok: false as const,
  error: {
    code: "unavailable" as const,
    message: "Terminal transport is unavailable",
  },
};

// main이 보낸 runtime인지 모양만 본다. 값 검사는 main이 보낼 때 한다.
function isRuntime(value: unknown): value is TerminalRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { terminal_ref?: unknown }).terminal_ref === "string"
  );
}

function isBridgeOpen(value: unknown): value is TerminalBridgeOpen {
  if (typeof value !== "object" || value === null) return false;
  const open = value as Record<string, unknown>;
  return (
    typeof open.request === "string" &&
    typeof open.terminal_ref === "string" &&
    typeof open.url === "string"
  );
}

function isReveal(value: unknown): value is TerminalReveal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { terminal_ref?: unknown }).terminal_ref === "string"
  );
}

function isAgentSessionsChanged(
  value: unknown,
): value is TerminalAgentSessionsChanged {
  if (typeof value !== "object" || value === null) return false;
  const change = value as { project?: unknown; sessions?: unknown };
  return typeof change.project === "string" && Array.isArray(change.sessions);
}

export function createTerminalApi(transport: TerminalTransport): TerminalApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<TerminalCall<T>> {
    try {
      return (await transport.invoke(channel, input)) as TerminalCall<T>;
    } catch {
      return unavailable;
    }
  }
  return Object.freeze({
    open: (input) => invoke(TERMINAL_OPEN_CHANNEL, input),
    input: (input) => invoke(TERMINAL_INPUT_CHANNEL, input),
    resize: (input) => invoke(TERMINAL_RESIZE_CHANNEL, input),
    close: (input) => invoke(TERMINAL_CLOSE_CHANNEL, input),
    restart: (input) => invoke(TERMINAL_RESTART_CHANNEL, input),
    snapshot: (input) => invoke(TERMINAL_SNAPSHOT_CHANNEL, input),
    focus: (input) => invoke(TERMINAL_FOCUS_CHANNEL, input),
    openLink: (input) => invoke(TERMINAL_LINK_CHANNEL, input),
    ackBridgeOpen: (input) => invoke(TERMINAL_BRIDGE_ACK_CHANNEL, input),
    onBridgeOpen(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isBridgeOpen(payload)) listener(payload);
      };
      transport.on(TERMINAL_BRIDGE_OPEN_CHANNEL, callback);
      return () =>
        transport.removeListener(TERMINAL_BRIDGE_OPEN_CHANNEL, callback);
    },
    onReveal(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isReveal(payload)) listener(payload);
      };
      transport.on(TERMINAL_REVEAL_CHANNEL, callback);
      return () => transport.removeListener(TERMINAL_REVEAL_CHANNEL, callback);
    },
    onRuntime(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isRuntime(payload)) listener(payload);
      };
      transport.on(TERMINAL_STATE_CHANNEL, callback);
      return () => transport.removeListener(TERMINAL_STATE_CHANNEL, callback);
    },
    agentSessions: (input) => invoke(TERMINAL_AGENT_SESSIONS_CHANNEL, input),
    onAgentSessions(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isAgentSessionsChanged(payload)) listener(payload);
      };
      transport.on(TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL, callback);
      return () =>
        transport.removeListener(
          TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL,
          callback,
        );
    },
  } satisfies TerminalApi);
}
