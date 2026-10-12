import {
  APP_SHORTCUT_ADD_CHANNEL,
  APP_SHORTCUT_REMOVE_CHANNEL,
  APP_WINDOW_OPEN_CHANNEL,
  type AppWindowReply,
  type LophnAppWindowsApi,
} from "../ipc/app-window.ts";

export interface AppWindowTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

const CODES = new Set([
  "invalid_input",
  "forbidden",
  "unavailable",
  "not_installed",
  "os_failed",
]);

// main 응답에서 ok와 code만 새 객체로 넘긴다. 통로가 끊기면 unavailable이다.
async function call(
  transport: AppWindowTransport,
  channel: string,
  input: unknown,
): Promise<AppWindowReply> {
  let reply: unknown;
  try {
    reply = await transport.invoke(channel, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
  const value = reply as { ok?: unknown; code?: unknown } | null;
  if (value?.ok === true) return { ok: true };
  return {
    ok: false,
    code: typeof value?.code === "string" && CODES.has(value.code)
      ? value.code as Extract<AppWindowReply, { ok: false }>["code"]
      : "unavailable",
  };
}

export function createAppWindowsApi(
  transport: AppWindowTransport,
): LophnAppWindowsApi {
  return Object.freeze(
    {
      openWindow: (input) => call(transport, APP_WINDOW_OPEN_CHANNEL, input),
      addShortcut: (input) => call(transport, APP_SHORTCUT_ADD_CHANNEL, input),
      removeShortcut: (input) =>
        call(transport, APP_SHORTCUT_REMOVE_CHANNEL, input),
    } satisfies LophnAppWindowsApi,
  );
}
