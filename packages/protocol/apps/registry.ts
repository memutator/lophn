import {
  appArchive,
  appConnectSource,
  appCreate,
  appDelete,
  appEditFolders,
  appGet,
  appList,
  appRename,
  appSetIcon,
  appUnarchive,
} from "./apps.ts";
import {
  annotationSend,
  annotationsGet,
  annotationUploadScreenshot,
} from "./annotation.ts";
import { appLogViewError } from "./app-log.ts";
import {
  appIcon,
  appSkills,
  appToolIndex,
  appTools,
} from "./declaration/read.ts";
import { declarationCheck } from "./declaration/check.ts";
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
import { NOTICE_ROUTES } from "./notice.ts";
import { APP_TRAY_ROUTES } from "./tray.ts";
import { APP_EVENT_ROUTES } from "./events.ts";
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
  appsOAuthSignOut,
  appsOAuthState,
} from "./oauth.ts";
import { appsSecretValue } from "./secret-use.ts";
import { PREVIEW_ROUTES } from "./previews.ts";
import { RELEASE_ROUTES } from "./releases.ts";
import {
  appSdkDecide,
  appSdkFeature,
  appSdkReviewRecord,
  appSdkStatus,
} from "./sdk-status.ts";
import { appUsage } from "./usage.ts";

export const ROUTES = [
  appCreate,
  appConnectSource,
  appArchive,
  appUnarchive,
  appDelete,
  appRename,
  appEditFolders,
  appSetIcon,
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
  appIcon,
  appSkills,
  declarationCheck,
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
  appsOAuthSignOut,
  appsOAuthState,
  appUsage,
  appSdkStatus,
  appSdkDecide,
  appSdkReviewRecord,
  appSdkFeature,
  ...APP_GRANT_ROUTES,
  ...NOTICE_ROUTES,
  ...APP_TRAY_ROUTES,
  ...APP_EVENT_ROUTES,
  ...PACKAGE_ROUTES,
  ...ACTIVATION_ROUTES,
  // consent.ts가 activation.ts를 import해서 ACTIVATION_ROUTES에 넣으면 순환 import다.
  activationAskConsent,
  activationConsent,
  activationConsents,
  ...PREVIEW_ROUTES,
  ...RELEASE_ROUTES,
] as const;
