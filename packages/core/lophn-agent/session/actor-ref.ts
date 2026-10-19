import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { agentRefOf, loadSession } from "./model.ts";

// session id → agent ref. approvals의 grant read가 agent 호출자의 자기 ref를 알 때 쓴다.
export function agentOfSession(
  sql: Pick<Sql, "get">,
): { agentOf(session: string): AgentRef | undefined } {
  return {
    agentOf(session) {
      const row = loadSession({ sql }, session);
      return row === undefined ? undefined : agentRefOf(row);
    },
  };
}
