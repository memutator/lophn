import {
  appArchive,
  appConnectSource,
  appCreate,
  appGet,
  appList,
  appRename,
  appUnarchive,
} from "./apps.ts";
import {
  annotationSend,
  annotationsGet,
  annotationUploadScreenshot,
} from "./annotation.ts";
import { appLogViewError } from "./app-log.ts";
import { appToolIndex, appTools } from "./blueprint/read.ts";
import { blueprintCheck } from "./blueprint/check.ts";
import {
  appCallTool,
  appInvocation,
  appInvocations,
  appRewind,
  appRewindPlan,
  appRewinds,
  appScreenFile,
} from "./calls/mod.ts";
import {
  appDisableExecution,
  appEnableExecution,
  appLogs,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
} from "./runtime.ts";
import { APP_GRANT_ROUTES } from "./grants.ts";
import { PACKAGE_ROUTES } from "./package-routes.ts";
import {
  ACTIVATION_ROUTES,
  activationAskConsent,
  activationConsent,
  activationConsents,
} from "./activation/mod.ts";
import {
  appsOAuthBegin,
  appsOAuthCancel,
  appsOAuthClientSet,
  appsOAuthState,
} from "./oauth.ts";
import { appsSecretValue } from "./secret-use.ts";
import { PREVIEW_ROUTES } from "./previews.ts";
import { RELEASE_ROUTES } from "./releases.ts";
import { appUsage } from "./usage.ts";

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
  appLogViewError,
  annotationUploadScreenshot,
  annotationSend,
  annotationsGet,
  appTools,
  appToolIndex,
  blueprintCheck,
  appCallTool,
  appInvocations,
  appInvocation,
  appRewindPlan,
  appRewind,
  appRewinds,
  appScreenFile,
  appsSecretValue,
  appsOAuthClientSet,
  appsOAuthBegin,
  appsOAuthCancel,
  appsOAuthState,
  appUsage,
  ...APP_GRANT_ROUTES,
  ...PACKAGE_ROUTES,
  ...ACTIVATION_ROUTES,
  // consent.ts가 activation.ts를 import해서 ACTIVATION_ROUTES에 넣으면 순환 import다.
  activationAskConsent,
  activationConsent,
  activationConsents,
  ...PREVIEW_ROUTES,
  ...RELEASE_ROUTES,
] as const;
