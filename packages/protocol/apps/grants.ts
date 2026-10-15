import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { withReadCommon } from "../base/envelope.ts";
import { releaseIdSchema } from "./apps.ts";
import {
  appIdSchema,
  approvalIdSchema,
  grantIdSchema,
} from "./channel-values.ts";
import {
  permissionKindSchema,
  permissionRequirementSchema,
  permissionScopeSchema,
} from "./permissions.ts";

export const GRANT_STATES = ["active", "revoked"] as const;
export const grantStateSchema = z.enum(GRANT_STATES);
export type GrantState = z.infer<typeof grantStateSchema>;

// 같은 (app,kind,정규 scope)의 active grant는 하나다(lead 결정). 중복은 handler가
// grants 집합의 partial unique로 거절한다(→ domain-model apps/permissions ledger 표).
// scope·요구의 교집합 판정은 runtime이고 Grant 자체는 사람이 허락한 범위만 담는다.
export const grantSchema = z.object({
  id: grantIdSchema,
  app: appIdSchema,
  kind: permissionKindSchema,
  scope: permissionScopeSchema,
  approval: approvalIdSchema,
  status: grantStateSchema,
  created_by: actorSchema,
  created_at: atSchema,
  revoked_by: actorSchema.nullable(),
  revoked_at: atSchema.nullable(),
}).refine(
  (value) => value.kind === value.scope.kind,
  { message: "grant kind does not match scope kind" },
).refine(
  (value) =>
    value.kind !== "app.call" ||
    (value.scope.kind === "app.call" && value.scope.app !== value.app),
  { message: "app.call grant cannot target its own app" },
).refine(
  (value) => value.created_by === "user",
  { message: "grant creator is the approval's user" },
).refine(
  (value) =>
    value.status !== "active" ||
    (value.revoked_by === null && value.revoked_at === null),
  { message: "active grant has no revoke fields" },
).refine(
  (value) => value.status !== "revoked" || value.revoked_at !== null,
  { message: "revoked grant needs revoked_at" },
).refine(
  (value) => value.status !== "revoked" || value.revoked_by === "user",
  { message: "revoked grant is revoked by a user" },
);
export type Grant = z.infer<typeof grantSchema>;

// grant.create 입력. 검증된 approval만 받는다
// (domain-model apps/permissions command 표).
export const grantCreateInputSchema = z.strictObject({
  app: appIdSchema,
  kind: permissionKindSchema,
  scope: permissionScopeSchema,
  approval: approvalIdSchema,
});
export type GrantCreateInput = z.infer<typeof grantCreateInputSchema>;

const grantCompareSchema = z.strictObject({ grants_seq: seqSchema });

// 앱에 activation이 진행 중이면 handler가 conflict로 거절한다.
export const grantCreate = defineCommand({
  resource: "grants",
  method: "create",
  name: "grant.create",
  input: grantCreateInputSchema,
  output: z.object({ grant: grantSchema }),
  compare: grantCompareSchema,
  actors: ["machine", "user"],
  errors: ["forbidden", "invalid_input", "conflict"],
});
export type GrantCreate = typeof grantCreate;

// grant.revoke 입력. 종료 확인 근거는 suppression 관측의 사실이며
// handler가 현재 프로세스 종료·이미 멈춤을 검사한다.
export const grantRevokeInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  grant: grantIdSchema,
  process_nonce: z.string().min(1).nullable(),
  termination_confirmed: z.literal(true).nullable(),
});
export type GrantRevokeInput = z.infer<typeof grantRevokeInputSchema>;

// grant.revoke는 사람의 결정이다(→ domain-model apps/permissions 상태 표).
export const grantRevoke = defineCommand({
  resource: "grants",
  method: "revoke",
  name: "grant.revoke",
  input: grantRevokeInputSchema,
  output: z.object({ grant: grantSchema }),
  compare: grantCompareSchema,
  actors: ["user"],
  errors: ["conflict", "unavailable"],
  confirmation: "required",
  binding: ["grant"],
  display_read: "grants/list",
});
export type GrantRevoke = typeof grantRevoke;

