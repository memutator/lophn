// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표와 agent 정의를 모르므로 session이 놓인 project와 agent의 project를 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 read를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createUsageReads, usagePorts } from "../../../apps/usage/mod.ts";
import type { UsagePorts } from "../../../apps/usage/mod.ts";
import { placeDepsOf } from "../../../lophn-agent/places/mod.ts";
import { loadSession, placeOf } from "../../../lophn-agent/session/model.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function projectOf(
  place: { kind: string; id: string } | null | undefined,
): Id<"prj"> | null {
  return place?.kind === "project" ? place.id as Id<"prj"> : null;
}

function portsOf(sql: Query): UsagePorts {
  return {
    sessionPlace(session) {
      const row = loadSession({ sql }, session);
      return row === undefined
        ? null
        : { role: row.role, project: projectOf(placeOf(row)) };
    },
    agentProject(agent) {
      switch (agent.role) {
        case "project_manager":
          return agent.project as Id<"prj">;
        case "operator":
          return projectOf(
            placeDepsOf(sql).operators.operator(agent.agent)?.place,
          );
        case "lophn":
          return null;
      }
    },
  };
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
