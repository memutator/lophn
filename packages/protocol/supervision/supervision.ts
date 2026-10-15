import { z } from "zod";
import {
  confirmationHandleRegisteredSchema,
  confirmationHandleRegisterSchema,
} from "../base/confirmation-handle.ts";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  BLOB_PREPARE_MAX_BYTES,
  blobPurposeDefinitionSchema,
  preparedBlobSchema,
} from "../storage/blob.ts";
import { credentialScopeSchema } from "../server/identity.ts";
import { idSchema } from "../base/ids.ts";
import {
  secretComparisonRequestSchema,
  secretComparisonResponseSchema,
  secretUseSchema,
} from "../secrets/secrets.ts";
import { atSchema, durationMsSchema, sha256Schema } from "../base/values.ts";
import { STREAM_CHUNK_MAX_BYTES } from "../base/frame.ts";

const nonblankSchema = z.string().regex(/\S/);

const opaque = z.string().min(1);
const uint = z.number().int().min(0).max(0xffffffff);
const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0);
const port = z.number().int().min(1).max(65535);
const streamChannel = uint.min(1);

// 알려진 기본 kind일 뿐 닫힌 registry가 아니다. 소유 팀이 자기 kind를 등록한다.
export const PROCESS_KINDS = [
  "platform/core",
  "platform/io",
  "problems/test-runner",
  "lophn-agent/runtime",
  "apps/supervisor",
] as const;
export const processKindSchema = z.string().regex(
  /^(platform|documents|apps|problems|lophn-agent|coding-agent)\/[a-z][a-z0-9-]*$/,
);
export type ProcessKind = z.infer<typeof processKindSchema>;

export const helloSchema = z.strictObject({
  type: z.literal("hello"),
  core_epoch: opaque,
  process_identity: opaque,
  kind: processKindSchema,
  task: opaque,
  scope: credentialScopeSchema,
  credential: opaque,
  api_port: port,
});
export const readySchema = z.strictObject({ type: z.literal("ready") });
export const stopSchema = z.strictObject({
  type: z.literal("stop"),
  grace_ms: durationMsSchema,
});
export const stoppedSchema = z.strictObject({ type: z.literal("stopped") });
export const streamCreditSchema = z.strictObject({
  type: z.literal("credit"),
  channel: streamChannel,
  window: count,
});
// 자식이 core에 blob 준비를 청하는 통로. 자식이 새 stream channel을
// 정해 json 요청을 보내고, core가 credit을 주면 그 channel의 bytes frame을 credit
// 안에서만 보내고, end(또는 abort)로 닫는다. core는 결과를 blob_prepare_result로 돌려준다.
// principal·expected_hash는 요청에 없다: principal은 core가 자식 kind에서 정하고 hash는
// I/O worker만 계산한다. size_bytes는 선언일 뿐이고 core가 실제 바이트 수와 대조한다.
export const BLOB_PREPARE_CREDIT_WINDOW = 2 * STREAM_CHUNK_MAX_BYTES;
export const blobPrepareRequestSchema = z.strictObject({
  type: z.literal("blob_prepare_request"),
  request_id: opaque,
  channel: streamChannel,
  purpose: blobPurposeDefinitionSchema.shape.purpose,
  size_bytes: z.number().int().min(0).max(BLOB_PREPARE_MAX_BYTES),
});
// 결과 오류는 안전한 고정 문구뿐이다(경로·내부 메시지·hash 원문 없음).
export const BLOB_PREPARE_ERROR_CODES = [
  "invalid_input",
  "forbidden",
  "unavailable",
  "internal",
] as const;
export const blobPrepareResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("blob_prepare_result"),
    request_id: opaque,
    ok: z.literal(true),
    prepared: preparedBlobSchema.strict(),
  }),
  z.strictObject({
    type: z.literal("blob_prepare_result"),
    request_id: opaque,
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(BLOB_PREPARE_ERROR_CODES),
      message: z.string().max(200),
    }),
  }),
]);
export type BlobPrepareRequest = z.infer<typeof blobPrepareRequestSchema>;
export type BlobPrepareResult = z.infer<typeof blobPrepareResultSchema>;

export const mainHelloSchema = z.strictObject({
  user_token: opaque,
  api_port: port,
  core_epoch: opaque,
});

