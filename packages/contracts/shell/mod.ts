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
// shell은 ledger route와 event를 내놓지 않는다.
export const ROUTES = [] as const;
export const EVENTS = [] as const;
