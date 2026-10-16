// agent grant를 읽고 저장하는 부분과 붙일 수 있는 대상 목록. 붙은 것은 agent_grants가, 붙일 수 있는 앱과 app-api는
// 앱 목록과 활성 release의 blueprint가, 부를 수 있는 agent는 agent 정의 목록이 말한다.
// 외부 MCP server의 tool 목록을 읽는 route가 없어 MCP tool 대상은 비어 있다.
import {
  type AgentGrantEntry,
  agentKey,
} from "../../../../protocol/approvals/grants.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
import type { AgentDefinitionRow } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { CallAgent } from "../../../../protocol/lophn-agent/calls.ts";
import { refOf } from "./agent-key.ts";
import { type Link, unavailable } from "./core-link.ts";
import type {
  GrantApp,
  GrantCatalog,
  GrantsView,
  ReadResult,
} from "./source.ts";

interface AppRow {
  id: string;
  name: string;
}

interface BlueprintValue {
  app_api: {
    key: string;
    description: string;
    effect: "read" | "write" | "external";
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
    const blueprint = await link.read<BlueprintValue>("apps", "blueprint", {
      app: app.id,
    });
    if (!blueprint.ok) continue;
    found.push({
      app: app.id,
      name: app.name,
      release: null,
      apis: blueprint.value.app_api.map((command) => ({
        api: command.key,
        detail: command.description,
        effect: command.effect,
        addedIn: null,
      })),
    });
  }
  return found;
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
  const apps = await appCatalog(link, names);
  return {
    ok: true,
    value: {
      entries: grant.value.grant.entries,
      catalog: {
        apps,
        mcpServers: [],
        agents: await agentCatalog(link, ref, names),
      },
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
  return link.command("agent_grants", "set", { agent: ref, entries }).then(
    (reply) =>
      reply.ok ? { ok: true, value: null } : { ok: false, message: reply.code },
  );
}
