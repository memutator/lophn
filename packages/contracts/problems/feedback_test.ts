import { assertEquals } from "@std/assert";
import {
  feedbackInputSchema,
  feedbackScreenshotInputSchema,
  feedbackTextSchema,
  recordReportInputSchema,
  reportBlobInputSchema,
  REPORTING_LIMITS,
  submitFeedbackInputSchema,
} from "./mod.ts";
import type { ReportBlobInput } from "./mod.ts";
import {
  preparedReport,
  REPORTING_TEST_AT as at,
  REPORTING_TEST_HASH as hash,
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
function screenFeedback() {
  const input = textFeedback();
  input.feedback.view_binding = "button-view-binding";
  input.feedback.screen_selected = true;
  input.feedback.screenshot_selected = true;
  const state = blob("feedback_state", 65536);
  const png = blob("feedback_screenshot", 2097152, "b".repeat(64));
  input.feedback.snapshot.screen = {
    name: "Editor",
    observed_at: at,
    state: state.hash,
    state_missing_reason: null,
    screenshot: png.hash,
    screenshot_missing_reason: null,
  };
  input.feedback.snapshot.screen_missing_reason = null;
  input.blobs = [state, png];
  input.screenshot = {
    blob: png,
    mime_type: "image/png",
    width: 1600,
    height: 900,
  };
  return input;
}
Deno.test("problems/feedback#R1: nonblank redacted text counts Unicode scalars not UTF16 units", () => {
  for (
    const text of ["a", "界".repeat(500), "😀".repeat(500), "é".repeat(250)]
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
      "é".repeat(251),
    ]
  ) {
    assertEquals(feedbackTextSchema.safeParse(text).success, false);
  }
  const input = textFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  assertEquals(
    feedbackInputSchema.safeParse({ ...input.feedback, source: "feedback" })
      .success,
    false,
  );
  assertEquals(
    feedbackInputSchema.safeParse({
      ...input.feedback,
      report_id: input.feedback.app,
    }).success,
    false,
  );
});
Deno.test("problems/feedback#R10: text-only all-missing snapshot needs no view or invocation", () => {
  const input = textFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      feedback: {
        ...input.feedback,
        screen_selected: true,
        screenshot_selected: true,
      },
    }).success,
    true,
  );
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      feedback: {
        ...input.feedback,
        snapshot: { ...input.feedback.snapshot, screen_missing_reason: null },
      },
    }).success,
    false,
  );
});
Deno.test("problems/feedback#R8: PNG typed authority and metadata binds size/hash/purpose, no base64", () => {
  const input = screenFeedback();
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, true);
  const screenshot = input.screenshot!;
  for (
    const change of [{ mime_type: "image/jpeg" }, { width: 1601 }, {
      height: 0,
    }, { bytes: "base64" }]
  ) {
    assertEquals(
      feedbackScreenshotInputSchema.safeParse({ ...screenshot, ...change })
        .success,
      false,
    );
  }
  assertEquals(
    feedbackScreenshotInputSchema.safeParse({
      ...screenshot,
      blob: blob("feedback_screenshot", 2097153),
    }).success,
    false,
  );
  assertEquals(
    reportBlobInputSchema.safeParse({
      hash,
      size_bytes: 10,
      purpose: "feedback_state",
    }).success,
    false,
  );
  const valid = blob("feedback_state", 10);
  assertEquals(reportBlobInputSchema.safeParse(valid).success, true);
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
  assertEquals(
    submitFeedbackInputSchema.safeParse({ ...input, blobs: [input.blobs[0]] })
      .success,
    false,
  );
});
Deno.test("problems/feedback#R9: UTF8 state 65536, log total bytes and aggregate bounds are finite", () => {
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
  const input = screenFeedback();
  // Even short Unicode text is bounded by the actual transmitted JSON bytes.
  input.feedback.snapshot.screen!.name = "界".repeat(400000);
  assertEquals(submitFeedbackInputSchema.safeParse(input).success, false);
  assertEquals(REPORTING_LIMITS.feedback_total_bytes, 3145728);
});
Deno.test("problems/feedback#R6: button time, view binding, selections and image hash cannot disagree", () => {
  const input = screenFeedback();
  for (
    const change of [{ view_binding: null }, { screen_selected: false }, {
      screenshot_selected: false,
    }, { observed_at: "2026-10-04T12:01:00.000Z" }]
  ) {
    assertEquals(
      submitFeedbackInputSchema.safeParse({
        ...input,
        feedback: { ...input.feedback, ...change },
      }).success,
      false,
    );
  }
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      screenshot: {
        ...input.screenshot,
        blob: blob("feedback_screenshot", 100, "c".repeat(64)),
      },
    }).success,
    false,
  );
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      feedback: { ...input.feedback, view_binding: " " },
    }).success,
    false,
  );
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
Deno.test("problems/feedback#R8: screenshot blob authority matches by value regardless of key order", () => {
  const input = screenFeedback();
  const png = input.screenshot!.blob as Record<string, unknown>;
  const reordered = Object.fromEntries(Object.entries(png).reverse());
  assertEquals(
    submitFeedbackInputSchema.safeParse({
      ...input,
      screenshot: { ...input.screenshot, blob: reordered },
    }).success,
    true,
  );
});
