import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { defineEvent } from "../events/events.ts";
import { preparedBlobSchema } from "../server/mod.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineUpload } from "../server/route.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { checkResultSchema, ticketIdSchema } from "./ticket-values.ts";

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
  connection: idSchema("cac"),
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

export const ticketRenewClaimInputSchema = z.strictObject(claimed);
export const ticketRenewClaimOutputSchema = ticketClaimOutputSchema;
export const ticketRenewClaim = defineCommand({
  resource: "tickets",
  method: "renew_claim",
  name: "RenewTicketClaim",
  input: ticketRenewClaimInputSchema,
  output: ticketRenewClaimOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["coding_agent"],
  errors: ["unauthorized", "forbidden", "conflict"],
});

export const ticketReleaseClaimInputSchema = z.strictObject(claimed);
export const ticketReleaseClaimOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.literal("open"),
});
export const ticketReleaseClaim = defineCommand({
  resource: "tickets",
  method: "release_claim",
  name: "ReleaseTicketClaim",
  input: ticketReleaseClaimInputSchema,
  output: ticketReleaseClaimOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["coding_agent"],
  errors: ["unauthorized", "forbidden", "conflict"],
});

export const ticketExpireClaimInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  claim_seq: seqSchema,
});
export const ticketExpireClaimOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.literal("open"),
});
export const ticketExpireClaim = defineCommand({
  resource: "tickets",
  method: "expire_claim",
  name: "ExpireTicketClaim",
  input: ticketExpireClaimInputSchema,
  output: ticketExpireClaimOutputSchema,
  actors: ["machine"],
  errors: ["conflict"],
});

const completionFields = {
  release: idSchema("rel"),
  summary_hash: sha256Schema,
  outputs: z.array(idSchema("ver")).max(20),
  fix_records: z.array(seqSchema).max(12),
  verifications: z.array(idSchema("vrf")).max(24),
};
export const ticketCompletionInputSchema = z.strictObject(completionFields);
// summary blob의 준비 증거다(hash만 싣는 보고는 가리키는 바이트가 저장된 blob이어야 한다).
// handler가 같은 준비를 본 뒤 같은 transaction에서 영구 참조를 등록한다(contracts#T40 선례).
export const ticketSummaryBlobSchema = z.strictObject(preparedBlobSchema.shape)
  .refine(
    (value) => value.purpose === "ticket_summary",
    { message: "summary blob purpose must be ticket_summary" },
  );

// summary blob 한 개의 상한이다. `ticket_summary` purpose의 max_size_bytes와 같은 값이다.
export const TICKET_SUMMARY_MAX_BYTES = 262_144;
// 보고할 summary 바이트를 core의 blob 준비로 보낸다(주체는 요청 credential, purpose는
// `ticket_summary` 고정). 준비된 참조가 이어지는 report_completion의 summary_blob이다.
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

// 완료 보고의 통로 입력이다(mcp#R27, R28, cli#R36). 통로는 summary 본문을 받아 hash를 내고
// `upload_summary`로 바이트를 올린 뒤 준비 참조로 report_completion을 보낸다. completion seq는
// 입력이 아니다(core가 부여한다). `fix_records`는 고친 기록(fix event)의 seq 참조다.
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
export const ticketReportSummarySchema = z.string().refine(
  (value) => /\S/.test(value) && utf8Bytes(value) <= TICKET_SUMMARY_MAX_BYTES,
  { message: "summary must be non-blank and within the upload limit" },
);
export const ticketReportToolInputSchema = z.strictObject({
  ...claimed,
  release: completionFields.release,
  summary: ticketReportSummarySchema,
  outputs: completionFields.outputs.optional(),
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
export const ticketReportCompletionOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.literal("reported"),
  completion_seq: seqSchema,
});
export type TicketReportCompletionInput = z.infer<
  typeof ticketReportCompletionInputSchema
>;
export const ticketReportCompletion = defineCommand({
  resource: "tickets",
  method: "report_completion",
  name: "ReportTicketCompletion",
  input: ticketReportCompletionInputSchema,
  output: ticketReportCompletionOutputSchema,
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

const recordedCheck = z.strictObject({
  condition: z.number().int().min(0).max(11),
  result: checkResultSchema,
  reason: z.string().max(2000),
  verification: idSchema("vrf").nullable(),
  targets: z.array(z.strictObject({
    concern: z.string().min(1).max(80),
    id: z.string().min(1).max(80),
    revision: seqSchema,
    release: idSchema("rel").nullable(),
  })).max(12),
});
export const ticketRecordChecksInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  completion_seq: seqSchema,
  base_revision: seqSchema,
  checks: z.array(recordedCheck).min(1).max(12),
});
export const ticketRecordChecksOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.enum(["reported", "confirmed", "check_failed"]),
  completion_seq: seqSchema,
});
export const ticketRecordChecks = defineCommand({
  resource: "tickets",
  method: "record_checks",
  name: "RecordTicketChecks",
  input: ticketRecordChecksInputSchema,
  output: ticketRecordChecksOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "conflict"],
});

