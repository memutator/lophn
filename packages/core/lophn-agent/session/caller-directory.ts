import { ok, type Result } from "../../../base/mod.ts";
import type { AgentRef, Place } from "../../../protocol/lophn-agent/places.ts";
import { agentRefOf, loadSession, placeOf } from "./model.ts";

type Sql = Parameters<typeof loadSession>[0]["sql"];

// apps의 CallerDirectory port와 같은 모양이다. lophn-agent는 apps를 import하지 않아 type을 다시 적는다.
type CallerOf = {
  agentToolCall(
    session: string,
    turn: string,
    toolCall: string,
  ): Result<{ agent: AgentRef; place: Place | null } | null>;
};

// tool을 부른 tool call이 지금 도는 turn의 것인지 확인하고 그 agent와 놓인 곳을 준다. 아니면 null.
export function createCallerDirectory(sql: Sql): CallerOf {
  return {
    agentToolCall(session, turn, toolCall) {
      const running = sql.get(
        `select 1 as found from tool_calls c join turns t on t.id = c.turn
          where c.id = ? and c.turn = ? and t.session = ? and t.state = 'running'`,
        [toolCall, turn, session],
      );
      if (running === undefined) return ok(null);
      const row = loadSession({ sql }, session);
      if (row === undefined) return ok(null);
      return ok({ agent: agentRefOf(row), place: placeOf(row) });
    },
  };
}
