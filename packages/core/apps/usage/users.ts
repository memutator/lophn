import { ok, type Result } from "../../../base/mod.ts";
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import type { AgentId, Place } from "../../../protocol/lophn-agent/places.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { wordsOf } from "../../../cli/parser.ts";
import type { AgentDirectory } from "../../lophn-agent/agents/directory.ts";
import { placeDepsOf } from "../../lophn-agent/places/mod.ts";
import { loadApp, loadApps } from "../registration/store.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

type Query = Pick<Sql, "get" | "all">;

export type ToolUser = {
  tool: string;
  // 쓰는 쪽 agent가 놓인 곳.
  place: Place;
  source: "grant" | "invocation";
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
  agents: AgentDirectory = placeDepsOf(sql).agents,
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

// 앱을 할당받은 agent와 그 앱에서 뺀(removed) command. 앱이 할당돼 있으면 뺀 것 말고는 전부 열려 있다.
// 사용 관계(app.usage)가 읽는다.
export type AppAssignee = { agent: AgentId; removed: ReadonlySet<string> };

export function appAssignees(
  sql: Query,
  app: string,
  agents: AgentDirectory = placeDepsOf(sql).agents,
): Result<AppAssignee[]> {
  const found = loadApp(sql, app);
  if (!found.ok) return found;
  if (found.value === null) return ok([]);
  const assignees: AppAssignee[] = [];
  for (const info of agents.agents()) {
    if (!info.apps.includes(found.value.slug)) continue;
    const removed = removedCommands(sql, found.value, info.deny);
    if (!removed.ok) return removed;
    assignees.push({ agent: info.id, removed: new Set(removed.value) });
  }
  return ok(assignees);
}

// 이 앱의 tool을 쓰는 다른 앱·project. 재료는 둘이다.
// - grant(할당): 앱을 할당받은 agent의 session이 놓였던 곳. 앱의 공개 tool 가운데 그 agent가 뺀 것이 아니면 쓰는 것으로 센다.
// - invocation: 앱 tool을 부른 agent session이 놓인 곳. home은 세지 않는다.
// 그 앱 자신의 place에서 쓰는 것은 세지 않는다. 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 한다.
export function appToolUsers(
  sql: Query,
  ports: UsagePorts,
  app: string,
): Result<ToolUser[]> {
  const active = loadActiveDeclaration(sql, app);
  if (!active.ok) return active;
  const tools = active.value?.declaration.commands ?? [];
  const names = new Set(tools.map((tool) => tool.name));

  const found = new Map<string, ToolUser>();
  const add = (tool: string, place: Place, source: ToolUser["source"]) => {
    if (place.kind === "app" && place.id === app) return;
    found.set(JSON.stringify([tool, place, source]), { tool, place, source });
  };

  const assignees = appAssignees(sql, app);
  if (!assignees.ok) return assignees;
  for (const { agent, removed } of assignees.value) {
    for (const place of ports.agentPlaces(agent)) {
      for (const tool of tools) {
        if (tool.public && !removed.has(tool.name)) {
          add(tool.name, place, "grant");
        }
      }
    }
  }

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
    const place = ports.sessionPlace(String(row["session"]))?.place;
    if (place !== undefined && place !== null) add(tool, place, "invocation");
  }

  return ok(
    [...found.values()].sort(
      (a, b) =>
        order(a.tool, b.tool) ||
        order(placeKey(a.place), placeKey(b.place)) ||
        order(a.source, b.source),
    ),
  );
}

export function placeKey(place: Place): string {
  return `${place.kind}:${place.id}`;
}

export function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