// automation 끄기는 확인 창 없이 user가 정확한 grant를 CAS해 회수한다.
export const automationGrantRevoke = defineCommand({
  resource: "grants",
  method: "revoke_automation",
  name: "grant.revoke_automation",
  input: z.strictObject({
    app: appIdSchema,
    grant: grantIdSchema,
    automation: z.string().min(1),
  }),
  output: z.object({ grant: grantSchema }),
  compare: grantCompareSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["not_found", "conflict", "unavailable"],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const GRANT_LIST_MAX_COUNT = 200;

// 현재 app의 grant. 선언 교집합 계산은 read를 부르는 쪽이다.
export const grantsListInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  status: grantStateSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(GRANT_LIST_MAX_COUNT).optional(),
});

// confirmation window가 grant 결정 앞에서 보여 주는 자료의 경고 key.
// 문구 본문은 design wording catalog의 몫이다.
export const GRANT_WARNING_KEYS = [
  "permissions.warning.file-read-and-network",
  "permissions.warning.outside-link",
] as const;
export const grantWarningKeySchema = z.enum(GRANT_WARNING_KEYS);
export type GrantWarningKey = z.infer<typeof grantWarningKeySchema>;

const displayKindSchema = z.enum([
  "fs.read",
  "fs.write",
  "net.fetch",
  "net.listen",
  "secret.use",
  "document.save",
]);

// 현재 release가 선언한 요구 하나와 같은 정규 scope의 active grant가 있는지.
// outside_links는 파일 검사(부여 준비)가 채운다. read는 파일 I/O를 하지 않아 빈 목록이다.
export const grantRequirementDisplaySchema = z.object({
  kind: displayKindSchema,
  scope: permissionRequirementSchema.shape.scope,
  reason: z.string().min(1),
  granted: z.boolean(),
  warnings: z.array(grantWarningKeySchema),
  outside_links: z.array(z.string().min(1)),
});
export type GrantRequirementDisplay = z.infer<
  typeof grantRequirementDisplaySchema
>;

export const grantCombinationWarningSchema = z.object({
  key: grantWarningKeySchema,
  kinds: z.array(displayKindSchema).min(1),
});
export type GrantCombinationWarning = z.infer<
  typeof grantCombinationWarningSchema
>;

// grant 결정의 표시 자료. 요구·reason·정규 scope·조합 경고·
// Deno 한계 문구 key만 담고 grant를 자동으로 만들지 않는다.
export const grantDisplaySchema = z.object({
  app: appIdSchema,
  release: releaseIdSchema,
  requirements: z.array(grantRequirementDisplaySchema),
  combination_warnings: z.array(grantCombinationWarningSchema),
  limit_keys: z.array(z.string().min(1)),
});
export type GrantDisplay = z.infer<typeof grantDisplaySchema>;

// display는 app을 지정했고 그 앱의 현재 release 선언을 알 때만 있다. 그 밖에는 null이다.
// 필드를 모르는 옛 소비자는 무시하므로 additive다.
export const grantsListOutputSchema = withReadCommon(z.object({
  grants: z.array(grantSchema),
  grants_seq: seqSchema.optional(),
  display: grantDisplaySchema.nullable().optional(),
}));
export const grantsList = defineRead({
  resource: "grants",
  method: "list",
  name: "grants.list",
  input: grantsListInputSchema,
  output: grantsListOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export type GrantsList = typeof grantsList;

export const GRANT_ROUTES = [
  grantCreate,
  grantRevoke,
  automationGrantRevoke,
  grantsList,
] as const;

const grantSubject = grantIdSchema;

// payload의 scope 종류는 Grant kind와 같아야 한다(domain-model apps/permissions).
export const grantCreatedPayloadSchema = z.object({
  app: appIdSchema,
  kind: permissionKindSchema,
  scope: permissionScopeSchema,
  approval: approvalIdSchema,
  created_by: actorSchema,
  created_at: atSchema,
}).refine(
  (value) => value.kind === value.scope.kind,
  { message: "grant kind does not match scope kind" },
).refine(
  (value) => value.created_by === "user",
  { message: "grant creator is the approval's user" },
);

export const grantRevokedPayloadSchema = z.object({
  app: appIdSchema,
  kind: permissionKindSchema,
  revoked_by: actorSchema,
  revoked_at: atSchema,
}).refine(
  (value) => value.revoked_by === "user",
  { message: "revoked grant is revoked by a user" },
);

export const grantCreated = defineEvent("GrantCreated", {
  subject: grantSubject,
  payload: grantCreatedPayloadSchema,
});
export const grantRevoked = defineEvent("GrantRevoked", {
  subject: grantSubject,
  payload: grantRevokedPayloadSchema,
});

export const GRANT_EVENTS = [
  grantCreated,
  grantRevoked,
] as const;
