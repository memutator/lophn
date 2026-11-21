// 앱 view의 preload bridge(protocol/shell app-bridge-types). 페이지에는 `lophnApp.callOperation`,
// `lophnApp.openExternal`, 앱 workspace의 agent session 길(`agent`), project 읽기(`projects`), 컴퓨터 명단 읽기(`machines`), session 목록·멈추기·끝내기(`sessions`), agent에게 call 보내기(`calls`)와 agent 명함(`agents`), 앱 event 받기(`events`)와 자기 탭 머리 줄(`setTabHead`·`onTabHead`)과 살려 두기 신호(`setKeepAlive`)만 열고, 다른 앱·shell API·token·임의
// method·경로·파일 통로는 없다. 앱·release·actor는 보내지 않는다: main이 sender view에서 정한다.
// transport와 Electron event는 closure 안에 남는다.
import type { Result } from "../../base/result.ts";
import {
  capabilityFrom,
  isPhoneCapability,
  PHONE_CAPABILITY_TABLE,
} from "../../protocol/phone/capabilities.ts";
import type {
  AppPlace,
  AppPlaceWorkspace,
  Json,
  LophnApp,
  LophnAppCommands,
  LophnAppPhone,
} from "../../protocol/shell/app-bridge-types.ts";
import {
  APP_KEYS_CHANNEL,
  APP_KEYS_FORWARD_CHANNEL,
  type AppKeysPayload,
} from "../ipc/app-keys.ts";
import {
  type KeyInput,
  MODIFIER_CODES,
  parseChord,
  type Stroke,
  strokeMatches,
} from "../../protocol/shell/keybindings.ts";
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
import { APP_EVENT_CHANNEL } from "../ipc/app-events.ts";
import { APP_AGENTS_CHANNEL } from "../ipc/app-agents.ts";
import { APP_MACHINES_LIST_CHANNEL } from "../ipc/app-machines.ts";
import { APP_PROJECTS_LIST_CHANNEL } from "../ipc/app-projects.ts";
import {
  APP_SESSIONS_LIST_CHANNEL,
  APP_SESSIONS_STATUS_CHANNEL,
  APP_SESSIONS_STOP_CHANNEL,
} from "../ipc/app-sessions.ts";
import { APP_KEEP_ALIVE_CHANNEL } from "../ipc/app-keep-alive.ts";
import { createTabHead } from "./tab-head.ts";

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

// agent·project 길은 실패를 던지지 않고 Result로 돌려준다.
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

const PLACES = ["tab", "panel", "card", "sidebar", "tray", "phone"] as const;

