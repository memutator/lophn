// context 모델(ledger 위의 API).
// node:sqlite를 쓰는 index 저장소(index/mod.ts)와 sync 파일 I/O는 core graph에 들어가면 안 돼서
// 이 barrel에 두지 않는다. 그것들은 core 밖(writer·reader Worker)에서만 올리는
// packages/core/projects/contexts/ledger/deps.ts가 index/mod.ts를 직접 import한다.
export { contextsLedgerSchemaSteps } from "./ledger/schema.ts";
export { contextStatusOf } from "./ledger/status.ts";
export {
  CONTEXT_WORKER_OPERATIONS,
  contextAuthorityPort,
  type ContextBlobs,
  type ContextIndexPort,
  contextLedgerCommands,
  type ContextLedgerDeps,
  contextLedgerReads,
  mapActor,
} from "./ledger/adapter.ts";
export { contextOutlineCommands, contextOutlineReads } from "./outlines.ts";
export { createContextFolders } from "./folders.ts";
export {
  contextWorkInputRead,
  contextWorkListRead,
} from "./ledger/work-input.ts";
export type { SearchExecutor } from "./api/reads.ts";
export type { BlobReference, ContextApiActor, EntityRow } from "./api/state.ts";
export { violationMessage } from "./api/violation-message.ts";
export { runSearch } from "./search/run.ts";
export type { SearchEntity, SearchResult } from "./search/types.ts";
export type { IndexedEntity, IndexState } from "./index/types.ts";
export { pagePreview } from "./preview/page.ts";
