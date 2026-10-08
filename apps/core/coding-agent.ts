import {
  connectionAuthFromSnapshot,
  connectionAuthFromTx,
  connectionAuthPort,
  connectionAuthSyncFromTx,
  connectionAuthSyncPort,
  connectionSchemaSteps,
  createConnectionCommands,
  createConnectionReads,
  createConnectionSecretRefSource,
} from "../../packages/coding-agent/mod.ts";
import { err } from "../../packages/base/mod.ts";
import {
  connectionConnect,
  connectionEndChild,
  connectionEndConnection,
  connectionRegisterChild,
  defaultHarnessSetting,
  harnessEnabledSetting,
  harnessProfileSetting,
  REPAIR_CONTEXT_ROUTES,
} from "../../packages/contracts/coding-agent/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";

// owner definitions만 내보낸다. App 존재 lookup(apps)과 확인 창 소비는 core 조립이 준다.
// 인증은 매 요청 auth port로 principal의 state·scope·digest를 읽는다.
const commands = createConnectionCommands();
const reads = createConnectionReads();

// 소유 concern(coding-agent/harnesses)의 harness 설정 3개다(platform/settings#R31).
// 값은 소유 concern의 schema 검증을 따른다. 실행 파일 경로·감지·receipt는
// machine-local 자료로 분리되고 일반 설정 조립에 들지 않는다.
// settings registry의 출처는 core 조립의 settings.ts다.
export const harnessSettings = [
  harnessEnabledSetting,
  defaultHarnessSetting,
  harnessProfileSetting,
];

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
  settings: harnessSettings,
  commands: [commands.create, commands.revoke],
  reads: [reads.list, reads.show],
  // 수리 자료 route다. route만 선언하고 handler는 worker 통로를 가진 core 조립(repair-context)이 붙인다.
  apiReads: REPAIR_CONTEXT_ROUTES.map((route) => ({
    route,
    handle: () =>
      err({
        code: "unavailable" as const,
        message: "수리 자료 읽기가 붙어 있지 않다",
      }),
  })),
  // 사람의 연결 결정 입구다. handler는 core 조립(core.ts)이 route 이름으로 붙인다.
  memoryRoutes: [
    connectionConnect,
    connectionRegisterChild,
    connectionEndChild,
    connectionEndConnection,
  ],
  // connection credential(keychain의 token)도 알려진 값 registry에 등록·회수된다(connection#R17).
  secretRefs: [createConnectionSecretRefSource()],
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
