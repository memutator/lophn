export { revertSchemaSteps } from "./schema.ts";
export { type CheckpointMessage, createCheckpoint } from "./checkpoints.ts";
export {
  createRecordRewindFile,
  recordBeforeWrite,
  type RecordedWrite,
  type RecorderPorts,
} from "./record.ts";
export {
  createRewindStore,
  type RewindStore,
  type StoredBlob,
} from "./store.ts";
export { deleteSessionReverts, eraseSessionStore } from "./erase.ts";
export { sweepRewindStore } from "./sweep.ts";
export {
  findUninstalled,
  type UninstalledCandidate,
  uninstalledCandidates,
} from "./recover.ts";
export {
  assertCheckpointVisible,
  type FoldedRange,
  foldedRanges,
  foldsOf,
  hiddenFromSeq,
  type HiddenRange,
  hiddenRanges,
  hiddenRangesOf,
  inHiddenRange,
  type RevertRow,
} from "./hidden.ts";
export {
  createSessionRewindCommands,
  type RevertDeps,
  type RewindEffects,
} from "./commands.ts";
export { appWritesPort, createSessionRewindReads } from "./reads.ts";
export { createRewindEffects } from "./effects.ts";
export {
  createRewindWriteHandlers,
  type RewindWriteDeps,
} from "./write-routes.ts";
export {
  type FileRef,
  observationOf,
  type PlanDeps,
  planRewind,
  type PreviewFact,
  type RewindPlan,
  type RewindTarget,
} from "./preview.ts";
export type { FileStat, JudgedFile } from "./judge.ts";
// 동기 관측(prepare.ts의 observeFiles)은 core가 import하지 않으므로 여기 없다. reader Worker의 모듈이
// 그 파일을 직접 import한다.
export {
  installRestore,
  type InstallResult,
  observeFilesAsync,
  prepareRestore,
} from "./restore.ts";
