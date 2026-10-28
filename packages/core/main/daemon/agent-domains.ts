// agent가 맡은 domain id와 앱 domain 이름의 id를 읽는 조립. 사용 관계(apps-usage)와 호출 Gate(apps)가 같은 셈을 쓴다.
import type { UsagePorts } from "../../apps/usage/mod.ts";
import { domainsOfOwner } from "../../domains/lookups.ts";
import { workingDomains } from "../../lophn-agent/agents/resolve.ts";
import { placeDepsOf } from "../../lophn-agent/places/mod.ts";
import { agentRefOf, loadSession } from "../../lophn-agent/session/model.ts";
import type { DomainOwner } from "../../../protocol/domains/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

export function agentDomainPorts(sql: Query): UsagePorts {
  const activeIds = (owner: DomainOwner) =>
    domainsOfOwner(sql, owner, "active").map((domain) => domain.id);
  const ports: UsagePorts = {
    sessionDomains(session) {
      const row = loadSession({ sql }, session);
      return row === undefined
        ? null
        : {
            role: agentRefOf(row).role,
            domains: ports.agentDomains(agentRefOf(row)),
          };
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
          return workingDomains(activeIds(found.place), found.domains);
        }
        default:
          return [];
      }
    },
    domainOf(app, name) {
      return (
        domainsOfOwner(sql, { kind: "app", id: app }).find(
          (domain) => domain.name === name,
        )?.id ?? null
      );
    },
  };
  return ports;
}
