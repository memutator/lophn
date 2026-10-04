import { assertEquals } from "@std/assert";
import {
  errorEvidenceInputSchema,
  exceptionObservationErrorSchema,
  exceptionObservationInputSchema,
  observeExceptionInputSchema,
} from "./mod.ts";
import type {
  InvocationEvidence,
  MissingReason,
  ObservedExceptionError,
  ObservedExceptionInput,
} from "./mod.ts";
import type {
  ExceptionObservationError,
  ExceptionObservationInput,
  ObservationInvocationEvidence,
  ObservationMissingReason,
} from "./sdk-report.ts";
import {
  REPORTING_TEST_AT as at,
  REPORTING_TEST_HASH as hash,
  reportingId as id,
} from "./reporting-fixtures.ts";

const error = {
  name: "TypeError",
  message: "failure",
  message_missing_reason: null,
  stack: "TypeError: failure\n    at save (/private/app/src/main.ts:10:2)",
  stack_missing_reason: null,
};
const observation = {
  report_id: id("rpt"),
  observed_at: at,
  observation: "error" as const,
  error,
  error_missing_reason: null,
  invocation: null,
};
Deno.test("problems/reporting#R5: authenticated observer accepts bounded raw stack including absolute trace", () => {
  assertEquals(exceptionObservationErrorSchema.safeParse(error).success, true);
  assertEquals(
    exceptionObservationInputSchema.safeParse(observation).success,
    true,
  );
  assertEquals(observeExceptionInputSchema, exceptionObservationInputSchema);
  assertEquals(
    exceptionObservationInputSchema.safeParse({
      ...observation,
      error: null,
      error_missing_reason: { reason: "non-Error rejection" },
      observation: "unhandledrejection",
    }).success,
    true,
  );
  for (
    const field of [
      "app",
      "release",
      "mode",
      "principal",
      "source",
      "frames",
      "blobs",
      "prepared",
    ]
  ) {
    assertEquals(
      exceptionObservationInputSchema.safeParse({
        ...observation,
        [field]: "forged",
      }).success,
      false,
    );
  }
  for (
    const field of [
      "frames",
      "source_missing_reason",
      "truncation_notes",
      "blobs",
    ]
  ) {
    assertEquals(
      exceptionObservationErrorSchema.safeParse({ ...error, [field]: [] })
        .success,
      false,
    );
  }
  assertEquals(
    exceptionObservationErrorSchema.safeParse({ ...error, stack: { hash } })
      .success,
    false,
  );
});
Deno.test("problems/reporting#R5: raw observation message and stack use strict reason XOR", () => {
  for (const field of ["message", "stack"] as const) {
    assertEquals(
      exceptionObservationErrorSchema.safeParse({ ...error, [field]: null })
        .success,
      false,
    );
    assertEquals(
      exceptionObservationErrorSchema.safeParse({
        ...error,
        [`${field}_missing_reason`]: { reason: "redacted" },
      }).success,
      false,
    );
    assertEquals(
      exceptionObservationErrorSchema.safeParse({
        ...error,
        [field]: null,
        [`${field}_missing_reason`]: { reason: "missing" },
      }).success,
      true,
    );
    assertEquals(
      exceptionObservationErrorSchema.safeParse({
        ...error,
        [field]: null,
        [`${field}_missing_reason`]: { reason: " " },
      }).success,
      false,
    );
    assertEquals(
      exceptionObservationErrorSchema.safeParse({
        ...error,
        [field]: null,
        [`${field}_missing_reason`]: { reason: "missing", unknown: true },
      }).success,
      false,
    );
  }
  assertEquals(
    exceptionObservationInputSchema.safeParse({ ...observation, error: null })
      .success,
    false,
  );
  assertEquals(
    exceptionObservationErrorSchema.safeParse({ ...error, name: " " }).success,
    false,
  );
});
Deno.test("problems/reporting#R16: raw observer total JSON uses 262144 UTF8 bytes, not stored stack cap", () => {
  assertEquals(
    exceptionObservationInputSchema.safeParse({
      ...observation,
      error: { ...error, stack: "a".repeat(20000) },
    }).success,
    true,
  );
  assertEquals(
    exceptionObservationInputSchema.safeParse({
      ...observation,
      error: { ...error, stack: "a".repeat(262144) },
    }).success,
    false,
  );
  assertEquals(
    exceptionObservationInputSchema.safeParse({
      ...observation,
      error: { ...error, stack: "界".repeat(90000) },
    }).success,
    false,
  );
});
Deno.test("problems/snapshots#R10: stored error remains relative source/hash-only and excludes raw observation shape", () => {
  assertEquals(errorEvidenceInputSchema.safeParse(error).success, false);
  const stored = {
    ...error,
    stack: hash,
    frames: [{ path: "src/main.ts", function: "save", line: 10, column: 2 }],
    source_missing_reason: null,
    truncation_notes: [],
  };
  assertEquals(errorEvidenceInputSchema.safeParse(stored).success, true);
  assertEquals(
    errorEvidenceInputSchema.safeParse({ ...stored, stack: error.stack })
      .success,
    false,
  );
  assertEquals(
    errorEvidenceInputSchema.safeParse({
      ...stored,
      frames: [{ ...stored.frames[0], path: "/private/app/src/main.ts" }],
    }).success,
    false,
  );
});
Deno.test("problems/reporting#R5: portable observer and schema types remain bidirectionally assignable", () => {
  const input: ObservedExceptionInput = observation;
  const portable: ExceptionObservationInput = input;
  const roundTrip: ObservedExceptionInput = portable;
  const schemaError: ObservedExceptionError = error;
  const portableError: ExceptionObservationError = schemaError;
  const returnedError: ObservedExceptionError = portableError;
  const reason: MissingReason = { reason: "pending" };
  const portableReason: ObservationMissingReason = reason;
  const returnedReason: MissingReason = portableReason;
  const invocation: InvocationEvidence = {
    id: id("inv"),
    binding: "view_context",
    record_missing_reason: reason,
  };
  const portableInvocation: ObservationInvocationEvidence = invocation;
  const returnedInvocation: InvocationEvidence = portableInvocation;
  assertEquals(roundTrip, input);
  assertEquals(returnedError, schemaError);
  assertEquals(returnedReason, reason);
  assertEquals(returnedInvocation, invocation);
});
