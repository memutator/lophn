// 앱 view의 agent 길 main service. 앱 화면이 session을 열고, ACP 상태를 읽고, 입력을 보내고, 갱신을 받는다. 열기는 core의
// `app_sessions.open`이 하고(core가 `opened_by_app`을 단다), 붙을 수 있는 session은 그 앱이 call로 닿을 수 있는 workspace의 session
// 전부다(core의 시야 판정). 앱 화면에서 보낸 것은 그 앱을 쓰는 사람의 메시지라 operation처럼 사람 자격(`coreInternal`. 다른 기계의 view는 그 기계가 보는 이 컴퓨터의 기기 자격)으로 core에
// 가고 따로 허락 단계가 없다. 앱 id는 sender view에서 main이 정한다(page가 고르지 못한다).
import { APP_AGENT_UPDATE_CHANNEL } from "../../ipc/app-agent.ts";
import type { CallOutcome } from "./app-call.ts";
import type { MachineCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppAgentDeps {
  call: MachineCaller;
  /** view의 page로 보낸다. 그 view가 이미 없으면 false다. */
  send(view_session: string, channel: string, payload: unknown): boolean;
  /**
   * 다른 기계에 묶인 view들이 붙은 그 기계의 session이 바뀌었다. 그 기계의 `AcpUpdated`를 이 session들에 대해서만 받게 건다
   * (빈 목록은 그만 받는다). 이 컴퓨터의 갱신은 shell main이 type으로 이미 받는다.
   */
  watch?(machine: string, sessions: readonly string[]): void;
}

function fail(code: string, message: string): CallOutcome<never> {
  return { ok: false, error: { code, message } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const NOT_YOURS = fail("forbidden", "session is not available");

// 앱 code(AI가 만든 code일 수 있다)가 보낼 수 있는 ACP 입력. `decide`(승인)는 사람이 채팅 탭에서만 하고, `run_shell`·
// `rewind`·`fork` 같은 사람의 composer 조작도 앱이 대신하지 못한다. 목록에 없는 것은 모두 막는 쪽이 새 입력이 생겨도 안전하다.
const ALLOWED_INPUTS: readonly unknown[] = ["send", "stop", "answer", "rename"];

export function createAppAgent(deps: AppAgentDeps) {
  // 이 view가 붙어 읽은 session과 view가 묶인 기계. 갱신을 거를 때만 쓴다(붙을 수 있는지는 읽고 보낼 때마다 core에 다시 묻는다).
  const owned = new Map<
    string,
    { machine: string | null; sessions: Set<string> }
  >();

  // 그 기계의 view들이 붙은 session 전부를 다시 건다.
  function rewatch(machine: string | null): void {
    if (machine === null) return;
    const sessions = new Set<string>();
    for (const entry of owned.values()) {
      if (entry.machine !== machine) continue;
      for (const session of entry.sessions) sessions.add(session);
    }
    deps.watch?.(machine, [...sessions]);
  }

  function remember(view: BoundView, session: string): void {
    const known = owned.get(view.view_session) ?? {
      machine: view.machine,
      sessions: new Set<string>(),
    };
    const added = !known.sessions.has(session);
    known.sessions.add(session);
    owned.set(view.view_session, known);
    if (added) rewatch(view.machine);
  }

  function forget(view_session: string): void {
    const entry = owned.get(view_session);
    if (entry === undefined) return;
    owned.delete(view_session);
    rewatch(entry.machine);
  }

  /** session이 이 view의 앱이 보는 lophn·harness session이면 undefined, 아니면 돌려줄 실패다. 없는 session과 안 보이는 session은 같다. */
  async function check(
    view: BoundView,
    session: unknown,
  ): Promise<CallOutcome<never> | undefined> {
    if (typeof session !== "string") {
      return fail("invalid_input", "session is invalid");
    }
    const listed = await deps.call(view.machine)(
      "memory",
      "app_sessions",
      "list",
      {
        app: view.target.app,
        session,
      },
    );
    if (!listed.ok) {
      switch (listed.error.code) {
        case "invalid_input":
          return fail("invalid_input", "session is invalid");
        case "not_found":
        case "forbidden":
        case "unauthorized":
          return NOT_YOURS;
        default:
          return fail("unavailable", "core is not available");
      }
    }
    const sessions = record(listed.value)?.sessions;
    const found = Array.isArray(sessions) ? record(sessions[0]) : undefined;
    // 터미널 coding agent는 ACP session이 아니다(`term:` 탭).
    if (found === undefined || found.kind === "terminal") return NOT_YOURS;
    remember(view, session);
    return undefined;
  }

  return {
    async open(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const input = record(value);
      const title = input?.title;
      if (
        input === undefined ||
        !Object.keys(input).every(
          (key) => key === "agent" || key === "title" || key === "workspace",
        ) ||
        typeof input.agent !== "string" ||
        (title !== undefined &&
          (typeof title !== "string" || title.trim() === ""))
      ) {
        return fail("invalid_input", "input is invalid");
      }
      const opened = await deps.call(view.machine)(
        "memory",
        "app_sessions",
        "open",
        {
          app: view.target.app,
          agent: input.agent,
          ...(title === undefined ? {} : { title }),
          // 앱이 call로 닿을 수 있는 workspace인지는 core가 판정한다(core의 strict schema가 모양을 거른다).
          ...(input.workspace === undefined
            ? {}
            : { workspace: input.workspace }),
        },
      );
      if (!opened.ok) return opened;
      const session = record(opened.value)?.session;
      if (typeof session !== "string") {
        return fail("unavailable", "core is not available");
      }
      remember(view, session);
      return { ok: true, value: { session } };
    },

    async snapshot(
      view: BoundView,
      value: unknown,
    ): Promise<CallOutcome<unknown>> {
      const session = record(value)?.session;
      const refused = await check(view, session);
      if (refused !== undefined) return refused;
      return await deps.call(view.machine)("read", "acp", "snapshot", {
        session,
      });
    },

    async send(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      if (!ALLOWED_INPUTS.includes(record(value)?.type)) {
        return fail("forbidden", "an app cannot send this input");
      }
      const refused = await check(view, record(value)?.session);
      if (refused !== undefined) return refused;
      // 앱 화면이 보낸 사람 메시지에는 그 앱의 이름표가 붙는다. page가 주장한 값은 버리고 sender view의 앱으로 덮는다(이름표일 뿐
      // 메시지는 사람의 것이다). 크기 상한과 입력 검사는 AcpSend의 것을 따른다.
      const input = record(value);
      const labelled =
        input?.type === "send" ? { ...input, via_app: view.target.app } : value;
      const sent = await deps.call(view.machine)(
        "memory",
        "acp",
        "send",
        labelled,
      );
      return sent.ok ? { ok: true, value: undefined } : sent;
    },

    /** 이 컴퓨터에서 그 session을 지금 쥔 view들. 그중 focus 창에 보이는 것이 있으면 사람이 보고 있다. */
    viewsOf(session: string): string[] {
      return [...owned]
        .filter(
          ([, entry]) => entry.machine === null && entry.sessions.has(session),
        )
        .map(([view_session]) => view_session);
    },

    /**
     * `machine`(null은 이 컴퓨터)의 core가 낸 `AcpUpdated`. 그 session을 이 앱이 보는 것으로 읽었고 그 기계에 묶인 view에만
     * 보낸다(기계마다 session id가 따로라 다른 기계의 view로 새지 않게 한다).
     */
    updated(
      payload: { session: string; update: unknown },
      machine: string | null,
    ): void {
      for (const [view_session, entry] of [...owned]) {
        if (entry.machine !== machine || !entry.sessions.has(payload.session)) {
          continue;
        }
        if (!deps.send(view_session, APP_AGENT_UPDATE_CHANNEL, payload)) {
          forget(view_session);
        }
      }
    },

    /** view가 닫혔다. 그 view가 붙은 session을 놓는다(다른 기계면 그 기계의 구독에서도 뺀다). */
    forget,
  };
}
