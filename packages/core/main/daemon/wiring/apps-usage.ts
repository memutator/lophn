// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표와 agent 정의를 모르므로 session과 agent가 맡은 domain을 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 그 port를 쓰는 read(app.usage, app.tool_index)를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createToolIndexRead } from "../../../apps/declaration/reads.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import { createUsageReads, usagePorts } from "../../../apps/usage/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import { agentDomainPorts } from "../agent-domains.ts";

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [createUsageReads(), createToolIndexRead(loadActiveDeclaration)],
    ports: new Map<unknown, unknown>([
      [usagePorts, snapshotPort((snapshot) => agentDomainPorts(snapshot.sql))],
    ]),
  };
}

export function createCoreRegistration() {
  return {
    ports: [defineTxPort(usagePorts, (tx) => agentDomainPorts(tx.sql))],
  };
}
