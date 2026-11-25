import { ok, type Result } from "../../../base/mod.ts";
import { wordsOf } from "../../../cli/parser.ts";
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

// 할당에서 뺀 command를 agent 정의의 permissions.deny에 적는 글이다: `lophn(<앱 slug> <command 낱말>)`.
export function denyRuleOf(slug: string, name: string): string {
  return `lophn(${slug} ${wordsOf(name).join(" ")})`;
}

// 앱의 active 선언 가운데 규칙 목록(deny·ask)에 적힌 command의 이름. active release가 없으면 뺄 것이 없다.
function matchingCommands(
  sql: Query,
  app: { id: string; slug: string },
  rules: readonly string[],
): Result<string[]> {
  if (rules.length === 0) return ok([]);
  const active = loadActiveDeclaration(sql, app.id);
  if (!active.ok) return active;
  return ok(
    (active.value?.declaration.commands ?? [])
      .filter((command) => rules.includes(denyRuleOf(app.slug, command.name)))
      .map((command) => command.name),
  );
}

// 한 agent의 할당. 정의 파일의 `apps`(slug)와 `permissions.deny`·`permissions.ask`를 앱 id와 command 이름으로 풀고, 다른 기계의 앱(`remote_apps`)을
// 그 뒤에 `{app, machine, name, removed_tools, ask_tools?}`로 잇는다. 없는 앱 slug는 건너뛴다. 앱 범위 agent는 자기 앱을 사람의 할당 없이 받는다(deny·ask는 그대로 적용한다).
export function agentAssignment(
  sql: Query,
  agent: AgentId,
  agents: AgentDirectory = workspaceDepsOf(sql).agents,
): Result<Assignment> {
  const info = agents.agent(agent);
  const own = info?.workspace?.kind === "app" ? info.workspace.id : null;
  if (info === null) return ok({ agent, entries: [] });
  const remote: Assignment["entries"] = info.remoteApps.map((line) => {
    const removedSet = new Set(line.removed);
    const askTools = (line.ask ?? []).filter((tool) => !removedSet.has(tool));
    return {
      app: line.app,
      machine: line.machine,
      name: line.name,
      removed_tools: [...line.removed],
      ...(askTools.length > 0 ? { ask_tools: askTools } : {}),
    };
  });
  if (info.apps.length === 0 && own === null) {
    return ok({ agent, entries: remote });
  }
  const known = loadApps(sql, undefined);
  if (!known.ok) return known;
  const entries: Assignment["entries"] = [];
  const ownApp = known.value.find((item) => item.id === own);
  const wanted = [
    ...info.apps.map((slug) => known.value.find((item) => item.slug === slug)),
    ...(ownApp === undefined ? [] : [ownApp]),
  ];
  for (const app of wanted) {
    if (app === undefined || entries.some((entry) => entry.app === app.id)) {
      continue;
    }
    const removed = matchingCommands(sql, app, info.deny);
    if (!removed.ok) return removed;
    const ask = matchingCommands(sql, app, info.ask ?? []);
    if (!ask.ok) return ask;
    const removedSet = new Set(removed.value);
    const askTools = ask.value.filter((name) => !removedSet.has(name));
    entries.push({
      app: app.id,
      removed_tools: removed.value,
      ...(askTools.length > 0 ? { ask_tools: askTools } : {}),
    });
  }
  return ok({ agent, entries: [...entries, ...remote] });
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
