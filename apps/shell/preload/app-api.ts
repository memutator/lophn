// 앱 view의 preload bridge(contracts/shell app-bridge). 페이지에는 `lophnApp.call`과
// `lophnApp.openExternal`만 열고, 다른 앱·shell API·token·임의 method·경로·파일 통로는 없다
// (shell/app-frame#R13, R15). 앱·release·actor는 보내지 않는다: main이 sender view에서 정한다.
// transport와 Electron event는 closure 안에 남는다.
import type { LophnApp } from "../../../packages/contracts/shell/app-bridge-types.ts";
import {
  APP_CALL_CHANNEL,
  APP_OPEN_EXTERNAL_CHANNEL,
  APP_VIEW_ERROR_CHANNEL,
  type AppReply,
} from "../ipc/app.ts";

export interface AppTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  send(channel: string, input: unknown): void;
}

function replyOf(value: unknown): AppReply<unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const reply = value as { ok?: unknown; error?: unknown };
  if (reply.ok === true) return value as AppReply<unknown>;
  const error = reply.error as { code?: unknown; message?: unknown } | null;
  return reply.ok === false && typeof error?.code === "string" &&
      typeof error.message === "string"
    ? value as AppReply<unknown>
    : undefined;
}

// 실패는 고정 code와 main의 문구만 싣는다. transport 오류 원문은 페이지로 넘기지 않는다.
async function request(
  transport: AppTransport,
  channel: string,
  input: unknown,
): Promise<unknown> {
  let reply: AppReply<unknown> | undefined;
  try {
    reply = replyOf(await transport.invoke(channel, input));
  } catch {
    reply = undefined;
  }
  if (reply === undefined) {
    throw new Error("unavailable: app bridge is unavailable");
  }
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
}

export function createAppApi(transport: AppTransport): LophnApp {
  return Object.freeze({
    call: (command: string, input: unknown) =>
      request(transport, APP_CALL_CHANNEL, { command, input }),
    async openExternal(url: string): Promise<void> {
      await request(transport, APP_OPEN_EXTERNAL_CHANNEL, { url });
    },
  });
}

// 처리되지 않은 오류를 main에 보내는 상한. main도 view마다 같은 상한을 다시 건다.
const ERRORS_PER_WINDOW = 20;
const ERROR_WINDOW_MS = 60_000;
const NAME_MAX_CHARS = 256;
const MESSAGE_MAX_CHARS = 16_384;

export interface ErrorTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

function field(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * window의 `error`·`unhandledrejection`을 내부 `app:view-error`로 보낸다(problems/reporting#R5).
 * 이름과 message만 싣고, 페이지 값을 읽다 실패하면 이름만 남긴다. 원래 오류의 처리는 바꾸지 않는다.
 */
export function installViewErrors(
  target: ErrorTarget,
  transport: Pick<AppTransport, "send">,
  now: () => number,
): void {
  let start = now();
  let count = 0;
  function report(
    observation: "error" | "unhandledrejection",
    error: unknown,
    fallback: unknown,
  ): void {
    const at = now();
    if (at - start >= ERROR_WINDOW_MS) {
      start = at;
      count = 0;
    }
    if (++count > ERRORS_PER_WINDOW) return;
    const name = text(field(error, "name"), NAME_MAX_CHARS);
    const message = text(field(error, "message"), MESSAGE_MAX_CHARS) ??
      text(fallback, MESSAGE_MAX_CHARS) ?? null;
    try {
      transport.send(APP_VIEW_ERROR_CHANNEL, {
        observation,
        name: name !== undefined && /\S/.test(name)
          ? name
          : observation === "error"
          ? "Error"
          : "UnhandledRejection",
        message,
      });
    } catch {
      // 보내지 못한 오류는 페이지 동작을 바꾸지 않는다.
    }
  }
  target.addEventListener("error", (event) => {
    report("error", field(event, "error"), field(event, "message"));
  });
  target.addEventListener("unhandledrejection", (event) => {
    const reason = field(event, "reason");
    report(
      "unhandledrejection",
      reason,
      typeof reason === "string" ? reason : undefined,
    );
  });
}
