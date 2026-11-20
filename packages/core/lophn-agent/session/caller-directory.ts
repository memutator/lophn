import { ok, type Result } from "../../../base/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { loadSession, workspaceOf } from "./model.ts";

type Sql = Parameters<typeof loadSession>[0]["sql"];

// apps의 CallerDirectory port와 같은 모양이다. lophn-agent는 apps를 import하지 않아 type을 다시 적는다.
type CallerOf = {
  agentToolCall(
    session: string,
    turn: string,
    toolCall: string,
  ): Result<{
    agent: AgentId;
    workspace: Workspace | null;
    remote: boolean;
  } | null>;
};

// tool을 부른 tool call이 지금 도는 turn의 것인지 확인하고 그 agent와 놓인 곳을 준다. 아니면 null.
export function createCallerDirectory(
  sql: Sql,
  // 그 session이 다른 컴퓨터의 event로 연 job의 것인가(jobs 표는 apps wiring이 안다).
  remoteOrigin: (session: string) => boolean,
): CallerOf {
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
      return ok({
        agent: row.agent,
        workspace: workspaceOf(row),
        remote: remoteOrigin(session),
      });
    },
  };
}
