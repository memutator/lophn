// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions 표와 agent 정의를 모르므로 session과 agent가 맡은 domain을 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 read를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.
import { createUsageReads, usagePorts } from "../../../apps/usage/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import { agentDomainPorts } from "../agent-domains.ts";

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [createUsageReads()],
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
