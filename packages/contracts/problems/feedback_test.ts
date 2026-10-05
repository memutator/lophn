import { assertEquals } from "@std/assert";
import {
  feedbackScreenshotInputSchema,
  feedbackTextSchema,
  recordReportInputSchema,
  reportBlobInputSchema,
  REPORTING_LIMITS,
  submitFeedbackInputSchema,
} from "./mod.ts";
import type { ReportBlobInput, SubmitFeedbackInput } from "./mod.ts";
import {
  preparedReport,
  REPORTING_TEST_AT as at,
  REPORTING_TEST_HASH as hash,
  reportingId,
  textFeedback,
} from "./testing/mod.ts";

function blob(
  purpose: ReportBlobInput["purpose"],
  size_bytes: number,
  contentHash = hash,
): ReportBlobInput {
  return {
    hash: contentHash,
    size_bytes,
    purpose,
    source: {
      kind: "prepared",
      blob: {
        hash: contentHash,
        size_bytes,
        purpose,
        preparation: "opaque-preparation",
        principal: "original-user",
      },
    },
  };
}
function screenFeedback(): SubmitFeedbackInput {
  const input = textFeedback();
  input.selection = { screen: true, screenshot: true };
  input.view = {
    binding: "button-view-binding",
    name: "Editor",
    app: input.app,
    release: reportingId("rel"),
    mode: "live",
    bundle_hash: hash,
    diagnostic_scope: null,
    observed_at: at,
    capture: null,
    final_screenshot_hash: "b".repeat(64),
  };
  input.facts = {
    tab: "Summary",
    url: "/orders?customer=ada#top",
    inputs: [{ name: "memo", value: "hello" }],
    business_data: { rows: [] },
  };
  input.screenshot = { size_bytes: 2097152 };
  return input;
}
Deno.test("problems/feedback#R1: nonblank redacted text counts Unicode scalars not UTF16 units", () => {
  for (
    const text of ["a", "界".repeat(500), "😀".repeat(500), "e\u0301".repeat(250)]
  ) {
    assertEquals(feedbackTextSchema.safeParse(text).success, true);
  }
  for (
    const text of [
      "",
      " \n\t",
      "a".repeat(501),
      "😀".repeat(501),
      "\ud800",
      "x\udfff",
      "e\u0301".repeat(251),
    ]
  ) {
    assertEquals(feedbackTextSchema.safeParse(text).success, false);
  }
  const input = textFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  // source·code·snapshot·blob은 호출자가 정하지 않는다: 원자료만 받는다.
  for (
    const extra of [
      { source: "feedback" },
      { code: "_feedback" },
      { snapshot: {} },
      { blobs: [] },
      { view_binding: "x" },
    ]
  ) {
    assertEquals(
      submitFeedbackInputSchema.safeParse({ ...input, ...extra }).success,
      false,
    );
  }
  assertEquals(
    submitFeedbackInputSchema.safeParse({ ...input, report_id: input.app })
      .success,
    false,
  );
});
Deno.test("problems/feedback#R10: text-only input needs no view, invocation or facts", () => {
  const input = textFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  // 선택 표시만 있고 자료가 없어도 접수할 수 있다: 이유는 collector가 남긴다.
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      selection: { screen: true, screenshot: true },
    }).success,
    true,
  );
});
Deno.test("problems/feedback#R8: screenshot is a declared size on the byte channel, no base64 in JSON", () => {
  const input = screenFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  for (
    const change of [
      { size_bytes: 2097153 },
      { size_bytes: 0 },
      { bytes: "base64" },
      { mime_type: "image/png", width: 10, height: 10 },
    ]
  ) {
    assertEquals(
      feedbackScreenshotInputSchema.safeParse({
        size_bytes: 10,
        ...change,
      }).success,
      false,
    );
  }
  const valid = blob("feedback_state", 10);
  assertEquals(reportBlobInputSchema.safeParse(valid).success, true);
  assertEquals(
    reportBlobInputSchema.safeParse({
      hash,
      size_bytes: 10,
      purpose: "feedback_state",
    }).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({ ...valid, hash: "b".repeat(64) }).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({ ...valid, size_bytes: 11 }).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({ ...valid, purpose: "snapshot_logs" })
      .success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({
      ...valid,
      source: { ...valid.source, extra: true },
    }).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({
      ...valid,
      source: {
        kind: "existing",
        reference: {
          owner_kind: "snapshot",
          owner_key: "known-snapshot",
          field: "state",
          hash,
          registered_seq: "1",
        },
      },
    }).success,
    true,
  );
});
Deno.test("problems/feedback#R9: state 65536, log total bytes and the 3 MiB transfer bound are finite", () => {
  assertEquals(
    reportBlobInputSchema.safeParse(blob("feedback_state", 65536)).success,
    true,
  );
  assertEquals(
    reportBlobInputSchema.safeParse(blob("feedback_state", 65537)).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse(blob("snapshot_logs", 65536)).success,
    true,
  );
  assertEquals(
    reportBlobInputSchema.safeParse(blob("snapshot_logs", 65537)).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse(blob("snapshot_stack", 16384)).success,
    true,
  );
  assertEquals(
    reportBlobInputSchema.safeParse(blob("snapshot_stack", 16385)).success,
    false,
  );
  // 짧은 글자 수여도 실제 전송 JSON bytes와 PNG 크기를 함께 센다.
  const input = screenFeedback();
  input.text = "界".repeat(400000);
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, false);
  const heavy = screenFeedback();
  heavy.text = "x".repeat(REPORTING_LIMITS.feedback_total_bytes - 2097152);
  assertEquals(submitFeedbackInputSchema.safeParse(heavy).success, false);
  heavy.screenshot = null;
  assertEquals(submitFeedbackInputSchema.safeParse(heavy).success, true);
  assertEquals(REPORTING_LIMITS.feedback_total_bytes, 3145728);
});
Deno.test("problems/feedback#R6: view binding, observed time, app and mode scope cannot disagree", () => {
  const input = screenFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  const view = input.view!;
  for (
    const change of [
      { observed_at: "2026-10-04T12:01:00.000Z" },
      { app: reportingId("prb") },
      { binding: " " },
      { mode: "preview" as const },
      { diagnostic_scope: "scope-1" },
      { capture: "other" },
      { final_screenshot_hash: "short" },
    ]
  ) {
    assertEquals(
      submitFeedbackInputSchema.safeParse({
        ...input,
        view: { ...view, ...change },
      }).success,
      false,
    );
  }
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      view: { ...view, mode: "preview", diagnostic_scope: "scope-1" },
    }).success,
    true,
  );
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      view: { ...view, app: reportingId("app").replace("fav", "faw") },
    }).success,
    false,
  );
});
Deno.test("problems/feedback#R3: targets are known ids or null and command start is a closed set", () => {
  const input = textFeedback();
  const known = {
    invocation: reportingId("inv"),
    automation: "nightly-sync",
    version: reportingId("ver"),
    command_start: "blocked_before_start" as const,
  };
  assertEquals(
    submitFeedbackInputSchema.safeParse({ ...input, targets: known }).success,
    true,
  );
  for (
    const change of [
      { invocation: "inv_x" },
      { version: reportingId("doc") },
      { automation: " " },
      { command_start: "running" },
      { extra: 1 },
    ]
  ) {
    assertEquals(
      submitFeedbackInputSchema.safeParse({
        ...input,
        targets: { ...known, ...change },
      }).success,
      false,
    );
  }
});
Deno.test("problems/feedback#R11: frozen record content needs every blob authority and host-assigned origin", () => {
  const input = preparedReport();
  input.report.text = hash;
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  input.blobs = [blob("report_text", 1)];
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
  input.blobs = [blob("snapshot_stack", 1)];
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  input.blobs = [blob("report_text", 1)];
  input.report.source = "feedback";
  input.report.code = "_feedback";
  input.group_key = {
    kind: "feedback",
    code: "_feedback",
    discriminator: input.report.id,
  };
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  input.origin.context.origin = "shell_user";
  input.origin.context.authentication.actor = "user";
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
});
