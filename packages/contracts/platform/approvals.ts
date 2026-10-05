import { z } from "zod";
import { fingerprint } from "../../base/mod.ts";
import { actorSchema } from "./actor.ts";
import { withReadCommon } from "./envelope.ts";
import { defineEvent } from "./events.ts";
import { idSchema } from "./ids.ts";
import { jsonObjectSchema } from "./json-values.ts";
import { defineCommand, defineRead } from "./route.ts";
import { atSchema, seqSchema, sha256Schema } from "./values.ts";

// concern id는 최상위 또는 최상위/leaf다(domain-model platform/approvals).
const concernSchema = z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/);

// command 이름은 소유 concern의 등록된 이름이다. 임의 함수 이름은 받지 않는다.
const commandNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

const nonemptyTextSchema = z.string().regex(/\S/);

// 대상은 정확한 고정 ID다. 이름·slug만으로 묶지 않는다.
const targetSchema = z.string().regex(/^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const targetsSchema = z.array(targetSchema).min(1).refine(
  (targets) => new Set(targets).size === targets.length,
  { message: "duplicate target" },
);

export const approvalInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inline"), value: jsonObjectSchema }),
  z.strictObject({ kind: z.literal("blob"), sha256: sha256Schema }),
]);
export type ApprovalInput = z.infer<typeof approvalInputSchema>;

export const approvalActionSchema = z.strictObject({
  concern: concernSchema,
  command: commandNameSchema,
  caller: actorSchema,
  targets: targetsSchema,
  input: approvalInputSchema,
  input_hash: sha256Schema,
  comparison: jsonObjectSchema,
  binding_hash: sha256Schema,
});
export type ApprovalAction = z.infer<typeof approvalActionSchema>;

export const approvalEffectSchema = z.strictObject({
  changes_blob: sha256Schema,
  external_blob: sha256Schema.nullable(),
  reversible: z.boolean(),
  reversibility_blob: sha256Schema,
});
export type ApprovalEffect = z.infer<typeof approvalEffectSchema>;

// binding_hash는 concern·command·caller·targets·input_hash·comparison 전체의 지문이다.
// 표시용 redacted 입력의 hash가 아니다(domain-model platform/approvals ApprovalAction).
export function approvalBinding(action: ApprovalAction): {
  concern: string;
  command: string;
  caller: string;
  targets: string[];
  input_hash: string;
  comparison: z.infer<typeof jsonObjectSchema>;
} {
  return {
    concern: action.concern,
    command: action.command,
    caller: action.caller,
    targets: action.targets,
    input_hash: action.input_hash,
    comparison: action.comparison,
  };
}

export function approvalBindingHash(action: ApprovalAction): Promise<string> {
  return fingerprint(approvalBinding(action));
}

export const APPROVAL_STATUSES = [
  "pending",
  "granted",
  "rejected",
  "expired",
  "cancelled",
] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRequestSchema = z.object({
  id: idSchema("apr"),
  requester: actorSchema,
  run: idSchema("run").nullable(),
  reason_blob: sha256Schema,
  effect: approvalEffectSchema,
  action: approvalActionSchema,
  expires_at: atSchema.nullable(),
  status: approvalStatusSchema,
  closed_reason_blob: sha256Schema.nullable(),
  created_seq: seqSchema,
  closed_seq: seqSchema.nullable(),
}).refine(
  (value) =>
    value.status === "pending" || value.status === "granted"
      ? value.closed_reason_blob === null
      // 거절은 이유 없이 할 수 있다(platform/approvals#R14). 만료·취소는 이유가 필수다.
      : value.status === "rejected" || value.closed_reason_blob !== null,
  { message: "closed reason presence does not match status" },
).refine(
  (value) => (value.status === "pending") === (value.closed_seq === null),
  { message: "closed_seq presence does not match status" },
);
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const approvalReceiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), id: targetSchema }),
  z.strictObject({ kind: z.literal("event"), seq: seqSchema }),
]);
export type ApprovalReceipt = z.infer<typeof approvalReceiptSchema>;

export const approvalUseSchema = z.strictObject({
  approval: idSchema("apr"),
  concern: concernSchema,
  receipt: approvalReceiptSchema,
  accepted_seq: seqSchema,
});
export type ApprovalUse = z.infer<typeof approvalUseSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const approvalsGetInputSchema = z.strictObject({
  approval: idSchema("apr"),
});
export const approvalsGetOutputSchema = withReadCommon(z.object({
  request: approvalRequestSchema,
  use: approvalUseSchema.nullable(),
}));
export const approvalsGet = defineRead({
  resource: "approvals",
  method: "get",
  name: "GetApproval",
  input: approvalsGetInputSchema,
  output: approvalsGetOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: readErrors,
});

