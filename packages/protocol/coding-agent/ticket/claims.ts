// claim과 완료 보고 route. claim의 주인은 coding session이다.
// event(`TicketCompletionReported`, `TicketClaimExpired` 등)는 protocol/events가 정의한다.
import { z } from "zod";
import { idSchema } from "../../base/ids.ts";
import { defineCommand, defineUpload } from "../../base/route.ts";
import { atSchema, seqSchema, sha256Schema } from "../../base/values.ts";
import { preparedBlobSchema } from "../../storage/blob.ts";
import { codingSessionIdSchema } from "../token.ts";
import {
  checkResultSchema,
  completionFields,
  ticketIdSchema,
} from "./values.ts";

const base = {
  ticket: ticketIdSchema,
  base_revision: seqSchema,
};
const claimed = {
  ...base,
  claim_seq: seqSchema,
};

export const ticketClaimInputSchema = z.strictObject(base);
export const ticketClaimOutputSchema = z.object({
  ticket: ticketIdSchema,
  session: codingSessionIdSchema,
  claim_seq: seqSchema,
  expires_at: atSchema,
});
export const ticketClaim = defineCommand({
  resource: "tickets",
  method: "claim",
  name: "ClaimTicket",
  input: ticketClaimInputSchema,
  output: ticketClaimOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["coding_agent"],
  errors: ["unauthorized", "forbidden", "not_found", "conflict"],
});

export const ticketRenewClaim = defineCommand({
  resource: "tickets",
  method: "renew_claim",
  name: "RenewTicketClaim",
  input: z.strictObject(claimed),
  output: ticketClaimOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["coding_agent"],
  errors: ["unauthorized", "forbidden", "conflict"],
});

export const ticketExpireClaim = defineCommand({
  resource: "tickets",
  method: "expire_claim",
  name: "ExpireTicketClaim",
  input: z.strictObject({ ticket: ticketIdSchema, claim_seq: seqSchema }),
  output: z.object({ ticket: ticketIdSchema, state: z.literal("open") }),
  actors: ["machine"],
  errors: ["conflict"],
});

// summary blob의 준비 증거다(hash만 싣는 보고는 가리키는 바이트가 저장된 blob이어야 한다).
export const ticketSummaryBlobSchema = z.strictObject(preparedBlobSchema.shape)
  .refine(
    (value) => value.purpose === "ticket_summary",
    { message: "summary blob purpose must be ticket_summary" },
  );

// summary blob 한 개의 상한이다. `ticket_summary` purpose의 max_size_bytes와 같은 값이다.
export const TICKET_SUMMARY_MAX_BYTES = 262_144;
export const ticketUploadSummary = defineUpload({
  resource: "tickets",
  method: "upload_summary",
  name: "UploadTicketSummary",
  input: z.strictObject({
    blob_hash: sha256Schema,
    bytes: z.number().int().min(1).max(TICKET_SUMMARY_MAX_BYTES),
  }),
  output: ticketSummaryBlobSchema,
  actors: ["coding_agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
  max_bytes: TICKET_SUMMARY_MAX_BYTES,
});

export const ticketCompletionInputSchema = z.strictObject(completionFields);

// CLI의 입력이다. summary 본문을 받아 hash를 내고 `upload_summary`로 올린 뒤 준비 참조로
// report_completion을 보낸다. completion seq는 입력이 아니다(core가 부여한다).
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
export const ticketReportSummarySchema = z.string().refine(
  (value) => /\S/.test(value) && utf8Bytes(value) <= TICKET_SUMMARY_MAX_BYTES,
  { message: "summary must be non-blank and within the upload limit" },
);
export const ticketReportToolInputSchema = z.strictObject({
  ...claimed,
  release: completionFields.release,
  summary: ticketReportSummarySchema,
  fix_records: completionFields.fix_records.optional(),
  verifications: completionFields.verifications.optional(),
});
export type TicketReportToolInput = z.infer<
  typeof ticketReportToolInputSchema
>;

export const ticketReportCompletionInputSchema = z.strictObject({
  ...claimed,
  completion: ticketCompletionInputSchema,
  summary_blob: ticketSummaryBlobSchema,
}).refine(
  (value) => value.summary_blob.hash === value.completion.summary_hash,
  { message: "summary blob hash must match completion.summary_hash" },
);
export type TicketReportCompletionInput = z.infer<
  typeof ticketReportCompletionInputSchema
>;
export const ticketReportCompletion = defineCommand({
  resource: "tickets",
  method: "report_completion",
  name: "ReportTicketCompletion",
  input: ticketReportCompletionInputSchema,
  output: z.object({
    ticket: ticketIdSchema,
    state: z.literal("reported"),
    completion_seq: seqSchema,
  }),
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["coding_agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

// 보고를 받을 때 실행 조건을 돌린 결과를 기록만 한다. 상태는 바꾸지 않는다.
// 확인됨·확인 실패는 App Engineer가 `ticketVerify`로 정한다.
export const ticketRecordChecks = defineCommand({
  resource: "tickets",
  method: "record_checks",
  name: "RecordTicketChecks",
  input: z.strictObject({
    ticket: ticketIdSchema,
    completion_seq: seqSchema,
    base_revision: seqSchema,
    result: checkResultSchema,
    reason: z.string().max(2000),
    verification: idSchema("vrf").optional(),
  }),
  output: z.object({
    ticket: ticketIdSchema,
    state: z.literal("reported"),
    completion_seq: seqSchema,
  }),
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "conflict"],
});

export const TICKET_CLAIM_ROUTES = [
  ticketClaim,
  ticketRenewClaim,
  ticketReportCompletion,
  ticketUploadSummary,
  ticketExpireClaim,
  ticketRecordChecks,
] as const;
