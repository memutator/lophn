import type { Clock, IdSource } from "../../../base/mod.ts";
import type {
  ApiReadDefinition,
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import type {
  FileRoute,
  MemoryRoute,
  UploadRoute,
  WorkerRoute,
} from "../../../protocol/base/mod.ts";
import type { KindLaunchSpec } from "../../../protocol/supervision/mod.ts";
import type { TxPortRegistration } from "./tx-ports.ts";

// 최상위 팀의 등록 파일이 내놓는 모양. main.ts는 이 목록만 부르고 팀 내용을 모른다.
// 팀 파일은 지금 자기 모양을 그대로 내보내므로, 여기 조립은 있는 항목만 읽는다.
type TeamRegistration = {
  schemaSteps?: readonly SchemaStep[];
  commands?: readonly CommandDefinition[];
  reads?: readonly ReadDefinition[];
  // ledger snapshot 없이 core가 바로 여는 read. dispatcher가 기다리므로 async여도 된다.
  // 경로는 같은 registry에서 모으므로 reads·files와 겹치면 거절한다.
  apiReads?: readonly ApiReadDefinition[];
  // HTTP route registry가 command·read와 같은 출처에서 모으는 file·worker route.
  // command·read route는 definitions에서 온다. 여기 적힌 것은 그것과 겹치면 거절한다.
  files?: readonly FileRoute[];
  workerRoutes?: readonly WorkerRoute[];
  // 바이트 body route. handler는 core 조립(core.ts)이 route 이름으로 붙인다.
  uploadRoutes?: readonly UploadRoute[];
  // ledger를 쓰지 않는 core 메모리 route. handler는 core 조립(core.ts)이 route 이름으로 붙인다.
  memoryRoutes?: readonly MemoryRoute[];
  ports?: readonly TxPortRegistration[];
  workers?: readonly KindLaunchSpec[];
  blobFields?: readonly BlobFieldDefinition[];
  clock?: Clock;
  ids?: IdSource;
};

// 팀 파일은 지금 자기 타입으로 내보낸다. 조립은 아래 키만 읽고 값은 등록 시점에 검사한다.
export type TeamModule = {
  createCoreRegistration?: () => TeamRegistration;
  createLedgerRegistration?: (environment: never) => unknown;
  problemsTestDefinitions?: unknown;
  lophnAgentDefinitions?: unknown;
};
