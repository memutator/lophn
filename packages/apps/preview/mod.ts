// apps/preview의 경계. activation 없이 고정 bundle을 별도 프로세스로 여는 launcher(supervisor 쪽),
// core의 `/v1/previews/*` service와 disposable 영역, 그리고 실제 효과 대신 쓰는 broker 대역이다.
export {
  createPreviewLauncher,
  PREVIEW_STOP_GRACE_MS,
  type PreviewChildIdentity,
  type PreviewLauncher,
  type PreviewLauncherDeps,
  type PreviewProbe,
  type PreviewSpawnRequest,
} from "./launcher.ts";
export {
  PREVIEW_STARTING,
  PREVIEW_UNAVAILABLE,
  previewDirectory,
  previewFlagsViolation,
  type PreviewScope,
  previewScopeOf,
} from "./model.ts";
export { createFsPreviewArea, type PreviewArea } from "./area.ts";
export {
  createPreviewService,
  type PreviewBundle,
  type PreviewBundles,
  previewObservationOf,
  type PreviewReleases,
  type PreviewService,
  type PreviewServiceDeps,
  type PreviewSupervisor,
  unattachedPreviewService,
} from "./service.ts";
export { createPreviewReads } from "./reads.ts";
export {
  createPreviewAppsService,
  createPreviewBrokerServices,
  createPreviewDocumentsService,
  createPreviewExternalService,
  createPreviewSecretService,
  type PreviewAppAttempt,
  type PreviewAppsService,
  type PreviewBrokerOptions,
  type PreviewBrokerServices,
  type PreviewDocumentsService,
  type PreviewExternalRequest,
  type PreviewExternalService,
  type PreviewSecretService,
  type PreviewSecretUse,
} from "./adapters/mod.ts";
