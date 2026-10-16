import { z } from "zod";
import { actorSchema } from "../../base/actor.ts";
import { idSchema } from "../../base/ids.ts";
import { atSchema, sha256Schema } from "../../base/values.ts";
import { defineCommand, defineRead } from "../../base/route.ts";
import { idempotencyKeySchema, withReadCommon } from "../../base/envelope.ts";
import { preparedBlobSchema } from "../../storage/blob.ts";
import {
  appApiKeySchema,
  appIdSchema,
  approvalIdSchema,
  invocationIdSchema,
  releaseIdSchema,
} from "../channel-values.ts";
import { readyAttestationSchema } from "../runtime.ts";
import {
  dataChangeSchema,
  releasesGetInputSchema,
  releasesListInputSchema,
  releaseStatusValueSchema,
  ticketSourceSchema,
} from "../releases.ts";
import { lossStepSchema } from "./migration.ts";

const MAX = Number.MAX_SAFE_INTEGER;

// 시도 id. event seq가 아니라 독립 id다.
// ReleaseActivationFailed event는 attempt를 싣지 않고 { app, ticket, failure: { code, summary } }를 싣는다.
export const activationAttemptIdSchema = idSchema("act");
export type ActivationAttemptId = z.infer<typeof activationAttemptIdSchema>;

export const ACTIVATION_FAILURE_CODES = [
  "drain_failed",
  "termination_unconfirmed",
  "schema_changed",
  "backup_failed",
  "migration_failed",
  "start_failed",
  "commit_rejected",
  "restore_failed",
] as const;
export const activationFailureCodeSchema = z.enum(ACTIVATION_FAILURE_CODES);

// restored는 이전 release가 다시 도는지(이전이 없으면 null). event payload의 failure는 code, summary만 싣는다.
export const activationFailureSchema = z.object({
  code: activationFailureCodeSchema,
  summary: z.string().regex(/\S/),
  restored: z.boolean().nullable(),
});
export type ActivationFailure = z.infer<typeof activationFailureSchema>;

// 마지막 시도의 기록. 시작·확정 때 CAS를 다시 하지 않으므로 approval과 expected_*는 없다.
export const activationAttemptSchema = z.object({
  attempt: activationAttemptIdSchema,
  previous_release: releaseIdSchema.nullable(),
  backup_hash: sha256Schema.nullable(),
  data_change_invocation: invocationIdSchema.nullable(),
  started_at: atSchema,
});
export type ActivationAttempt = z.infer<typeof activationAttemptSchema>;

export const releaseRecordSchema = z.object({
  id: releaseIdSchema,
  app: appIdSchema,
  number: z.number().int().positive().max(MAX),
  code_commit: z.string().regex(/^[0-9a-f]{40}$/),
  bundle_hash: sha256Schema,
  blueprint_hash: sha256Schema,
  data_schema: z.number().int().nonnegative().max(MAX),
  data_changes: z.array(dataChangeSchema),
  tests: z.array(idSchema("vrf")).min(1)
    .refine(
      (tests) => new Set(tests).size === tests.length,
      { message: "release test reference is duplicated" },
    ),
  ticket_source: ticketSourceSchema,
  created_by: actorSchema,
  created_at: atSchema,
  status: releaseStatusValueSchema,
  activation: activationAttemptSchema.nullable(),
  // active, superseded이면 값이 있다. problem 재발 판정이 쓴다.
  activated_at: atSchema.nullable(),
  failure: activationFailureSchema.nullable(),
}).refine(
  (value) =>
    value.status === "activating" || value.status === "failed"
      ? value.activation !== null
      : true,
  { message: "activating and failed need an activation" },
).refine(
  (value) => value.status === "failed" ? value.failure !== null : true,
  { message: "failed release needs a failure" },
).refine(
  (value) =>
    value.status === "active" || value.status === "superseded"
      ? value.activated_at !== null
      : true,
  { message: "active and superseded need activated_at" },
);
export type ReleaseRecord = z.infer<typeof releaseRecordSchema>;

