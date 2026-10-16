import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { idempotencyKeySchema, withReadCommon } from "../base/envelope.ts";
import {
  problemNameSchema,
  problemRecordSchema,
  problemStateSchema,
} from "./problem-record.ts";
import { problemSnapshotSchema } from "./problem-report.ts";
import { reportSourceSchema } from "./reports.ts";
import { logEvidenceSchema } from "./snapshots.ts";

const readActors = ["user", "coding_agent", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const cursor = z.string().min(1).optional();

export const PROBLEM_MESSAGE_PREVIEW_CHARS = 2_000;

export const releaseRefSchema = z.object({
  id: idSchema("rel"),
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  code_commit: z.string().regex(/^[0-9a-f]{40}$/),
});
export type ReleaseRef = z.infer<typeof releaseRefSchema>;

export const problemListItemSchema = z.object({
  id: idSchema("prb"),
  app: idSchema("app"),
  state: problemStateSchema,
  name: problemNameSchema,
  occurrence_count: z.number().int().nonnegative(),
  last_observed_at: atSchema,
  seq: seqSchema,
});
export type ProblemListItem = z.infer<typeof problemListItemSchema>;

// live 발생만 문제에 붙는다.
export const problemOccurrenceSchema = z.object({
  report: idSchema("rpt"),
  observed_at: atSchema,
  source: reportSourceSchema,
  release: idSchema("rel").nullable(),
});
export type ProblemOccurrence = z.infer<typeof problemOccurrenceSchema>;

export const problemDetailViewSchema = z.object({
  problem: problemRecordSchema,
  occurrence_count: z.number().int().nonnegative(),
  first_observed_at: atSchema,
  last_observed_at: atSchema,
  first_release: releaseRefSchema.nullable(),
  last_release: releaseRefSchema.nullable(),
  // 최근 20개.
  occurrences: z.array(problemOccurrenceSchema).max(20),
  latest: z.object({
    occurrence: problemOccurrenceSchema,
    snapshot: problemSnapshotSchema,
  }).nullable(),
});
export type ProblemDetailView = z.infer<typeof problemDetailViewSchema>;

const PROBLEM_LIST_LIMIT = 100;
export const problemList = defineRead({
  resource: "problems",
  method: "list_problems",
  name: "problem.list",
  input: z.strictObject({
    app: idSchema("app").optional(),
    state: problemStateSchema.optional(),
    // 기간은 마지막 발생 시각에 건다.
    since: atSchema.optional(),
    until: atSchema.optional(),
    cursor,
    limit: z.number().int().min(1).max(PROBLEM_LIST_LIMIT).optional(),
  }),
  output: withReadCommon(z.object({
    problems: z.array(problemListItemSchema),
  })),
  actors: readActors,
  errors: readErrors,
});

export const problemGet = defineRead({
  resource: "problems",
  method: "get_problem",
  name: "problem.get",
  input: z.strictObject({ problem: idSchema("prb") }),
  output: withReadCommon(problemDetailViewSchema),
  actors: readActors,
  errors: readErrors,
});

// 전체 본문은 `problems.report_body`로 읽는다.
export const problemGetOccurrence = defineRead({
  resource: "problems",
  method: "get_occurrence",
  name: "problem.get_occurrence",
  input: z.strictObject({ report: idSchema("rpt") }),
  output: withReadCommon(z.object({
    occurrence: problemOccurrenceSchema,
    name: problemNameSchema,
    message: z.object({
      hash: sha256Schema,
      preview: z.string().max(PROBLEM_MESSAGE_PREVIEW_CHARS),
      truncated: z.boolean(),
    }).nullable(),
    details_hash: sha256Schema.nullable(),
    snapshot: problemSnapshotSchema,
  })),
  actors: readActors,
  errors: readErrors,
});

export const PROBLEM_MORE_KINDS = [
  "occurrences",
  "failed_invocations",
  "logs",
  "release_changes",
  "related_problems",
] as const;
export const problemMoreKindSchema = z.enum(PROBLEM_MORE_KINDS);
export type ProblemMoreKind = z.infer<typeof problemMoreKindSchema>;

function more<K extends ProblemMoreKind, T extends z.ZodType>(
  kind: K,
  item: T,
) {
  return withReadCommon(z.object({
    kind: z.literal(kind),
    items: z.array(item),
    next_cursor: z.string().min(1).nullable(),
  }));
}
export const problemMoreOutputSchema = z.discriminatedUnion("kind", [
  more("occurrences", problemOccurrenceSchema),
  // 실패 여부는 확인하지 않는다. 내용은 `app.invocation` read로 본다.
  more(
    "failed_invocations",
    z.object({ report: idSchema("rpt"), invocation: idSchema("inv") }),
  ),
  // 본문은 `GetSnapshotLogs`로 읽는다.
  more(
    "logs",
    z.object({
      report: idSchema("rpt"),
      snapshot: idSchema("snp"),
      log: logEvidenceSchema,
    }),
  ),
  // 코드 차이는 `problem diff`가 맡는다.
  more(
    "release_changes",
    z.object({
      release: releaseRefSchema,
      previous: releaseRefSchema.nullable(),
      added_resources: z.array(z.string()),
      removed_resources: z.array(z.string()),
    }),
  ),
  more("related_problems", problemListItemSchema),
]);
export type ProblemMoreOutput = z.infer<typeof problemMoreOutputSchema>;

export const problemMore = defineRead({
  resource: "problems",
  method: "more_problem",
  name: "problem.more",
  input: z.strictObject({
    problem: idSchema("prb"),
    kind: problemMoreKindSchema,
    cursor,
    limit: z.number().int().min(1).max(50).optional(),
  }),
  output: problemMoreOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// Gate도 보류 request도 없다. 같은 상태로 바꾸면 그대로 ok다.
export const problemSetState = defineCommand({
  resource: "problems",
  method: "set_state",
  name: "problem.set_state",
  input: z.strictObject({
    problem: idSchema("prb"),
    state: problemStateSchema,
    key: idempotencyKeySchema,
  }),
  output: z.object({ problem: problemRecordSchema }),
  actors: ["agent", "user"],
  // forbidden: App Engineer는 자기 앱의 문제만 바꾼다.
  errors: ["not_found", "forbidden", "invalid_input"],
});
