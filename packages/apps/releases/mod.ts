// apps/releases concern의 경계다. 최상위 concern 사이는 packages/contracts로만 부르고,
// release worker 조립은 아래 모듈을 직접 부른다(apps/worker/apps/release.ts).
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
} from "./prepare/limits.ts";
export {
  extractCommit,
  type ExtractedFile,
  type ExtractFailure,
  type ExtractInput,
  type GitRunner,
  parseLsTree,
  parsePorcelain,
  validCommit,
} from "./prepare/git-extract.ts";
export {
  checkPin,
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
  type ImportMapFailure,
  lockedImportMap,
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
