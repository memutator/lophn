// agent grant를 읽고 저장하는 부분과 붙일 수 있는 대상 목록. 붙은 것은 agent_grants가, 붙일 수 있는 앱과 app-api는
// 앱 목록과 활성 release의 blueprint가, 부를 수 있는 agent는 agent 정의 목록이 말한다.
// 붙일 수 있는 MCP tool은 core가 서버에 연결해 읽은 목록(agent-mcp-tools/list)이 말한다.
import {
  type AgentGrantEntry,
  agentKey,
} from "../../../../protocol/approvals/grants.ts";
import { agentGrantsSet } from "../../../../protocol/approvals/grants.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
import type { AgentDefinitionRow } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { CallAgent } from "../../../../protocol/lophn-agent/calls.ts";
import type { McpToolServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import { isAppPlace, refOf } from "./agent-key.ts";
import { type Link, unavailable } from "./core-link.ts";
import { appsFor } from "./editor/grants-model.ts";
import type {
  GrantApp,
  GrantCatalog,
  GrantsView,
  ReadResult,
} from "./source.ts";

interface AppRow {
  id: string;
  name: string;
  project: string;
}

interface BlueprintValue {
  tools: {
    name: string;
    description: string;
    effect: "read" | "write" | "external";
    public: boolean;
  }[];
}

async function appCatalog(
  link: Link,
  names: Map<string, string>,
): Promise<GrantApp[]> {
  const apps = await link.read<{ apps: (AppRow & { status: string })[] }>(
    "apps",
    "list",
    {},
  );
  if (!apps.ok) return [];
  const found: GrantApp[] = [];
  for (const app of apps.value.apps) {
    names.set(app.id, app.name);
    if (app.status !== "active") continue;
    // 활성 release가 없는 앱은 blueprint가 없다. 붙일 수 없어 목록에서 뺀다.
    const blueprint = await link.read<BlueprintValue>("apps", "app_api", {
      app: app.id,
    });
    if (!blueprint.ok) continue;
    found.push({
      app: app.id,
      name: app.name,
      release: null,
      apis: blueprint.value.tools.map((command) => ({
        api: command.name,
        detail: command.description,
        effect: command.effect,
        addedIn: null,
        public: command.public,
      })),
    });
  }
  return found;
}

/** 읽은 서버의 tool. 읽지 못한 서버(reason이 있는 서버)는 붙일 tool이 없어 뺀다. */
async function mcpCatalog(
  link: Link,
  place: string | null,
  ref: AgentRef,
): Promise<GrantCatalog["mcpServers"]> {
  const body = place === null
    ? null
    : { kind: isAppPlace(place) ? "app" : "project", id: place };
  const read = await link.memory<{ servers: McpToolServer[] }>(
    "agent-mcp-tools",
    "list",
    { place: body, agent: ref.role === "operator" ? ref.agent : null },
  );
  if (!read.ok) return [];
  return read.value.servers.filter((one) => one.reason === null).map((one) => ({
    server: one.name,
    tools: one.tools.map((tool) => ({
      tool: tool.tool,
      detail: tool.description,
      effect: tool.effect,
    })),
  }));
}

/** 부를 수 있는 agent. 자기 자신은 뺀다. detail은 놓인 곳의 이름이다. */
async function agentCatalog(
  link: Link,
  self: AgentRef,
  placeNames: ReadonlyMap<string, string>,
): Promise<GrantCatalog["agents"]> {
  const rows = await link.read<{ agents: AgentDefinitionRow[] }>(
    "agent-definitions",
    "list",
    {},
  );
  if (!rows.ok) return [];
  return rows.value.agents.filter((row) =>
    agentKey(row.agent) !== agentKey(self)
  ).map((row) => ({
    agent: row.agent as CallAgent,
    name: row.name,
    detail: row.place === null ? "" : placeNames.get(row.place.id) ?? "",
  }));
}

async function projectNames(link: Link): Promise<Map<string, string>> {
  const projects = await link.read<
    { projects: { id: string; title: string }[] }
  >(
    "projects",
    "list",
    {},
  );
  return new Map(
    projects.ok
      ? projects.value.projects.map((one) => [one.id, one.title])
      : [],
  );
}

export async function readGrants(
  link: Link,
  place: string | null,
  key: string,
): Promise<ReadResult<GrantsView>> {
  const ref = refOf(place, key);
  if (ref === null) return { ok: false, message: "not_found" };
  const grant = await link.read<{ grant: { entries: AgentGrantEntry[] } }>(
    "agent_grants",
    "get",
    { agent: ref },
  );
  if (!grant.ok) return grant;
  const names = await projectNames(link);
  // MCP 연결이 느린 서버가 있어도 다른 목록이 그만큼 더 늦지 않게 함께 읽는다. agent 목록은 appCatalog가
  // 채우는 앱 이름을 쓰므로 그 뒤에 읽는다.
  const [mcpServers, [apps, agents]] = await Promise.all([
    mcpCatalog(link, place, ref),
    appCatalog(link, names).then(async (apps) =>
      [apps, await agentCatalog(link, ref, names)] as const
    ),
  ]);
  return {
    ok: true,
    value: {
      entries: grant.value.grant.entries,
      catalog: { apps: appsFor(apps, place), mcpServers, agents },
    },
  };
}

export function saveGrants(
  link: Link,
  place: string | null,
  key: string,
  entries: readonly AgentGrantEntry[],
): Promise<ReadResult<null>> {
  const ref = refOf(place, key);
  if (ref === null) return Promise.resolve(unavailable);
  return link.command(agentGrantsSet, {
    input: { agent: ref, entries },
    compare: {},
  }).then(
    (reply) =>
      reply.ok ? { ok: true, value: null } : { ok: false, message: reply.code },
  );
}
