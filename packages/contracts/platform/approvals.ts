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

// command 이름은 소유 concern이 등록한 command route의 이름 그대로다(`document.rename`,
// `invocation.accept_confirm`, `create_approval_request`, `ApplySettings`). 이름을 바꾸거나 맞추지
// 않으므로 action의 command와 registry의 route 이름이 글자 그대로 같을 때만 같은 동작이다.
// 이 모양은 문법 검사일 뿐이고 dispatch는 등록된 dispatchable command만 한다.
const commandNameSchema = z.string().max(128).regex(
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/,
);

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

// 설명 글(이유·변경·외부 영향·되돌림)은 요청에 값으로 싣는다. 호출자는 hash를 만들지도
// blob을 준비하지도 않는다: core가 redaction을 거친 글을 UTF-8 bytes로 blob으로 준비하고
// command가 같은 transaction에서 영구 참조를 등록한다(platform/approvals, 메시지 본문·질문
// 글과 같은 길). ledger에는 그 blob의 hash만 남고, 글은 ReadApprovalText가 돌려준다.

// 글 하나의 상한(UTF-8 bytes). 요청 전체는 platform/api의 RPC JSON 상한 안이어야 한다.
export const APPROVAL_TEXT_MAX_BYTES = 32768;
// 글 blob 준비·참조의 이름. 준비 주체는 보낸 쪽의 자격이고 참조는 permanent다.
export const APPROVAL_TEXT_PURPOSE = "approval_text";
export const APPROVAL_BLOB_OWNER_KIND = "approval_request";
export const APPROVAL_TEXT_FIELDS = {
  reason: "reason",
  changes: "changes",
  external: "external",
  reversibility: "reversibility",
  // 거절·취소에 사람이나 요청자가 적은 이유. 없으면 참조도 없다.
  closed: "closed_reason",
} as const;

const encoder = new TextEncoder();

export function approvalTextBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

// 비어 있거나 공백뿐인 글은 글이 아니다(domain model ApprovalRequest·ApprovalEffect).
export const approvalTextSchema = z.string()
  .refine((value) => value.trim().length > 0, {
    message: "expected nonblank text",
  })
  .refine(
    (value) => approvalTextBytes(value).length <= APPROVAL_TEXT_MAX_BYTES,
    { message: "approval text is too large" },
  );

export const approvalEffectInputSchema = z.strictObject({
  changes: approvalTextSchema,
  external: approvalTextSchema.nullable(),
  reversible: z.boolean(),
  reversibility: approvalTextSchema,
});
export type ApprovalEffectInput = z.infer<typeof approvalEffectInputSchema>;

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

// 허락 범위(platform/approvals#R18). 대화 안 승인 카드의 선택은 Allow once(once)·Allow for this
// session(session)·Deny 셋이고 계속 허락(Always)은 없다. 오래 가는 허락은 자리의 권한 규칙이 맡는다.
export const APPROVAL_GRANT_SCOPES = ["once", "session"] as const;
export const approvalGrantScopeSchema = z.enum(APPROVAL_GRANT_SCOPES);
export type ApprovalGrantScope = z.infer<typeof approvalGrantScopeSchema>;

