// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표와 agent 정의를 모르므로 session과 agent가 맡은 domain을 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 read를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createUsageReads, usagePorts } from "../../../apps/usage/mod.ts";
import type { UsagePorts } from "../../../apps/usage/mod.ts";
import { domainsOfOwner } from "../../../domains/lookups.ts";
import { placeDepsOf } from "../../../lophn-agent/places/mod.ts";
import { agentRefOf, loadSession } from "../../../lophn-agent/session/model.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

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
          const found = placeDepsOf(sql).operators.operator(agent.agent);
          if (found === null) return [];
          const all = activeIds(found.place);
          const picked = all.filter((id) => found.domains.includes(id));
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
