import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

// repairs#R1, R2: before와 다른 준비된 after, 공백 아닌 설명, 결과 목록은 비어도 된다.
export const fixRecordSchema = z.object({
  before: idSchema("rel"),
  after: idSchema("rel"),
  summary: sha256Schema,
  verification: z.array(idSchema("vrf")).refine(unique, {
    message: "duplicate verification",
  }),
  ticket: idSchema("tkt").nullable(),
  claim_seq: seqSchema.nullable(),
}).refine(
  (value) =>
    value.before !== value.after &&
    (value.ticket === null) === (value.claim_seq === null),
  { message: "before and after differ; ticket and claim stay paired" },
);
export const fixRecordInputSchema = z.strictObject({
  before: idSchema("rel"),
  after: idSchema("rel"),
  summary: sha256Schema,
  verification: z.array(idSchema("vrf")).refine(unique, {
    message: "duplicate verification",
  }),
  ticket: idSchema("tkt"),
  claim_seq: seqSchema,
}).refine((value) => value.before !== value.after, {
  message: "before and after must differ",
});
export type FixRecord = z.infer<typeof fixRecordSchema>;

export const recordProblemFixInputSchema = z.strictObject({
  problem: idSchema("prb"),
  fix: fixRecordInputSchema,
  idempotency_key: z.string().min(1).max(128),
});
export const recordProblemFixCompareSchema = z.strictObject({
  problem_seq: seqSchema,
});
export const recordProblemFixOutputSchema = z.object({
  seq: seqSchema,
});
export const recordProblemFix = defineCommand({
  resource: "problems",
  method: "record-fix",
  name: "RecordProblemFix",
  input: recordProblemFixInputSchema,
  output: recordProblemFixOutputSchema,
  compare: recordProblemFixCompareSchema,
  actors: ["coding_agent"],
  errors: ["invalid_input", "not_found", "forbidden", "conflict"],
});

export const listProblemFixesInputSchema = z.strictObject({
  problem: idSchema("prb"),
  cursor: seqSchema.optional(),
});
export const listProblemFixesOutputSchema = withReadCommon(z.object({
  fixes: z.array(z.object({ seq: seqSchema, fix: fixRecordSchema })),
}));
export const listProblemFixes = defineRead({
  resource: "problems",
  method: "list-fixes",
  name: "ListProblemFixes",
  input: listProblemFixesInputSchema,
  output: listProblemFixesOutputSchema,
  actors: ["user", "coding_agent", "agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const problemFixRecorded = defineEvent("ProblemFixRecorded", {
  subject: idSchema("prb"),
  payload: fixRecordSchema,
});
