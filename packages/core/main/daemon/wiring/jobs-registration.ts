// jobs의 team 등록 file. writer·reader Worker가 import한다.
// jobs는 session 표와 agent·project·앱 이름 풀기를 모르므로 이 조립이 jobTargetsPort로 꽂는다.
// reader port는 등록마다 모아 모든 read가 같이 쓰므로(같은 key를 두 곳에 두면 기동 때 던진다)
// read를 가진 jobs/register.ts와 따로 둔다.
import { err, ok } from "../../../../base/mod.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/mod.ts";
import { placeOfAgentRef } from "../../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { jobTargetsPort, jobZonePort } from "../../../jobs/ports.ts";
import type { JobTargets } from "../../../jobs/ports.ts";
import {
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import { agentRefOf, loadSession } from "../../../lophn-agent/session/model.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function targetsOf(sql: Query): JobTargets {
  return {
    creatorOf(session) {
      const row = loadSession({ sql }, session);
      return row === undefined ? undefined : agentRefOf(row);
    },
    // wiring/runs.ts의 agents.resolve와 같은 호출이다. 그쪽은 ledgerSnapshot을 열고 여기는 이미 sql을 받는다.
    resolveAgent(named) {
      if (named.role === "coding_agent") {
        return err({
          code: "invalid_input",
          message: "a coding agent cannot run headless",
        });
      }
      const deps = placeDepsOf(sql);
      const resolved = createSessionDirectory({
        ...deps,
        publish: () => {},
        sql: () => sql,
      }).resolveAgent(named);
      if (!resolved.ok) return resolved;
      const agent = resolved.value as AgentRef;
      const place = placeOfAgentRef(agent);
      return ok({
        agent,
        place: place === undefined
          ? deps.operators.operator((agent as { agent: string }).agent as never)
            ?.place ?? null
          : place,
      });
    },
    resolveApp(ref) {
      const found = placeDepsOf(sql).apps.appByName(ref);
      return found === null
        ? err({ code: "not_found", message: "app not found" })
        : ok(found.id);
    },
    resolveProject(ref) {
      const found = placeDepsOf(sql).projects.projectByName(ref);
      return found === null
        ? err({ code: "not_found", message: "project not found" })
        : ok(found.id);
    },
  };
}

export function createCoreRegistration() {
  return {
    ports: [
      defineTxPort(jobTargetsPort, (tx) => targetsOf(tx.sql)),
      defineTxPort(jobZonePort, () => ({
        zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      })),
    ],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [],
    ports: new Map<unknown, unknown>([
      [jobTargetsPort, snapshotPort((snapshot) => targetsOf(snapshot.sql))],
    ]),
  };
}
