// 앱 view의 agent 길 main service. 앱 화면이 자기 앱 workspace의 session을 열고, ACP 상태를 읽고, 입력을 보내고,
// 갱신을 받는다. 앱 화면에서 보낸 것은 그 앱을 쓰는 사람의 메시지라 operation처럼 사람 자격(`coreInternal`)으로 core에
// 가고 따로 허락 단계가 없다. 앱 id는 sender view에서 main이 정한다(page가 고르지 못한다).
import { APP_AGENT_UPDATE_CHANNEL } from "../../ipc/app-agent.ts";
import type { CallOutcome } from "./app-call.ts";
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppAgentDeps {
  call: CoreCaller;
  ids: { newId(prefix: string): string };
  /** view의 page로 보낸다. 그 view가 이미 없으면 false다. */
  send(view_session: string, channel: string, payload: unknown): boolean;
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
  // 이 view가 열었거나 읽어서 앱 workspace의 것으로 확인한 session. 갱신을 거를 때 쓴다(session의 workspace는 열 때 정해져 안 바뀐다).
  const owned = new Map<string, Set<string>>();
  // 앱 화면이 연 적 있는 session. view가 사라져도 남겨, 떠난 사이 끝난 turn도 앱 session의 알림 규칙을 따르게 한다.
  const appSessions = new Set<string>();

  function remember(view: BoundView, session: string): void {
    appSessions.add(session);
    const known = owned.get(view.view_session) ?? new Set<string>();
    known.add(session);
    owned.set(view.view_session, known);
  }

  /** session이 이 view의 앱 workspace의 것이면 undefined, 아니면 돌려줄 실패다. 없는 session도 forbidden이다. */
  async function check(
    view: BoundView,
    session: unknown,
  ): Promise<CallOutcome<never> | undefined> {
    if (typeof session !== "string") {
      return fail("invalid_input", "session is invalid");
    }
    if (owned.get(view.view_session)?.has(session)) return undefined;
    const read = await deps.call("read", "sessions", "read", { session });
    if (!read.ok) {
      switch (read.error.code) {
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
    const workspace = record(record(record(read.value)?.session)?.workspace);
    if (workspace?.kind !== "app" || workspace.id !== view.target.app)
      return NOT_YOURS;
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
          (key) => key === "agent" || key === "title",
        ) ||
        typeof input.agent !== "string" ||
        (title !== undefined &&
          (typeof title !== "string" || title.trim() === ""))
      ) {
        return fail("invalid_input", "input is invalid");
      }
      // 앱은 agent를 handle로 부른다. 이 앱 workspace에서 보이는 agent(전역과 이 앱의 범위 agent) 가운데서 id를 푼다.
      const listed = await deps.call("read", "agents", "list", {
        workspace: { kind: "app", id: view.target.app },
      });
      if (!listed.ok) return listed;
      const key = input.agent.trim().toLowerCase();
      const agents = record(listed.value)?.agents;
      const found = (Array.isArray(agents) ? agents : [])
        .map(record)
        .find(
          (row) =>
            typeof row?.handle === "string" &&
            row.handle.trim().toLowerCase() === key,
        );
      if (typeof found?.agent !== "string") {
        return fail("not_found", "agent not found");
      }
      const id = deps.ids.newId("ses");
      const opened = await deps.call("command", "sessions", "open", {
        input: {
          id,
          agent: found.agent,
          workspace: { kind: "app", id: view.target.app },
        },
        idempotency_key: `app-agent-open-${id}`,
        compare: {},
        prepared: [],
      });
      if (!opened.ok) return opened;
      remember(view, id);
      // 제목은 겉모습이라 못 붙여도 session은 이미 열렸다. 앱은 `rename`으로 다시 붙일 수 있다.
      if (typeof title === "string") {
        await deps.call("memory", "acp", "send", {
          type: "rename",
          session: id,
          key: `app-agent-title-${id}`,
          title,
        });
      }
      return { ok: true, value: { session: id } };
    },

    async snapshot(
      view: BoundView,
      value: unknown,
    ): Promise<CallOutcome<unknown>> {
      const session = record(value)?.session;
      const refused = await check(view, session);
      if (refused !== undefined) return refused;
      return await deps.call("read", "acp", "snapshot", { session });
    },

    async send(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      if (!ALLOWED_INPUTS.includes(record(value)?.type)) {
        return fail("forbidden", "an app cannot send this input");
      }
      const refused = await check(view, record(value)?.session);
      if (refused !== undefined) return refused;
      // 크기 상한과 입력 검사는 AcpSend의 것을 따른다.
      const sent = await deps.call("memory", "acp", "send", value);
      return sent.ok ? { ok: true, value: undefined } : sent;
    },

    /** 앱 화면이 연(또는 다시 붙어 확인한) session이다. 알림 규칙이 turn 끝 알림을 거르는 데 쓴다. */
    isAppSession(session: string): boolean {
      return appSessions.has(session);
    },

    /** 그 session을 지금 쥔 view들. 그중 focus 창에 보이는 것이 있으면 사람이 보고 있다. */
    viewsOf(session: string): string[] {
      return [...owned]
        .filter(([, sessions]) => sessions.has(session))
        .map(([view_session]) => view_session);
    },

    /** core의 `AcpUpdated`. 그 session을 이 앱 workspace의 것으로 확인한 view에만 보낸다. */
    updated(payload: { session: string; update: unknown }): void {
      for (const [view_session, sessions] of owned) {
        if (!sessions.has(payload.session)) continue;
        if (!deps.send(view_session, APP_AGENT_UPDATE_CHANNEL, payload)) {
          owned.delete(view_session);
        }
      }
    },
  };
}
