// 앱 view의 agent 길 main service. 앱 화면이 자기 앱 place의 session을 열고, ACP 상태를 읽고, 입력을 보내고,
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

export function createAppAgent(deps: AppAgentDeps) {
  // 이 view가 열었거나 읽어서 앱 place의 것으로 확인한 session. 갱신을 거를 때 쓴다(session의 place는 열 때 정해져 안 바뀐다).
  const owned = new Map<string, Set<string>>();

  function remember(view: BoundView, session: string): void {
    const known = owned.get(view.view_session) ?? new Set<string>();
    known.add(session);
    owned.set(view.view_session, known);
  }

  /** session이 이 view의 앱 place의 것이면 undefined, 아니면 돌려줄 실패다. 없는 session도 forbidden이다. */
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
    const place = record(record(record(read.value)?.session)?.place);
    if (place?.kind !== "app" || place.id !== view.target.app) return NOT_YOURS;
    remember(view, session);
    return undefined;
  }

  return {
    async open(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const input = record(value);
      if (
        input === undefined ||
        Object.keys(input).join() !== "agent" ||
        typeof input.agent !== "string"
      ) {
        return fail("invalid_input", "input is invalid");
      }
      const id = deps.ids.newId("ses");
      const opened = await deps.call("command", "sessions", "open", {
        input: {
          id,
          agent: input.agent,
          place: { kind: "app", id: view.target.app },
        },
        idempotency_key: `app-agent-open-${id}`,
        compare: {},
        prepared: [],
      });
      if (!opened.ok) return opened;
      remember(view, id);
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
      const refused = await check(view, record(value)?.session);
      if (refused !== undefined) return refused;
      // 크기 상한과 입력 검사는 AcpSend의 것을 따른다.
      const sent = await deps.call("memory", "acp", "send", value);
      return sent.ok ? { ok: true, value: undefined } : sent;
    },

    /** core의 `AcpUpdated`. 그 session을 이 앱 place의 것으로 확인한 view에만 보낸다. */
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
