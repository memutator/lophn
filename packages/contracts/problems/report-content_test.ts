import { assertEquals } from "@std/assert";
import {
  recordReportInputSchema,
  reportContentHashInputSchema,
  reportInputSchema,
  reportSchema,
} from "./mod.ts";
import type { RecordReportInput, ReportBlobInput } from "./mod.ts";
import {
  preparedReport,
  REPORTING_TEST_HASH as hash,
  reportingId as id,
} from "./testing/mod.ts";

function blob(purpose: ReportBlobInput["purpose"]): ReportBlobInput {
  return {
    hash,
    size_bytes: 1,
    purpose,
    source: {
      kind: "prepared",
      blob: {
        hash,
        size_bytes: 1,
        purpose,
        preparation: "opaque",
        principal: "origin-principal",
      },
    },
  };
}
function feedbackRecord(): RecordReportInput {
  const input = preparedReport();
  input.report.source = "feedback";
  input.report.code = "_feedback";
  input.origin.context.origin = "shell_user";
  input.origin.context.authentication.actor = "user";
  input.group_key = {
    kind: "feedback",
    code: "_feedback",
    discriminator: input.report.id,
  };
  return input;
}
Deno.test("problems/feedback#R1: prepared, stored and canonical feedback content require text hash", () => {
  const input = feedbackRecord();
  assertEquals(reportInputSchema.safeParse(input.report).success, false);
  assertEquals(
    reportSchema.safeParse({ ...input.report, problem: id("prb") }).success,
    false,
  );
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  const { content_hash: _hash, ...report } = input.report;
  const canonical = {
    report,
    snapshot: input.snapshot,
    group_key: input.group_key,
    existing_problem: null,
    blobs: [],
  };
  assertEquals(
    reportContentHashInputSchema.safeParse(canonical).success,
    false,
  );
  input.report.text = hash;
  assertEquals(reportInputSchema.safeParse(input.report).success, true);
  assertEquals(
    reportSchema.safeParse({ ...input.report, problem: id("prb") }).success,
    true,
  );
  assertEquals(
    reportContentHashInputSchema.safeParse({
      ...canonical,
      report: { ...report, text: hash },
      blobs: [{ purpose: "report_text", hash }],
    }).success,
    true,
  );
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  input.blobs = [blob("report_text")];
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
  for (
    const group_key of [{
      kind: "declared",
      code: "save_failed",
      discriminator: null,
    }, { kind: "exception", code: "_exception", discriminator: hash }]
  ) {
    assertEquals(
      recordReportInputSchema.safeParse({
        ...input,
        existing_problem: id("prb"),
        group_key,
      }).success,
      true,
    );
  }
});
Deno.test("problems/snapshots#R15: automatic app/exception cannot persist feedback state or PNG", () => {
  for (const source of ["app", "exception"] as const) {
    for (const field of ["state", "screenshot"] as const) {
      const input = preparedReport();
      if (source === "exception") {
        input.report.source = source;
        input.report.code = "_exception";
        input.group_key = {
          kind: "exception",
          code: "_exception",
          discriminator: hash,
        };
        input.origin.context.origin = "process_observer";
      }
      input.snapshot.screen = {
        name: "Editor",
        observed_at: input.report.observed_at,
        state: null,
        state_missing_reason: { reason: "not selected" },
        screenshot: null,
        screenshot_missing_reason: { reason: "not selected" },
      };
      input.snapshot.screen_missing_reason = null;
      assertEquals(recordReportInputSchema.safeParse(input).success, true);
      input.snapshot.screen[field] = hash;
      input.snapshot.screen[`${field}_missing_reason`] = null;
      input.blobs = [
        blob(field === "state" ? "feedback_state" : "feedback_screenshot"),
      ];
      assertEquals(recordReportInputSchema.safeParse(input).success, false);
    }
  }
  const input = feedbackRecord();
  input.report.text = hash;
  input.blobs = [
    blob("report_text"),
    blob("feedback_state"),
    blob("feedback_screenshot"),
  ];
  input.snapshot.screen = {
    name: "Editor",
    observed_at: input.report.observed_at,
    state: hash,
    state_missing_reason: null,
    screenshot: hash,
    screenshot_missing_reason: null,
  };
  input.snapshot.screen_missing_reason = null;
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
});
