// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표와 agent 정의를 모르므로 session과 agent가 맡은 domain을 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 read를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createUsageReads, usagePorts } from "../../../apps/usage/mod.ts";
import type { UsagePorts } from "../../../apps/usage/mod.ts";
import { appExists, appIds } from "../../../apps/lookups.ts";
import { projectExists, projectIds } from "../../../projects/lookups.ts";
import { domainsOfOwner } from "../../../domains/lookups.ts";
import { ROLE_TABLE } from "../../../agent-roles/agents/role-table.ts";
import {
  type AgentDeps,
  type AgentFileSystem,
  loadAgent,
  openAgentContext,
} from "../../../lophn-agent/agents/mod.ts";
import { agentRefOf, loadSession } from "../../../lophn-agent/session/model.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles } = await import(NODE_AGENT_FILES) as {
  createNodeAgentFiles(): AgentFileSystem;
};

// Operator 정의 file의 domains만 읽으므로 skill, MCP, model은 비워 둔다.
const agentDeps: AgentDeps = {
  files: createNodeAgentFiles(),
  roles: ROLE_TABLE,
  lookups: (sql) => ({
    placeExists: (place) =>
      place.kind === "project"
        ? projectExists(sql, place.id)
        : appExists(sql, place.id),
    places: () => [
      ...projectIds(sql).map((id) => ({ kind: "project" as const, id })),
      ...appIds(sql).map((id) => ({ kind: "app" as const, id })),
    ],
    skills: () => [],
    mcp: () => [],
    modelDefault: () => null,
    projectModel: () => null,
  }),
  operatorPlaceAllowed: () => false,
};

function portsOf(sql: Query): UsagePorts {
  const activeIds = (owner: DomainOwner) =>
    domainsOfOwner(sql, owner, "active").map((domain) => domain.id);
  const ports: UsagePorts = {
    sessionDomains(session) {
      const row = loadSession({ sql }, session);
      return row === undefined
        ? null
        : { role: row.role, domains: ports.agentDomains(agentRefOf(row)) };
    },
    agentDomains(agent) {
      switch (agent.role) {
        case "project_manager":
          return activeIds({ kind: "project", id: agent.project });
        case "app_engineer":
          return activeIds({ kind: "app", id: agent.app });
        case "operator": {
          const opened = openAgentContext(agentDeps, sql);
          if (!opened.ok) return [];
          const loaded = loadAgent(opened.value, agent);
          if (!loaded.ok || loaded.value === null) return [];
          const { place, definition } = loaded.value;
          if (place === null) return [];
          const all = activeIds(place);
          const chosen = definition !== null && "domains" in definition
            ? definition.domains ?? []
            : [];
          const picked = all.filter((id) => chosen.includes(id as never));
          return picked.length > 0 ? picked : all;
        }
        default:
          return [];
      }
    },
    domainOf(app, name) {
      return domainsOfOwner(sql, { kind: "app", id: app })
        .find((domain) => domain.name === name)?.id ?? null;
    },
  };
  return ports;
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [createUsageReads()],
    ports: new Map<unknown, unknown>([
      [usagePorts, snapshotPort((snapshot) => portsOf(snapshot.sql))],
    ]),
  };
}

export function createCoreRegistration() {
  return { ports: [defineTxPort(usagePorts, (tx) => portsOf(tx.sql))] };
}
