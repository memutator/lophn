import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentGrant,
  type AgentGrantEntry,
  agentGrantSchema,
  agentKey,
} from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored agent grant" });
}

function grantOf(
  agent: AgentRef | string,
  entries: unknown,
): Result<AgentGrant> {
  let parsedEntries: unknown;
  let parsedAgent: unknown;
  try {
    parsedEntries = JSON.parse(String(entries));
    parsedAgent = typeof agent === "string" ? JSON.parse(agent) : agent;
  } catch {
    return invalidStored();
  }
  const parsed = agentGrantSchema.safeParse({
    agent: parsedAgent,
    entries: parsedEntries,
  });
  return parsed.success ? ok(parsed.data) : invalidStored();
}

// 줄이 없는 agent는 아무 대상도 열려 있지 않다.
export function loadAgentGrant(
  sql: Pick<Sql, "get">,
  agent: AgentRef,
): Result<AgentGrant> {
  const row = sql.get("select entries from agent_grants where agent = ?", [
    agentKey(agent),
  ]);
  if (row === undefined) return ok({ agent, entries: [] });
  return grantOf(agent, row["entries"]);
}

export function saveAgentGrant(
  tx: Pick<Tx, "sql" | "now">,
  agent: AgentRef,
  entries: readonly AgentGrantEntry[],
): void {
  tx.sql.run(
    `insert into agent_grants (agent, entries, updated_at) values (?, ?, ?)
     on conflict (agent) do update
     set entries = excluded.entries, updated_at = excluded.updated_at`,
    [agentKey(agent), canonicalize(entries), tx.now()],
  );
}

// release에서 빠진 app-api의 override를 모든 agent grant에서 지운다.
// 새로 더해진 app-api는 apis에 없으므로 효과별 기본값으로 들어온다. 사람이 바꾼 것은 그대로다.
// activation 성공 단계가 부른다.
export function pruneAgentGrantApis(
  tx: Pick<Tx, "sql" | "now">,
  app: string,
  apiNames: readonly string[],
): Result<void> {
  const kept = new Set(apiNames);
  for (const row of tx.sql.all("select agent, entries from agent_grants", [])) {
    const grant = grantOf(String(row["agent"]), row["entries"]);
    if (!grant.ok) return grant;
    let changed = false;
    const entries = grant.value.entries.map((entry) => {
      if (entry.kind !== "app" || entry.app !== app) return entry;
      const apis = entry.apis.filter((one) => kept.has(one.api));
      if (apis.length === entry.apis.length) return entry;
      changed = true;
      return { ...entry, apis };
    });
    if (changed) saveAgentGrant(tx, grant.value.agent, entries);
  }
  return ok(undefined);
}
