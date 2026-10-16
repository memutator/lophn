import {
  appArchive,
  appArchived,
  appConnectSource,
  appCreate,
  appCreated,
  appGet,
  appList,
  appRename,
  appRenamed,
  appSourceConnected,
  appUnarchive,
  appUnarchived,
} from "./apps.ts";
import {
  annotationSend,
  annotationsGet,
  annotationUploadScreenshot,
} from "./annotation.ts";
import { appAppApi } from "./blueprint/read.ts";
import { blueprintCheck } from "./blueprint/check.ts";
import {
  appCallApi,
  appInvocation,
  appInvocations,
  appProjects,
  appRewind,
  appRewindPlan,
  appRewinds,
  appScreenFile,
} from "./calls/mod.ts";
import {
  appDisableExecution,
  appEnableExecution,
  appExecutionDisabled,
  appExecutionEnabled,
  appLogs,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  appStarted,
  appStopped,
  appUnavailable,
} from "./runtime.ts";
import { APP_GRANT_ROUTES } from "./grants.ts";
import { PACKAGE_EVENTS, PACKAGE_ROUTES } from "./package-routes.ts";
import { ACTIVATION_ROUTES } from "./activation/mod.ts";
import { PREVIEW_ROUTES } from "./previews.ts";
import {
  RELEASE_ROUTES,
  releaseActivated,
  releaseActivationFailed,
} from "./releases.ts";

export const ROUTES = [
  appCreate,
  appConnectSource,
  appArchive,
  appUnarchive,
  appRename,
  appEnableExecution,
  appDisableExecution,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appList,
  appGet,
  appRuntime,
  appLogs,
  annotationUploadScreenshot,
  annotationSend,
  annotationsGet,
  appAppApi,
  blueprintCheck,
  appCallApi,
  appInvocations,
  appInvocation,
  appRewindPlan,
  appRewind,
  appRewinds,
  appProjects,
  appScreenFile,
  ...APP_GRANT_ROUTES,
  ...PACKAGE_ROUTES,
  ...ACTIVATION_ROUTES,
  ...PREVIEW_ROUTES,
  ...RELEASE_ROUTES,
] as const;

export const EVENTS = [
  appCreated,
  appSourceConnected,
  appArchived,
  appUnarchived,
  appRenamed,
  appExecutionEnabled,
  appExecutionDisabled,
  appStarted,
  appStopped,
  appUnavailable,
  ...PACKAGE_EVENTS,
  releaseActivated,
  releaseActivationFailed,
] as const;
