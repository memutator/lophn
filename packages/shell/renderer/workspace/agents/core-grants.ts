// 할당을 읽고 저장하는 부분과 붙일 수 있는 앱 목록. 붙은 것은 agent 정의 파일의 apps·permissions가, 붙일 수 있는 앱과 tool은
// 앱 목록과 활성 release의 선언이 말한다. MCP server는 설정한 층이 곧 할당이라 여기에 없다.
import {
  assignmentSet,
  type AssignmentEntry,
} from "../../../../protocol/approvals/assignment.ts";
import type { DomainView } from "../source.ts";
import { isAgentId } from "./agent-key.ts";
import { placeOf } from "./core-extensions.ts";
import { type Link, unavailable } from "./core-link.ts";
import { appsFor } from "./editor/grants-model.ts";
import type { GrantApp, GrantsView, ReadResult } from "./source.ts";

interface AppRow {
  id: string;
  name: string;
  project: string;
}

interface DeclarationValue {
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
    // 활성 release가 없는 앱은 선언이 없다. 붙일 수 없어 목록에서 뺀다.
    const declaration = await link.read<DeclarationValue>("apps", "tools", {
      app: app.id,
    });
    if (!declaration.ok) continue;
    found.push({
      app: app.id,
      name: app.name,
      tools: declaration.value.tools.map((command) => ({
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

/** agent가 이 자리에서 받는 domain의 이름. `effective.domains`를 그 자리 그릇의 것으로 바꾼다. */
async function agentDomainNames(
  link: Link,
  place: string | null,
  agent: string,
  domains: (place: string) => Promise<ReadResult<readonly DomainView[]>>,
): Promise<string[]> {
  if (place === null) return [];
  const container = await domains(place);
  if (!container.ok) return [];
  const read = await link.read<{ effective: { domains: string[] } }>(
    "agents",
    "read",
    { agent, place: placeOf(place) },
  );
  if (!read.ok) return [];
  const received = read.value.effective.domains;
  return container.value
    .filter((one) => received.includes(one.id))
    .map((one) => one.name);
}

export async function readGrants(
  link: Link,
  place: string | null,
  agent: string,
  domains: (place: string) => Promise<ReadResult<readonly DomainView[]>>,
): Promise<ReadResult<GrantsView>> {
  if (!isAgentId(agent)) return { ok: false, message: "not_found" };
  const read = await link.read<{
    assignment: { entries: AssignmentEntry[] };
    revision: number;
  }>("agent_assignments", "get", { agent });
  if (!read.ok) return read;
  const [apps, agentDomains] = await Promise.all([
    appCatalog(link),
    agentDomainNames(link, place, agent, domains),
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
  _place: string | null,
  agent: string,
  entries: readonly AssignmentEntry[],
  revision: number,
): Promise<ReadResult<{ readonly revision: number }>> {
  if (!isAgentId(agent)) return Promise.resolve(unavailable);
  return link
    .command(assignmentSet, {
      input: { agent, entries },
      compare: { revision },
    })
    .then((reply) =>
      reply.ok
        ? { ok: true, value: { revision: reply.value.revision } }
        : { ok: false, message: reply.code },
    );
}
