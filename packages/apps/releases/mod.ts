// apps/releases concern의 경계다. 최상위 concern 사이는 packages/contracts로만 부르고,
// release worker 조립은 아래 모듈을 직접 부른다(apps/worker/apps/release.ts).
export {
  type PrepareDeps,
  type PreparedRelease,
  type PrepareFailure,
  prepareRelease,
  type PrepareReleaseInput,
} from "./prepare/flow.ts";
export {
  checkLimits,
  exceededLimit,
  type LimitFailure,
  type LimitName,
  type PreparationUsage,
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
  usageCounter,
} from "./prepare/limits.ts";
export {
  extractCommit,
  type ExtractedFile,
  type ExtractFailure,
  type ExtractInput,
  gitCommandRunner,
  type GitRunner,
  parseLsTree,
  parsePorcelain,
  validCommit,
} from "./prepare/git-extract.ts";
export {
  checkPin,
  gitSourceWatch,
  observationPin,
  observeGitSource,
  observeSourceChanged,
  pinSource,
  type SourceWatch,
  type SourceWatchFailure,
  type WatchDeps,
} from "./prepare/source-watch.ts";
export {
  buildManifest,
  manifestBytes,
  type ManifestFailure,
  parseManifest,
} from "./bundle/manifest.ts";
export {
  type LockedImports,
  lockAppImports,
  readSdkCopies,
  type SdkRef,
} from "./bundle/lock.ts";
export {
  type ImportMapFailure,
  lockedImportMap,
  parseSdkSpecifier,
  resolveSpecifier,
  type SdkPathMap,
  sdkPathMap,
  validDependencyName,
  validDependencyVersion,
} from "./bundle/import-map.ts";
export {
  BLUEPRINT_COPY_NAME,
  bundleCopyPath,
  sealBundle,
  type SealFailure,
  SOURCE_MAP_COPY_NAME,
  verifySealedPermissions,
} from "./bundle/seal.ts";
export {
  buildScreens,
  dependenciesInsideFixedList,
  FIXED_UI_DEPENDENCIES,
  type UiBuildFailure,
  type UiBuildInput,
  type UiBuildOutput,
} from "./ui-build/build.ts";
// core의 ledger 쪽(동기 command·read). apps/core/apps.ts는 core module graph에 worker 코드가 들어가지
// 않도록 이 파일들을 각각 import한다.
export { releasesSchemaSteps } from "./schema.ts";
export { checkPreparationClaim, createReleaseCommands } from "./commands.ts";
export { createReleaseReads } from "./reads.ts";
export { type ComparedRelease, compareReleases } from "./compare.ts";
export {
  canonicalInputHashSync,
  declarationsOfBlueprint,
  permissionLabel,
} from "./facts.ts";
export {
  insertRelease,
  loadActiveBlueprint,
  loadActiveRelease,
  loadRelease,
  loadReleases,
  loadStoredBlueprint,
  releaseDeclarations,
  type StoredBlueprint,
} from "./store.ts";
// activation: 한 시도를 순서대로 진행·복원·이어받는 모듈과 봉인 사본에서 앱 자식 입력을 만드는 함수다.
// 실제 supervisor·data worker·core command는 `ActivationPorts`로 끼운다(apps/app-supervisor 조립).
export { runActivation } from "./activation/orchestrator.ts";
export {
  loadMigrationHistory,
  type MigrationHistoryEntry,
  observeReleaseActivations,
  recoverActivation,
  rollback,
} from "./activation/recovery.ts";
export {
  type ActivationFailure,
  type ActivationOutcome,
  type ActivationPorts,
  type ActivationProblem,
  type Attempt,
  attemptOf,
  type BackupOutcome,
  type Candidate,
} from "./activation/steps.ts";
export {
  bundleFlags,
  type BundleParts,
  createCopyPreviewBundles,
  dataChangesOf,
  dataSchemaOf,
  desiredFromBundle,
  readBundleCopy,
} from "./activation/desired.ts";
export { activationAttemptGate } from "./commands.ts";
