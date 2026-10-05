import {
  connectionAuthFromSnapshot,
  connectionAuthFromTx,
  connectionAuthPort,
  connectionAuthSyncFromTx,
  connectionAuthSyncPort,
  connectionSchemaSteps,
  createConnectionCommands,
  createConnectionReads,
} from "../../packages/coding-agent/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";

// owner definitions만 내보낸다. App 존재 lookup(apps)과 확인 창 소비는 core 조립이 준다.
// 인증은 매 요청 auth port로 principal의 state·scope·digest를 읽는다.
const commands = createConnectionCommands();
const reads = createConnectionReads();

// reader Worker가 다시 import한다. 인증 port는 요청마다 snapshot에서 principal을 읽는다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createConnectionReads();
  return {
    reads: [reads.list, reads.show],
    ports: new Map([[connectionAuthPort, connectionAuthFromSnapshot]]),
  };
}

export const codingAgentConnectionDefinitions = {
  schema: connectionSchemaSteps,
  commands: [commands.create, commands.revoke],
  reads: [reads.list, reads.show],
  ports: {
    auth: {
      key: connectionAuthPort,
      fromTx: connectionAuthFromTx,
      fromSnapshot: connectionAuthFromSnapshot,
    },
    // claim command는 transaction 안에서 동기 lookup이 필요하다.
    // 계약 port(Promise)와 키가 달라 writer 등록이 겹치지 않는다.
    authSync: {
      key: connectionAuthSyncPort,
      create: connectionAuthSyncFromTx,
    },
  },
};
