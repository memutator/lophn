import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineWorker } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import {
  FEEDBACK_PROBLEM_NAME,
  problemGroupKeyInputSchema,
  problemNameSchema,
} from "./problem-record.ts";
import {
  recordReportCompareSchema,
  REPORT_ERRORS,
  reportAcceptanceSchema,
  reportModeSchema,
  reportOriginEvidenceInputSchema,
  reportSourceSchema,
} from "./reports.ts";
import {
  invocationEvidenceInputSchema,
  invocationEvidenceSchema,
  logEvidenceInputSchema,
  logEvidenceSchema,
  sourceFrameInputSchema,
  sourceFrameSchema,
} from "./snapshots.ts";
import {
  permanentBlobReferenceSchema,
  preparedBlobSchema,
} from "../storage/blob.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";

const nonblank = z.string().regex(/\S/);

const automaticBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length <=
    REPORTING_LIMITS.automatic_body_bytes;

// 보고 접수 입력. 코드가 아니라 이름과 message다.
export const problemReportInputSchema = z.strictObject({
  report_id: idSchema("rpt"),
  name: problemNameSchema,
  message: nonblank,
  observed_at: atSchema,
  details: z.json().optional(),
  invocation: invocationEvidenceInputSchema.nullable().optional(),
}).refine(automaticBytes);
export type ProblemReportInput = z.infer<typeof problemReportInputSchema>;

export const problemReport = defineWorker({
  resource: "problems",
  method: "report_problem",
  name: "problem.report",
  input: problemReportInputSchema,
  output: reportAcceptanceSchema,
  actors: ["app"],
  errors: REPORT_ERRORS,
});

// 발생 근거. 앱 release와 실행 구분(live·preview·test)은 Report가 가진다.
function evidence(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  const frame = strict ? sourceFrameInputSchema : sourceFrameSchema;
  const error = object({
    name: nonblank,
    message: z.string().nullable(),
    frames: z.array(frame).max(REPORTING_LIMITS.snapshot_frames),
    stack: sha256Schema.nullable(),
    truncation_notes: z.array(nonblank),
  });
  const snapshot = object({
    id: idSchema("snp"),
    captured_at: atSchema,
    invocation:
      (strict ? invocationEvidenceInputSchema : invocationEvidenceSchema)
        .nullable(),
    error: error.nullable(),
    logs: (strict ? logEvidenceInputSchema : logEvidenceSchema).nullable(),
  });
  return { error, snapshot };
}
const output = evidence(false);
const input = evidence(true);
export const problemErrorEvidenceSchema = output.error;
export const problemErrorEvidenceInputSchema = input.error;
export const problemSnapshotSchema = output.snapshot;
export const problemSnapshotInputSchema = input.snapshot.refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length <= 65_536
);
export type ProblemErrorEvidence = z.infer<typeof problemErrorEvidenceSchema>;
export type ProblemSnapshot = z.infer<typeof problemSnapshotSchema>;
export type ProblemSnapshotInput = z.infer<typeof problemSnapshotInputSchema>;

// 기록 입력. 옛 report에서 code가 name이고 text(해시)가 message다.
const nullableHash = sha256Schema.nullable();
const scopeFields = {
  app: idSchema("app"),
  mode: reportModeSchema,
  diagnostic_scope: nonblank.nullable(),
  release: idSchema("rel").nullable(),
  release_missing_reason: nonblank.nullable(),
  bundle_hash: sha256Schema.nullable(),
};
type Scope = {
  mode: "live" | "preview" | "test";
  diagnostic_scope: string | null;
  release: string | null;
  release_missing_reason: string | null;
};
const validScope = (value: Scope) =>
  (value.mode === "live") === (value.diagnostic_scope === null) &&
  (value.release === null) !== (value.release_missing_reason === null);
const reportFields = {
  id: idSchema("rpt"),
  ...scopeFields,
  source: reportSourceSchema,
  name: problemNameSchema,
  message: nullableHash,
  details: nullableHash,
  snapshot: idSchema("snp"),
  observed_at: atSchema,
  principal: nonblank,
  content_hash: sha256Schema,
};
// exception의 name은 오류 이름이라 따로 정하지 않는다.
const validContent = (
  value: {
    source: "app" | "exception" | "feedback";
    name: string;
    message: string | null;
  },
) => (value.source !== "feedback" ||
  value.name === FEEDBACK_PROBLEM_NAME && value.message !== null);
