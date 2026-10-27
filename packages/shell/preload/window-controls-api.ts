import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type WindowAction,
  type WindowControlReply,
  type WindowControlsApi,
  type WindowState,
} from "../ipc/window-controls.ts";

interface WindowControlsTransport {
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

// 동작 이름만 보낸다. 통로가 끊기면 unavailable이다.
export function createWindowControlsApi(
  transport: WindowControlsTransport,
): WindowControlsApi {
  async function call(action: WindowAction): Promise<WindowControlReply> {
    try {
      return (await transport.invoke(WINDOW_CONTROL_CHANNEL, {
        action,
      })) as WindowControlReply;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return Object.freeze({
    state: () => call("state"),
    minimize: () => call("minimize"),
    toggleMaximize: () => call("toggle-maximize"),
    close: () => call("close"),
    subscribe(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        const maximized = (payload as { maximized?: unknown } | null)
          ?.maximized;
        if (typeof maximized === "boolean") {
          listener({ maximized } satisfies WindowState);
        }
      };
      transport.on(WINDOW_STATE_CHANNEL, callback);
      return () => transport.removeListener(WINDOW_STATE_CHANNEL, callback);
    },
  } satisfies WindowControlsApi);
}