// byte stream은 request의 channel에 묶는다. channel 0은 JSON 제어 전용이다.
// envelope 뒤 op별 입력/출력은 소유 contracts가 주는 schema로 다시 검사한다.
export const workerRequestEnvelopeSchema = z.strictObject({
  type: z.literal("worker_request"),
  request_id: opaque,
  op: opaque,
  channel: streamChannel.optional(),
  payload: z.unknown(),
});
const workerSuccessEnvelopeSchema = z.strictObject({
  type: z.literal("worker_response"),
  request_id: opaque,
  ok: z.literal(true),
  payload: z.unknown(),
});
const workerFailureEnvelopeSchema = z.strictObject({
  type: z.literal("worker_response"),
  request_id: opaque,
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export const workerResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  workerSuccessEnvelopeSchema,
  workerFailureEnvelopeSchema,
]);
export type WorkerRequest = z.infer<typeof workerRequestEnvelopeSchema>;
export type WorkerResponse = z.infer<typeof workerResponseEnvelopeSchema>;
export function workerRequestSchema<P extends z.ZodType>(payload: P) {
  return workerRequestEnvelopeSchema.extend({ payload });
}
export function workerResponseSchema<P extends z.ZodType>(payload: P) {
  return z.discriminatedUnion("ok", [
    workerSuccessEnvelopeSchema.extend({ payload }),
    workerFailureEnvelopeSchema,
  ]);
}
export const appCredentialRequestSchema = z.strictObject({
  type: z.literal("app_credential_request"),
  request_id: opaque,
  app: idSchema("app"),
  // 준비 전 bundle의 preview는 release가 없다. 가짜 release를 만들지 않는다.
  release: idSchema("rel").nullable(),
  process: opaque,
  mode: opaque,
  bundle_hash: sha256Schema.nullable().optional(),
  diagnostic_scope: nonblankSchema.nullable().optional(),
});
export const appCredentialResponseSchema = z.strictObject({
  type: z.literal("app_credential_response"),
  request_id: opaque,
  credential: opaque,
  credential_ref: opaque,
  expires_at: atSchema.optional(),
});

// agent runtime이 run마다 `agent:<asg>` credential을 core에 청하는 통로(lophn-agent/harness/run-loop).
// StartRun이 확정된 run에만 청하고 core의 인증 경계가 발급한다. platform은 scope.agent를 해석하지
// 않고 그대로 싣는다. operations는 발급 상한 안이어야 하고 넓히지 못한다.
export const agentCredentialRequestSchema = z.strictObject({
  type: z.literal("agent_credential_request"),
  request_id: opaque,
  run: idSchema("run"),
  assignment: idSchema("asg"),
  operations: z.array(opaque),
  scope: z.record(z.string(), z.unknown()),
});
export const agentCredentialResponseSchema = z.strictObject({
  type: z.literal("agent_credential_response"),
  request_id: opaque,
  credential: opaque,
  credential_ref: opaque,
});
// run 종료·멈춤·assignment 회수에 그 run의 credential을 끝낸다. 감독 상실은 core가 process 조건으로 끝낸다.
export const agentCredentialEndSchema = z.strictObject({
  type: z.literal("agent_credential_end"),
  run: idSchema("run"),
});
export type AgentCredentialRequest = z.infer<
  typeof agentCredentialRequestSchema
>;
export type AgentCredentialResponse = z.infer<
  typeof agentCredentialResponseSchema
>;

// agent runtime이 model로 보낼 글을 core의 안전화에 맡기는 통로(lophn-agent/harness/run-loop). 알려진 secret
// 값은 core의 보호 registry에만 있고 child로 가지 않는다. child가 글 조각(window)을 보내면 core가 같은
// 검출 규칙과 알려진 값으로 지울 자리(index·length, 조각 안의 UTF-16 위치)만 돌려준다. 요청 하나는 조각
// 128개·합 32,768 단위 이내이고 응답의 자리는 4,096개 이내다. core가 안전화를 끝낼 수 없으면 ok=false이고
// child는 그 글을 보내지 않는다(fail-closed).
export const REDACT_WINDOWS_MAX = 128;
export const REDACT_UNITS_MAX = 32_768;
export const REDACT_SPANS_MAX = 4_096;
export const redactRequestSchema = z.strictObject({
  type: z.literal("redact_request"),
  request_id: opaque,
  windows: z.array(z.string()).min(1).max(REDACT_WINDOWS_MAX).refine(
    (windows) =>
      windows.reduce((sum, window) => sum + window.length, 0) <=
        REDACT_UNITS_MAX,
    { message: "redact request is too large" },
  ),
});
const redactSpanSchema = z.strictObject({
  index: z.number().int().min(0),
  length: z.number().int().min(1),
});
export const redactResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("redact_response"),
    request_id: opaque,
    ok: z.literal(true),
    spans: z.array(z.array(redactSpanSchema)),
  }),
  z.strictObject({
    type: z.literal("redact_response"),
    request_id: opaque,
    ok: z.literal(false),
  }),
]);
export type RedactRequest = z.infer<typeof redactRequestSchema>;
export type RedactResponse = z.infer<typeof redactResponseSchema>;

