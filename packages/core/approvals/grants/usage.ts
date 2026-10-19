import { err, ok, type Result } from "../../../base/mod.ts";
import { agentGrantSchema } from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 앱을 맡은 agent와 그 앱에서 뺀(excluded) tool. 앱 항목이 있으면 뺀 것 말고는 전부 열려 있다.
// 사용 관계(app.usage)가 읽는다.
export type AppGrantee = { agent: AgentRef; excluded: ReadonlySet<string> };

export function appGrantees(
  sql: Pick<Sql, "all">,
  app: string,
): Result<AppGrantee[]> {
  const grantees: AppGrantee[] = [];
  for (const row of sql.all("select agent, entries from agent_grants", [])) {
    let parsed;
    try {
      parsed = agentGrantSchema.safeParse({
        agent: JSON.parse(String(row["agent"])),
        entries: JSON.parse(String(row["entries"])),
      });
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || !parsed.success) {
      return err({ code: "internal", message: "invalid stored agent grant" });
    }
    for (const entry of parsed.data.entries) {
      if (entry.kind !== "app" || entry.app !== app) continue;
      grantees.push({
        agent: parsed.data.agent,
        excluded: new Set(
          entry.apis.filter((one) => one.setting === "excluded").map((one) =>
            one.api
          ),
        ),
      });
    }
  }
  return ok(grantees);
}
