import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentAssignment,
  agentAssignmentSchema,
  type AssignmentEntry,
} from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";

export type AssignmentRow = { assignment: AgentAssignment; revision: number };

// 줄이 없는 agent는 아무 앱도 할당되지 않았고 revision은 0이다.
export function loadAssignmentRow(
  sql: Pick<Sql, "get">,
  agent: AgentRef,
): Result<AssignmentRow> {
  const row = sql.get(
    "select entries, revision from agent_assignments where agent = ?",
    [canonicalize(agent)],
  );
  if (row === undefined) {
    return ok({ assignment: { agent, entries: [] }, revision: 0 });
  }
  let entries: unknown;
  try {
    entries = JSON.parse(String(row["entries"]));
  } catch {
    return invalidStored();
  }
  const parsed = agentAssignmentSchema.safeParse({ agent, entries });
  if (!parsed.success) return invalidStored();
  return ok({ assignment: parsed.data, revision: Number(row["revision"]) });
}

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored agent assignment" });
}

export function loadAssignment(
  sql: Pick<Sql, "get">,
  agent: AgentRef,
): Result<AgentAssignment> {
  const row = loadAssignmentRow(sql, agent);
  return row.ok ? ok(row.value.assignment) : row;
}

export function saveAssignment(
  tx: Pick<Tx, "sql" | "now">,
  agent: AgentRef,
  entries: readonly AssignmentEntry[],
  revision: number,
): void {
  tx.sql.run(
    `insert into agent_assignments (agent, entries, revision, updated_at) values (?, ?, ?, ?)
     on conflict (agent) do update
     set entries = excluded.entries, revision = excluded.revision, updated_at = excluded.updated_at`,
    [canonicalize(agent), canonicalize(entries), revision, tx.now()],
  );
}