// agent runtime의 provider 호출이 credential 값을 받는 통로다.
// 요청은 값 없이 secret 참조·판·용도·목적지와 보낼 요청의 url·method만 싣는다.
// core가 현재 참조·판·목적지와 대조하고 값을 읽을 수 있을 때만 `value`를 답한다. 값은 이 응답 하나로만
// child에 닿고 child의 인증 전송 callback 메모리에서만 쓰인다. 읽을 수 없거나 대조에 실패하면 값 없이
// 오류이고 child는 요청을 보내지 않는다(fail-closed).
export const SECRET_SEND_ERROR_CODES = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
export const secretSendRequestSchema = z.strictObject({
  type: z.literal("secret_send_request"),
  request_id: opaque,
  use: secretUseSchema,
  operation: opaque,
  url: opaque,
  method: opaque,
});
export const secretSendResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("secret_send_response"),
    request_id: opaque,
    ok: z.literal(true),
    value: opaque,
  }),
  z.strictObject({
    type: z.literal("secret_send_response"),
    request_id: opaque,
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(SECRET_SEND_ERROR_CODES),
      message: z.string().max(200),
    }),
  }),
]);
export type SecretSendRequest = z.infer<typeof secretSendRequestSchema>;
export type SecretSendResponse = z.infer<typeof secretSendResponseSchema>;

export const DIAGNOSTIC_KINDS = [
  "lophn_internal",
  "unattributed_observation",
  "invalid_report",
  "shell_view_lifetime",
  "app_invocation_delivery_loss",
  "app_log_line_loss",
] as const;
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];
export const diagnosticKindSchema = z.enum(DIAGNOSTIC_KINDS);
const diagnostic = <K extends DiagnosticKind, P extends z.ZodType>(
  kind: K,
  payload: P,
) =>
  z.strictObject({
    type: z.literal("diagnostic"),
    kind: z.literal(kind),
    payload,
  });
