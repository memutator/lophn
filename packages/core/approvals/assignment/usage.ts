import { err, ok, type Result } from "../../../base/mod.ts";
import { agentAssignmentSchema } from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 앱을 할당받은 agent와 그 앱에서 뺀(removed) tool. 앱 줄이 있으면 뺀 것 말고는 전부 열려 있다.
// 사용 관계(app.usage)가 읽는다.
export type AppAssignee = { agent: AgentRef; removed: ReadonlySet<string> };

export function appAssignees(
  sql: Pick<Sql, "all">,
  app: string,
): Result<AppAssignee[]> {
  const assignees: AppAssignee[] = [];
  for (
    const row of sql.all("select agent, entries from agent_assignments", [])
  ) {
    let parsed;
    try {
      parsed = agentAssignmentSchema.safeParse({
        agent: JSON.parse(String(row["agent"])),
        entries: JSON.parse(String(row["entries"])),
      });
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || !parsed.success) {
      return err({
        code: "internal",
        message: "invalid stored agent assignment",
      });
    }
    for (const entry of parsed.data.entries) {
      if (entry.app !== app) continue;
      assignees.push({
        agent: parsed.data.agent,
        removed: new Set(entry.removed_tools),
      });
    }
  }
  return ok(assignees);
}
