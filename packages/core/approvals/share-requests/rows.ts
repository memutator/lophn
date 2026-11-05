import type { Sql } from "../../../protocol/server/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";

type Query = Pick<Sql, "get" | "all">;

export type ShareRow = {
  app: string;
  agents: AgentId[];
  coding_agents: boolean;
  reason: string;
  session: string;
  requested_at: string;
};

function rowOf(row: Record<string, unknown>): ShareRow {
  return {
    app: String(row["app"]),
    agents: JSON.parse(String(row["agents"])) as AgentId[],
    coding_agents: Number(row["coding_agents"]) === 1,
    reason: String(row["reason"]),
    session: String(row["session"]),
    requested_at: String(row["requested_at"]),
  };
}

export function loadShare(sql: Query, app: string): ShareRow | null {
  const row = sql.get("select * from share_requests where app = ?", [app]);
  return row === undefined ? null : rowOf(row);
}

// 오래된 것부터 준다.
export function allShares(sql: Query): ShareRow[] {
  return sql
    .all("select * from share_requests order by requested_at, app", [])
    .map(rowOf);
}
