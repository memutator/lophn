import { z } from "zod";
import {
  confirmationHandleRegisteredSchema,
  confirmationHandleRegisterSchema,
} from "./confirmation-handle.ts";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  BLOB_PREPARE_MAX_BYTES,
  blobPurposeDefinitionSchema,
  preparedBlobSchema,
} from "./blob.ts";
import { credentialScopeSchema } from "./identity.ts";
import { idSchema } from "./ids.ts";
import {
  secretComparisonRequestSchema,
  secretComparisonResponseSchema,
} from "./secrets.ts";
import { atSchema, durationMsSchema, sha256Schema } from "./values.ts";

const nonblankSchema = z.string().regex(/\S/);

export const FRAME_KINDS = { json: 1, bytes: 2, end: 3, abort: 4 } as const;
export const STREAM_CHUNK_MAX_BYTES = 1024 * 1024;
export const CONTROL_MAX_BYTES = 256 * 1024;
export type Frame =
  | { kind: "json"; channel: 0; payload: unknown }
  | { kind: "bytes"; channel: number; payload: Uint8Array }
  | { kind: "end" | "abort"; channel: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function validateHeader(length: number, kind: number, channel: number) {
  if (length < 5 || length > STREAM_CHUNK_MAX_BYTES + 5) {
    throw new Error("invalid frame length");
  }
  if (!Number.isInteger(kind) || kind < 1 || kind > 4) {
    throw new Error("unknown frame kind");
  }
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffffffff) {
    throw new Error("invalid frame channel");
  }
  if ((kind === 1) !== (channel === 0)) {
    throw new Error(
      "control requires channel 0; stream requires nonzero channel",
    );
  }
  if (kind === 1 && length > CONTROL_MAX_BYTES + 5) {
    throw new Error("control frame exceeds limit");
  }
  if (kind >= 3 && length !== 5) throw new Error("terminal frame has payload");
}

// 길이는 prefix 자체를 제외한 kind(1) + channel(4) + payload의 bytes다.
export function encodeFrame(frame: Frame): Uint8Array {
  const kind = FRAME_KINDS[frame.kind];
  const payload = frame.kind === "json"
    ? encoder.encode(JSON.stringify(frame.payload))
    : frame.kind === "bytes"
    ? frame.payload
    : new Uint8Array();
  validateHeader(5 + payload.length, kind, frame.channel);
  if (frame.kind === "json") JSON.parse(decoder.decode(payload));
  const bytes = new Uint8Array(9 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 5 + payload.length, false);
  view.setUint8(4, kind);
  view.setUint32(5, frame.channel, false);
  bytes.set(payload, 9);
  return bytes;
}

// header를 먼저 검사해서 공격자가 보낸 길이만큼 무제한 할당하지 않는다.
export class FrameDecoder {
  private header = new Uint8Array(9);
  private headerUsed = 0;
  private payload: Uint8Array | undefined;
  private payloadUsed = 0;
  private failed = false;

  push(bytes: Uint8Array): Frame[] {
    if (this.failed) throw new Error("frame decoder has failed");
    const frames: Frame[] = [];
    let offset = 0;
    try {
      while (offset < bytes.length) {
        if (!this.payload) {
          const count = Math.min(9 - this.headerUsed, bytes.length - offset);
          this.header.set(
            bytes.subarray(offset, offset + count),
            this.headerUsed,
          );
          this.headerUsed += count;
          offset += count;
          if (this.headerUsed >= 4) {
            const length = new DataView(this.header.buffer).getUint32(0, false);
            if (length < 5 || length > STREAM_CHUNK_MAX_BYTES + 5) {
              throw new Error("invalid frame length");
            }
          }
          if (this.headerUsed < 9) continue;
          const view = new DataView(this.header.buffer);
          const length = view.getUint32(0, false);
          validateHeader(length, view.getUint8(4), view.getUint32(5, false));
          this.payload = new Uint8Array(length - 5);
        }
        const count = Math.min(
          this.payload.length - this.payloadUsed,
          bytes.length - offset,
        );
        this.payload.set(
          bytes.subarray(offset, offset + count),
          this.payloadUsed,
        );
        this.payloadUsed += count;
        offset += count;
        if (this.payloadUsed !== this.payload.length) continue;
        const view = new DataView(this.header.buffer);
        const channel = view.getUint32(5, false);
        const kind = view.getUint8(4);
        if (kind === 1) {
          frames.push({
            kind: "json",
            channel: 0,
            payload: JSON.parse(decoder.decode(this.payload)),
          });
        } else if (kind === 2) {
          frames.push({ kind: "bytes", channel, payload: this.payload });
        } else {
          frames.push({ kind: kind === 3 ? "end" : "abort", channel });
        }
        this.headerUsed = 0;
        this.payload = undefined;
        this.payloadUsed = 0;
      }
      return frames;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  finish(): void {
    if (this.failed || this.headerUsed !== 0) {
      throw new Error("incomplete frame stream");
    }
  }
}

const opaque = z.string().min(1);
const uint = z.number().int().min(0).max(0xffffffff);
const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0);
const port = z.number().int().min(1).max(65535);
const streamChannel = uint.min(1);

// 알려진 기본 kind일 뿐 닫힌 registry가 아니다. 소유 팀이 자기 kind를 등록한다.
export const PROCESS_KINDS = [
  "platform/core",
  "platform/io",
  "documents/worker",
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
// 자식이 core에 blob 준비를 청하는 통로(platform Q6). 자식이 새 stream channel을
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
  release: idSchema("rel"),
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
  blobPrepareResultSchema,
]);
export const childMessageSchema = z.union([
  readySchema,
  stoppedSchema,
  streamCreditSchema,
  workerResponseEnvelopeSchema,
  diagnosticSchema,
  appCredentialRequestSchema,
  blobPrepareRequestSchema,
]);
// 사람 결정 handle 등록과 secret 비교 read는 main↔core 비공개 연결로만 오간다
// (architecture/platform 5.6). 비교 op는 이 연결에서 main 신원을 인증하며
// renderer HTTP token과 worker context를 신뢰하지 않는다.
export const mainToCoreMessageSchema = z.union([
  diagnosticSchema,
  stopSchema,
  confirmationHandleRegisterSchema,
  secretComparisonRequestSchema,
]);
export const coreToMainMessageSchema = z.union([
  mainHelloSchema,
  readySchema,
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
