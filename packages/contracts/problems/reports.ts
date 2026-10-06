import { z } from "zod";
import {
  atSchema,
  authenticatedContextSchema,
  defineCommand,
  defineEvent,
  defineWorker,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  problemCodeSchema,
  reservedProblemCodeSchema,
} from "./problem-codes.ts";
import {
  invocationEvidenceInputSchema,
  snapshotInputSchema,
} from "./snapshots.ts";
import { reportBlobsInputSchema } from "./report-blobs.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";
import { exceptionObservationInputSchema } from "./exception-observation.ts";

const nonblank = z.string().regex(/\S/);
export const reportSourceSchema = z.enum(["app", "exception", "feedback"]);
export const reportModeSchema = z.enum(["live", "preview", "test"]);
export type ReportSource = z.infer<typeof reportSourceSchema>;
export type ReportMode = z.infer<typeof reportModeSchema>;
const scopeFields = {
  app: idSchema("app"),
  mode: reportModeSchema,
  diagnostic_scope: nonblank.nullable(),
  release: idSchema("rel").nullable(),
  release_missing_reason: nonblank.nullable(),
  bundle_hash: sha256Schema.nullable(),
};
const validScope = (value: {
  mode: ReportMode;
  diagnostic_scope: string | null;
  release: string | null;
  release_missing_reason: string | null;
}) =>
  (value.mode === "live") === (value.diagnostic_scope === null) &&
  (value.release === null) !== (value.release_missing_reason === null);
const reportFields = {
  id: idSchema("rpt"),
  ...scopeFields,
  source: reportSourceSchema,
  code: z.union([problemCodeSchema, reservedProblemCodeSchema]),
  text: sha256Schema.nullable(),
  details: sha256Schema.nullable(),
  snapshot: idSchema("snp"),
  observed_at: atSchema,
  principal: nonblank,
  content_hash: sha256Schema,
};
const validCode = (value: { source: ReportSource; code: string }) =>
  value.source === "exception"
    ? value.code === "_exception"
    : value.source === "feedback"
    ? value.code === "_feedback"
    : problemCodeSchema.safeParse(value.code).success ||
      value.code === "_invalid_report";
const validReportContent = (
  value: { source: ReportSource; text: string | null },
) => value.source !== "feedback" || value.text !== null;
// The caller cannot fix the server-assigned problem in prepared input.
export const reportInputSchema = z.strictObject(reportFields).refine(validScope)
  .refine(validCode).refine(validReportContent);
export const reportSchema = z.object({
  ...reportFields,
  problem: idSchema("prb").nullable(),
}).refine(validScope).refine(validCode).refine(validReportContent).refine((
  value,
) => (value.mode === "live") === (value.problem !== null));
export type ReportInput = z.infer<typeof reportInputSchema>;
export type Report = z.infer<typeof reportSchema>;

function groupKey(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  return z.discriminatedUnion("kind", [
    object({
      kind: z.literal("declared"),
      code: problemCodeSchema,
      discriminator: z.null(),
    }),
    object({
      kind: z.literal("exception"),
      code: z.literal("_exception"),
      discriminator: z.union([sha256Schema, idSchema("rpt")]),
    }),
    object({
      kind: z.literal("invalid_report"),
      code: z.literal("_invalid_report"),
      discriminator: nonblank,
    }),
    object({
      kind: z.literal("feedback"),
      code: z.literal("_feedback"),
      discriminator: idSchema("rpt"),
    }),
  ]);
}
export const groupKeySchema = groupKey(false);
export const groupKeyInputSchema = groupKey(true);
export type GroupKey = z.infer<typeof groupKeySchema>;

// The authentication boundary supplies this separately, never from JSON body.
export const authenticatedReportContextSchema = z.strictObject({
  authentication: authenticatedContextSchema.extend({ principal: nonblank }),
  ...scopeFields,
  binding: nonblank,
  origin: z.enum(["app", "process_observer", "view_observer", "shell_user"]),
}).refine(validScope);
export type AuthenticatedReportContext = z.infer<
  typeof authenticatedReportContextSchema
