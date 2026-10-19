// apps/preview의 경계. activation 없이 고정 bundle을 별도 프로세스로 여는 launcher(supervisor 쪽),
// core의 `/previews/*` service와 disposable 영역, 그리고 실제 효과 대신 쓰는 broker 대역이다.
export { createPreviewLauncher, type PreviewLauncher } from "./launcher.ts";
export { previewFlagsViolation } from "./flags.ts";
export {
  appFolderOfPreview,
  PREVIEW_STARTING,
  PREVIEW_UNAVAILABLE,
  type PreviewLaunch,
  type PreviewObservationWire,
  type PreviewScope,
  previewScopeOf,
  validNonce,
} from "./model.ts";
export { createFsPreviewArea, type PreviewArea } from "./area.ts";
export {
  createPreviewService,
  type CurrentPreview,
  type PreviewBundle,
  type PreviewBundles,
  type PreviewReleases,
  type PreviewService,
  unattachedPreviewService,
} from "./service.ts";
export { createPreviewReads } from "./reads.ts";
export {
  createPreviewAppsCallService,
  createPreviewBrokerServices,
  createPreviewExternalService,
  createPreviewSecretService,
  type PreviewAppsCallService,
  type PreviewExternalService,
  type PreviewSecretService,
} from "./adapters/mod.ts";
