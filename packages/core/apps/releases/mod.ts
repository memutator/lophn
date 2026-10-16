// apps/releases concern의 경계다. 최상위 concern 사이는 packages/protocol로만 부르고,
// release worker 조립은 아래 모듈을 직접 부른다(packages/core/apps/releases/worker/run.ts).
export {
  type PrepareDeps,
  type PreparedRelease,
  type PrepareFailure,
  prepareRelease,
  type PrepareReleaseInput,
} from "./prepare/flow.ts";
export {
  type LimitFailure,
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
  usageCounter,
} from "./prepare/limits.ts";
export {
  extractCommit,
  gitCommandRunner,
  type GitRunner,
} from "./prepare/git-extract.ts";
export { buildManifest, manifestBytes } from "./bundle/manifest.ts";
export { lockAppImports, readSdkCopies } from "./bundle/lock.ts";
export {
  BLUEPRINT_COPY_NAME,
  bundleCopyPath,
  sealBundle,
  SOURCE_MAP_COPY_NAME,
} from "./bundle/seal.ts";
export { buildScreens, FIXED_UI_DEPENDENCIES } from "./ui-build/build.ts";
// core의 ledger 쪽(동기 command·read). packages/core/apps/register.ts는 core module graph에 worker 코드가 들어가지
// 않도록 이 파일들을 각각 import한다.
export { releasesSchemaSteps } from "./schema.ts";
export { createReleaseCommands } from "./commands.ts";
export { createActivationQueueRead, createReleaseReads } from "./reads.ts";
export { asksFor, compareForActivation } from "./compare.ts";
export { declarationsOfBlueprint, permissionLabel } from "./facts.ts";
export {
  findReleaseForTicket,
  insertRelease,
  loadActiveBlueprint,
  loadActiveRelease,
  loadRelease,
  loadReleases,
  loadStoredBlueprint,
  releaseDeclarations,
  releaseLookupOf,
  releaseWording,
} from "./store.ts";
// activation: 한 시도를 순서대로 진행·복원·이어받는 모듈과 봉인 사본에서 앱 자식 입력을 만드는 함수다.
// 실제 supervisor·data worker·core command는 `ActivationPorts`로 끼운다(packages/core/main/app-supervisor 조립).
export { runActivation } from "./activation/orchestrator.ts";
export {
  observeReleaseActivations,
  recoverActivation,
  rollback,
} from "./activation/recovery.ts";
export {
  type ActivationIntake,
  type ActivationOutcome,
  type ActivationPorts,
  type Attempt,
  attemptOf,
} from "./activation/steps.ts";
export {
  bundleFlags,
  createCopyPreviewBundles,
  dataChangesOf,
  desiredFromBundle,
  readBundleCopy,
} from "./activation/desired.ts";
export { activationAttemptGate } from "./commands.ts";
