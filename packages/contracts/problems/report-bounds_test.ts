import { assertEquals } from "@std/assert";
import { recordReportInputSchema, snapshotInputSchema } from "./mod.ts";
import {
  missingSnapshot,
  preparedReport,
  REPORTING_TEST_AT as at,
  REPORTING_TEST_HASH as hash,
  reportingId as id,
} from "./reporting-fixtures.ts";

Deno.test("problems/snapshots#R20: snapshot metadata total uses UTF8 bytes without a per-line text cap", () => {
  const snapshot = missingSnapshot();
  snapshot.logs = {
    blob: hash,
    line_count: 1,
    truncated: false,
    scope: "a".repeat(1000),
    from_at: null,
    to_at: null,
    collected_at: at,
  };
  snapshot.logs_missing_reason = null;
  assertEquals(snapshotInputSchema.safeParse(snapshot).success, true);
  snapshot.logs.scope = "界".repeat(22000);
  assertEquals(snapshotInputSchema.safeParse(snapshot).success, false);
});
Deno.test("problems/reporting#R8: invalid-report diagnostic and exception GroupKey have their own reserved branch", () => {
  const input = preparedReport();
  input.report.code = "_invalid_report";
  input.group_key = {
    kind: "invalid_report",
    code: "_invalid_report",
    discriminator: "redacted_wrong_code",
  };
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
  input.report.code = "_exception";
  input.report.source = "exception";
  input.group_key = {
    kind: "exception",
    code: "_exception",
    discriminator: input.report.id,
  };
  input.origin.context.origin = "process_observer";
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
  input.group_key = {
    kind: "declared",
    code: "save_failed",
    discriminator: null,
  };
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
});
Deno.test("problems/reporting#R2: forwarded original app principal is not a collector actor or blank identity", () => {
  const input = preparedReport();
  input.origin.context.authentication.actor = "machine";
  assertEquals(recordReportInputSchema.safeParse(input).success, false);
  input.origin.context.authentication.actor = `app:${id("app")}`;
  input.origin.context.authentication.scope.targets = {
    nested: { valid: true },
  };
  assertEquals(recordReportInputSchema.safeParse(input).success, true);
});