const reasonSchema = z.string().refine((value) => {
  const count = [...value].length;
  return count >= 1 && count <= 200 && /\S/.test(value) &&
    !/[\r\n]/.test(value);
}, { message: "cancel reason" });

export const ticketCancelInputSchema = z.strictObject({
  ...base,
  reason: reasonSchema,
});
export const ticketCancelOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.literal("cancelled"),
});
export type TicketCancelInput = z.infer<typeof ticketCancelInputSchema>;
export const ticketCancel = defineCommand({
  resource: "tickets",
  method: "cancel",
  name: "CancelTicket",
  input: ticketCancelInputSchema,
  output: ticketCancelOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["user", "machine"],
  errors: ["invalid_input", "forbidden", "conflict"],
});

const appProblems = {
  app: idSchema("app"),
  problems: z.array(idSchema("prb")).max(12),
};

export const ticketClaimedPayloadSchema = z.object({
  ...appProblems,
  connection: idSchema("cac"),
  claim_seq: seqSchema,
  expires_at: atSchema,
});
export const ticketClaimed = defineEvent("TicketClaimed", {
  subject: ticketIdSchema,
  payload: ticketClaimedPayloadSchema,
});

export const ticketClaimRenewedPayloadSchema = z.object({
  connection: idSchema("cac"),
  claim_seq: seqSchema,
  before_expires_at: atSchema,
  expires_at: atSchema,
});
export const ticketClaimRenewed = defineEvent("TicketClaimRenewed", {
  subject: ticketIdSchema,
  payload: ticketClaimRenewedPayloadSchema,
});

export const ticketClaimReleasedPayloadSchema = z.object({
  ...appProblems,
  connection: idSchema("cac"),
  claim_seq: seqSchema,
  reason: z.enum(["returned", "expired", "connection_revoked"]),
});
export const ticketClaimReleased = defineEvent("TicketClaimReleased", {
  subject: ticketIdSchema,
  payload: ticketClaimReleasedPayloadSchema,
});

export const ticketCompletionReportedPayloadSchema = z.object({
  ...appProblems,
  completion_seq: seqSchema,
  claim_seq: seqSchema,
  release: idSchema("rel"),
  fix_records: z.array(seqSchema).max(12),
  summary_hash: sha256Schema,
  outputs: z.array(idSchema("ver")).max(20),
  verifications: z.array(idSchema("vrf")).max(24),
});
export const ticketCompletionReported = defineEvent(
  "TicketCompletionReported",
  {
    subject: ticketIdSchema,
    payload: ticketCompletionReportedPayloadSchema,
  },
);

export const ticketChecksRecordedPayloadSchema = z.object({
  completion_seq: seqSchema,
  checks: z.array(z.object({
    condition: z.number().int().min(0).max(11),
    result: checkResultSchema,
  })).max(12),
});
export const ticketChecksRecorded = defineEvent("TicketChecksRecorded", {
  subject: ticketIdSchema,
  payload: ticketChecksRecordedPayloadSchema,
});

const confirmedFields = {
  ...appProblems,
  completion_seq: seqSchema,
  release: idSchema("rel"),
  fix_records: z.array(seqSchema).max(12),
};
export const ticketConfirmedPayloadSchema = z.object(confirmedFields);
export const ticketConfirmed = defineEvent("TicketConfirmed", {
  subject: ticketIdSchema,
  payload: ticketConfirmedPayloadSchema,
});

export const ticketCheckFailedPayloadSchema = z.object({
  ...confirmedFields,
  failed_conditions: z.array(z.number().int().min(0).max(11)).min(1).max(12),
});
export const ticketCheckFailed = defineEvent("TicketCheckFailed", {
  subject: ticketIdSchema,
  payload: ticketCheckFailedPayloadSchema,
});

export const ticketCancelledPayloadSchema = z.object({
  ...appProblems,
  reason: reasonSchema,
  released_claim: seqSchema.nullable(),
  completion_seq: seqSchema.nullable(),
  fix_records: z.array(seqSchema).max(12),
});
export const ticketCancelled = defineEvent("TicketCancelled", {
  subject: ticketIdSchema,
  payload: ticketCancelledPayloadSchema,
});

export const TICKET_CLAIM_ROUTES = [
  ticketClaim,
  ticketRenewClaim,
  ticketReleaseClaim,
  ticketReportCompletion,
  ticketExpireClaim,
  ticketRecordChecks,
  ticketCancel,
  ticketUploadSummary,
] as const;

export const TICKET_CLAIM_EVENTS = [
  ticketClaimed,
  ticketClaimRenewed,
  ticketClaimReleased,
  ticketCompletionReported,
  ticketChecksRecorded,
  ticketConfirmed,
  ticketCheckFailed,
  ticketCancelled,
] as const;

const knownErrors: readonly string[] = ERROR_CODES;
for (const route of TICKET_CLAIM_ROUTES) {
  for (const code of route.errors) {
    if (!knownErrors.includes(code)) {
      throw new Error("ticket error code is outside the common seven");
    }
  }
}
