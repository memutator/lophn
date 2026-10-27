// apps/releases concern의 경계다. 최상위 concern 사이는 packages/protocol로만 부르고,
// release worker 조립은 아래 모듈을 직접 부른다(packages/core/apps/releases/worker/run.ts).

export {
  createCopyPreviewBundles,
  dataChangesOf,
  desiredFromBundle,
  readBundleCopy,
} from "./activation/desired.ts";
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
export { buildManifest, manifestBytes } from "./bundle/manifest.ts";
export {
  bundleCopyPath,
  DECLARATION_COPY_NAME,
  sealCopy,
} from "./bundle/seal.ts";
export { activationAttemptGate, createReleaseCommands } from "./commands.ts";
export { asksFor, compareForActivation } from "./compare.ts";
export { factsOfDeclaration } from "./facts.ts";
export {
  type PrepareDeps,
  type PreparedRelease,
  type PrepareFailure,
  type PrepareReleaseInput,
  prepareRelease,
} from "./prepare/flow.ts";
export {
  extractCommit,
  type GitRunner,
  gitCommandRunner,
} from "./prepare/git-extract.ts";
export {
  type LimitFailure,
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
  usageCounter,
} from "./prepare/limits.ts";
export { createActivationQueueRead, createReleaseReads } from "./reads.ts";
// core의 ledger 쪽(동기 command·read). packages/core/apps/register.ts는 core module graph에 worker 코드가 들어가지
// 않도록 이 파일들을 각각 import한다.
export { releasesSchemaSteps } from "./schema.ts";
export {
  findPreparedRelease,
  insertRelease,
  loadActiveDeclaration,
  loadActiveRelease,
  loadRelease,
  loadReleases,
  loadStoredDeclaration,
  releaseFacts,
} from "./store.ts";
export { buildScreens, FIXED_UI_DEPENDENCIES } from "./ui-build/build.ts";