>;
// Trusted forwarding attestation, not a caller-created proof of authorization.
export const reportOriginEvidenceInputSchema = z.strictObject({
  context: authenticatedReportContextSchema,
  report_id: idSchema("rpt"),
  content_hash: sha256Schema,
});
export type ReportOriginEvidence = z.infer<
  typeof reportOriginEvidenceInputSchema
>;

const acceptanceIds = { report: idSchema("rpt"), snapshot: idSchema("snp") };
export const reportAcceptanceSchema = z.union([
  z.object({
    ...acceptanceIds,
    problem: idSchema("prb"),
    diagnostic_scope: z.null(),
  }),
  z.object({ ...acceptanceIds, problem: z.null(), diagnostic_scope: nonblank }),
]);
export type AcceptedReport = z.infer<typeof reportAcceptanceSchema>;
export const REPORT_ERRORS = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
  "internal",
] as const;
const automaticBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length <=
    REPORTING_LIMITS.automatic_body_bytes;
export const reportProblemInputSchema = z.strictObject({
  report_id: idSchema("rpt"),
  code: problemCodeSchema,
  observed_at: atSchema,
  text: z.string().optional(),
  details: z.json().optional(),
  invocation: invocationEvidenceInputSchema.nullable().optional(),
}).refine(automaticBytes);
export type ReportProblemIngress = z.infer<typeof reportProblemInputSchema>;
export const observeExceptionInputSchema = exceptionObservationInputSchema;
export type ObserveExceptionInput = z.infer<typeof observeExceptionInputSchema>;
export const reportProblem = defineWorker({
  resource: "problems",
  method: "report",
  name: "ReportProblem",
  input: reportProblemInputSchema,
  output: reportAcceptanceSchema,
  actors: ["app"],
  errors: REPORT_ERRORS,
});
export const observeException = defineWorker({
  resource: "problems",
  method: "observe-exception",
  name: "ObserveException",
  input: observeExceptionInputSchema,
  output: reportAcceptanceSchema,
  actors: ["app", "user", "machine"],
  errors: REPORT_ERRORS,
});

// 앱 view의 exception 보고 (reporting#R5, R6). shell이 보내는 view error를
// collector로 넘긴다. binding은 core가 서명한 AppConnection Authorization이고,
// app·release·mode는 credential에서만 정한다(T16: 페이지 주장은 무시).
export const observeViewErrorInputSchema = z.strictObject({
  view: z.strictObject({
    view_session: z.string().min(1),
    generation: z.number().int().nonnegative(),
    app: z.string().min(1),
    release: z.string().min(1).nullable(),
    mode: z.enum(["live", "preview", "test"]),
    bundle_hash: z.string().min(1),
    binding: z.string().min(1),
  }),
  observation: exceptionObservationInputSchema,
});
export type ObserveViewErrorInput = z.infer<typeof observeViewErrorInputSchema>;
export const observeViewError = defineWorker({
  resource: "problems",
  method: "observe-view-error",
  name: "ObserveViewError",
  input: observeViewErrorInputSchema,
  output: reportAcceptanceSchema,
  actors: ["machine"],
  errors: REPORT_ERRORS,
});

