import { ok, type Result } from "../../../base/mod.ts";
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { wordsOf } from "../../../cli/parser.ts";
import type { AgentDirectory } from "../../lophn-agent/agents/directory.ts";
import { workspaceDepsOf } from "../../lophn-agent/workspaces/mod.ts";
import { loadApps } from "../registration/store.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

type Query = Pick<Sql, "get" | "all">;

export type ToolUser = {
  tool: string;
  // 부른 agent가 놓인 곳.
  workspace: Workspace;
};

// 할당에서 뺀 command를 agent 정의의 permissions.deny에 적는 글이다: `lophn(<앱 slug> <command 낱말>)`.
export function denyRuleOf(slug: string, name: string): string {
  return `lophn(${slug} ${wordsOf(name).join(" ")})`;
}

// 앱의 active 선언 가운데 deny에 적힌 command의 이름. active release가 없으면 뺄 것이 없다.
function removedCommands(
  sql: Query,
  app: { id: string; slug: string },
  deny: readonly string[],
): Result<string[]> {
  if (deny.length === 0) return ok([]);
  const active = loadActiveDeclaration(sql, app.id);
  if (!active.ok) return active;
  return ok(
    (active.value?.declaration.commands ?? [])
      .filter((command) => deny.includes(denyRuleOf(app.slug, command.name)))
      .map((command) => command.name),
  );
}

// 한 agent의 할당. 정의 파일의 `apps`(slug)와 `permissions.deny`를 앱 id와 뺀 command 이름으로 푼다.
// 없는 앱 slug는 건너뛴다.
export function agentAssignment(
  sql: Query,
  agent: AgentId,
  agents: AgentDirectory = workspaceDepsOf(sql).agents,
): Result<Assignment> {
  const info = agents.agent(agent);
  if (info === null || info.apps.length === 0) {
    return ok({ agent, entries: [] });
  }
  const known = loadApps(sql, undefined);
  if (!known.ok) return known;
  const entries: Assignment["entries"] = [];
  for (const slug of info.apps) {
    const app = known.value.find((item) => item.slug === slug);
    if (app === undefined) continue;
    const removed = removedCommands(sql, app, info.deny);
    if (!removed.ok) return removed;
    entries.push({ app: app.id, removed_tools: removed.value });
  }
  return ok({ agent, entries });
}

// 이 앱의 tool을 부른 다른 앱·project: 앱 tool을 부른 agent session이 놓인 곳이다. home과 그 앱 자신의 workspace는 세지 않는다.
// 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 한다.
export function appToolUsers(
  sql: Query,
  ports: UsagePorts,
  app: string,
): Result<ToolUser[]> {
  const active = loadActiveDeclaration(sql, app);
  if (!active.ok) return active;
  const names = new Set(
    (active.value?.declaration.commands ?? []).map((tool) => tool.name),
  );

  const found = new Map<string, ToolUser>();
  const calls = sql.all(
    `select distinct json_extract(operation, '$.name') as tool, session
       from invocations
      where app = ? and caller_kind = 'agent'
        and json_extract(operation, '$.kind') = 'command'`,
    [app],
  );
  for (const row of calls) {
    const tool = String(row["tool"]);
    if (!names.has(tool)) continue;
    const workspace = ports.sessionWorkspace(String(row["session"]))?.workspace;
    if (workspace === undefined || workspace === null) continue;
    if (workspace.kind === "app" && workspace.id === app) continue;
    found.set(JSON.stringify([tool, workspace]), { tool, workspace });
  }

  return ok(
    [...found.values()].sort(
      (a, b) =>
        order(a.tool, b.tool) ||
        order(workspaceKey(a.workspace), workspaceKey(b.workspace)),
    ),
  );
}

export function workspaceKey(workspace: Workspace): string {
  return `${workspace.kind}:${workspace.id}`;
}

export function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
