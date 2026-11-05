// jobs의 team 등록 file. writer·reader Worker가 import한다.
// jobs는 session 표와 agent·project·앱 이름 풀기를 모르므로 이 조립이 jobTargetsPort로 꽂는다.
// reader port는 등록마다 모아 모든 read가 같이 쓰므로(같은 key를 두 곳에 두면 기동 때 던진다)
// read를 가진 jobs/register.ts와 따로 둔다.
import { err, ok } from "../../../../base/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { jobTargetsPort, jobZonePort } from "../../../jobs/ports.ts";
import type { JobTargets } from "../../../jobs/ports.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
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
      return row === undefined
        ? undefined
        : { agent: row.agent, workspace: workspaceOf(row) };
    },
    // wiring/runs.ts의 agents.resolve와 같은 호출이다.
    resolveAgent(address) {
      return createSessionDirectory({
        ...workspaceDepsOf(sql),
        publish: () => {},
        sql: () => sql,
      }).resolveAddress(address);
    },
    resolveApp(ref) {
      const found = workspaceDepsOf(sql).apps.appByName(ref);
      return found === null
        ? err({ code: "not_found", message: "app not found" })
        : ok(found.id);
    },
    resolveProject(ref) {
      const found = workspaceDepsOf(sql).projects.projectByName(ref);
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
