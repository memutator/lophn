import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { idempotencyKeySchema, withReadCommon } from "../base/envelope.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import {
  confirmExecutionProofSchema,
  invocationCallerSchema,
  signedConfirmProofSchema,
} from "./channel.ts";
import {
  appIdSchema,
  approvalIdSchema,
  commandKeySchema,
  invocationIdSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "./channel-values.ts";

const KIB = 1024;

// redaction 뒤 UTF-8 상한.
export const INVOCATION_SUMMARY_MAX_BYTES = 16 * KIB;
// 후행 기록 전달 목록 한도. 두 값 중 먼저 닿는 쪽이 한도다.
export const INVOCATION_DELIVERY_MAX_MESSAGES = 4096;
export const INVOCATION_DELIVERY_MAX_BYTES = 8 * 1024 * KIB;
// unavailable만 다시 보내는 backoff 단계와 상한(ms).
export const INVOCATION_DELIVERY_BACKOFF_MS = [1000, 2000, 4000] as const;
export const INVOCATION_DELIVERY_BACKOFF_MAX_MS = 30_000;

export const INVOCATION_STATUSES = [
  "accepted",
  "running",
  "succeeded",
  "failed",
  "denied",
  "unknown",
] as const;
export const invocationStatusValueSchema = z.enum(INVOCATION_STATUSES);
export type InvocationStatus = z.infer<typeof invocationStatusValueSchema>;

// record_finished가 확정하는 상태다. denied는 record_denied가 남긴다.
export const INVOCATION_FINISH_STATUSES = [
  "succeeded",
  "failed",
  "unknown",
] as const;

// summary는 redaction 뒤의 작은 JSON object다. 입출력 본문·credential 원문이 아니다.
export const invocationSummarySchema = jsonObjectSchema.refine(
  (value) =>
    new TextEncoder().encode(JSON.stringify(value)).length <=
      INVOCATION_SUMMARY_MAX_BYTES,
  { message: "invocation summary exceeds 16384 UTF-8 bytes" },
);

function operationTriggerSchemas(strict: boolean) {
  const object = strict ? z.strictObject : z.object;
  const operation = z.discriminatedUnion("kind", [
    object({ kind: z.literal("command"), command: commandKeySchema }),
    object({ kind: z.literal("start") }),
    object({
      kind: z.literal("data_change"),
      from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      to: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }).refine((value) => value.to > value.from, {
      message: "data_change to is not after from",
    }),
  ]);
  const trigger = z.discriminatedUnion("kind", [
    object({ kind: z.literal("direct") }),
    object({ kind: z.literal("automation"), key: commandKeySchema }),
    object({
      kind: z.literal("activation"),
      activation_seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }),
    object({ kind: z.literal("restart") }),
  ]);
  return { operation, trigger };
}

const shapes = operationTriggerSchemas(false);
const inputShapes = operationTriggerSchemas(true);

export const invocationOperationSchema = shapes.operation;
export const invocationOperationInputSchema = inputShapes.operation;
export type InvocationOperation = z.infer<typeof invocationOperationSchema>;

export const invocationTriggerSchema = shapes.trigger;
export const invocationTriggerInputSchema = inputShapes.trigger;
export type InvocationTrigger = z.infer<typeof invocationTriggerSchema>;

function invocationSchemas(strict: boolean) {
  const fields = {
    id: invocationIdSchema,
    app: appIdSchema,
    release: releaseIdSchema,
    operation: strict
      ? invocationOperationInputSchema
      : invocationOperationSchema,
    trigger: strict ? invocationTriggerInputSchema : invocationTriggerSchema,
    mode: runtimeModeSchema,
    actor: actorSchema,
    caller: invocationCallerSchema,
    approval: approvalIdSchema.nullable(),
    input_hash: sha256Schema.nullable(),
    status: invocationStatusValueSchema,
    started_at: atSchema.nullable(),
    finished_at: atSchema.nullable(),
    summary: invocationSummarySchema,
    detail_hash: sha256Schema.nullable(),
  };
  // accepted·denied는 실제 시작이 없으므로 started_at이 없다.
  const noStart = (value: { status: InvocationStatus }) =>
    value.status === "accepted" || value.status === "denied";
  // 종료 상태는 확정 시각이 필수다. unknown은 미확인 판정 시각이다.
  const finished = (value: { status: InvocationStatus }) =>
    value.status === "succeeded" || value.status === "failed" ||
    value.status === "denied" || value.status === "unknown";
  return z.object(fields).refine(
    (value) => noStart(value) ? value.started_at === null : true,
    { message: "accepted and denied have no started_at" },
  ).refine(
    (value) => finished(value) === (value.finished_at !== null),
    { message: "finished status needs finished_at" },
  ).refine(
    (value) =>
      value.started_at === null || value.finished_at === null ||
      value.started_at <= value.finished_at,
    { message: "started_at is after finished_at" },
  );
}

export const invocationSchema = invocationSchemas(false);
export const invocationInputSchema = invocationSchemas(true);
export type Invocation = z.infer<typeof invocationSchema>;

const startedFactFields = {
  app: appIdSchema,
  release: releaseIdSchema,
  mode: runtimeModeSchema,
  actor: actorSchema,
  caller: invocationCallerSchema,
  operation: invocationOperationInputSchema,
  trigger: invocationTriggerInputSchema,
  started_at: atSchema,
};

// record_started 입력. 검증된 inv·사실만 받는다
// (domain-model apps/invocations command 표).
export const invocationRecordStartedInputSchema = z.strictObject({
  invocation: invocationIdSchema,
  ...startedFactFields,
});
export type InvocationRecordStartedInput = z.infer<
  typeof invocationRecordStartedInputSchema
>;

const finishedFactFields = {
  status: z.enum(INVOCATION_FINISH_STATUSES),
  started_at: atSchema.nullable(),
  finished_at: atSchema,
  summary: invocationSummarySchema,
  detail_hash: sha256Schema.nullable(),
};

// record_finished 입력. 종료 상태는 succeeded/failed/unknown이다.
// unknown도 같은 사실 재전송이므로 started_at 모양은 그대로다.
export const invocationRecordFinishedInputSchema = z.strictObject({
  invocation: invocationIdSchema,
  ...finishedFactFields,
});
export type InvocationRecordFinishedInput = z.infer<
  typeof invocationRecordFinishedInputSchema
>;

// record_denied 입력. handler를 부르기 전 거절이라 시작이 없다.
export const invocationRecordDeniedInputSchema = z.strictObject({
  invocation: invocationIdSchema,
  app: appIdSchema,
  release: releaseIdSchema,
  actor: actorSchema,
  caller: invocationCallerSchema,
  operation: invocationOperationInputSchema,
  trigger: invocationTriggerInputSchema,
  finished_at: atSchema,
  summary: invocationSummarySchema,
});
export type InvocationRecordDeniedInput = z.infer<
  typeof invocationRecordDeniedInputSchema
>;

// confirm 접수. 승인 사용과 accepted를 원자적으로 저장한다(domain-model command 표).
export const invocationAcceptConfirmInputSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema,
  command: commandKeySchema,
  input_hash: sha256Schema,
  approval: approvalIdSchema,
  key: idempotencyKeySchema,
  process_nonce: processNonceSchema,
  caller: invocationCallerSchema,
});
export type InvocationAcceptConfirmInput = z.infer<
  typeof invocationAcceptConfirmInputSchema
