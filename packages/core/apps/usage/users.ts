import { ok, type Result } from "../../../base/mod.ts";
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { AgentDirectory } from "../../lophn-agent/agents/directory.ts";
import { workspaceDepsOf } from "../../lophn-agent/workspaces/mod.ts";
import { loadApp, loadApps } from "../registration/store.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

type Query = Pick<Sql, "get" | "all">;

export type ToolUser = {
  tool: string;
  // 부른 agent가 놓인 곳.
  workspace: Workspace;
};

// 한 agent의 다른 컴퓨터 앱 할당. 정의 파일의 `remote_apps`를 `{app, machine, name, removed_tools, ask_tools?}`로 푼다.
// 이 컴퓨터의 앱은 할당이 아니라 skill 배포가 닿게 한다(`deployments`).
export function agentAssignment(
  sql: Query,
  agent: AgentId,
  agents: AgentDirectory = workspaceDepsOf(sql).agents,
): Result<Assignment> {
  const info = agents.agent(agent);
  if (info === null) return ok({ agent, entries: [] });
  return ok({
    agent,
    entries: info.remoteApps.map((line) => {
      const removedSet = new Set(line.removed);
      const askTools = (line.ask ?? []).filter((tool) => !removedSet.has(tool));
      return {
        app: line.app,
        machine: line.machine,
        name: line.name,
        removed_tools: [...line.removed],
        ...(askTools.length > 0 ? { ask_tools: askTools } : {}),
      };
    }),
  });
}

// 이 앱의 tool을 쓰는 다른 앱·project: 정적 선언(다른 활성 앱의 app_connections, 활성 job의 tool_run)과
// 과거 agent 호출 기록(invocations)을 합쳐 중복 없이 낸다. home과 그 앱 자신의 workspace는 세지 않는다.
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
  if (names.size === 0) return ok([]);

  const target = loadApp(sql, app);
  if (!target.ok) return target;
  const targetSlug = target.value?.slug ?? null;

  const found = new Map<string, ToolUser>();
  const add = (tool: string, workspace: Workspace | null | undefined) => {
    if (!names.has(tool)) return;
    if (workspace === undefined || workspace === null) return;
    if (workspace.kind === "app" && workspace.id === app) return;
    found.set(JSON.stringify([tool, workspace]), { tool, workspace });
  };

  // 1. 과거 agent 호출 기록(invocations).
  const calls = sql.all(
    `select distinct json_extract(operation, '$.name') as tool, session
       from invocations
      where app = ? and caller_kind = 'agent'
        and json_extract(operation, '$.kind') = 'command'`,
    [app],
  );
  for (const row of calls) {
    const tool = String(row["tool"]);
    const workspace = ports.sessionWorkspace(String(row["session"]))?.workspace;
    add(tool, workspace);
  }

  // 2. 다른 활성 앱의 활성 선언 app_connections.
  const activeApps = loadApps(sql, "active");
  if (!activeApps.ok) return activeApps;
  for (const other of activeApps.value) {
    if (other.id === app) continue;
    const decl = loadActiveDeclaration(sql, other.id);
    if (!decl.ok) return decl;
    for (const conn of decl.value?.declaration.app_connections ?? []) {
      if (
        conn.app !== app &&
        (targetSlug === null || conn.app !== targetSlug)
      ) {
        continue;
      }
      for (const tool of conn.commands) {
        add(tool, { kind: "app", id: other.id });
      }
    }
  }

  // 3. 활성 job(tool_run) 등 다른 module의 정적 선언 사용처.
  for (const use of ports.declaredToolUsers?.(app) ?? []) {
    add(use.tool, use.workspace);
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