export const problemReportRecordInputSchema = z.strictObject(reportFields)
  .refine(validScope).refine(validContent);
export const problemReportSchema = z.object({
  ...reportFields,
  problem: idSchema("prb").nullable(),
}).refine(validScope).refine(validContent).refine((value) =>
  (value.mode === "live") === (value.problem !== null)
);
export type ProblemReport = z.infer<typeof problemReportSchema>;
export type ProblemReportRecordInput = z.infer<
  typeof problemReportRecordInputSchema
>;

export const problemReportBlobPurposes = [
  "report_text",
  "report_details",
  "snapshot_stack",
  "snapshot_logs",
] as const;
export const problemReportBlobPurposeSchema = z.enum(problemReportBlobPurposes);
export const problemReportBlobInputSchema = z.strictObject({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  purpose: problemReportBlobPurposeSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("prepared"),
      blob: z.strictObject(preparedBlobSchema.shape),
    }),
    z.strictObject({
      kind: z.literal("existing"),
      reference: z.strictObject(permanentBlobReferenceSchema.shape),
    }),
  ]),
}).refine((value) => {
  const source = value.source;
  return source.kind === "prepared"
    ? source.blob.hash === value.hash &&
      source.blob.size_bytes === value.size_bytes &&
      source.blob.purpose === value.purpose
    : source.reference.hash === value.hash;
}, { message: "blob authority must bind content metadata" }).refine((value) => {
  const limits: Record<typeof value.purpose, number> = {
    report_text: REPORTING_LIMITS.automatic_body_bytes,
    report_details: REPORTING_LIMITS.automatic_body_bytes,
    snapshot_stack: REPORTING_LIMITS.stack_bytes,
    snapshot_logs: REPORTING_LIMITS.log_bytes,
  };
  return value.size_bytes <= limits[value.purpose];
});
export type ProblemReportBlobInput = z.infer<
  typeof problemReportBlobInputSchema
>;
export const problemReportBlobsInputSchema = z.array(
  problemReportBlobInputSchema,
).max(4).refine((values) =>
  new Set(values.map((value) => value.purpose)).size === values.length
);

export const recordProblemReportInputSchema = z.strictObject({
  report: problemReportRecordInputSchema,
  snapshot: problemSnapshotInputSchema,
  group_key: problemGroupKeyInputSchema,
  existing_problem: idSchema("prb").nullable(),
  blobs: problemReportBlobsInputSchema,
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
  const key = value.group_key;
  const keyMatches = feedback && value.existing_problem !== null ||
    (report.source === "app"
      ? key.kind === "named" && key.name === report.name
      : report.source === "exception"
      ? key.kind === "exception"
      : key.kind === "feedback");
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
    keyMatches &&
    // 새 feedback key는 자기 최초 rpt다. 기존 문제를 고르면 그 문제 key를 쓰고 자기 key를 새로 달지 않는다.
    (key.kind !== "feedback" ||
      (value.existing_problem === null) === (key.discriminator === report.id));
}).refine((value) => {
  const { report, snapshot, blobs } = value;
  const expected = [
    ["report_text", report.message],
    ["report_details", report.details],
    ["snapshot_stack", snapshot.error?.stack ?? null],
    ["snapshot_logs", snapshot.logs?.blob ?? null],
  ];
  return expected.every(([purpose, hash]) =>
    hash === null
      ? !blobs.some((blob) => blob.purpose === purpose)
      : blobs.some((blob) => blob.purpose === purpose && blob.hash === hash)
  );
}, { message: "all content hashes need matching bounded blob authority" });
export type RecordProblemReportInput = z.infer<
  typeof recordProblemReportInputSchema
>;

export const recordProblemReport = defineCommand({
  resource: "problems",
  method: "record_problem_report",
  name: "problem.record_report",
  input: recordProblemReportInputSchema,
  output: reportAcceptanceSchema,
  compare: recordReportCompareSchema,
  actors: ["machine"],
  errors: REPORT_ERRORS,
});
