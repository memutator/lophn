import type { ToolCall } from "../../../../packages/protocol/lophn-agent/mod.ts";
import type { Participant, SessionRecord } from "../../types.ts";
import { fixtureSession, type FxStep } from "../fixtures.ts";

const APP_TOOL_PREFIX = "domain__fx__";

// 이름이 `domain__fx__<command>`인 step을 tool call로 만든다. landed fixtureSession은 app_tool을 늘 null로 둔다.
export function appToolSession(
  agent: Participant,
  steps: FxStep[],
): SessionRecord {
  const session = fixtureSession(agent, steps);
  for (const c of session.tool_calls) {
    if (!c.call.tool.startsWith(APP_TOOL_PREFIX)) continue;
    c.call.app_tool = {
      app: "app_fx_x",
      release: "rel_fx",
      command: c.call.tool.slice(APP_TOOL_PREFIX.length),
      blueprint_hash: "0".repeat(64),
      definition_hash: "0".repeat(64),
      permission_basis: { grant: "grt_fx", scope: "fx", basis_seq: "0" },
    } as unknown as ToolCall["app_tool"];
  }
  return session;
}