function parsed(search: URLSearchParams, name: string): unknown {
  const text = search.get(name);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// main이 연 주소의 query에서 읽는다. 틀린 값은 place null로 돌려주고 앱이 자리를 모르는 채로 그린다.
export function placeOf(query: string): AppPlace {
  const search = new URLSearchParams(query);
  const place = search.get("place");
  const params = parsed(search, "params");
  const workspace = parsed(search, "workspace");
  const folders = isObject(workspace) ? workspace.folders : undefined;
  if (
    !PLACES.includes(place as (typeof PLACES)[number]) ||
    (params !== undefined && !isObject(params)) ||
    (workspace !== undefined &&
      !(
        isObject(workspace) &&
        ["project", "home", "app"].includes(workspace.kind as string) &&
        typeof workspace.id === "string" &&
        (workspace.kind !== "project" ||
          (typeof workspace.identity === "string" &&
            Array.isArray(workspace.formerIdentities) &&
            workspace.formerIdentities.every(
              (id) => typeof id === "string",
            ))) &&
        Array.isArray(folders) &&
        folders.every((folder) => typeof folder === "string")
      ))
  ) {
    return { place: null, params: {}, workspace: null };
  }
  return {
    place: place as AppPlace["place"],
    params: (params ?? {}) as { [key: string]: Json },
    workspace: (workspace ?? null) as AppPlaceWorkspace | null,
  };
}

/** keydown에서 맞추기에 쓰는 DOM KeyboardEvent의 부분. */
interface AppKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface HeardKey {
  readonly text: string;
  readonly stroke: Stroke;
}

const heard = (text: string): HeardKey => ({
  text,
  stroke: parseChord(text).strokes[0]!,
});

/**
 * 앱 page의 key 맞추기. host가 준 글(`AppKeysPayload`)과 page가 건 handler로 keydown을 판정한다. 앱 key가
 * 맞고 handler가 있고 `when`이 참이면 handler를 부르고 삼킨다. 아니면 shell 글에 맞을 때 host로 넘기고 삼킨다.
 * 맞지 않으면 그대로 둔다. 눌러 둔 반복은 삼키기만 하고 부르거나 넘기지 않는다.
 */
export function createAppKeys(
  transport: Pick<AppTransport, "on" | "sendToHost">,
): {
  commands: LophnAppCommands;
  handle(event: AppKeyEvent): void;
} {
  const handlers = new Map<string, { run: () => void; when?: () => boolean }>();
  let own: (HeardKey & { name: string })[] = [];
  let shell: HeardKey[] = [];
  transport.on(APP_KEYS_CHANNEL, (payload) => {
    const value = payload as AppKeysPayload;
    own = Object.entries(value.keys).flatMap(([name, texts]) =>
      texts.map((text) => ({ name, ...heard(text) })),
    );
    shell = value.forward.map(heard);
  });
  const commands: LophnAppCommands = {
    register(name, handler, when) {
      const entry = { run: handler, when };
      handlers.set(name, entry);
      return () => {
        if (handlers.get(name) === entry) handlers.delete(name);
      };
    },
  };
  function handle(event: AppKeyEvent): void {
    // 한글 조합 중과 modifier만 누른 key는 맞추지 않는다(shell service와 같다).
    if (
      event.isComposing ||
      MODIFIER_CODES.test(event.code) ||
      MODIFIER_CODES.test(event.key)
    ) {
      return;
    }
    const input: KeyInput = {
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
    };
    const mine = own.find((one) => {
      if (!strokeMatches(one.stroke, input)) return false;
      const handler = handlers.get(one.name);
      return handler !== undefined && (handler.when?.() ?? true);
    });
    if (mine !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) handlers.get(mine.name)?.run();
      return;
    }
    const forwarded = shell.find((one) => strokeMatches(one.stroke, input));
    if (forwarded === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      transport.sendToHost(APP_KEYS_FORWARD_CHANNEL, forwarded.text);
    }
  }
  return { commands, handle };
}

