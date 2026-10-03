import { z } from "zod";
import { credentialScopeSchema } from "./identity.ts";
import { idSchema } from "./ids.ts";
import { atSchema, durationMsSchema } from "./values.ts";

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

export const PROCESS_KINDS = [
  "core",
  "platform_io",
  "documents",
  "test_runner",
  "agent_runtime",
  "apps_supervisor",
] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];
export const processKindSchema = z.enum(PROCESS_KINDS);

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
export const mainHelloSchema = z.strictObject({
  user_token: opaque,
  api_port: port,
  core_epoch: opaque,
});

// op별 입력/출력은 소유 contracts가 주는 schema로 고정한다.
export function workerRequestSchema<P extends z.ZodType>(payload: P) {
  return z.strictObject({
    type: z.literal("worker_request"),
    request_id: opaque,
    op: opaque,
    payload,
  });
}
export function workerResponseSchema<P extends z.ZodType>(payload: P) {
  return z.strictObject({
    type: z.literal("worker_response"),
    request_id: opaque,
    op: opaque,
    payload,
  });
}
export const appCredentialRequestSchema = z.strictObject({
  type: z.literal("app_credential_request"),
  request_id: opaque,
  app: idSchema("app"),
  release: idSchema("rel"),
  process: opaque,
  mode: opaque,
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
// 자유 text는 넣지 않는다. 안전한 계수·등록 ID만 diagnostic 경계를 지난다.
export const diagnosticSchema = z.discriminatedUnion("kind", [
  diagnostic("lophn_internal", z.strictObject({ count })),
  diagnostic("unattributed_observation", z.strictObject({ count })),
  diagnostic(
    "invalid_report",
    z.strictObject({ report: idSchema("rpt"), count }),
  ),
  diagnostic(
    "shell_view_lifetime",
    z.strictObject({
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
  appCredentialResponseSchema,
]);
export const childMessageSchema = z.union([
  readySchema,
  stoppedSchema,
  streamCreditSchema,
  diagnosticSchema,
  appCredentialRequestSchema,
]);
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
  allow_env: z.array(opaque.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)),
  policy: z.enum(["always", "on_request"]),
  memory_limit_bytes: count.refine((n) => n > 0),
});
export type KindLaunchSpec = z.infer<typeof kindLaunchSpecSchema>;
export const runMetadataSchema = z.object({
  format: z.literal(1),
  api_port: port,
  core_epoch: opaque,
  started_at: atSchema,
});
export type RunMetadata = z.infer<typeof runMetadataSchema>;