export const approvalsListInputSchema = z.strictObject({
  status: approvalStatusSchema.optional(),
  run: idSchema("run").optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const approvalsListOutputSchema = withReadCommon(z.object({
  requests: z.array(approvalRequestSchema),
}));
export const approvalsList = defineRead({
  resource: "approvals",
  method: "list",
  name: "ListApprovals",
  input: approvalsListInputSchema,
  output: approvalsListOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: readErrors,
});

const contentCompareSchema = z.strictObject({ created_seq: seqSchema });

export const createApprovalRequestInputSchema = z.strictObject({
  id: idSchema("apr"),
  requester: actorSchema,
  run: idSchema("run").nullable(),
  reason_blob: sha256Schema,
  effect: approvalEffectSchema,
  action: approvalActionSchema,
  expires_at: atSchema.nullable(),
});
export const createApprovalRequestOutputSchema = z.object({
  request: approvalRequestSchema,
});
export const createApprovalRequest = defineCommand({
  resource: "approvals",
  method: "create",
  name: "create_approval_request",
  input: createApprovalRequestInputSchema,
  output: createApprovalRequestOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const grantApprovalRequestInputSchema = z.strictObject({
  approval: idSchema("apr"),
  created_seq: seqSchema,
  binding_hash: sha256Schema,
});
export const grantApprovalRequestOutputSchema = z.object({
  request: approvalRequestSchema,
});
// confirmation 필수: user 자격만으로 허락하지 않는다(platform/approvals#R3).
export const grantApprovalRequest = defineCommand({
  resource: "approvals",
  method: "grant",
  name: "grant_approval_request",
  input: grantApprovalRequestInputSchema,
  output: grantApprovalRequestOutputSchema,
  compare: contentCompareSchema,
  actors: ["user"],
  errors: ["forbidden", "not_found", "conflict"],
  confirmation: "required",
  binding: ["approval", "created_seq", "binding_hash"],
  display_read: "approvals/get",
});

export const rejectApprovalRequestInputSchema = z.strictObject({
  approval: idSchema("apr"),
  created_seq: seqSchema,
  binding_hash: sha256Schema,
  closed_reason_blob: sha256Schema.nullable(),
});
export const rejectApprovalRequestOutputSchema = z.object({
  request: approvalRequestSchema,
});
// 거절은 이유 없이 가능하다(platform/approvals#R14).
export const rejectApprovalRequest = defineCommand({
  resource: "approvals",
  method: "reject",
  name: "reject_approval_request",
  input: rejectApprovalRequestInputSchema,
  output: rejectApprovalRequestOutputSchema,
  compare: contentCompareSchema,
  actors: ["user"],
  errors: ["forbidden", "not_found", "conflict"],
  confirmation: "required",
  binding: ["approval", "created_seq", "binding_hash"],
  display_read: "approvals/get",
});

export const expireApprovalRequestInputSchema = z.strictObject({
  approval: idSchema("apr"),
  created_seq: seqSchema,
});
export const expireApprovalRequestOutputSchema = z.object({
  request: approvalRequestSchema,
});
export const expireApprovalRequest = defineCommand({
  resource: "approvals",
  method: "expire",
  name: "expire_approval_request",
  input: expireApprovalRequestInputSchema,
  output: expireApprovalRequestOutputSchema,
  compare: contentCompareSchema,
  actors: ["machine"],
  errors: ["forbidden", "not_found", "conflict"],
});

export const cancelApprovalRequestInputSchema = z.strictObject({
  approval: idSchema("apr"),
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema,
});
export const cancelApprovalRequestOutputSchema = z.object({
  request: approvalRequestSchema,
});
export const cancelApprovalRequest = defineCommand({
  resource: "approvals",
  method: "cancel",
  name: "cancel_approval_request",
  input: cancelApprovalRequestInputSchema,
  output: cancelApprovalRequestOutputSchema,
  compare: contentCompareSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["forbidden", "not_found", "conflict"],
});

export const applyApprovedActionInputSchema = z.strictObject({
  approval: idSchema("apr"),
  action: approvalActionSchema,
  idempotency_key: nonemptyTextSchema,
});
export const applyApprovedActionOutputSchema = z.object({
  use: approvalUseSchema,
  replayed: z.boolean(),
});
export const applyApprovedAction = defineCommand({
  resource: "approvals",
  method: "apply",
  name: "apply_approved_action",
  input: applyApprovedActionInputSchema,
  output: applyApprovedActionOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["forbidden", "not_found", "conflict"],
});

export const APPROVAL_ROUTES = [
  approvalsGet,
  approvalsList,
  createApprovalRequest,
  grantApprovalRequest,
  rejectApprovalRequest,
  expireApprovalRequest,
  cancelApprovalRequest,
  applyApprovedAction,
] as const;

const approvalSubject = idSchema("apr");

export const approvalRequestCreatedPayloadSchema = z.object({
  binding_hash: sha256Schema,
});
export const approvalRequestGrantedPayloadSchema = z.object({
  created_seq: seqSchema,
  binding_hash: sha256Schema,
});
export const approvalRequestRejectedPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema.nullable(),
});
export const approvalRequestExpiredPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema,
});
export const approvalRequestCancelledPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema,
});

export const approvalRequestCreated = defineEvent("ApprovalRequestCreated", {
  subject: approvalSubject,
  payload: approvalRequestCreatedPayloadSchema,
});
export const approvalRequestGranted = defineEvent("ApprovalRequestGranted", {
  subject: approvalSubject,
  payload: approvalRequestGrantedPayloadSchema,
});
export const approvalRequestRejected = defineEvent("ApprovalRequestRejected", {
  subject: approvalSubject,
  payload: approvalRequestRejectedPayloadSchema,
});
export const approvalRequestExpired = defineEvent("ApprovalRequestExpired", {
  subject: approvalSubject,
  payload: approvalRequestExpiredPayloadSchema,
});
export const approvalRequestCancelled = defineEvent(
  "ApprovalRequestCancelled",
  {
    subject: approvalSubject,
    payload: approvalRequestCancelledPayloadSchema,
  },
);

export const APPROVAL_EVENTS = [
  approvalRequestCreated,
  approvalRequestGranted,
  approvalRequestRejected,
  approvalRequestExpired,
  approvalRequestCancelled,
] as const;
