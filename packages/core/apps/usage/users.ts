import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { appGrantees } from "../../approvals/grants/usage.ts";
import { appProjectOf } from "../lookups.ts";
import { loadActiveBlueprint } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

export type ToolUser = {
  tool: string;
  project: Id<"prj">;
  source: "grant" | "invocation";
};

// 이 앱의 tool을 쓰는 다른 project. 재료는 둘이다.
// - grant: 앱을 맡은 agent의 project. 앱의 공개 tool 가운데 그 agent가 뺀 것이 아니면 쓰는 것으로 센다.
// - invocation: 앱 tool을 부른 agent session이 놓인 project.
// 앱 자신의 project는 뺀다. 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 한다.
export function appToolUsers(
  sql: Pick<Sql, "get" | "all">,
  ports: UsagePorts,
  app: string,
): Result<ToolUser[]> {
  const own = appProjectOf(sql, app);
  const found = new Map<string, ToolUser>();
  const add = (user: ToolUser) => {
    if (user.project === own) return;
    found.set(JSON.stringify([user.tool, user.project, user.source]), user);
  };

  const grantees = appGrantees(sql, app);
  if (!grantees.ok) return grantees;
  if (grantees.value.length > 0) {
    const active = loadActiveBlueprint(sql, app);
    if (!active.ok) return active;
    const tools = (active.value?.blueprint.tools ?? []).filter((tool) =>
      tool.public
    );
    for (const { agent, excluded } of grantees.value) {
      const project = ports.agentProject(agent);
      if (project === null) continue;
      for (const tool of tools) {
        if (!excluded.has(tool.name)) {
          add({ tool: tool.name, project, source: "grant" });
        }
      }
    }
  }

  const calls = sql.all(
    `select distinct json_extract(operation, '$.tool') as tool, session
       from invocations
      where app = ? and caller_kind = 'agent'
        and json_extract(operation, '$.kind') = 'tool'`,
    [app],
  );
  for (const row of calls) {
    const project = ports.sessionPlace(String(row["session"]))?.project;
    if (project) {
      add({ tool: String(row["tool"]), project, source: "invocation" });
    }
  }

  return ok(
    [...found.values()].sort((a, b) =>
      order(a.tool, b.tool) || order(a.project, b.project) ||
      order(a.source, b.source)
    ),
  );
}

export function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
