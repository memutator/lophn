// shell renderer가 쓰는 터미널 통로. 채널 이름과 Electron event는 closure 안에만 있다.
// 출력은 renderer가 snapshot으로 당겨 읽는다. 터미널 출력을 다른 곳으로 보내지 않는다.
import {
  TERMINAL_CLOSE_CHANNEL,
  TERMINAL_FOCUS_CHANNEL,
  TERMINAL_FOCUS_SESSION_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_SNAPSHOT_CHANNEL,
  TERMINAL_STATE_CHANNEL,
  type TerminalApi,
  type TerminalCall,
  type TerminalRuntime,
} from "../ipc/terminal.ts";

export interface TerminalTransport {
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
  return typeof value === "object" && value !== null &&
    typeof (value as { terminal_ref?: unknown }).terminal_ref === "string";
}

export function createTerminalApi(transport: TerminalTransport): TerminalApi {
  async function invoke<T>(
    channel: string,
    input: unknown,
  ): Promise<TerminalCall<T>> {
    try {
      return await transport.invoke(channel, input) as TerminalCall<T>;
    } catch {
      return unavailable;
    }
  }
  return Object.freeze(
    {
      open: (input) => invoke(TERMINAL_OPEN_CHANNEL, input),
      input: (input) => invoke(TERMINAL_INPUT_CHANNEL, input),
      resize: (input) => invoke(TERMINAL_RESIZE_CHANNEL, input),
      close: (input) => invoke(TERMINAL_CLOSE_CHANNEL, input),
      restart: (input) => invoke(TERMINAL_RESTART_CHANNEL, input),
      snapshot: (input) => invoke(TERMINAL_SNAPSHOT_CHANNEL, input),
      focus: (input) => invoke(TERMINAL_FOCUS_CHANNEL, input),
      focusSession: (input) => invoke(TERMINAL_FOCUS_SESSION_CHANNEL, input),
      onRuntime(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          if (isRuntime(payload)) listener(payload);
        };
        transport.on(TERMINAL_STATE_CHANNEL, callback);
        return () => transport.removeListener(TERMINAL_STATE_CHANNEL, callback);
      },
    } satisfies TerminalApi,
  );
}
