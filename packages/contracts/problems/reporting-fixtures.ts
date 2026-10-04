import type {
  RecordReportInput,
  SnapshotInput,
  SubmitFeedbackInput,
} from "./mod.ts";

export const reportingId = (prefix: string) =>
  `${prefix}_01arz3ndektsv4rrffq69g5fav`;
export const REPORTING_TEST_AT = "2026-10-04T12:00:00.000Z";
export const REPORTING_TEST_HASH = "a".repeat(64);
export function missingSnapshot(): SnapshotInput {
  const reason = { reason: "source unavailable" };
  return {
    id: reportingId("snp"),
    captured_at: REPORTING_TEST_AT,
    invocation: null,
    invocation_missing_reason: reason,
    error: null,
    error_missing_reason: reason,
    logs: null,
    logs_missing_reason: reason,
    screen: null,
    screen_missing_reason: reason,
  };
}
export function preparedReport(): RecordReportInput {
  const scope = {
    app: reportingId("app"),
    release: reportingId("rel"),
    release_missing_reason: null,
    bundle_hash: REPORTING_TEST_HASH,
    mode: "live" as const,
    diagnostic_scope: null,
  };
  return {
    report: {
      id: reportingId("rpt"),
      ...scope,
      source: "app",
      code: "save_failed",
      text: null,
      details: null,
      snapshot: reportingId("snp"),
      observed_at: REPORTING_TEST_AT,
      principal: "origin-principal",
      content_hash: REPORTING_TEST_HASH,
    },
    snapshot: missingSnapshot(),
    group_key: { kind: "declared", code: "save_failed", discriminator: null },
    existing_problem: null,
    blobs: [],
    origin: {
      report_id: reportingId("rpt"),
      content_hash: REPORTING_TEST_HASH,
      context: {
        ...scope,
        binding: "authenticated-process-binding",
        origin: "app",
        authentication: {
          principal: "origin-principal",
          actor: `app:${reportingId("app")}`,
          scope: { operations: ["problems/report"], targets: {} },
          conditions: {
            app: reportingId("app"),
            process: "process-nonce",
            mode: "live",
          },
          credential_ref: "opaque-credential-reference",
        },
      },
    },
  };
}
export function textFeedback(): SubmitFeedbackInput {
  return {
    feedback: {
      report_id: reportingId("rpt"),
      app: reportingId("app"),
      text: "It did not save.",
      existing_problem: null,
      observed_at: REPORTING_TEST_AT,
      view_binding: null,
      screen_selected: false,
      screenshot_selected: false,
      snapshot: missingSnapshot(),
    },
    blobs: [],
    screenshot: null,
  };
}
