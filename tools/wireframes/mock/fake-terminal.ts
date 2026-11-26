// core 없는 일반 browser용 터미널 가짜. PTY 없이 터미널 탭이 열린 모양을 보이려고, 열면 running으로 답하고 정해 둔 출력을
// 준다. 입력은 그대로 되돌려 보여 준다. core의 `terminals/*`·`coding_sessions/*` route와 터미널 event를 흉내 내고, 그 밖의
// route는 page가 `handle`로 답한다(harness GUI의 ACP 길).
import type { CodingSession } from "../../../packages/protocol/coding-agent/relay.ts";
import type {
  TerminalAgent,
  TerminalOutput,
  TerminalRuntime,
} from "../../../packages/protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../packages/protocol/events/mod.ts";
import {
  type GuiHarness,
  isGuiHarness,
} from "../../../packages/protocol/acp/mod.ts";
import type {
  TerminalApi,
  TerminalCall,
} from "../../../packages/shell/ipc/terminal.ts";
import type { CoreReply } from "../../../packages/shell/ipc/core-api.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  type EventClient,
  type EventMessage,
  matchesCondition,
} from "../../../packages/shell/renderer/desktop/connection/events/client.ts";
import type { TerminalCore } from "../../../packages/shell/renderer/terminal/core.ts";
import type { TerminalDeps } from "../../../packages/shell/renderer/terminal/deps.ts";
import { TerminalDisplays } from "../../../packages/shell/renderer/terminal/displays.ts";
import { TerminalStore } from "../../../packages/shell/renderer/terminal/store.ts";
import { createXtermView } from "../../../packages/shell/renderer/terminal/xterm-view.ts";

const PROMPT = "\x1b[32mmina@lophn\x1b[0m:\x1b[34m~/Documents/grocery\x1b[0m$ ";
const FIRST = [
  `${PROMPT}ls\r\n`,
  "budget.md  receipts.md  plan.md  weekly\r\n",
  `${PROMPT}git status --short\r\n`,
  " M budget.md\r\n",
  PROMPT,
].join("");

const REF = "trm_01h455vb4pex5v6nkc6gd5fd01";
/** 가짜 터미널의 coding session id. ACP event의 session이다. */
export const FAKE_CODING_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd01";
const SESSION = FAKE_CODING_SESSION;
const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd01";

function ok<T>(value: T): Promise<TerminalCall<T>> {
  return Promise.resolve({ ok: true, value });
}

/** page가 터미널 밖 route에 답한다. undefined면 not_found다. */
export type FakeRoutes = (
  resource: string,
  method: string,
  body: Record<string, unknown>,
) => unknown;

export interface FakeTerminalCore extends TerminalCore {
  /** 창의 event 연결에 event 하나를 낸다. */
  emit(event: BusEvent): void;
  /** 친 글을 터미널 출력으로 되돌린다. */
  echo(text: string): void;
  /** 이 터미널의 coding session(목록의 행). coding agent가 없으면 null이다. */
  readonly coding: CodingSession | null;
}

/** 조건에 맞는 구독자에게 event를 주는 가짜 연결. 붙으면 곧 ready다. */
function fakeEvents(
  core: CoreSource,
): EventClient & { emit(event: BusEvent): void } {
  const subscribers = new Set<{
    condition: Parameters<EventClient["subscribe"]>[0];
    onMessage: (message: EventMessage) => void;
  }>();
  return {
    core,
    subscribe(condition, onMessage) {
      const one = { condition, onMessage };
      subscribers.add(one);
      queueMicrotask(() => {
        if (subscribers.has(one)) onMessage({ kind: "ready" });
      });
      return () => void subscribers.delete(one);
    },
    emit(event) {
      for (const one of [...subscribers]) {
        if (
          matchesCondition(
            one.condition,
            event as { type: string; session?: string },
          )
        ) {
          one.onMessage({ kind: "event", event });
        }
      }
    },
  };
}

