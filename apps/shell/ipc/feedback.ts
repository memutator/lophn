// [Report a problem] 경계(contracts#T38 FEEDBACK_IPC·FEEDBACK_PUSH의 사본). main tsc는 contracts
// package를 보지 않으므로 같은 모양을 여기 둔다. feedback_test.ts가 contracts schema와 같은 값을
// 받고 거절하는지 맞춘다. 원문 글·binding·raw capture는 main 메모리에만 있고 renderer에는
// draftRef와 안전한 미리보기만 온다(architecture/shell 5.2).
import { z } from "zod";

export const FEEDBACK_BEGIN_CHANNEL = "shell:feedback-begin";
export const FEEDBACK_SUBMIT_CHANNEL = "shell:feedback-submit";
export const FEEDBACK_CANCEL_CHANNEL = "shell:feedback-cancel";
export const FEEDBACK_OPEN_ISSUE_CHANNEL = "shell:feedback-open-issue";
export const FEEDBACK_PREVIEW_CHANNEL = "shell:feedback-preview";

/** problems/feedback 한도(contracts FEEDBACK_LIMITS와 같은 값). */
export const FEEDBACK_LIMITS = {
  text_scalars: 500,
  state_bytes: 65_536,
  png_long_side: 1_600,
  png_bytes: 2_097_152,
  total_bytes: 3_145_728,
} as const;

/** 앱 view 캡처를 기다리는 최대 시간. 늦은 이미지는 버린다. */
export const FEEDBACK_CAPTURE_MS = 1_500;

/**
 * 사람이 보낸 feedback이 묶인 문제의 문구. problems/problem-codes가 `_feedback`에 정한 값
 * 그대로다(contracts RESERVED_PROBLEM_CODES, shell/wording#R9). shell이 고치거나 합치지 않는다.
 */
export const FEEDBACK_PROBLEM_MESSAGE = "You reported an issue.";

const noControl = (value: string) => !/\p{Cc}/u.test(value);
const ref = z.string().min(1).refine(noControl);

// problems/feedback#R1: 공백 외 1~500 Unicode scalar. lone surrogate는 받지 않는다.
export const feedbackTextSchema = z.string().regex(/\S/).refine((text) => {
  const scalars = [...text];
  return scalars.length >= 1 &&
    scalars.length <= FEEDBACK_LIMITS.text_scalars &&
    scalars.every((scalar) => {
      const code = scalar.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    });
});

export const feedbackBeginSchema = z.strictObject({ view_session: ref });

export const feedbackSubmitSchema = z.strictObject({
  draftRef: ref,
  text: feedbackTextSchema,
  selection: z.strictObject({ screen: z.boolean(), screenshot: z.boolean() }),
});

export const feedbackCancelSchema = z.strictObject({ draftRef: ref });

export const FEEDBACK_CAPTURE_BLOCKS = [
  "hidden",
  "protected_window",
  "capture_failed",
] as const;
export type FeedbackCaptureBlock = typeof FEEDBACK_CAPTURE_BLOCKS[number];

export const FEEDBACK_SCREENSHOT_STATES = [
  "pending",
  ...FEEDBACK_CAPTURE_BLOCKS,
] as const;
export type FeedbackScreenshotState = typeof FEEDBACK_SCREENSHOT_STATES[number];

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const feedbackPreviewSchema = z.strictObject({
  draftRef: ref,
  text: feedbackTextSchema.nullable(),
  screen: sha256.nullable(),
  screen_missing_reason: z.strictObject({ reason: z.string().regex(/\S/) })
    .nullable(),
  screenshot: sha256.nullable(),
  screenshot_png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
    .nullable().optional(),
  screenshot_block: z.enum(FEEDBACK_SCREENSHOT_STATES).nullable().optional(),
  screen_summary: z.strictObject({
    name: z.string().regex(/\S/),
    path: z.string().nullable(),
  }).nullable().optional(),
}).refine((value) =>
  (value.screen === null) !== (value.screen_missing_reason === null)
).refine((value) =>
  value.screenshot_png === undefined ||
  (value.screenshot === null) === (value.screenshot_png === null)
);

export type FeedbackPreview = z.infer<typeof feedbackPreviewSchema>;
export type FeedbackSelection = { screen: boolean; screenshot: boolean };

export type FeedbackErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "unavailable"
  | "internal";

/** main이 IPC로 돌려주는 모양. preload가 값 또는 code를 싣은 Error 거절로 바꾼다. */
export type FeedbackReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: FeedbackErrorCode; message: string } };

export interface FeedbackAccepted {
  /** 접수된 Report. */
  report: string;
  /** 묶인 문제. live가 아니면 문제로 묶지 않아 null이다. */
  problem: string | null;
}

/** desktop renderer의 버튼 쪽. view_session만 보내고 신원은 main이 정한다. */
export interface LophnShellFeedbackBegin {
  beginFeedback(view_session: string): Promise<{ draftRef: string }>;
}

/** overlay의 dialog 쪽. 실패는 code 하나를 message로 싣은 Error로 거절한다. */
export interface LophnOverlayFeedback {
  submitFeedback(
    draftRef: string,
    text: string,
    selection: FeedbackSelection,
  ): Promise<FeedbackAccepted>;
  cancelFeedback(draftRef: string): Promise<void>;
  openFeedbackIssue(draftRef: string): Promise<void>;
  /** main이 미는 미리보기. 지금까지 받은 마지막 미리보기도 곧바로 넘긴다. */
  subscribePreview(listener: (preview: FeedbackPreview) => void): () => void;
}
