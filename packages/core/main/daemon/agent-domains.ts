// agent가 맡은 domain id와 앱 domain 이름의 id를 읽는 조립. 사용 관계(apps-usage)와 호출 Gate(apps)가 같은 셈을 쓴다.
import type { UsagePorts } from "../../apps/usage/mod.ts";
import { domainsOfOwner } from "../../domains/lookups.ts";
import { workingDomains } from "../../lophn-agent/agents/resolve.ts";
import { placeDepsOf } from "../../lophn-agent/places/mod.ts";
import {
  agentRefOf,
  loadSession,
  placeOf,
} from "../../lophn-agent/session/model.ts";
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
            domains: ports.agentDomains({
              agent: row.agent,
              place: placeOf(row),
            }),
          };
    },
    agentDomains({ agent, place }) {
      if (place === null) return [];
      const found = placeDepsOf(sql).agents.agent(agent);
      if (found === null) return [];
      return workingDomains(activeIds(place), found.domains);
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
