import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import {
  FEEDBACK_CAPTURE_BLOCKS,
  feedbackTextSchema,
} from "../problems/feedback.ts";
import { missingReasonInputSchema } from "../problems/snapshots.ts";
import { REPORTING_LIMITS } from "../problems/sdk-report.ts";

// 버튼 시점 고정 참조. 원문은 main 메모리다(architecture/shell 5.2).
const draftRefSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "draft ref contains a control character" },
);

const viewSessionSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "view session contains a control character" },
);

export const feedbackBeginSchema = z.strictObject({
  view_session: viewSessionSchema,
  // Issues의 "직접 해 봤지만 안 됩니다": 이 보고를 덧붙일 같은 앱의 기존 문제.
  problem: z.string().regex(/^prb_[0-7][0-9a-hjkmnp-tv-z]{25}$/).optional(),
});

export type FeedbackBegin = z.infer<typeof feedbackBeginSchema>;

// 글은 problems/feedback의 1~500 scalar 입력을 그대로 쓴다. 선택 자료만 shell이 더한다.
export const feedbackSubmitSchema = z.strictObject({
  draftRef: draftRefSchema,
  text: feedbackTextSchema,
  selection: z.strictObject({
    screen: z.boolean(),
    screenshot: z.boolean(),
  }),
});

export type FeedbackSubmit = z.infer<typeof feedbackSubmitSchema>;

export const feedbackCancelSchema = z.strictObject({
  draftRef: draftRefSchema,
});

export type FeedbackCancel = z.infer<typeof feedbackCancelSchema>;

// 접수된 feedback이 묶인 Issue로 간다. dialog를 닫고 그 앱 공간을 연다.
export const feedbackOpenIssueSchema = feedbackCancelSchema;

export const FEEDBACK_IPC = {
  "shell:feedback-begin": feedbackBeginSchema,
  "shell:feedback-submit": feedbackSubmitSchema,
  "shell:feedback-cancel": feedbackCancelSchema,
  "shell:feedback-open-issue": feedbackOpenIssueSchema,
} as const;

export type FeedbackIpc = keyof typeof FEEDBACK_IPC;

// 이미지를 아직 얻는 중(pending)이거나 얻을 수 없었던 분류.
export const FEEDBACK_SCREENSHOT_STATES = [
  "pending",
  ...FEEDBACK_CAPTURE_BLOCKS,
] as const;

// 미리보기는 글·화면 상태의 redaction 결과와 없는 이유만 담는다.
// screenshot은 사람이 고른 그대로라 redaction 불가 이유·가림 값을 두지 않는다(D32).
// `screenshot_png`는 main이 캡처한 같은 PNG를 가리지 않고 dialog 미리보기에 보이는 data URL이고,
// `screen_summary`는 보낼 화면 상태 중 사람이 알아볼 화면 이름·URL path다.
export const feedbackPreviewSchema = z.strictObject({
  draftRef: draftRefSchema,
  text: feedbackTextSchema.nullable(),
  screen: sha256Schema.nullable(),
  screen_missing_reason: missingReasonInputSchema.nullable(),
  screenshot: sha256Schema.nullable(),
  screenshot_png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
    .nullable().optional(),
  screenshot_block: z.enum(FEEDBACK_SCREENSHOT_STATES).nullable().optional(),
  screen_summary: z.strictObject({
    name: z.string().regex(/\S/),
    path: z.string().nullable(),
  }).nullable().optional(),
  // 이 보고가 Issues에서 고른 기존 문제에 덧붙는지.
  existing_issue: z.boolean().optional(),
}).refine((value) =>
  (value.screen === null) !== (value.screen_missing_reason === null)
).refine((value) =>
  value.screenshot_png === undefined ||
  (value.screenshot === null) === (value.screenshot_png === null)
);

export type FeedbackPreview = z.infer<typeof feedbackPreviewSchema>;

export const FEEDBACK_PUSH = {
  "shell:feedback-preview": feedbackPreviewSchema,
} as const;

// problems/feedback 한도를 shell이 복제하지 않고 다시 내보낸다.
export const FEEDBACK_LIMITS = {
  text_scalars: REPORTING_LIMITS.feedback_text_scalars,
  state_bytes: REPORTING_LIMITS.feedback_state_bytes,
  png_long_side: REPORTING_LIMITS.feedback_png_long_side,
  png_bytes: REPORTING_LIMITS.feedback_png_bytes,
  total_bytes: REPORTING_LIMITS.feedback_total_bytes,
} as const;

export type LophnShellFeedback = {
  beginFeedback(view_session: string): Promise<{ draftRef: string }>;
  submitFeedback(
    draftRef: string,
    text: string,
    selection: { screen: boolean; screenshot: boolean },
  ): Promise<{ report: string; problem: string | null }>;
  cancelFeedback(draftRef: string): Promise<void>;
  openFeedbackIssue(draftRef: string): Promise<void>;
};
