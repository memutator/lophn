// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표를 모르므로 session이 놓인 곳을 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 그 port를 쓰는 read(app.usage, app.tool_index)를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createToolIndexRead } from "../../../apps/declaration/reads.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import {
  createUsageReads,
  type UsagePorts,
  usagePorts,
} from "../../../apps/usage/mod.ts";
import { loadSession, placeOf } from "../../../lophn-agent/session/model.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";

function usagePortsOf(sql: Pick<Sql, "get" | "all">): UsagePorts {
  return {
    sessionPlace(session) {
      const row = loadSession({ sql }, session);
      return row === undefined ? null : { place: placeOf(row) };
    },
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [createUsageReads(), createToolIndexRead(loadActiveDeclaration)],
    ports: new Map<unknown, unknown>([
      [usagePorts, snapshotPort((snapshot) => usagePortsOf(snapshot.sql))],
    ]),
  };
}

export function createCoreRegistration() {
  return {
    ports: [defineTxPort(usagePorts, (tx) => usagePortsOf(tx.sql))],
  };
}