// 선언 비교. 카드에는 이 넷만 보인다.
// 묻는 규칙: grant 덮음으로 정한다. 새 release의 선언 가운데 지금 active grant가 덮지 않는 항목이
// 있으면 묻는다. 이전 release와 선언을 따로 비교하지 않는다.
// first이거나 added_resources, added_app_apis, loss_steps 가운데 하나라도 비어 있지 않으면 묻는다.
export const addedAppApiSchema = z.object({
  app: appIdSchema,
  api: appApiKeySchema,
});
export type AddedAppApi = z.infer<typeof addedAppApiSchema>;

export const activationComparisonSchema = z.object({
  previous_release: releaseIdSchema.nullable(),
  // 이전 활성 release가 없다. 선언이 없어도 묻는다.
  first: z.boolean(),
  // 선언한 바깥 자원(network host, secret, 파일) 가운데 active grant가 덮지 않는 것. 이름은 permissionLabel 규칙을 따른다.
  added_resources: z.array(z.string().min(1)),
  // 선언한 다른 앱의 app-api 가운데 active grant가 덮지 않는 것.
  added_app_apis: z.array(addedAppApiSchema),
  // 이번 activation이 지나는 migration 단계 가운데 loss가 비지 않은 것.
  loss_steps: z.array(z.object({
    from: z.number().int().nonnegative().max(MAX),
    to: z.number().int().nonnegative().max(MAX),
    loss: z.array(lossStepSchema),
  })),
});
export type ActivationComparison = z.infer<typeof activationComparisonSchema>;

// 줄은 메모리다. 끝난 것은 release의 status(active, failed)로 본다.
export const ACTIVATION_PHASES = [
  "waiting_approval",
  "queued",
  "running",
] as const;
export const activationPhaseSchema = z.enum(ACTIVATION_PHASES);
export type ActivationPhase = z.infer<typeof activationPhaseSchema>;

// running일 때 지금 하는 단계다: 새 호출 멈춤, 도는 호출 기다림, 이전 process 종료, migration, 시작 확인.
export const ACTIVATION_STEPS = [
  "hold",
  "drain",
  "stop",
  "migrate",
  "start",
] as const;
export const activationStepSchema = z.enum(ACTIVATION_STEPS);
export type ActivationStep = z.infer<typeof activationStepSchema>;

export const activationQueueEntrySchema = z.object({
  app: appIdSchema,
  release: releaseIdSchema,
  phase: activationPhaseSchema,
  approval: approvalIdSchema.nullable(),
  // running이 아니면 null이다.
  step: activationStepSchema.nullable(),
  // 새 호출 접수를 닫은 동안 붙잡은 호출 수.
  held_calls: z.number().int().nonnegative().max(MAX),
  // 적용할 migration 단계 수. 모르면 0이다.
  migration_steps: z.number().int().nonnegative().max(MAX),
});
export type ActivationQueueEntry = z.infer<typeof activationQueueEntrySchema>;

// 앱 전용 프로세스의 결과. 시도·실제 schema·무결성을 core가 검증한다.
export const activationDataResultSchema = z.object({
  release: releaseIdSchema,
  attempt: activationAttemptIdSchema,
  invocation: invocationIdSchema.nullable(),
  data_schema: z.number().int().nonnegative().max(MAX),
  integrity_ok: z.boolean(),
});
export type ActivationDataResult = z.infer<typeof activationDataResultSchema>;

const machine = ["machine"] as const;
const accepted = z.object({ accepted: z.literal(true) });

// activation handler가 앱의 차례가 되면 부른다. prepared인 release만 받고 아니면 conflict.
export const activationStart = defineCommand({
  resource: "activations",
  method: "start",
  name: "activation.start",
  input: z.strictObject({
    release: releaseIdSchema,
    key: idempotencyKeySchema,
  }),
  output: z.object({
    attempt: activationAttemptIdSchema,
    previous_release: releaseIdSchema.nullable(),
  }),
  actors: machine,
  errors: ["forbidden", "conflict", "invalid_input"],
});

