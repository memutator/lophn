export {
  CONFIRMATION_ERRORS,
  CONFIRMATION_IPC,
  CONFIRMATION_REQUEST_KINDS,
  confirmationCancelSchema,
  type ConfirmationDisplay,
  confirmationDisplaySchema,
  type ConfirmationIntent,
  type ConfirmationIpc,
  type ConfirmationOpenInput,
  confirmationOpenInputSchema,
  type ConfirmationOpenIntent,
  confirmationOpenIntentSchema,
  type ConfirmationOpenResult,
  confirmationOpenResultSchema,
  type ConfirmationOutcome,
  confirmationOutcomeSchema,
  type ConfirmationRequest,
  type ConfirmationRequestKind,
  confirmationRequestSchema,
  type ConfirmationSubmission,
  confirmationSubmitSchema,
  type LophnConfirmation,
  type LophnShell,
} from "./confirmation.ts";
import { WORKSPACE_ROUTES } from "./workspace.ts";

export {
  type AppView,
  type CurrentViewState,
  type Selection,
  SUMMARY_MAX_BYTES,
  TAB_PAGE_SIZE,
  VIEW_STRING_MAX_CHARS,
  type ViewOmission,
  type ViewTab,
  WORKSPACE_ROUTES,
  workspaceBind,
  workspacePublish,
  workspaceRead,
  type WorkspaceReadOutput,
  workspaceUnpublish,
} from "./workspace.ts";
export {
  type LaunchIntent,
  launchIntentSchema,
  OPEN_APP_FLAG,
  QUIT_FLAG,
  type ThingsToConfirmLink,
  thingsToConfirmLinkSchema,
  TRAY_FLAG,
} from "./launch.ts";

// 확인 창을 여는 계기는 core event(ApprovalRequestCreated, QuestionCreated) 구독이다.
// shell은 ledger command·event를 내놓지 않는다. 현재 보기 relay만 core 메모리 route다.
export const ROUTES = WORKSPACE_ROUTES;
export const EVENTS = [] as const;
