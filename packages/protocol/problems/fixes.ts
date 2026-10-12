import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  defineUpload,
  idSchema,
  preparedBlobSchema,
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

// summary blob의 준비 증거다(hash만 싣는 기록은 가리키는 바이트가 저장된 blob이어야 한다).
// handler가 같은 준비를 본 뒤 같은 transaction에서 영구 참조를 등록한다(contracts#T40).
export const fixSummaryBlobSchema = z.strictObject(preparedBlobSchema.shape)
  .refine(
    (value) => value.purpose === "fix_summary",
    { message: "summary blob purpose must be fix_summary" },
  );

export const recordProblemFixInputSchema = z.strictObject({
  problem: idSchema("prb"),
  fix: fixRecordInputSchema,
  summary_blob: fixSummaryBlobSchema,
  idempotency_key: z.string().min(1).max(128),
}).refine((value) => value.summary_blob.hash === value.fix.summary, {
  message: "summary blob hash must match fix.summary",
});
// summary blob 한 개의 상한이다. `fix_summary` purpose의 max_size_bytes와 같은 값이다.
export const FIX_SUMMARY_MAX_BYTES = 262_144;
// 고친 기록의 summary 바이트를 core의 blob 준비로 보낸다(주체는 요청 credential, purpose는
// `fix_summary` 고정). 준비된 참조가 이어지는 RecordProblemFix의 summary_blob이다.
export const problemsUploadFixSummary = defineUpload({
  resource: "problems",
  method: "upload_fix_summary",
  name: "UploadFixSummary",
  input: z.strictObject({
    blob_hash: sha256Schema,
    bytes: z.number().int().min(1).max(FIX_SUMMARY_MAX_BYTES),
  }),
  output: fixSummaryBlobSchema,
  actors: ["coding_agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
  max_bytes: FIX_SUMMARY_MAX_BYTES,
});

// MCP·CLI의 record_fix 입력이다. 통로가 summary 본문을 받아 hash를 내고 upload_fix_summary로 올린
// 준비 참조를 싣는다(hash만 싣는 기록은 거절된다). 모델이 hash나 준비 증거를 만들지 않는다.
// 이 입력은 ticket·claim_seq가 필수이고 owner command 입력이 현재 claim을 한 번 더 검사한다.
const fixSummaryText = z.string().refine(
  (value) =>
    /\S/.test(value) &&
    new TextEncoder().encode(value).length <= FIX_SUMMARY_MAX_BYTES,
  { message: "summary must be non-blank and within the upload limit" },
);
export const recordProblemFixToolInputSchema = z.strictObject({
  problem: idSchema("prb"),
  // 읽은 문제의 seq다(problems list·show의 seq). 낡으면 owner가 conflict로 거절한다.
  problem_seq: seqSchema,
  fix: z.strictObject({
    before: idSchema("rel"),
    after: idSchema("rel"),
    verification: z.array(idSchema("vrf")).refine(unique, {
      message: "duplicate verification",
    }),
    ticket: idSchema("tkt"),
    claim_seq: seqSchema,
  }).refine((value) => value.before !== value.after, {
    message: "before and after must differ",
  }),
  summary: fixSummaryText,
  idempotency_key: z.string().min(1).max(128).optional(),
});
export type RecordProblemFixToolInput = z.infer<
  typeof recordProblemFixToolInputSchema
>;

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
