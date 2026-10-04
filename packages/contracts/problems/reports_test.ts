import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  EVENTS,
  groupKeyInputSchema,
  observeException,
  observeExceptionInputSchema,
  problemObserved,
  problemOpened,
  recordReport,
  recordReportInputSchema,
  reportInputSchema,
  reportProblem,
  reportProblemInputSchema,
  reportRecorded,
  reportSchema,
  ROUTES,
  snapshotRecorded,
  submitFeedback,
} from "./mod.ts";
import {
  preparedReport,
  REPORTING_TEST_AT,
  REPORTING_TEST_HASH,
  reportingId as id,
} from "./reporting-fixtures.ts";

Deno.test("problems/reporting#R2: fixed collector and machine route table plus exact root membership", () => {
  const reporting = [
    reportProblem,
    observeException,
    submitFeedback,
    recordReport,
  ];
  assertEquals(
    reporting.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["ReportProblem", "/v1/problems/report", "worker"],
      ["ObserveException", "/v1/problems/observe-exception", "worker"],
      ["SubmitFeedback", "/v1/problems/submit-feedback", "worker"],
      ["RecordReport", "/v1/problems/record-report", "command"],
    ],
  );
  assertEquals(recordReport.actors, ["machine"]);
  assertEquals(submitFeedback.actors, ["user"]);
  assertEquals(reportProblem.actors, ["app"]);
  for (const route of reporting) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      route.errors.every((error) => ERROR_CODES.includes(error)),
      true,
    );
  }
  const events = [
    reportRecorded,
    snapshotRecorded,
    problemOpened,
    problemObserved,
  ];
  assertEquals(events.map((event) => event.type), [
    "ReportRecorded",
    "SnapshotRecorded",
    "ProblemOpened",
    "ProblemObserved",
  ]);
  for (const event of events) {
    assertEquals(EVENTS.filter((entry) => entry === event).length, 1);
    assertEquals(ALL_EVENTS.filter((entry) => entry === event).length, 1);
  }
});
Deno.test("problems/reporting#R2: ingress excludes authenticated scope claims at every nested boundary", () => {
  const input = {
    report_id: id("rpt"),
    code: "save_failed",
    observed_at: REPORTING_TEST_AT,
  };
  assertEquals(reportProblemInputSchema.safeParse(input).success, true);
  for (
    const field of [
      "app",
      "release",
      "mode",
      "source",
      "principal",
      "diagnostic_scope",
      "actor",
      "problem",
    ]
  ) {
    assertEquals(
      reportProblemInputSchema.safeParse({ ...input, [field]: "forged" })
        .success,
      false,
    );
  }
  assertEquals(
    reportProblemInputSchema.safeParse({
      ...input,
      invocation: {
        id: id("inv"),
        binding: "sdk_context",
        record_missing_reason: { reason: "pending", secret: true },
      },
    }).success,
    false,
  );
  assertEquals(
    reportProblemInputSchema.safeParse({ ...input, report_id: id("prb") })
      .success,
    false,
  );
  assertEquals(
    reportProblemInputSchema.safeParse({ ...input, text: "a".repeat(262144) })
      .success,
    false,
  );
});
Deno.test("problems/reporting#R8: app declaration syntax and reserved observer code are separate", () => {
  const input = {
    report_id: id("rpt"),
    observed_at: REPORTING_TEST_AT,
    code: "save_failed",
  };
  for (
    const code of [
      "_exception",
      "_feedback",
      "_invalid_report",
      "a",
      "Wrong",
      "a".repeat(49),
    ]
  ) {
    assertEquals(
      reportProblemInputSchema.safeParse({ ...input, code }).success,
      false,
    );
  }
  const observer = {
    report_id: id("rpt"),
    observed_at: REPORTING_TEST_AT,
    observation: "unhandledrejection",
    error: null,
    error_missing_reason: { reason: "unavailable" },
    invocation: null,
  };
  assertEquals(observeExceptionInputSchema.safeParse(observer).success, true);
  assertEquals(
    observeExceptionInputSchema.safeParse({ ...observer, code: "_exception" })
      .success,
    false,
  );
  assertEquals(
    observeExceptionInputSchema.safeParse({
      ...observer,
      error_missing_reason: null,
    }).success,
    false,
  );
});
Deno.test("problems/reporting#R2: report output scope and release XOR with additive output", () => {
  const input = preparedReport().report;
  assertEquals(reportInputSchema.safeParse(input).success, true);
  assertEquals(
    reportInputSchema.safeParse({ ...input, problem: id("prb") }).success,
    false,
  );
  assertEquals(
    reportSchema.safeParse({ ...input, problem: id("prb"), future: true })
      .success,
    true,
  );
  for (
    const change of [{ problem: null }, { diagnostic_scope: "scope" }, {
      release_missing_reason: "unknown",
    }, { release: null }]
  ) {
    assertEquals(
      reportSchema.safeParse({ ...input, problem: id("prb"), ...change })
        .success,
      false,
    );
  }
  for (const mode of ["preview", "test"]) {
    assertEquals(
      reportSchema.safeParse({
        ...input,
        mode,
        diagnostic_scope: "issued-scope",
        problem: null,
      }).success,
      true,
    );
    assertEquals(
      reportSchema.safeParse({
        ...input,
        mode,
        diagnostic_scope: " ",
        problem: null,
      }).success,
      false,
    );
  }
  assertEquals(
    reportSchema.safeParse({
      ...input,
      source: "exception",
      problem: id("prb"),
    }).success,
    false,
  );
});
Deno.test("problems/reporting#R9: trusted origin binds final id/hash and authenticated scope", () => {
  const input = preparedReport();
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
  for (const field of ["app", "release", "mode", "principal", "content_hash"]) {
    const values = {
      app: id("prb"),
      release: null,
      mode: "test",
      principal: "collector",
      content_hash: "b".repeat(64),
    };
    assertEquals(
      recordReportInputSchema.safeParse({
        ...input,
        report: {
          ...input.report,
          [field]: values[field as keyof typeof values],
        },
      }).success,
      false,
    );
  }
  assertEquals(
    recordReportInputSchema.safeParse({
      ...input,
      report: { ...input.report, snapshot: id("rpt") },
    }).success,
    false,
  );
  assertEquals(
    recordReportInputSchema.safeParse({
      ...input,
      origin: { ...input.origin, extra: true },
    }).success,
    false,
  );
  assertEquals(
    recordReportInputSchema.safeParse({
      ...input,
      origin: {
        ...input.origin,
        context: {
          ...input.origin.context,
          authentication: {
            ...input.origin.context.authentication,
            principal: " ",
          },
        },
      },
    }).success,
    false,
  );
});
Deno.test("problems/grouping#R6: selected feedback reuses declared or exception key, new feedback uses own rpt", () => {
  for (
    const group_key of [{
      kind: "declared",
      code: "save_failed",
      discriminator: null,
    }, {
      kind: "exception",
      code: "_exception",
      discriminator: REPORTING_TEST_HASH,
    }]
  ) {
    const input = preparedReport();
    const feedback = {
      ...input,
      report: {
        ...input.report,
        source: "feedback",
        code: "_feedback",
        text: REPORTING_TEST_HASH,
      },
      blobs: [{
        hash: REPORTING_TEST_HASH,
        size_bytes: 1,
        purpose: "report_text",
        source: {
          kind: "prepared",
          blob: {
            hash: REPORTING_TEST_HASH,
            size_bytes: 1,
            purpose: "report_text",
            preparation: "opaque",
            principal: "origin-principal",
          },
        },
      }],
      existing_problem: id("prb"),
      group_key,
      origin: {
        ...input.origin,
        context: {
          ...input.origin.context,
          origin: "shell_user",
          authentication: {
            ...input.origin.context.authentication,
            actor: "user",
          },
        },
      },
    };
    assertEquals(recordReportInputSchema.safeParse(feedback).success, true);
    assertEquals(
      recordReportInputSchema.safeParse({ ...feedback, existing_problem: null })
        .success,
      false,
    );
    // 기존 문제를 고른 feedback은 자기 rpt로 새 feedback key를 달 수 없다.
    const ownKey = {
      kind: "feedback",
      code: "_feedback",
      discriminator: feedback.report.id,
    };
    assertEquals(
      recordReportInputSchema.safeParse({ ...feedback, group_key: ownKey })
        .success,
      false,
    );
    assertEquals(
      recordReportInputSchema.safeParse({
        ...feedback,
        group_key: ownKey,
        existing_problem: null,
      }).success,
      true,
    );
    assertEquals(
      recordReportInputSchema.safeParse({
        ...feedback,
        group_key: { ...ownKey, discriminator: id("rpt") },
      }).success,
      feedback.report.id !== id("rpt"),
    );
  }
  assertEquals(
    groupKeyInputSchema.safeParse({
      kind: "feedback",
      code: "_feedback",
      discriminator: id("rpt"),
    }).success,
    true,
  );
  for (
    const key of [
      { kind: "declared", code: "_exception", discriminator: null },
      { kind: "declared", code: "save_failed", discriminator: "x" },
      { kind: "exception", code: "_exception", discriminator: "x" },
      { kind: "invalid_report", code: "_invalid_report", discriminator: " " },
      { kind: "feedback", code: "_feedback", discriminator: id("prb") },
    ]
  ) assertEquals(groupKeyInputSchema.safeParse(key).success, false);
});
