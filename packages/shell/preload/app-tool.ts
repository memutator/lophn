// 앱 view의 preload bridge(protocol/shell app-bridge-types). 페이지에는 `lophnApp.callOperation`,
// `lophnApp.openExternal`, 앱 place의 agent session 길(`agent`)과 자기 탭 머리 줄(`setTabHead`·`onTabHead`)만 열고, 다른 앱·shell API·token·임의
// method·경로·파일 통로는 없다. 앱·release·actor는 보내지 않는다: main이 sender view에서 정한다.
// transport와 Electron event는 closure 안에 남는다.
import type { Result } from "../../base/result.ts";
import type {
  LophnApp,
  TabHead,
  TabHeadEvent,
} from "../../protocol/shell/app-bridge-types.ts";
import {
  APP_AGENT_OPEN_CHANNEL,
  APP_AGENT_SEND_CHANNEL,
  APP_AGENT_SNAPSHOT_CHANNEL,
  APP_AGENT_UPDATE_CHANNEL,
} from "../ipc/app-agent.ts";
import {
  APP_CALL_OPERATION_CHANNEL,
  APP_OPEN_EXTERNAL_CHANNEL,
  APP_VIEW_ERROR_CHANNEL,
  type AppReply,
} from "../ipc/app.ts";
import {
  APP_TAB_HEAD_CHANNEL,
  APP_TAB_HEAD_EVENT_CHANNEL,
} from "../ipc/app-tab-head.ts";

interface AppTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  send(channel: string, input: unknown): void;
  /** 이 view를 품은 shell renderer(`<webview>` element)로 보낸다. */
  sendToHost(channel: string, input: unknown): void;
  on(channel: string, listener: (payload: unknown) => void): void;
}

function replyOf(value: unknown): AppReply<unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const reply = value as { ok?: unknown; error?: unknown };
  if (reply.ok === true) return value as AppReply<unknown>;
  const error = reply.error as { code?: unknown; message?: unknown } | null;
  return reply.ok === false &&
    typeof error?.code === "string" &&
    typeof error.message === "string"
    ? (value as AppReply<unknown>)
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

// agent 길은 실패를 던지지 않고 Result로 돌려준다.
async function result(
  transport: AppTransport,
  channel: string,
  input: unknown,
): Promise<Result<never>> {
  try {
    const reply = replyOf(await transport.invoke(channel, input));
    if (reply !== undefined) return reply as Result<never>;
  } catch {
    // 아래 고정 오류로 돌려준다.
  }
  return {
    ok: false,
    error: { code: "unavailable", message: "app bridge is unavailable" },
  } as Result<never>;
}

export function createAppTool(transport: AppTransport): LophnApp {
  // shell이 머리 줄을 그리는지는 page가 받기 시작하기 전에 올 수 있어 여기 쥐고 있다가 새 listener에 준다.
  let shown = false;
  const listeners = new Set<(event: TabHeadEvent) => void>();
  transport.on(APP_TAB_HEAD_EVENT_CHANNEL, (payload) => {
    const event = payload as TabHeadEvent;
    if (event?.type === "shown") shown = event.shown === true;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // 한 listener의 오류가 다른 listener를 막지 않는다. 오류 자체는 main world가 본다.
      }
    }
  });
  const updateListeners = new Set<(session: string, update: unknown) => void>();
  transport.on(APP_AGENT_UPDATE_CHANNEL, (payload) => {
    const { session, update } = payload as {
      session: string;
      update: unknown;
    };
    for (const listener of updateListeners) {
      try {
        listener(session, update);
      } catch {
        // 한 listener의 오류가 다른 listener를 막지 않는다.
      }
    }
  });
  try {
    transport.sendToHost(APP_TAB_HEAD_CHANNEL, { hello: true });
  } catch {
    // shell 밖이면 머리 줄이 없다.
  }
  return Object.freeze({
    callOperation: (operation: string, input: unknown) =>
      request(transport, APP_CALL_OPERATION_CHANNEL, { operation, input }),
    async openExternal(url: string): Promise<void> {
      await request(transport, APP_OPEN_EXTERNAL_CHANNEL, { url });
    },
    agent: Object.freeze({
      open: (input: { agent: string }) =>
        result(transport, APP_AGENT_OPEN_CHANNEL, { agent: input.agent }),
      snapshot: (session: string) =>
        result(transport, APP_AGENT_SNAPSHOT_CHANNEL, { session }),
      send: (input: unknown) =>
        result(transport, APP_AGENT_SEND_CHANNEL, input),
      onUpdate(listener: (session: string, update: unknown) => void) {
        updateListeners.add(listener);
        return () => {
          updateListeners.delete(listener);
        };
      },
    }),
    setTabHead(head: TabHead | null): void {
      try {
        transport.sendToHost(APP_TAB_HEAD_CHANNEL, head ?? null);
      } catch {
        // 보낼 수 없는 값(함수 등)이면 머리 줄을 바꾸지 않는다.
      }
    },
    onTabHead(listener: (event: TabHeadEvent) => void): () => void {
      listeners.add(listener);
      listener({ type: "shown", shown });
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

// 처리되지 않은 오류를 main에 보내는 상한. main도 view마다 같은 상한을 다시 건다.
const ERRORS_PER_WINDOW = 20;
const ERROR_WINDOW_MS = 60_000;
const NAME_MAX_CHARS = 256;
const MESSAGE_MAX_CHARS = 16_384;

/** main world에서 본 오류 하나. 문자열이 아닌 값은 버린다. */
type ViewErrorReport = (
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
      observation !== "error" &&
      observation !== "unhandledrejection" &&
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
        name:
          shown !== undefined && /\S/.test(shown)
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

interface ErrorTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

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
