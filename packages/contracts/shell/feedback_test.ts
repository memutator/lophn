import { assert, assertEquals } from "@std/assert";
import { feedbackTextSchema } from "../problems/feedback.ts";
import { REPORTING_LIMITS } from "../problems/sdk-report.ts";
import {
  FEEDBACK_IPC,
  FEEDBACK_LIMITS,
  FEEDBACK_PUSH,
  feedbackBeginSchema,
  feedbackPreviewSchema,
  feedbackSubmitSchema,
  type LophnShellFeedback,
} from "./feedback.ts";

const HASH = "ab".repeat(32);

Deno.test(
  "shell/app-frame#R32, shell/app-frame#R34: feedback IPC는 begin·submit·cancel과 preview push다",
  () => {
    assertEquals(Object.keys(FEEDBACK_IPC), [
      "shell:feedback-begin",
      "shell:feedback-submit",
      "shell:feedback-cancel",
    ]);
    assertEquals(Object.keys(FEEDBACK_PUSH), ["shell:feedback-preview"]);
    const shell: LophnShellFeedback = {
      beginFeedback: () => Promise.reject(new Error("x")),
      submitFeedback: () => Promise.reject(new Error("x")),
      cancelFeedback: () => Promise.reject(new Error("x")),
    };
    assertEquals(Object.keys(shell), [
      "beginFeedback",
      "submitFeedback",
      "cancelFeedback",
    ]);
    assert(feedbackBeginSchema.safeParse({ view_session: "view-1" }).success);
    assert(
      feedbackSubmitSchema.safeParse({
        draftRef: "draft-1",
        text: "화면이 멈췄다",
        selection: { screen: true, screenshot: false },
      }).success,
    );
  },
);

Deno.test(
  "problems/feedback#R1: 제출 글은 problems feedback 입력을 재사용하고 모르는 field를 거절한다",
  () => {
    assertEquals(
      FEEDBACK_LIMITS.text_scalars,
      REPORTING_LIMITS.feedback_text_scalars,
    );
    assertEquals(FEEDBACK_LIMITS.state_bytes, 65_536);
    assertEquals(FEEDBACK_LIMITS.png_long_side, 1_600);
    assertEquals(FEEDBACK_LIMITS.png_bytes, 2_097_152);
    assertEquals(FEEDBACK_LIMITS.total_bytes, 3_145_728);
    assert(feedbackTextSchema.safeParse("화면이 멈췄다").success);
    assert(!feedbackTextSchema.safeParse("   ").success);
    assert(!feedbackTextSchema.safeParse("가".repeat(501)).success);
    assert(
      !feedbackSubmitSchema.safeParse({
        draftRef: "draft-1",
        text: "화면이 멈췄다",
        selection: { screen: true, screenshot: false },
        screenshot_bytes: "aaaa",
      }).success,
    );
    assert(
      !feedbackBeginSchema.safeParse({
        view_session: "doc_01arz3ndektsv4rrffq69g5fav",
        app: "app_claimed",
      }).success,
    );
  },
);

Deno.test(
  "problems/feedback#R8: 미리보기는 화면 상태 hash 또는 없는 이유 하나와 사람이 고른 screenshot hash만 담는다",
  () => {
    const preview = feedbackPreviewSchema.parse({
      draftRef: "draft-1",
      text: "화면이 멈췄다",
      screen: HASH,
      screen_missing_reason: null,
      screenshot: null,
    });
    assertEquals(preview.screenshot, null);
    assert(!("screenshot_missing_reason" in preview));
    assert(
      feedbackPreviewSchema.safeParse({
        draftRef: "draft-1",
        text: null,
        screen: null,
        screen_missing_reason: { reason: "capture failed" },
        screenshot: HASH,
      }).success,
    );
    assert(
      !feedbackPreviewSchema.safeParse({
        draftRef: "draft-1",
        text: null,
        screen: HASH,
        screen_missing_reason: { reason: "both" },
        screenshot: null,
      }).success,
    );
    assert(
      !feedbackPreviewSchema.safeParse({
        draftRef: "draft-1",
        text: null,
        screen: null,
        screen_missing_reason: { reason: "capture failed" },
        screenshot: null,
        screenshot_redaction: "omitted",
      }).success,
    );
  },
);
