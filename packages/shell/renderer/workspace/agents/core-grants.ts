// 다른 컴퓨터 앱 할당을 읽고 저장하는 부분과 그 컴퓨터가 내놓는 앱 목록. 붙은 것은 agent 정의 파일의 remote_apps가, 붙일 수 있는 앱과 tool은
// 그 컴퓨터의 앱 목록과 활성 release의 선언이 말한다. 이 컴퓨터의 앱은 할당이 아니라 skill 배포다(`core-extensions.ts`).
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

/** 앱 목록을 읽지 못하면 null이다(앱이 없는 것과 다르다). */
async function appCatalog(link: Link): Promise<GrantApp[] | null> {
  const apps = await link.read<{ apps: (AppRow & { status: string })[] }>(
    "apps",
    "list",
    {},
  );
  if (!apps.ok) return null;
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
 * 거절할 비공개 command는 처음부터 뺀다. 목록을 읽지 못하면 null이다.
 */
export async function readComputerApps(
  core: CoreSource,
): Promise<GrantApp[] | null> {
  // 읽기만 하므로 command key의 무작위 값은 쓰이지 않는다.
  const apps = await appCatalog(createLink(core, () => ""));
  return apps === null ? null : appsFor(apps);
}

export async function readGrants(
  link: Link,
  agent: string,
): Promise<ReadResult<GrantsView>> {
  if (!isAgentId(agent)) return { ok: false, message: "not_found" };
  const read = await link.read<{
    assignment: { entries: AssignmentEntry[] };
    revision: number;
  }>("agent_assignments", "get", { agent });
  if (!read.ok) return read;
  return {
    ok: true,
    value: {
      entries: read.value.assignment.entries,
      revision: read.value.revision,
    },
  };
}

export function saveGrants(
  link: Link,
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
