import { z } from "zod";
import {
  atSchema,
  defineRead,
  idSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  problemCodeSchema,
  reservedProblemCodeSchema,
} from "./problem-codes.ts";
import {
  reportModeSchema,
  reportSchema,
  reportSourceSchema,
} from "./reports.ts";
import {
  errorEvidenceSchema,
  invocationEvidenceSchema,
  logEvidenceSchema,
  missingReasonSchema,
  screenEvidenceSchema,
  snapshotSchema,
} from "./snapshots.ts";

const readActors = ["user", "coding_agent", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const cursor = z.string().min(1).optional();

// 일반 업무 응답에는 raw stack을 넣지 않는다. 상세는 수리 조회 권한이다.
export const reportSummarySchema = z.object({
  id: idSchema("rpt"),
  app: idSchema("app"),
  problem: idSchema("prb").nullable(),
  source: reportSourceSchema,
  mode: reportModeSchema,
  code: z.union([problemCodeSchema, reservedProblemCodeSchema]),
  snapshot: idSchema("snp"),
  observed_at: atSchema,
  release: idSchema("rel").nullable(),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const listReportsInputSchema = z.strictObject({
  problem: idSchema("prb").optional(),
  app: idSchema("app").optional(),
  diagnostic_scope: z.string().regex(/\S/).optional(),
  cursor,
}).refine(
  (value) =>
    value.problem !== undefined ||
    (value.app !== undefined && value.diagnostic_scope !== undefined),
  { message: "list by problem, or by app and diagnostic scope" },
);
export const listReportsOutputSchema = withReadCommon(z.object({
  reports: z.array(reportSummarySchema),
}));
export const listReports = defineRead({
  resource: "problems",
  method: "list-reports",
  name: "ListReports",
  input: listReportsInputSchema,
  output: listReportsOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const getReportInputSchema = z.strictObject({
  report: idSchema("rpt"),
});
export const getReportOutputSchema = withReadCommon(z.object({
  report: reportSchema,
  snapshot: snapshotSchema.nullable(),
  missing: z.object({
    invocation: missingReasonSchema.nullable(),
    error: missingReasonSchema.nullable(),
    logs: missingReasonSchema.nullable(),
    screen: missingReasonSchema.nullable(),
  }),
}));
export const getReport = defineRead({
  resource: "problems",
  method: "get-report",
  name: "GetReport",
  input: getReportInputSchema,
  output: getReportOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const SNAPSHOT_ITEMS = [
  "invocation",
  "error",
  "logs",
  "screen",
] as const;
export const snapshotItemSchema = z.enum(SNAPSHOT_ITEMS);

export const getSnapshotInputSchema = z.strictObject({
  snapshot: idSchema("snp"),
  item: snapshotItemSchema.optional(),
});
const blobRef = z.object({ purpose: z.string(), hash: sha256Schema });
export const getSnapshotOutputSchema = withReadCommon(z.object({
  snapshot: snapshotSchema,
  item: z.union([
    invocationEvidenceSchema,
    errorEvidenceSchema,
    logEvidenceSchema,
    screenEvidenceSchema,
  ]).nullable(),
  blobs: z.array(blobRef),
  missing: missingReasonSchema.nullable(),
}));
export const getSnapshot = defineRead({
  resource: "problems",
  method: "get-snapshot",
  name: "GetSnapshot",
  input: getSnapshotInputSchema,
  output: getSnapshotOutputSchema,
  actors: readActors,
  errors: readErrors,
});
