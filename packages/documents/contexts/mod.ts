export { contextsSchemaSteps } from "./schema.ts";
export { targetKey } from "./model.ts";
export { type ContextCommandDeps, createContextCommands } from "./commands.ts";
export {
  type ContextOutlineItemRecord,
  type ContextOutlineRecord,
  type ContextOutlineSource,
  createContextOutlineSource,
  createContextReads,
} from "./reads.ts";
export {
  compareWatchedItem,
  type ContextConfigEvent,
  loadConfigEvents,
  type PendingWatch,
  pendingWatches,
  replayContexts,
  UNVERIFIED_MODULE_CHANGED,
  UNVERIFIED_PENDING,
  unverifiedReason,
  type WatchComparisonInput,
  type WatchedItemComparison,
  type WatchSectionState,
  type WatchVersion,
} from "./work.ts";

// 새 context 모델(ledger 위의 API). 옛 모델을 걷어 내는 작업이 끝나면 위의 옛 export를 지운다.
// node:sqlite를 쓰는 index 저장소(index/mod.ts)와 sync 파일 I/O는 core graph에 들어가면 안 돼서
// 이 barrel에 두지 않는다. 그것들은 core 밖(writer·reader Worker)에서만 올리는
// apps/core/contexts-ledger-deps.ts가 index/mod.ts를 직접 import한다.
export { contextsLedgerSchemaSteps } from "./ledger/schema.ts";
export {
  CONTEXT_WORKER_OPERATIONS,
  type ContextBlobs,
  type ContextIndexPort,
  contextLedgerCommands,
  type ContextLedgerDeps,
  contextLedgerReads,
  mapActor,
} from "./ledger/adapter.ts";
export type { SearchExecutor } from "./api/reads.ts";
export type { BlobReference, ContextApiActor, EntityRow } from "./api/state.ts";
export { runSearch } from "./search/run.ts";
export type { SearchEntity, SearchResult, TablePage } from "./search/types.ts";
export type { IndexedEntity, IndexState } from "./index/types.ts";
