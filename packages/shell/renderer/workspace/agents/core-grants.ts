// 할당을 읽고 저장하는 부분과 붙일 수 있는 앱 목록. 붙은 것은 agent_assignments가, 붙일 수 있는 앱과 tool은
// 앱 목록과 활성 release의 blueprint가 말한다. MCP server는 설정한 층이 곧 할당이라 여기에 없다.
import {
  agentAssignmentSet,
  type AssignmentEntry,
} from "../../../../protocol/approvals/assignment.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
import type { DomainView } from "../source.ts";
import { refOf } from "./agent-key.ts";
import { type Link, unavailable } from "./core-link.ts";
import { appsFor, domainNamesOf } from "./editor/grants-model.ts";
import type { GrantApp, GrantsView, ReadResult } from "./source.ts";

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
    domain: string;
  }[];
}

async function appCatalog(link: Link): Promise<GrantApp[]> {
  const apps = await link.read<{ apps: (AppRow & { status: string })[] }>(
    "apps",
    "list",
    {},
  );
  if (!apps.ok) return [];
  const found: GrantApp[] = [];
  for (const app of apps.value.apps) {
    if (app.status !== "active") continue;
    // 활성 release가 없는 앱은 blueprint가 없다. 붙일 수 없어 목록에서 뺀다.
    const blueprint = await link.read<BlueprintValue>("apps", "tools", {
      app: app.id,
    });
    if (!blueprint.ok) continue;
    found.push({
      app: app.id,
      name: app.name,
      tools: blueprint.value.tools.map((command) => ({
        tool: command.name,
        detail: command.description,
        effect: command.effect,
        public: command.public,
        domain: command.domain,
      })),
    });
  }
  return found;
}

/** agent가 일할 domain의 이름. lophn은 놓인 곳이 없어 없다. */
async function agentDomainNames(
  link: Link,
  place: string | null,
  ref: AgentRef,
  domains: (place: string) => Promise<ReadResult<readonly DomainView[]>>,
): Promise<string[]> {
  if (place === null) return [];
  const container = await domains(place);
  if (!container.ok) return [];
  const read = await link.read<{ definition: { domains?: string[] } | null }>(
    "agent-definitions",
    "read",
    { agent: ref },
  );
  const chosen = read.ok ? read.value.definition?.domains ?? [] : [];
  return domainNamesOf(chosen, container.value);
}

export async function readGrants(
  link: Link,
  place: string | null,
  key: string,
  domains: (place: string) => Promise<ReadResult<readonly DomainView[]>>,
): Promise<ReadResult<GrantsView>> {
  const ref = refOf(place, key);
  if (ref === null) return { ok: false, message: "not_found" };
  const read = await link.read<
    { assignment: { entries: AssignmentEntry[] }; revision: number }
  >("agent_assignments", "get", { agent: ref });
  if (!read.ok) return read;
  const [apps, agentDomains] = await Promise.all([
    appCatalog(link),
    agentDomainNames(link, place, ref, domains),
  ]);
  return {
    ok: true,
    value: {
      entries: read.value.assignment.entries,
      catalog: { apps: appsFor(apps, agentDomains) },
      revision: read.value.revision,
    },
  };
}

export function saveGrants(
  link: Link,
  place: string | null,
  key: string,
  entries: readonly AssignmentEntry[],
  revision: number,
): Promise<ReadResult<{ readonly revision: number }>> {
  const ref = refOf(place, key);
  if (ref === null) return Promise.resolve(unavailable);
  return link.command(agentAssignmentSet, {
    input: { agent: ref, entries },
    compare: { revision },
  }).then(
    (reply) =>
      reply.ok
        ? { ok: true, value: { revision: reply.value.revision } }
        : { ok: false, message: reply.code },
  );
}