// main이 연 주소의 query `phone`(core가 이 view에 준 목록)에서 읽는다. 틀리거나 없으면 빈 목록이다.
export function phoneCapabilitiesOf(query: string): string[] {
  const text = new URLSearchParams(query).get("phone");
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) &&
      parsed.every((name) => typeof name === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

// 폰 화면의 desktop preview에서 폰 기능은 늘 stand-in이다: IPC 없이 표의 값을 돌려준다. core가 이 view에 준 목록(preview 선언이
// `phone.use`로 선언한 기능) 밖의 기능은 폰의 preview와 live처럼 `forbidden`이다.
function standInPhone(capabilities: readonly string[]): LophnAppPhone {
  return Object.freeze({
    capabilities,
    standIn: true,
    async request(capability: string): Promise<unknown> {
      if (
        !isPhoneCapability(capability) ||
        !capabilityFrom(capability, "screen")
      ) {
        throw new Error(
          `invalid_input: ${capability} is not a phone capability`,
        );
      }
      if (!capabilities.includes(capability)) {
        throw new Error(
          `forbidden: phone.use ${JSON.stringify({ capability })} is not permitted`,
        );
      }
      return PHONE_CAPABILITY_TABLE[capability].stand_in;
    },
  });
}

export function createAppTool(
  transport: AppTransport,
  query: string,
): LophnApp {
  const tabHead = createTabHead(transport);
  const keepAliveKeys = new Set<string>();
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
  // 앱 event. main이 이 화면의 release가 구독을 선언한 것만 보낸다. 여기서는 (source, event)별 listener에 나눠 준다.
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const eventKey = (source: string, event: string) => `${source}\u0000${event}`;
  transport.on(APP_EVENT_CHANNEL, (payload) => {
    const {
      source,
      event,
      payload: body,
    } = payload as {
      source: string;
      event: string;
      payload: unknown;
    };
    for (const listener of eventListeners.get(eventKey(source, event)) ?? []) {
      try {
        listener(body);
      } catch {
        // 한 listener의 오류가 다른 listener를 막지 않는다.
      }
    }
  });
  const keys = createAppKeys(transport);
  // 창(window)에서 듣는다. page의 keydown listener보다 먼저 받아야 맞은 key를 page가 받기 전에 삼킬 수 있다.
  // Node 테스트처럼 window가 없으면 듣지 않는다.
  (
    globalThis as unknown as {
      addEventListener?(
        type: "keydown",
        listener: (event: AppKeyEvent) => void,
        capture: true,
      ): void;
    }
  ).addEventListener?.("keydown", keys.handle, true);
  const place = placeOf(query);
  return Object.freeze({
    place: Object.freeze(place),
    ...(place.place === "phone"
      ? { phone: standInPhone(phoneCapabilitiesOf(query)) }
      : {}),
    commands: Object.freeze(keys.commands),
    callOperation: (operation: string, input: unknown) =>
      request(transport, APP_CALL_OPERATION_CHANNEL, { operation, input }),
    async openExternal(url: string): Promise<void> {
      await request(transport, APP_OPEN_EXTERNAL_CHANNEL, { url });
    },
    agent: Object.freeze({
      open: (input: {
        agent: string;
        title?: string;
        workspace?: { kind: "project" | "app"; id: string };
      }) =>
        result(transport, APP_AGENT_OPEN_CHANNEL, {
          agent: input.agent,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.workspace === undefined
            ? {}
            : { workspace: input.workspace }),
        }),
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
    projects: Object.freeze({
      list: () => result(transport, APP_PROJECTS_LIST_CHANNEL, null),
    }),
    machines: Object.freeze({
      list: () => result(transport, APP_MACHINES_LIST_CHANNEL, null),
    }),
    sessions: Object.freeze({
      list: (filter?: unknown) =>
        result(transport, APP_SESSIONS_LIST_CHANNEL, filter ?? null),
      status: (session: string) =>
        result(transport, APP_SESSIONS_STATUS_CHANNEL, { session }),
      stop: (session: string) =>
        result(transport, APP_SESSIONS_STOP_CHANNEL, { session }),
      end: (session: string) =>
        result(transport, APP_AGENTS_CHANNEL, {
          op: "sessions.end",
          input: { session },
        }),
    }),
    calls: Object.freeze({
      send: (input: unknown) =>
        result(transport, APP_AGENTS_CHANNEL, { op: "calls.send", input }),
      read: (call: string) =>
        result(transport, APP_AGENTS_CHANNEL, {
          op: "calls.read",
          input: { call },
        }),
      cancel: (call: string, reason?: string) =>
        result(transport, APP_AGENTS_CHANNEL, {
          op: "calls.cancel",
          input: { call, ...(reason === undefined ? {} : { reason }) },
        }),
      list: (session: string) =>
        result(transport, APP_AGENTS_CHANNEL, {
          op: "calls.list",
          input: { session },
        }),
    }),
    agents: Object.freeze({
      list: () =>
        result(transport, APP_AGENTS_CHANNEL, { op: "agents.list", input: {} }),
    }),
    events: Object.freeze({
      subscribe(
        source: string,
        event: string,
        listener: (payload: unknown) => void,
      ) {
        const key = eventKey(String(source), String(event));
        const set = eventListeners.get(key) ?? new Set();
        set.add(listener);
        eventListeners.set(key, set);
        return () => {
          set.delete(listener);
        };
      },
    }),
    setTabHead: tabHead.setTabHead,
    setKeepAlive(active: boolean, key = "default"): void {
      // 앱 코드와 SDK가 각자 key로 켜므로 host에는 "켠 key가 있나"만 올린다.
      if (active === true) keepAliveKeys.add(String(key));
      else keepAliveKeys.delete(String(key));
      try {
        transport.sendToHost(APP_KEEP_ALIVE_CHANNEL, keepAliveKeys.size > 0);
      } catch {
        // shell 밖이면 살려 둘 곳이 없다.
      }
    },
    onTabHead: tabHead.onTabHead,
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
