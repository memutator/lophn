import type { ToolCall } from "../../../../packages/protocol/lophn-agent/mod.ts";
import type { Participant, SessionRecord } from "../../types.ts";
import { fixtureSession, type FxStep } from "../fixtures.ts";

const APP_API_PREFIX = "app__fx__";

// 이름이 `app__fx__<command>`인 step을 app-api tool call로 만든다. landed fixtureSession은 app_api를 늘 null로 둔다.
export function appApiSession(
  agent: Participant,
  steps: FxStep[],
): SessionRecord {
  const session = fixtureSession(agent, steps);
  for (const c of session.tool_calls) {
    if (!c.call.tool.startsWith(APP_API_PREFIX)) continue;
    c.call.app_api = {
      app: "app_fx_x",
      release: "rel_fx",
      command: c.call.tool.slice(APP_API_PREFIX.length),
      blueprint_hash: "0".repeat(64),
      definition_hash: "0".repeat(64),
      permission_basis: { grant: "grt_fx", scope: "fx", basis_seq: "0" },
      context_binding: null,
    } as unknown as ToolCall["app_api"];
  }
  return session;
}

// 그 session의 sent_calls에 coding agent로 간 call 하나를 더한다. landed FixtureCall.to는 Participant라 coding agent를 못 받는다.
export function addCodingCall(
  session: SessionRecord,
  app: string,
  body = "fixture",
): SessionRecord {
  const order = session.sent_calls.length;
  return {
    ...session,
    sent_calls: [...session.sent_calls, {
      tool_call: `tcl_fx_c${order}`,
      order,
      to: { role: "coding_agent", place: { app } },
      reply: "conversation",
      body,
      outcome: { kind: "success", code: "ok" },
      call: null,
      state: "accepted",
      fail_reason: null,
      record: null,
      receiver: null,
      receiver_session: null,
      receiver_place: null,
    }],
  };
}
