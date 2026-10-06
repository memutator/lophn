// apps/data concern의 ledger 경계다. core가 command 등록으로 import하므로
// node:sqlite를 여는 worker 모듈은 내보내지 않는다. data worker 조립은
// apps/worker/apps/data.ts가 worker 모듈을 직접 부른다.
export { boundaryFact, createDataCommands } from "./commands.ts";
export type {
  AttemptGate,
  BoundaryFact,
  DataRecord,
  DataRecordStore,
} from "./commands.ts";
export { dataSchemaSteps } from "./schema.ts";
export { createDataRecordStore, loadDataRecords } from "./store.ts";
// 현재 schema에서 목표까지의 연속 경로 계산이다. IO가 없어 core가 start_activation에서 쓴다.
export { migrationPath } from "./worker/schema.ts";
export {
  BACKUP_BLOB_FIELD,
  BACKUP_BLOB_FIELD_NAME,
  BACKUP_BLOB_OWNER_KIND,
  BACKUP_BLOB_PURPOSE,
  BACKUP_BLOB_PURPOSE_DEFINITION,
  backupBlobOwnerKey,
} from "./blobs.ts";
