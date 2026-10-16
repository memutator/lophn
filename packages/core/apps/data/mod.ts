// apps/data concern의 ledger 경계다. core가 command 등록으로 import하므로
// node:sqlite를 여는 worker 모듈은 내보내지 않는다. data worker 조립은
// packages/core/apps/data/worker/run.ts가 worker 모듈을 직접 부른다.
export { createDataCommands } from "./commands.ts";
export type { AttemptGate, DataRecord, DataRecordStore } from "./commands.ts";
export { dataSchemaSteps } from "./schema.ts";
export { createDataRecordStore } from "./store.ts";
export { discardBackups } from "./discard.ts";
// 현재 schema에서 목표까지의 연속 경로 계산이다. IO가 없어 core가 activation 시작 검사에서 쓴다.
export { migrationPath } from "./worker/schema.ts";
export {
  BACKUP_BLOB_FIELD,
  BACKUP_BLOB_FIELD_NAME,
  BACKUP_BLOB_OWNER_KIND,
  BACKUP_BLOB_PURPOSE,
  backupBlobOwnerKey,
} from "./blobs.ts";
