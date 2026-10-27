import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { appAssignees } from "../../approvals/assignment/usage.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

export type ToolUser = {
  tool: string;
  // 쓰는 쪽 domain id.
  domain: string;
  source: "grant" | "invocation";
};

// 이 앱의 tool을 쓰는 다른 domain. 재료는 둘이다.
// - grant(할당): 앱을 할당받은 agent가 맡은 domain. 앱의 공개 tool 가운데 그 agent가 뺀 것이 아니면 쓰는 것으로 센다.
// - invocation: 앱 tool을 부른 agent session이 맡은 domain.
// tool 자신의 domain에서 쓰는 것은 세지 않는다. 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 한다.
export function appToolUsers(
  sql: Pick<Sql, "get" | "all">,
  ports: UsagePorts,
  app: string,
): Result<ToolUser[]> {
  const active = loadActiveDeclaration(sql, app);
  if (!active.ok) return active;
  const tools = active.value?.declaration.tools ?? [];
  const domainOfTool = new Map<string, string>();
  for (const tool of tools) {
    const domain = ports.domainOf(app, tool.domain);
    if (domain === null) {
      return err({ code: "internal", message: "tool domain not found" });
    }
    domainOfTool.set(tool.name, domain);
  }

  const found = new Map<string, ToolUser>();
  const add = (tool: string, domain: string, source: ToolUser["source"]) => {
    if (domain === domainOfTool.get(tool)) return;
    found.set(JSON.stringify([tool, domain, source]), { tool, domain, source });
  };

  const assignees = appAssignees(sql, app);
  if (!assignees.ok) return assignees;
  for (const { agent, removed } of assignees.value) {
    for (const domain of ports.agentDomains(agent)) {
      for (const tool of tools) {
        if (tool.public && !removed.has(tool.name)) {
          add(tool.name, domain, "grant");
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
    const tool = String(row["tool"]);
    if (!domainOfTool.has(tool)) continue;
    const session = ports.sessionDomains(String(row["session"]));
    for (const domain of session?.domains ?? []) {
      add(tool, domain, "invocation");
    }
  }

  return ok(
    [...found.values()].sort(
      (a, b) =>
        order(a.tool, b.tool) ||
        order(a.domain, b.domain) ||
        order(a.source, b.source),
    ),
  );
}

export function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