export const approvalRequestSchema = z.object({
  id: idSchema("apr"),
  requester: actorSchema,
  run: idSchema("run").nullable(),
  reason_blob: sha256Schema,
  effect: approvalEffectSchema,
  action: approvalActionSchema,
  expires_at: atSchema.nullable(),
  // 카드가 session 선택을 보일 수 있나. 생성 뒤 바꾸지 않는다(platform/approvals#R20).
  session_grantable: z.boolean(),
  status: approvalStatusSchema,
  // 허락한 범위와 session 허락이 사는 session. granted일 때만 범위가 있고, session 범위일 때만
  // session이 있다(platform/approvals#R19).
  grant_scope: approvalGrantScopeSchema.nullable(),
  grant_session: idSchema("ses").nullable(),
  closed_reason_blob: sha256Schema.nullable(),
  created_seq: seqSchema,
  closed_seq: seqSchema.nullable(),
}).refine(
  (value) =>
    // 종료 이유는 거절·취소에서 적었을 때만 있다(platform/approvals#R14). 만료는 이유 글이 없고
    // 상태가 곧 이유다. 가짜 hash는 두지 않는다.
    value.status === "pending" || value.status === "granted"
      ? value.closed_reason_blob === null
      : true,
  { message: "closed reason presence does not match status" },
).refine(
  (value) => (value.status === "pending") === (value.closed_seq === null),
  { message: "closed_seq presence does not match status" },
).refine(
  (value) => (value.grant_scope !== null) === (value.status === "granted"),
  { message: "grant scope presence does not match status" },
).refine(
  (value) =>
    value.grant_scope === "session"
      ? value.session_grantable && value.grant_session !== null
      : value.grant_session === null,
  { message: "grant session does not match grant scope" },
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
  // session 허락이 사는 session으로 거른다. tool-judgment가 그 session의 허락을 찾는다.
  grant_session: idSchema("ses").optional(),
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

export const approvalsTextInputSchema = z.strictObject({
  approval: idSchema("apr"),
});
// 사람이 결정할 때 보는 설명 글이다. 글은 준비 단계에서 이미 redaction을 거쳤다.
export const approvalsTextOutputSchema = withReadCommon(z.object({
  approval: idSchema("apr"),
  reason: z.string(),
  changes: z.string(),
  external: z.string().nullable(),
  reversibility: z.string(),
  // 거절·취소에 적은 이유. 적지 않았거나 아직 끝나지 않았거나 만료면 null이다.
  closed_reason: z.string().nullable(),
}));
export const approvalsText = defineRead({
  resource: "approvals",
  method: "text",
  name: "ReadApprovalText",
  input: approvalsTextInputSchema,
  output: approvalsTextOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: readErrors,
});

const contentCompareSchema = z.strictObject({ created_seq: seqSchema });

// 요청이 저장된 모양(글은 blob hash). 설명 글 값을 싣는 입력과 구별한다.
export const createApprovalRequestStoredSchema = z.strictObject({
  id: idSchema("apr"),
  requester: actorSchema,
  run: idSchema("run").nullable(),
  reason_blob: sha256Schema,
  effect: approvalEffectSchema,
  action: approvalActionSchema,
  expires_at: atSchema.nullable(),
  session_grantable: z.boolean(),
});

export const createApprovalRequestInputSchema = z.strictObject({
  id: idSchema("apr"),
  requester: actorSchema,
  run: idSchema("run").nullable(),
  reason: approvalTextSchema,
  effect: approvalEffectInputSchema,
  action: approvalActionSchema,
  expires_at: atSchema.nullable(),
  // agent tool call의 ask에서만 true다(platform/approvals#R20). 앱 command의 confirm·앱 permission·
  // release 적용·복원 request는 false다.
  session_grantable: z.boolean(),
});
export type CreateApprovalRequestInput = z.infer<
  typeof createApprovalRequestInputSchema
>;
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
  // 사람이 고른 범위다. 기본 선택이 없고(R4) confirmation 내용에 묶인다.
  scope: approvalGrantScopeSchema,
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
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
  confirmation: "required",
  binding: ["approval", "created_seq", "binding_hash", "scope"],
  display_read: "approvals/get",
});

export const rejectApprovalRequestInputSchema = z.strictObject({
  approval: idSchema("apr"),
  created_seq: seqSchema,
  binding_hash: sha256Schema,
  // 거절 이유 글. 이유 없이도 거절한다(R14). core가 redaction·blob 준비를 하고 command가 영구 참조를
  // 등록한다.
  closed_reason: approvalTextSchema.nullable(),
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
  // 취소 이유 글. 없을 수 있다.
  closed_reason: approvalTextSchema.nullable(),
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
  approvalsText,
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
  scope: approvalGrantScopeSchema,
  session: idSchema("ses").nullable(),
}).refine(
  (value) => (value.scope === "session") === (value.session !== null),
  { message: "session presence does not match scope" },
);
export const approvalRequestRejectedPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema.nullable(),
});
export const approvalRequestExpiredPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: z.null(),
});
export const approvalRequestCancelledPayloadSchema = z.object({
  created_seq: seqSchema,
  closed_reason_blob: sha256Schema.nullable(),
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
