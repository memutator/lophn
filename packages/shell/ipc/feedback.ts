// [Report a problem] 경계. main tsc는 protocol
// package를 보지 않으므로 같은 모양을 여기 둔다.
// 원문 글·binding은 main 메모리에만 있고 renderer에는 draftRef만 온다.
import { z } from "zod";

export const FEEDBACK_BEGIN_CHANNEL = "shell:feedback-begin";
export const FEEDBACK_SEND_CHANNEL = "shell:feedback-send";
export const FEEDBACK_CANCEL_CHANNEL = "shell:feedback-cancel";
export const FEEDBACK_OPEN_ISSUE_CHANNEL = "shell:feedback-open-issue";

/** problems/feedback 한도. core가 같은 값을 쓴다. */
export const FEEDBACK_LIMITS = {
  text_scalars: 500,
  state_bytes: 65_536,
  png_long_side: 1_600,
  png_bytes: 2_097_152,
  total_bytes: 3_145_728,
} as const;

/** 제보로 새로 연 문제의 이름(protocol FEEDBACK_PROBLEM_NAME과 같은 값). */
export const FEEDBACK_PROBLEM_NAME = "User report";

const noControl = (value: string) => !/\p{Cc}/u.test(value);
const ref = z.string().min(1).refine(noControl);

// 공백 외 1~500 Unicode scalar. lone surrogate는 받지 않는다.
const feedbackTextSchema = z.string().regex(/\S/).refine((text) => {
  const scalars = [...text];
  return scalars.length >= 1 &&
    scalars.length <= FEEDBACK_LIMITS.text_scalars &&
    scalars.every((scalar) => {
      const code = scalar.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    });
});

export const feedbackBeginSchema = z.strictObject({ view_session: ref });

// 제보는 글만 보낸다.
export const feedbackSendSchema = z.strictObject({
  draftRef: ref,
  text: feedbackTextSchema,
  existing_problem: z.string().regex(/^prb_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
    .nullable(),
});

export const feedbackCancelSchema = z.strictObject({ draftRef: ref });

type FeedbackErrorCode =
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

/** 제보에 덧붙일 수 있는 같은 앱의 열린 문제 한 줄. */
export interface FeedbackProblem {
  readonly id: string;
  readonly title: string;
  readonly count: number;
}

/** desktop renderer의 버튼 쪽. view_session만 보내고 신원은 main이 정한다. */
export interface LophnShellFeedbackBegin {
  beginFeedback(view_session: string): Promise<{ draftRef: string }>;
}

/** overlay의 dialog 쪽. 실패는 code 하나를 message로 싣은 Error로 거절한다. */
export interface LophnOverlayFeedback {
  sendFeedback(
    draftRef: string,
    text: string,
    existing_problem: string | null,
  ): Promise<FeedbackAccepted>;
  cancelFeedback(draftRef: string): Promise<void>;
  openFeedbackIssue(draftRef: string): Promise<void>;
}