/** `agent`를 주면 그 터미널에서 coding agent가 도는 것으로 runtime과 coding session 목록이 알린다. */
export function fakeTerminalCore(
  options: {
    agent?: TerminalAgent;
    /** 탭의 GUI view. 주면 GUI가 되는 harness(`harness`, 없으면 claude)의 coding session이 그 view로 목록에 있다. */
    view?: "gui" | "tui";
    harness?: GuiHarness;
    routes?: FakeRoutes;
  } = {},
): FakeTerminalCore {
  const { agent } = options;
  const chunks: TerminalOutput[] = [
    {
      terminal_ref: REF,
      generation: 1,
      seq: 1,
      chunk: FIRST,
      dropped_output: false,
    },
  ];
  const runtime = (): TerminalRuntime => ({
    terminal_ref: REF,
    project: PROJECT,
    folder_ref: "fld_gallery",
    cwd_at_start: "/home/mina/Documents/grocery",
    program_path: "/bin/bash",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: chunks.length,
    dropped_output: false,
    ...(agent === undefined ? {} : { agent }),
  });
  const harness =
    options.view !== undefined
      ? (options.harness ?? "claude")
      : (agent?.harness ?? null);
  const coding: CodingSession | null =
    harness === null || !isGuiHarness(harness)
      ? null
      : {
          session: SESSION,
          terminal: REF,
          harness,
          label: harness,
          project: PROJECT,
          cwd: "/home/mina/Documents/grocery",
          title: agent?.title ?? null,
          state: agent?.state ?? "idle",
          view: options.view ?? "tui",
          handoff: "restart",
          cli_session: agent?.session ?? null,
          last_active_at: null,
          switch:
            options.view === "gui"
              ? null
              : agent?.foreground !== true
                ? { blocked: "not_running" }
                : agent.session === undefined
                  ? { blocked: "no_session" }
                  : null,
        };
  const answer = (resource: string, method: string, body: unknown) => {
    const input = (body ?? {}) as Record<string, unknown>;
    switch (`${resource}/${method}`) {
      case "terminals/open":
        return { terminal: REF, runtime: runtime() };
      case "terminals/close":
      case "terminals/resize":
        return { runtime: runtime() };
      case "terminals/snapshot":
        return {
          runtime: runtime(),
          output: chunks.filter(
            (chunk) => chunk.seq > Number(input.after_seq ?? 0),
          ),
        };
      case "terminals/watch":
      case "terminals/name":
        return {};
      case "terminals/list":
        return { terminals: [runtime()] };
      case "terminals/saved_sessions":
      case "terminals/rename_saved":
        return { sessions: [] };
      case "coding_sessions/list":
        return { sessions: coding === null ? [] : [coding] };
      case "coding_sessions/switch_plan":
        return {
          to: coding?.view === "gui" ? "tui" : "gui",
          stops: {
            turn: agent?.state === "running" || agent?.state === "waiting",
            tasks: 0,
            queued: 0,
          },
          blocked: null,
        };
      case "coding_sessions/switch":
        return { ok: true };
      default:
        return options.routes?.(resource, method, input);
    }
  };
  const source: CoreSource = {
    subscribe: () => () => {},
    call: async (call): Promise<CoreReply> => {
      const value = answer(call.resource, call.method, call.body);
      return value === undefined
        ? { ok: false, error: { code: "not_found", message: "not here" } }
        : { ok: true, value };
    },
  };
  const events = fakeEvents(source);
  const call = async <T>(resource: string, method: string, body: unknown) => {
    const reply = await source.call({ kind: "read", resource, method, body });
    return reply.ok
      ? { ok: true as const, value: reply.value as T }
      : { ok: false as const, code: "not_found", reason: null };
  };
  return {
    events,
    coding,
    emit: events.emit,
    echo(text) {
      const chunk: TerminalOutput = {
        terminal_ref: REF,
        generation: 1,
        seq: chunks.length + 1,
        chunk: text === "\r" ? `\r\n${PROMPT}` : text,
        dropped_output: false,
      };
      chunks.push(chunk);
      events.emit({
        type: "TerminalOutputAppended",
        subject: `terminal:${REF}`,
        at: new Date().toISOString(),
        payload: chunk,
      } as BusEvent);
    },
    open: (input) => call("terminals", "open", input),
    close: async () => ({ ok: true, value: runtime() }),
    resize: async () => ({ ok: true, value: runtime() }),
    snapshot: (terminal, afterSeq) =>
      call("terminals", "snapshot", { terminal, after_seq: afterSeq }),
    watch: async () => ({ ok: true, value: {} }),
    name: async () => ({ ok: true, value: {} }),
    list: async () => [runtime()],
    savedSessions: async () => [],
    renameSaved: async () => [],
    forgetSaved: async () => {},
    subscribe: (listener) =>
      events.subscribe(
        { types: ["TerminalOutputAppended", "TerminalRuntimeChanged"] },
        listener,
      ),
  };
}

/** shell main의 입력 통로 가짜. 친 글을 core의 출력 event로 되돌린다. */
export function fakeTerminalBridge(core: FakeTerminalCore): TerminalApi {
  return {
    input({ text }) {
      core.echo(text);
      return ok(null);
    },
    respond: () => ok(null),
    restart: () => ok(null),
    focus: () => ok(null),
    shown: () => ok(null),
    openLink: () => ok("os"),
    copy: () => ok(null),
    paste: () => ok(""),
    pasteImage: () => ok({ path: "/tmp/paste.png", bytes: 1 }),
    trace: () => ok(false),
    onReveal: () => () => {},
  };
}

/** 터미널 탭 하나를 그리는 통로 묶음. */
export function fakeTerminalDeps(
  options: Parameters<typeof fakeTerminalCore>[0] = {},
): TerminalDeps {
  const core = fakeTerminalCore(options);
  const bridge = fakeTerminalBridge(core);
  const store = new TerminalStore(core, bridge);
  return {
    core,
    bridge,
    store,
    displays: new TerminalDisplays(store, core, bridge),
    createView: createXtermView,
    confirmClose: () => Promise.resolve(false),
  };
}
