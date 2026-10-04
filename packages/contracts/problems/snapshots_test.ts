import { assertEquals } from "@std/assert";
import {
  errorEvidenceInputSchema,
  errorEvidenceSchema,
  invocationEvidenceInputSchema,
  logEvidenceInputSchema,
  screenEvidenceInputSchema,
  snapshotInputSchema,
  snapshotRecorded,
  snapshotSchema,
} from "./mod.ts";
import {
  missingSnapshot,
  REPORTING_TEST_AT as at,
  REPORTING_TEST_HASH as hash,
  reportingId as id,
} from "./reporting-fixtures.ts";

Deno.test("problems/snapshots#R4: each evidence has exactly value or strict nonblank MissingReason", () => {
  const snapshot = missingSnapshot();
  assertEquals(snapshotInputSchema.safeParse(snapshot).success, true);
  for (const field of ["invocation", "error", "logs", "screen"]) {
    assertEquals(
      snapshotInputSchema.safeParse({
        ...snapshot,
        [`${field}_missing_reason`]: null,
      }).success,
      false,
    );
    assertEquals(
      snapshotInputSchema.safeParse({
        ...snapshot,
        [`${field}_missing_reason`]: { reason: " " },
      }).success,
      false,
    );
    assertEquals(
      snapshotInputSchema.safeParse({
        ...snapshot,
        [`${field}_missing_reason`]: { reason: "unavailable", unknown: true },
      }).success,
      false,
    );
  }
  assertEquals(
    snapshotInputSchema.safeParse({ ...snapshot, lifecycle: "pending" })
      .success,
    false,
  );
  assertEquals(
    snapshotSchema.safeParse({
      ...snapshot,
      future: true,
      invocation_missing_reason: { reason: "unknown", future: true },
    }).success,
    true,
  );
  assertEquals(
    snapshotInputSchema.safeParse({ ...snapshot, id: id("rpt") }).success,
    false,
  );
});
Deno.test("problems/snapshots#R2: actual invocation keeps known pending record id and binding", () => {
  const invocation = {
    id: id("inv"),
    binding: "sdk_context",
    record_missing_reason: { reason: "record pending" },
  };
  assertEquals(
    invocationEvidenceInputSchema.safeParse(invocation).success,
    true,
  );
  assertEquals(
    invocationEvidenceInputSchema.safeParse({
      ...invocation,
      record_missing_reason: null,
    }).success,
    true,
  );
  assertEquals(
    invocationEvidenceInputSchema.safeParse({ ...invocation, id: id("rpt") })
      .success,
    false,
  );
  assertEquals(
    invocationEvidenceInputSchema.safeParse({
      ...invocation,
      binding: "nearest_time",
    }).success,
    false,
  );
  assertEquals(
    snapshotInputSchema.safeParse({
      ...missingSnapshot(),
      invocation,
      invocation_missing_reason: null,
    }).success,
    true,
  );
  assertEquals(
    snapshotInputSchema.safeParse({ ...missingSnapshot(), invocation }).success,
    false,
  );
});
const error = {
  name: "TypeError",
  message: "safe message",
  message_missing_reason: null,
  frames: [{ path: "src/view.tsx", function: null, line: 3, column: null }],
  source_missing_reason: null,
  stack: null,
  stack_missing_reason: { reason: "not collected" },
  truncation_notes: [],
};
Deno.test("problems/snapshots#R10: redacted error XOR, relative source path and positive coordinates", () => {
  assertEquals(errorEvidenceInputSchema.safeParse(error).success, true);
  assertEquals(
    errorEvidenceSchema.safeParse({
      ...error,
      future: true,
      frames: [{ ...error.frames[0], future: true }],
    }).success,
    true,
  );
  for (
    const change of [
      { name: " " },
      { message: null },
      { message_missing_reason: { reason: "unsafe" } },
      { stack: hash },
      { stack_missing_reason: null },
      { frames: [] },
      { frames: [{ ...error.frames[0], unknown: true }] },
    ]
  ) {
    assertEquals(
      errorEvidenceInputSchema.safeParse({ ...error, ...change }).success,
      false,
    );
  }
  assertEquals(
    errorEvidenceInputSchema.safeParse({
      ...error,
      frames: [],
      source_missing_reason: { reason: "no source map" },
    }).success,
    true,
  );
  for (
    const path of [
      "/secret.ts",
      "../secret.ts",
      "src/../secret.ts",
      "C:/secret.ts",
      "src\\secret.ts",
      "src//view.ts",
    ]
  ) {
    assertEquals(
      errorEvidenceInputSchema.safeParse({
        ...error,
        frames: [{ ...error.frames[0], path }],
      }).success,
      false,
    );
  }
  for (const line of [0, -1, 1.5]) {
    assertEquals(
      errorEvidenceInputSchema.safeParse({
        ...error,
        frames: [{ ...error.frames[0], line }],
      }).success,
      false,
    );
  }
});
Deno.test("problems/snapshots#R12: zero logs is normal success, actual collection time and ordered known range", () => {
  const logs = {
    blob: hash,
    line_count: 0,
    truncated: false,
    scope: "known invocation",
    from_at: null,
    to_at: null,
    collected_at: "2026-10-04T11:59:59.000Z",
  };
  assertEquals(logEvidenceInputSchema.safeParse(logs).success, true);
  assertEquals(
    snapshotInputSchema.safeParse({
      ...missingSnapshot(),
      logs,
      logs_missing_reason: null,
    }).success,
    true,
  );
  assertEquals(
    logEvidenceInputSchema.safeParse({
      ...logs,
      from_at: at,
      to_at: "2026-10-04T11:59:59.000Z",
    }).success,
    false,
  );
  assertEquals(
    logEvidenceInputSchema.safeParse({ ...logs, from_at: at, to_at: null })
      .success,
    true,
  );
  for (const line_count of [-1, 31, 1.5]) {
    assertEquals(
      logEvidenceInputSchema.safeParse({ ...logs, line_count }).success,
      false,
    );
  }
  assertEquals(
    logEvidenceInputSchema.safeParse({ ...logs, scope: " " }).success,
    false,
  );
  assertEquals(
    logEvidenceInputSchema.safeParse({ ...logs, collected_at: undefined })
      .success,
    false,
  );
});
Deno.test("problems/snapshots#R20: maximum 32 frames and policy truncation has no per-log-line cap", () => {
  assertEquals(
    errorEvidenceInputSchema.safeParse({
      ...error,
      frames: Array(32).fill(error.frames[0]),
      truncation_notes: ["remaining frames excluded"],
    }).success,
    true,
  );
  assertEquals(
    errorEvidenceInputSchema.safeParse({
      ...error,
      frames: Array(33).fill(error.frames[0]),
    }).success,
    false,
  );
  assertEquals(
    screenEvidenceInputSchema.safeParse({
      name: "Editor",
      observed_at: at,
      state: null,
      state_missing_reason: { reason: "not selected" },
      screenshot: null,
      screenshot_missing_reason: { reason: "not selected" },
    }).success,
    true,
  );
  assertEquals(
    screenEvidenceInputSchema.safeParse({
      name: "Editor",
      observed_at: at,
      state: hash,
      state_missing_reason: { reason: "not selected" },
      screenshot: null,
      screenshot_missing_reason: { reason: "not selected" },
    }).success,
    false,
  );
});
Deno.test("problems/reporting#R14: snapshot event carries actual missing reasons and evidence hashes", () => {
  const payload = {
    report: id("rpt"),
    captured_at: at,
    evidence_hashes: [hash],
    missing_reasons: {
      invocation: { reason: "record pending" },
      error: null,
      logs: null,
      screen: { reason: "no screen" },
    },
  };
  assertEquals(snapshotRecorded.subject.safeParse(id("snp")).success, true);
  assertEquals(snapshotRecorded.subject.safeParse(id("rpt")).success, false);
  assertEquals(
    snapshotRecorded.payload.safeParse({ ...payload, future: true }).success,
    true,
  );
  assertEquals(
    snapshotRecorded.payload.safeParse({ ...payload, report: id("snp") })
      .success,
    false,
  );
});