// domain model의 내부 exception과 저장소 실패만 분류한다. 원문 오류 이름은 받지 않는다.
export const INTERNAL_ERROR_CLASSES = [
  "internal_exception",
  "disk_full",
  "ledger_corruption",
] as const;
export const internalErrorClassSchema = z.enum(INTERNAL_ERROR_CLASSES);
export type InternalErrorClass = z.infer<typeof internalErrorClassSchema>;
const diagnosticObservation = {
  component: processKindSchema,
  observed_at: atSchema,
};
// location은 소유 팀이 등록한 ID다. 경로·stack·자유 text를 보내지 않는다.
// 실제 등록 여부는 수신자의 registry에서 검사한다.
const locationId = opaque.regex(/^[a-z][a-z0-9._-]*$/);
export const diagnosticSchema = z.discriminatedUnion("kind", [
  diagnostic(
    "lophn_internal",
    z.strictObject({
      ...diagnosticObservation,
      error_class: internalErrorClassSchema,
      location: locationId,
      count,
    }),
  ),
  diagnostic(
    "unattributed_observation",
    z.strictObject({ ...diagnosticObservation, count }),
  ),
  diagnostic(
    "invalid_report",
    z.strictObject({
      ...diagnosticObservation,
      report: idSchema("rpt"),
      count,
    }),
  ),
  diagnostic(
    "shell_view_lifetime",
    z.strictObject({
      ...diagnosticObservation,
      view_id: opaque,
      generation: count,
      created: count,
      hidden: count,
      replaced: count,
      disposed: count,
      attached: count,
    }),
  ),
  diagnostic(
    "app_invocation_delivery_loss",
    z.strictObject({
      ...diagnosticObservation,
      app: idSchema("app"),
      lost_messages: count,
      lost_bytes: count,
      first_lost_at: atSchema,
      reason: z.enum(["memory_limit", "non_retryable_error"]),
    }),
  ),
  diagnostic(
    "app_log_line_loss",
    z.strictObject({
      ...diagnosticObservation,
      app: idSchema("app"),
      invocation: idSchema("inv").optional(),
      dropped_lines: count,
      reason: z.enum(["buffer_limit", "unsafe_truncation"]),
    }),
  ),
]);
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const parentMessageSchema = z.union([
  helloSchema,
  stopSchema,
  streamCreditSchema,
  workerRequestEnvelopeSchema,
  appCredentialResponseSchema,
  agentCredentialResponseSchema,
  redactResponseSchema,
  secretSendResponseSchema,
  blobPrepareResultSchema,
]);
export const childMessageSchema = z.union([
  readySchema,
  stoppedSchema,
  streamCreditSchema,
  workerResponseEnvelopeSchema,
  diagnosticSchema,
  appCredentialRequestSchema,
  agentCredentialRequestSchema,
  agentCredentialEndSchema,
  redactRequestSchema,
  secretSendRequestSchema,
  blobPrepareRequestSchema,
]);
// 사람 결정 handle 등록과 secret 비교 read는 main↔core 비공개 연결로만 오간다.
// 비교 op는 이 연결에서 main 신원을 인증하며
// renderer HTTP token과 worker context를 신뢰하지 않는다.
export const mainToCoreMessageSchema = z.union([
  diagnosticSchema,
  stopSchema,
  confirmationHandleRegisterSchema,
  secretComparisonRequestSchema,
]);
// migration 앞에서 시작하지 못할 때 알린다. 문장과 경로는 싣지 않는다.
export const START_FAILURE_REASONS = [
  "newer_schema",
  "history_mismatch",
  "damaged_original",
  "other",
] as const;
export const startFailedSchema = z.strictObject({
  type: z.literal("start_failed"),
  reason: z.enum(START_FAILURE_REASONS),
});
export const coreToMainMessageSchema = z.union([
  mainHelloSchema,
  readySchema,
  startFailedSchema,
  confirmationHandleRegisteredSchema,
  secretComparisonResponseSchema,
]);
export type MainToCoreMessage = z.infer<typeof mainToCoreMessageSchema>;
export type CoreToMainMessage = z.infer<typeof coreToMainMessageSchema>;
export type ParentMessage = z.infer<typeof parentMessageSchema>;
export type ChildMessage = z.infer<typeof childMessageSchema>;
export type MainHello = z.infer<typeof mainHelloSchema>;

export const MEMORY_LIMIT_MODES = ["hard", "soft", "unavailable"] as const;
export const memoryLimitModeSchema = z.enum(MEMORY_LIMIT_MODES);
export type MemoryLimitMode = (typeof MEMORY_LIMIT_MODES)[number];
export const kindLaunchSpecSchema = z.strictObject({
  kind: processKindSchema,
  entry: opaque.refine((value) => !value.includes("*")),
  allow_read: z.array(opaque.refine((value) => value !== "*")),
  allow_write: z.array(opaque.refine((value) => value !== "*")),
  allow_net: z.array(opaque.refine((value) => value !== "*")),
  allow_run: z.array(opaque.refine((value) => !value.includes("*"))),
  // sys의 항목은 이름 하나다(예: statfs). 와일드카드는 받지 않는다.
  allow_sys: z.array(opaque.refine((value) => !value.includes("*"))),
  allow_env: z.array(opaque.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)),
  // agent runtime의 web.fetch가 아무 host로 나갈 수 있게 한다.
  net_any: z.boolean().optional(),
  policy: z.enum(["always", "on_request"]),
  memory_limit_bytes: count.refine((n) => n > 0),
});
export type KindLaunchSpec = z.infer<typeof kindLaunchSpecSchema>;
export const runMetadataSchema = z.strictObject({
  format: z.literal(1),
  api_port: port,
  core_epoch: opaque,
  started_at: atSchema,
});
export type RunMetadata = z.infer<typeof runMetadataSchema>;
