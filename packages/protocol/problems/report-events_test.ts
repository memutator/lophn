import { assertEquals } from "@std/assert";
import {
  commandRequestSchema,
  commandResponseSchema,
} from "../platform/mod.ts";
import {
  problemObserved,
  problemOpened,
  recordReport,
  reportAcceptanceSchema,
  reportContentHashInputSchema,
  reportRecorded,
} from "./mod.ts";
import { preparedReport, reportingId as id } from "./testing/mod.ts";

Deno.test("problems/reporting#R10: external command envelope owns event range, hash excludes server output", () => {
  const input = preparedReport();
  const request = {
    input,
    prepared: ["opaque-preparation"],
    compare: { active_release: id("rel"), problem_seq: null },
    idempotency_key: "report-attempt",
  };
  assertEquals(
    commandRequestSchema(recordReport).safeParse(request).success,
    true,
  );
  const acceptance = {
    report: id("rpt"),
    snapshot: id("snp"),
    problem: id("prb"),
    diagnostic_scope: null,
  };
  assertEquals(
    commandResponseSchema(recordReport).safeParse({
      result: acceptance,
      replayed: false,
      first_seq: "1",
      last_seq: "3",
    }).success,
    true,
  );
  assertEquals(
    reportAcceptanceSchema.safeParse({ ...acceptance, future: true }).success,
    true,
  );
  assertEquals(
    reportAcceptanceSchema.safeParse({
      ...acceptance,
      diagnostic_scope: "scope",
    }).success,
    false,
  );
  assertEquals(
    reportAcceptanceSchema.safeParse({ ...acceptance, problem: null }).success,
    false,
  );
  const { content_hash: _hash, ...report } = input.report;
  const hashInput = {
    report,
    snapshot: input.snapshot,
    group_key: input.group_key,
    existing_problem: null,
    blobs: [],
  };
  assertEquals(reportContentHashInputSchema.safeParse(hashInput).success, true);
  assertEquals(
    reportContentHashInputSchema.safeParse({
      ...hashInput,
      report: input.report,
    }).success,
    false,
  );
  assertEquals(
    reportContentHashInputSchema.safeParse({ ...hashInput, problem: id("prb") })
      .success,
    false,
  );
});
Deno.test("problems/reporting#R10: exact event subjects and payload identities", () => {
  const input = preparedReport().report;
  const payload = {
    app: input.app,
    problem: id("prb"),
    source: input.source,
    mode: input.mode,
    code: input.code,
    snapshot: input.snapshot,
    observed_at: input.observed_at,
    content_hash: input.content_hash,
  };
  assertEquals(reportRecorded.subject.safeParse(id("rpt")).success, true);
  assertEquals(reportRecorded.subject.safeParse(id("prb")).success, false);
  assertEquals(
    reportRecorded.payload.safeParse({ ...payload, future: 1 }).success,
    true,
  );
  assertEquals(
    reportRecorded.payload.safeParse({ ...payload, snapshot: id("rpt") })
      .success,
    false,
  );
  assertEquals(
    problemOpened.payload.safeParse({
      app: id("app"),
      group_key: preparedReport().group_key,
      report: id("rpt"),
    }).success,
    true,
  );
  assertEquals(problemOpened.subject.safeParse(id("rpt")).success, false);
  assertEquals(
    problemObserved.payload.safeParse({
      report: id("rpt"),
      release: null,
      active_release_at_acceptance: id("rel"),
      previous_status: "closed",
    }).success,
    true,
  );
  assertEquals(problemObserved.subject.safeParse(id("rpt")).success, false);
});