>;

// 출력은 inv ID와 proof다.
export const invocationAcceptConfirmOutputSchema = z.object({
  invocation: invocationIdSchema,
  proof: confirmExecutionProofSchema,
});
export type InvocationAcceptConfirmOutput = z.infer<
  typeof invocationAcceptConfirmOutputSchema
>;

const recordActors = ["machine"] as const;

export const invocationAcceptConfirm = defineCommand({
  resource: "invocations",
  method: "accept_confirm",
  name: "invocation.accept_confirm",
  input: invocationAcceptConfirmInputSchema,
  output: invocationAcceptConfirmOutputSchema,
  actors: recordActors,
  errors: ["forbidden", "conflict", "invalid_input", "unavailable"],
});

// agent caller가 이미 접수된 confirm을 앱에 보낼 때 붙이는 서명 proof.
// 입력은 접수 입력 그대로이고, 출력 proof는 core 서명이다. 이 route는 접수나 approval 사용을 만들지 않는다.
export const appAgentConfirmProof = defineMemory({
  resource: "apps",
  method: "agent_confirm_proof",
  name: "app.agent_confirm_proof",
  input: invocationAcceptConfirmInputSchema,
  output: z.object({
    invocation: invocationIdSchema,
    proof: signedConfirmProofSchema,
  }),
  actors: ["machine"],
  errors: [
    "forbidden",
    "not_found",
    "conflict",
    "invalid_input",
    "unavailable",
  ],
});
export const invocationRecordStarted = defineCommand({
  resource: "invocations",
  method: "record_started",
  name: "invocation.record_started",
  input: invocationRecordStartedInputSchema,
  output: z.object({ accepted: z.literal(true) }),
  actors: recordActors,
  errors: ["conflict", "unauthorized", "invalid_input"],
});
export const invocationRecordFinished = defineCommand({
  resource: "invocations",
  method: "record_finished",
  name: "invocation.record_finished",
  input: invocationRecordFinishedInputSchema,
  output: z.object({ accepted: z.literal(true) }),
  actors: recordActors,
  errors: ["conflict", "unauthorized", "invalid_input"],
});
export const invocationRecordDenied = defineCommand({
  resource: "invocations",
  method: "record_denied",
  name: "invocation.record_denied",
  input: invocationRecordDeniedInputSchema,
  output: z.object({ accepted: z.literal(true) }),
  actors: recordActors,
  errors: ["conflict", "unauthorized", "invalid_input"],
});

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const INVOCATION_LIST_MAX_COUNT = 200;

// 알려진 invocation 목록. 기록 없음은 행이 없다.
export const invocationsListInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  status: invocationStatusValueSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(INVOCATION_LIST_MAX_COUNT).optional(),
});
export const invocationsListOutputSchema = withReadCommon(z.object({
  invocations: z.array(invocationSchema),
}));
export const invocationsList = defineRead({
  resource: "invocations",
  method: "list",
  name: "invocations.list",
  input: invocationsListInputSchema,
  output: invocationsListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const invocationsGetInputSchema = z.strictObject({
  invocation: invocationIdSchema,
});
export const invocationsGetOutputSchema = withReadCommon(z.object({
  invocation: invocationSchema.nullable(),
}));
export const invocationsGet = defineRead({
  resource: "invocations",
  method: "get",
  name: "invocations.get",
  input: invocationsGetInputSchema,
  output: invocationsGetOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const INVOCATION_ROUTES = [
  invocationAcceptConfirm,
  invocationRecordStarted,
  invocationRecordFinished,
  invocationRecordDenied,
  invocationsList,
  invocationsGet,
] as const;

const invocationSubject = invocationIdSchema;
