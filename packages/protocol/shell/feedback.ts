import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { feedbackTextSchema } from "../problems/feedback.ts";
import { REPORTING_LIMITS } from "../problems/sdk-report.ts";

// 버튼 시점 고정 참조. 원문은 main 메모리다.
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
  problem: idSchema("prb").optional(),
});

export type FeedbackBegin = z.infer<typeof feedbackBeginSchema>;

// 제보는 글만 보낸다. 화면 상태·screenshot 선택이 없다.
// existing_problem은 Issues에서 고른 같은 앱의 기존 문제다. null이면 새 문제다.
export const feedbackSendSchema = z.strictObject({
  draftRef: draftRefSchema,
  text: feedbackTextSchema,
  existing_problem: idSchema("prb").nullable(),
});

export type FeedbackSend = z.infer<typeof feedbackSendSchema>;

export const FEEDBACK_SEND_IPC = {
  "shell:feedback-send": feedbackSendSchema,
} as const;

export const feedbackCancelSchema = z.strictObject({
  draftRef: draftRefSchema,
});

export type FeedbackCancel = z.infer<typeof feedbackCancelSchema>;

// 접수된 feedback이 묶인 Issue로 간다. dialog를 닫고 그 앱 공간을 연다.
export const feedbackOpenIssueSchema = feedbackCancelSchema;

export const FEEDBACK_IPC = {
  "shell:feedback-begin": feedbackBeginSchema,
  "shell:feedback-cancel": feedbackCancelSchema,
  "shell:feedback-open-issue": feedbackOpenIssueSchema,
} as const;

export type FeedbackIpc = keyof typeof FEEDBACK_IPC;

// problems/feedback 한도를 shell이 복제하지 않고 다시 내보낸다.
export const FEEDBACK_LIMITS = {
  text_scalars: REPORTING_LIMITS.feedback_text_scalars,
  state_bytes: REPORTING_LIMITS.feedback_state_bytes,
  png_long_side: REPORTING_LIMITS.feedback_png_long_side,
  png_bytes: REPORTING_LIMITS.feedback_png_bytes,
  total_bytes: REPORTING_LIMITS.feedback_total_bytes,
} as const;

export type LophnShellFeedback = {
  beginFeedback(
    view_session: string,
    problem?: string,
  ): Promise<{ draftRef: string }>;
  cancelFeedback(draftRef: string): Promise<void>;
  openFeedbackIssue(draftRef: string): Promise<void>;
};

export type LophnShellFeedbackSend = {
  sendFeedback(
    draftRef: string,
    text: string,
    existing_problem: string | null,
  ): Promise<{ report: string; problem: string | null }>;
};