export const recordReportInputSchema = z.strictObject({
  report: reportInputSchema,
  snapshot: snapshotInputSchema,
  group_key: groupKeyInputSchema,
  existing_problem: idSchema("prb").nullable(),
  blobs: reportBlobsInputSchema,
  origin: reportOriginEvidenceInputSchema,
}).refine((value) => {
  const report = value.report;
  const context = value.origin.context;
  const feedback = report.source === "feedback";
  const originAllowed = feedback
    ? context.origin === "shell_user" && context.authentication.actor === "user"
    : report.source === "exception"
    ? ["process_observer", "view_observer"].includes(context.origin)
    : context.origin === "app" &&
      context.authentication.actor === `app:${context.app}`;
  return originAllowed && report.snapshot === value.snapshot.id &&
    report.principal === context.authentication.principal &&
    report.app === context.app && report.mode === context.mode &&
    report.release === context.release &&
    report.bundle_hash === context.bundle_hash &&
    report.release_missing_reason === context.release_missing_reason &&
    report.diagnostic_scope === context.diagnostic_scope &&
    report.id === value.origin.report_id &&
    report.content_hash === value.origin.content_hash &&
    (value.existing_problem === null || feedback && report.mode === "live") &&
    (feedback && value.existing_problem !== null ||
      report.code === value.group_key.code) &&
    // 새 feedback key는 자기 최초 rpt다. 기존 문제를 고르면 그 문제 key를 쓰고 자기 key를 새로 달지 않는다.
    (value.group_key.kind !== "feedback" ||
      (value.existing_problem === null) ===
        (value.group_key.discriminator === report.id)) &&
    (report.source === "feedback" ||
      value.snapshot.screen?.state == null &&
        value.snapshot.screen?.screenshot == null);
}).refine((value) => {
  const { report, snapshot, blobs } = value;
  const expected = [
    ["report_text", report.text],
    ["report_details", report.details],
    ["snapshot_stack", snapshot.error?.stack ?? null],
    ["snapshot_logs", snapshot.logs?.blob ?? null],
    ["feedback_state", snapshot.screen?.state ?? null],
    ["feedback_screenshot", snapshot.screen?.screenshot ?? null],
  ];
  return expected.every(([purpose, hash]) =>
    hash === null
      ? !blobs.some((blob) => blob.purpose === purpose)
      : blobs.some((blob) => blob.purpose === purpose && blob.hash === hash)
  );
  // 큰 자료 준비 총량(snapshot_large_bytes)은 항목별 상한 합보다 커서 schema로는 걸리지 않는다.
  // 조립 중 실제 잘림·timeout·제외 이유 판정은 collector runtime 책임이다.
}, { message: "all content hashes need matching bounded blob authority" });
export type RecordReportInput = z.infer<typeof recordReportInputSchema>;
export type PreparedReport = RecordReportInput;
// Hash the immutable content, not this hash itself, ephemeral preparation
// handles, server-assigned problem, origin forwarding metadata or event seq.
export const reportContentHashInputSchema = z.strictObject({
  report: z.strictObject(reportFields).omit({ content_hash: true })
    .refine(validScope).refine(validCode).refine(validReportContent),
  snapshot: snapshotInputSchema,
  group_key: groupKeyInputSchema,
  existing_problem: idSchema("prb").nullable(),
  blobs: z.array(z.strictObject({
    purpose: reportBlobsInputSchema.element.shape.purpose,
    hash: sha256Schema,
  })).max(6),
});
export type ReportContentHashInput = z.infer<
  typeof reportContentHashInputSchema
>;
export const recordReportCompareSchema = z.strictObject({
  active_release: idSchema("rel").nullable(),
  problem_seq: seqSchema.nullable(),
});
export const recordReport = defineCommand({
  resource: "problems",
  method: "record-report",
  name: "RecordReport",
  input: recordReportInputSchema,
  output: reportAcceptanceSchema,
  compare: recordReportCompareSchema,
  actors: ["machine"],
  errors: REPORT_ERRORS,
});
export const reportRecorded = defineEvent("ReportRecorded", {
  subject: idSchema("rpt"),
  payload: z.object({
    app: idSchema("app"),
    problem: idSchema("prb").nullable(),
    source: reportSourceSchema,
    mode: reportModeSchema,
    code: z.union([problemCodeSchema, reservedProblemCodeSchema]),
    snapshot: idSchema("snp"),
    observed_at: atSchema,
    content_hash: sha256Schema,
  }).refine(validCode).refine((value) =>
    (value.mode === "live") === (value.problem !== null)
  ),
});
export const problemOpened = defineEvent("ProblemOpened", {
  subject: idSchema("prb"),
  payload: z.object({
    app: idSchema("app"),
    group_key: groupKeySchema,
    report: idSchema("rpt"),
  }),
});
export const problemObserved = defineEvent("ProblemObserved", {
  subject: idSchema("prb"),
  payload: z.object({
    report: idSchema("rpt"),
    release: idSchema("rel").nullable(),
    active_release_at_acceptance: idSchema("rel").nullable(),
    previous_status: z.enum(["open", "fixing", "closed"]),
  }),
});