export const activationRecordBackup = defineCommand({
  resource: "activations",
  method: "record_backup",
  name: "activation.record_backup",
  input: z.strictObject({
    release: releaseIdSchema,
    attempt: activationAttemptIdSchema,
    backup_hash: sha256Schema,
    // backup byte를 준비한 보호 blob이다. hash가 backup_hash와 같아야 한다.
    blob: preparedBlobSchema,
    data_schema: z.number().int().nonnegative().max(MAX),
  }),
  output: accepted,
  actors: machine,
  errors: ["conflict", "invalid_input", "unavailable"],
});

// 성공 제출은 integrity_ok true만 받는다.
export const activationRecordDataChange = defineCommand({
  resource: "activations",
  method: "record_data_change",
  name: "activation.record_data_change",
  input: z.strictObject({ result: activationDataResultSchema }),
  output: accepted,
  actors: machine,
  errors: ["conflict", "invalid_input", "unavailable"],
});

export const activationRecordDataRestore = defineCommand({
  resource: "activations",
  method: "record_data_restore",
  name: "activation.record_data_restore",
  input: z.strictObject({
    result: activationDataResultSchema,
    backup_hash: sha256Schema,
  }),
  output: accepted,
  actors: machine,
  errors: ["conflict", "invalid_input", "unavailable"],
});

// 새 active 참조와 이전 superseded를 같은 transaction으로 확정한다.
export const activationComplete = defineCommand({
  resource: "activations",
  method: "complete",
  name: "activation.complete",
  input: z.strictObject({
    release: releaseIdSchema,
    attempt: activationAttemptIdSchema,
    result: activationDataResultSchema,
    attestation: readyAttestationSchema,
  }),
  output: z.object({
    status: z.literal("active"),
    previous_release: releaseIdSchema.nullable(),
  }),
  actors: machine,
  errors: ["conflict", "unavailable"],
});

export const activationFail = defineCommand({
  resource: "activations",
  method: "fail",
  name: "activation.fail",
  input: z.strictObject({
    release: releaseIdSchema,
    attempt: activationAttemptIdSchema,
    failure: activationFailureSchema,
    invocation: invocationIdSchema.nullable().optional(),
  }),
  output: z.object({ status: z.literal("failed") }),
  actors: machine,
  errors: ["conflict", "invalid_input"],
});

// 사람만 한다. 지금 data schema와 같은 superseded release만 받고 아니면 invalid_input. migration이 없다.
export const activationActivatePrevious = defineCommand({
  resource: "activations",
  method: "activate_previous",
  name: "activation.activate_previous",
  input: z.strictObject({
    release: releaseIdSchema,
    key: idempotencyKeySchema,
  }),
  output: z.object({ phase: z.enum(["queued", "running"]) }),
  actors: ["user"],
  errors: ["forbidden", "conflict", "invalid_input"],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const activationsQueue = defineRead({
  resource: "activations",
  method: "queue",
  name: "activations.queue",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: withReadCommon(z.object({
    entries: z.array(activationQueueEntrySchema),
  })),
  actors: ["user", "agent", "coding_agent", "machine"],
  errors: readErrors,
});

// 지금 활성 release와 견준다.
export const activationsCompare = defineRead({
  resource: "activations",
  method: "compare",
  name: "activations.compare",
  input: z.strictObject({ release: releaseIdSchema }),
  output: withReadCommon(z.object({ comparison: activationComparisonSchema })),
  actors: readActors,
  errors: readErrors,
});

export const releasesListRecords = defineRead({
  resource: "releases",
  method: "list_records",
  name: "releases.list_records",
  input: releasesListInputSchema,
  output: withReadCommon(z.object({ releases: z.array(releaseRecordSchema) })),
  actors: readActors,
  errors: readErrors,
});

export const releasesGetRecord = defineRead({
  resource: "releases",
  method: "get_record",
  name: "releases.get_record",
  input: releasesGetInputSchema,
  output: withReadCommon(z.object({ release: releaseRecordSchema.nullable() })),
  actors: readActors,
  errors: readErrors,
});

export const ACTIVATION_ROUTES = [
  activationStart,
  activationRecordBackup,
  activationRecordDataChange,
  activationRecordDataRestore,
  activationComplete,
  activationFail,
  activationActivatePrevious,
  activationsQueue,
  activationsCompare,
  releasesListRecords,
  releasesGetRecord,
] as const;
