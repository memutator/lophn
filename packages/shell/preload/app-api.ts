// 앱 view의 preload bridge(contracts/shell app-bridge). 페이지에는 `lophnApp.call`과
// `lophnApp.openExternal`만 열고, 다른 앱·shell API·token·임의 method·경로·파일 통로는 없다
// (shell/app-frame#R13, R15). 앱·release·actor는 보내지 않는다: main이 sender view에서 정한다.
// transport와 Electron event는 closure 안에 남는다.
import type { LophnApp } from "../../protocol/shell/app-bridge-types.ts";
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

/** main world에서 본 오류 하나. 문자열이 아닌 값은 버린다. */
export type ViewErrorReport = (
  observation: unknown,
  name: unknown,
  message: unknown,
) => void;

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

/**
 * main world의 오류(error·unhandledrejection·render_error)를 내부 `app:view-error`로 보내는
 * 함수. 이름과
 * message만 싣고 창당 상한을 넘으면 버린다. 보내지 못해도 페이지 동작은 바꾸지 않는다.
 */
export function createViewErrorReport(
  transport: Pick<AppTransport, "send">,
  now: () => number,
): ViewErrorReport {
  let start = now();
  let count = 0;
  return (observation, name, message) => {
    if (
      observation !== "error" && observation !== "unhandledrejection" &&
      observation !== "render_error"
    ) {
      return;
    }
    const at = now();
    if (at - start >= ERROR_WINDOW_MS) {
      start = at;
      count = 0;
    }
    if (++count > ERRORS_PER_WINDOW) return;
    const shown = text(name, NAME_MAX_CHARS);
    try {
      transport.send(APP_VIEW_ERROR_CHANNEL, {
        observation,
        name: shown !== undefined && /\S/.test(shown)
          ? shown
          : observation === "unhandledrejection"
          ? "UnhandledRejection"
          : "Error",
        message: text(message, MESSAGE_MAX_CHARS) ?? null,
      });
    } catch {
      // 보내지 못한 오류는 페이지 동작을 바꾸지 않는다.
    }
  };
}

export interface ErrorTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/**
 * SDK 루트 오류 경계(ui-state AppErrorBoundary)가 main world에서 보내는 DOM event.
 * `detail`은 `{name, message}`다. watchMainWorldErrors 안에는 같은 글자를 직접 쓴다(직렬화돼 돈다).
 */
export const RENDER_ERROR_EVENT = "lophn:render-error";

/**
 * 페이지의 오류는 그 world에서만 보이므로(context isolation) 이 함수를 main world에서 돌린다
 * (`contextBridge.executeInMainWorld`). report는 bridge된 함수로 closure에만 있고 window에 걸리지
 * 않는다. 바깥 변수를 쓰지 않는 자기 완결 함수여야 한다. 원래 오류 처리는 바꾸지 않는다.
 */
export function watchMainWorldErrors(
  report: ViewErrorReport,
  target?: ErrorTarget,
): void {
  const on = target ?? (globalThis as unknown as ErrorTarget);
  const read = (value: unknown, key: string): unknown => {
    try {
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
    } catch {
      return undefined;
    }
  };
  const textOf = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  on.addEventListener("error", (event) => {
    const error = read(event, "error");
    report(
      "error",
      textOf(read(error, "name")),
      textOf(read(error, "message")) ?? textOf(read(event, "message")),
    );
  });
  on.addEventListener("unhandledrejection", (event) => {
    const reason = read(event, "reason");
    report(
      "unhandledrejection",
      textOf(read(reason, "name")),
      textOf(read(reason, "message")) ?? textOf(reason),
    );
  });
  on.addEventListener("lophn:render-error", (event) => {
    const detail = read(event, "detail");
    report(
      "render_error",
      textOf(read(detail, "name")),
      textOf(read(detail, "message")),
    );
  });
}
