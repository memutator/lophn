// 할당을 읽고 저장하는 부분과 붙일 수 있는 앱 목록. 붙은 것은 agent 정의 파일의 apps·permissions가, 붙일 수 있는 앱과 tool은
// 앱 목록과 활성 release의 선언이 말한다. MCP server는 설정한 층이 곧 할당이라 여기에 없다.
import {
  assignmentSet,
  type AssignmentEntry,
} from "../../../../protocol/approvals/assignment.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { isAgentId } from "./agent-key.ts";
import { createLink, type Link, unavailable } from "./core-link.ts";
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
      })),
    });
  }
  return found;
}

/**
 * 다른 컴퓨터의 앱 가운데 붙일 수 있는 것. 그 컴퓨터의 core를 사람의 화면으로 읽고(`useMachineData(machine).core`), 받는 기계가
 * 거절할 비공개 command는 처음부터 뺀다. 읽지 못하면 빈 목록이다.
 */
export async function readComputerApps(core: CoreSource): Promise<GrantApp[]> {
  // 읽기만 하므로 command key의 무작위 값은 쓰이지 않는다.
  return appsFor(await appCatalog(createLink(core, () => "")), null);
}

export async function readGrants(
  link: Link,
  workspace: string | null,
  agent: string,
): Promise<ReadResult<GrantsView>> {
  if (!isAgentId(agent)) return { ok: false, message: "not_found" };
  const read = await link.read<{
    assignment: { entries: AssignmentEntry[] };
    revision: number;
  }>("agent_assignments", "get", { agent });
  if (!read.ok) return read;
  const apps = await appCatalog(link);
  return {
    ok: true,
    value: {
      entries: read.value.assignment.entries,
      catalog: { apps: appsFor(apps, workspace) },
      revision: read.value.revision,
    },
  };
}

export function saveGrants(
  link: Link,
  _workspace: string | null,
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
