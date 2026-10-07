import { assertEquals } from "@std/assert";

import {
  FEEDBACK_IPC,
  FEEDBACK_LIMITS as CONTRACT_LIMITS,
  FEEDBACK_PUSH,
} from "../../../packages/contracts/shell/feedback.ts";
import { RESERVED_PROBLEM_CODES } from "../../../packages/contracts/problems/problem-codes.ts";
import { submitFeedbackInputSchema } from "../../../packages/contracts/problems/feedback.ts";
import { createFeedback } from "../main/app-frame/feedback.ts";
import { ContentsRegistry } from "../main/desktop/ipc-guard.ts";
import {
  FEEDBACK_BEGIN_CHANNEL,
  FEEDBACK_CANCEL_CHANNEL,
  FEEDBACK_LIMITS,
  FEEDBACK_OPEN_ISSUE_CHANNEL,
  FEEDBACK_PREVIEW_CHANNEL,
  FEEDBACK_PROBLEM_MESSAGE,
  FEEDBACK_SUBMIT_CHANNEL,
  feedbackBeginSchema,
  feedbackCancelSchema,
  feedbackPreviewSchema,
  feedbackSubmitSchema,
} from "./feedback.ts";

type Schema = { safeParse(value: unknown): { success: boolean } };

function same(name: string, ours: Schema, theirs: Schema, values: unknown[]) {
  for (const value of values) {
    assertEquals(
      ours.safeParse(value).success,
      theirs.safeParse(value).success,
      `${name}: ${JSON.stringify(value)}`,
    );
  }
}

const HASH = "ab".repeat(32);
const PNG = "data:image/png;base64,iVBORw0KGgo=";

Deno.test("problems/feedback#R1, R6, R10: shell feedback IPC 사본은 contracts의 channel·한도와 받는 값·거절하는 값이 같다", () => {
  assertEquals(Object.keys(FEEDBACK_IPC), [
    FEEDBACK_BEGIN_CHANNEL,
    FEEDBACK_SUBMIT_CHANNEL,
    FEEDBACK_CANCEL_CHANNEL,
    FEEDBACK_OPEN_ISSUE_CHANNEL,
  ]);
  assertEquals(Object.keys(FEEDBACK_PUSH), [FEEDBACK_PREVIEW_CHANNEL]);
  assertEquals(FEEDBACK_LIMITS, CONTRACT_LIMITS);
  same(
    FEEDBACK_BEGIN_CHANNEL,
    feedbackBeginSchema,
    FEEDBACK_IPC[FEEDBACK_BEGIN_CHANNEL],
    [
      { view_session: "view-1" },
      { view_session: "" },
      { view_session: "a\u0007" },
      { view_session: "view-1", app: "app_x" },
    ],
  );
  const submit = {
    draftRef: "draft-1",
    text: "The total is wrong.",
    selection: { screen: true, screenshot: false },
  };
  same(
    FEEDBACK_SUBMIT_CHANNEL,
    feedbackSubmitSchema,
    FEEDBACK_IPC[FEEDBACK_SUBMIT_CHANNEL],
    [
      submit,
      { ...submit, text: "   " },
      { ...submit, text: "a".repeat(500) },
      { ...submit, text: "a".repeat(501) },
      { ...submit, text: "\ud800" },
      { ...submit, selection: { screen: true } },
      { ...submit, screenshot_bytes: "aaaa" },
    ],
  );
  same(
    FEEDBACK_CANCEL_CHANNEL,
    feedbackCancelSchema,
    FEEDBACK_IPC[FEEDBACK_CANCEL_CHANNEL],
    [
      { draftRef: "draft-1" },
      { draftRef: "" },
      { draftRef: "draft-1", report: "rpt" },
    ],
  );
  same(
    FEEDBACK_OPEN_ISSUE_CHANNEL,
    feedbackCancelSchema,
    FEEDBACK_IPC[FEEDBACK_OPEN_ISSUE_CHANNEL],
    [
      { draftRef: "draft-1" },
      { draftRef: "" },
    ],
  );
  const preview = {
    draftRef: "draft-1",
    text: null,
    screen: HASH,
    screen_missing_reason: null,
    screenshot: HASH,
    screenshot_png: PNG,
    screenshot_block: null,
    screen_summary: { name: "main", path: "/screens/main/index.html" },
  };
  same(
    FEEDBACK_PREVIEW_CHANNEL,
    feedbackPreviewSchema,
    FEEDBACK_PUSH[FEEDBACK_PREVIEW_CHANNEL],
    [
      preview,
      {
        ...preview,
        screenshot: null,
        screenshot_png: null,
        screenshot_block: "pending",
      },
      { ...preview, screenshot: null },
      { ...preview, screen: null },
      {
        ...preview,
        screen: null,
        screen_missing_reason: { reason: "no screen" },
      },
      { ...preview, screenshot_block: "masked" },
      { ...preview, screenshot_png: "data:image/jpeg;base64,AAAA" },
      { ...preview, extra: true },
    ],
  );
});

