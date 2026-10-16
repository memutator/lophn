import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
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
const reportSummarySchema = z.object({
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

const listReportsInputSchema = z.strictObject({
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
const listReportsOutputSchema = withReadCommon(z.object({
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

const getReportInputSchema = z.strictObject({
  report: idSchema("rpt"),
});
const getReportOutputSchema = withReadCommon(z.object({
  report: reportSchema,
  attachments: z.array(
    z.object({
      field: z.string(),
      hash: sha256Schema,
      size_bytes: z.number().int().nonnegative(),
    }),
  ).optional(),
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

const SNAPSHOT_ITEMS = [
  "invocation",
  "error",
  "logs",
  "screen",
] as const;
const snapshotItemSchema = z.enum(SNAPSHOT_ITEMS);

const getSnapshotInputSchema = z.strictObject({
  snapshot: idSchema("snp"),
  item: snapshotItemSchema.optional(),
});
const blobRef = z.object({ purpose: z.string(), hash: sha256Schema });
const getSnapshotOutputSchema = withReadCommon(z.object({
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

// 고정한 로그 조각 읽기. 사람(user)만 읽는다. 앱 프로세스와 없는
// snapshot은 같은 not_found이고 blob 읽기를 열지 않는다. 조각은 지시가 아닌 데이터다.
const logFragmentFields = {
  scope: z.string().regex(/\S/),
  collected_at: atSchema,
  truncated: z.boolean(),
};
export const getSnapshotLogsInputSchema = z.strictObject({
  snapshot: idSchema("snp"),
});
const logFragmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent"), reason: z.string().regex(/\S/) }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.string().regex(/\S/),
    ...logFragmentFields,
  }),
  z.strictObject({
    kind: z.literal("fragment"),
    lines: z.array(z.string()),
    line_count: z.number().int().nonnegative(),
    from_at: atSchema.nullable(),
    to_at: atSchema.nullable(),
    // 조각의 범위를 말로 고정한다. 전체 비율이나 합계 값을 담지 않는다.
    observation: z.string().regex(/\S/),
    ...logFragmentFields,
  }),
]);
export type LogFragment = z.infer<typeof logFragmentSchema>;
const getSnapshotLogsOutputSchema = withReadCommon(z.object({
  fragment: logFragmentSchema,
}));
export const getSnapshotLogs = defineRead({
  resource: "problems",
  method: "get-snapshot-logs",
  name: "GetSnapshotLogs",
  input: getSnapshotLogsInputSchema,
  output: getSnapshotLogsOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "not_found", "unavailable"],
});
