// shell renderer가 쓰는 터미널 통로. 채널 이름과 Electron event는 closure 안에만 있다. 터미널 출력과 runtime은 core event로
// 오고 이 통로에 없다.
import {
  TERMINAL_COPY_CHANNEL,
  TERMINAL_FOCUS_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_LINK_CHANNEL,
  TERMINAL_PASTE_CHANNEL,
  TERMINAL_PASTE_IMAGE_CHANNEL,
  TERMINAL_RESPONSE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_REVEAL_CHANNEL,
  TERMINAL_SHOWN_CHANNEL,
  TERMINAL_TRACE_CHANNEL,
  type TerminalApi,
  type TerminalCall,
  type TerminalReveal,
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
    code: "unavailable",
    message: "Terminal transport is unavailable",
  },
};

function isReveal(value: unknown): value is TerminalReveal {
  if (typeof value !== "object" || value === null) return false;
  const reveal = value as { terminal?: unknown; project?: unknown };
  return (
    typeof reveal.terminal === "string" && typeof reveal.project === "string"
  );
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
    input: (input) => invoke(TERMINAL_INPUT_CHANNEL, input),
    respond: (input) => invoke(TERMINAL_RESPONSE_CHANNEL, input),
    restart: (input) => invoke(TERMINAL_RESTART_CHANNEL, input),
    focus: (input) => invoke(TERMINAL_FOCUS_CHANNEL, input),
    shown: (input) => invoke(TERMINAL_SHOWN_CHANNEL, input),
    openLink: (input) => invoke(TERMINAL_LINK_CHANNEL, input),
    copy: (input) => invoke(TERMINAL_COPY_CHANNEL, input),
    paste: () => invoke(TERMINAL_PASTE_CHANNEL, null),
    pasteImage: (input) => invoke(TERMINAL_PASTE_IMAGE_CHANNEL, input),
    trace: (input) => invoke(TERMINAL_TRACE_CHANNEL, input),
    onReveal(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isReveal(payload)) listener(payload);
      };
      transport.on(TERMINAL_REVEAL_CHANNEL, callback);
      return () => transport.removeListener(TERMINAL_REVEAL_CHANNEL, callback);
    },
  } satisfies TerminalApi);
}