Deno.test("shell/wording#R9: dialog의 문제 문구는 problems가 `_feedback`에 정한 값 그대로다", () => {
  const feedback = RESERVED_PROBLEM_CODES.find((code) =>
    code.code === "_feedback"
  );
  assertEquals(FEEDBACK_PROBLEM_MESSAGE, feedback?.message);
});

Deno.test("problems/feedback#R5, R6: main이 만든 제출 입력은 problems SubmitFeedback 입력 schema를 통과한다", async () => {
  const frame = (url: string) => ({ url, parent: null });
  const desk = {
    id: 1,
    isDestroyed: () => false,
    mainFrame: frame("lophn-shell://desktop/index.html"),
  };
  const overlay = {
    id: 2,
    isDestroyed: () => false,
    mainFrame: frame("lophn-shell://overlay/index.html"),
  };
  const registry = new ContentsRegistry();
  for (const [contents, host] of [[desk, "desktop"], [overlay, "overlay"]]) {
    registry.register({
      contents: contents as typeof desk,
      origin: {
        scheme: "lophn-shell",
        host: host as string,
        path: "/index.html",
      },
    });
  }
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sent: unknown[] = [];
  const event = (sender: typeof desk) => ({
    sender,
    senderFrame: sender.mainFrame,
  });
  for (const mode of ["live", "preview"] as const) {
    const feedback = createFeedback({
      registry,
      windowOfShell: (sender) => sender === desk ? "w" : undefined,
      windowOfOverlay: (sender) => sender === overlay ? "w" : undefined,
      view: () => ({
        view_session: "view-1",
        window: "w",
        generation: 1,
        app: "app_01j9zzzzzzzzzzzzzzzzzzzzzz",
        release: mode === "live" ? "rel_01j9zzzzzzzzzzzzzzzzzzzzz1" : null,
        mode,
        screen: "orders",
        bundleHash: "a".repeat(64),
        processNonce: "nonce",
        visible: true,
        url: "lophn-app://app-x/orders/index.html?q=secret",
        capture: () => Promise.resolve(png),
        current: () => true,
      }),
      dialog: () => ({
        open: () => true,
        close() {},
        preview() {},
        dialogOpen: () => false,
      }),
      protectedWindow: () => false,
      submit(input) {
        sent.push(input);
        return Promise.resolve({
          ok: true,
          value: { report: input.report_id, problem: null },
        });
      },
      openIssue() {},
      lookup: () => Promise.resolve({ ok: true, value: null }),
      ids: {
        draft: () => "draft-1",
        report: () => "rpt_01j9zzzzzzzzzzzzzzzzzzzzzz",
      },
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
      timer: { set: () => 0, clear() {} },
    });
    feedback.begin(event(desk), { view_session: "view-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await feedback.submit(event(overlay), {
      draftRef: "draft-1",
      text: "The total is wrong.",
      selection: { screen: true, screenshot: true },
    });
  }
  assertEquals(sent.length, 2);
  for (const input of sent) {
    const parsed = submitFeedbackInputSchema.safeParse(input);
    assertEquals(parsed.success, true, JSON.stringify(parsed.error?.issues));
  }
});
