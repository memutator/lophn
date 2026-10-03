import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import {
  appCredentialRequestSchema,
  appCredentialResponseSchema,
  DIAGNOSTIC_KINDS,
  diagnosticSchema,
  encodeFrame,
  type Frame,
  FrameDecoder,
  helloSchema,
  kindLaunchSpecSchema,
  mainHelloSchema,
  memoryLimitModeSchema,
  readySchema,
  runMetadataSchema,
  stoppedSchema,
  stopSchema,
  STREAM_CHUNK_MAX_BYTES,
  streamCreditSchema,
  workerRequestSchema,
  workerResponseSchema,
} from "./supervision.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
function concat(parts: Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
Deno.test("platform/identity#R3: pipe frame은 증분 bytes·붙은 frame을 복원한다", () => {
  const frames: Frame[] = [
    { kind: "json", channel: 0, payload: { type: "ready" } },
    { kind: "bytes", channel: 1, payload: new Uint8Array([0, 255, 17]) },
    { kind: "end", channel: 1 },
    { kind: "abort", channel: 2 },
  ];
  const encoded = concat(frames.map(encodeFrame));
  const decoder = new FrameDecoder();
  const decoded: Frame[] = [];
  for (const byte of encoded) {
    decoded.push(...decoder.push(new Uint8Array([byte])));
  }
  assertEquals(decoded, frames);
  decoder.finish();
  const together = new FrameDecoder();
  assertEquals(together.push(encoded), frames);
  together.finish();
  assertEquals(
    new DataView(encodeFrame(frames[1]).buffer).getUint32(0, false),
    8,
  );
});
Deno.test("platform/identity#R3: frame 한도·종류·channel·truncated stdout을 거절한다", () => {
  assertThrows(() =>
    encodeFrame({
      kind: "bytes",
      channel: 1,
      payload: new Uint8Array(STREAM_CHUNK_MAX_BYTES + 1),
    })
  );
  assertEquals(
    new FrameDecoder().push(
      encodeFrame({
        kind: "bytes",
        channel: 1,
        payload: new Uint8Array(STREAM_CHUNK_MAX_BYTES),
      }),
    ).length,
    1,
  );
  const header = new Uint8Array(9);
  const view = new DataView(header.buffer);
  view.setUint32(0, STREAM_CHUNK_MAX_BYTES + 6);
  assertThrows(() => new FrameDecoder().push(header.subarray(0, 4)));
  view.setUint32(0, 5);
  view.setUint8(4, 9);
  assertThrows(() => new FrameDecoder().push(header));
  view.setUint8(4, 2);
  assertThrows(() => new FrameDecoder().push(header));
  view.setUint8(4, 3);
  view.setUint32(5, 1);
  view.setUint32(0, 6);
  assertThrows(() => new FrameDecoder().push(header));
  const partial = new FrameDecoder();
  partial.push(new Uint8Array([0]));
  assertThrows(() => partial.finish());
  const malformed = encodeFrame({ kind: "json", channel: 0, payload: {} });
  malformed[9] = 255;
  const failed = new FrameDecoder();
  assertThrows(() => failed.push(malformed));
  assertThrows(() => failed.push(encodeFrame({ kind: "end", channel: 1 })));
});
Deno.test("platform/identity#R2 platform/identity#R3 platform/identity#R6: 신뢰 시작·worker·앱 credential은 pipe 메시지만 갖는다", () => {
  const hello = {
    type: "hello",
    core_epoch: "epoch",
    process_identity: "process",
    kind: "documents",
    task: "task",
    scope: { operations: [], targets: {} },
    credential: "private-token",
    api_port: 7431,
  };
  assert(helloSchema.safeParse(hello).success);
  assert(!helloSchema.safeParse({ ...hello, argv: ["private-token"] }).success);
  assert(!helloSchema.safeParse({ ...hello, kind: "arbitrary" }).success);
  for (
    const [schema, value] of [
      [readySchema, { type: "ready" }],
      [stoppedSchema, { type: "stopped" }],
      [stopSchema, { type: "stop", grace_ms: 5000 }],
      [streamCreditSchema, { type: "credit", channel: 1, window: 1024 }],
    ] as const
  ) assert(schema.safeParse(value).success);
  assert(
    !streamCreditSchema.safeParse({ type: "credit", channel: 0, window: 1 })
      .success,
  );
  assert(
    mainHelloSchema.safeParse({
      user_token: "private",
      api_port: 7431,
      core_epoch: "epoch",
    }).success,
  );
  const payload = z.strictObject({ owner_id: z.string() });
  assert(
    workerRequestSchema(payload).safeParse({
      type: "worker_request",
      request_id: "r",
      op: "prepare",
      payload: { owner_id: "id" },
    }).success,
  );
  assert(
    workerResponseSchema(payload).safeParse({
      type: "worker_response",
      request_id: "r",
      op: "prepare",
      payload: { owner_id: "id" },
    }).success,
  );
  assert(
    !workerRequestSchema(payload).safeParse({
      type: "worker_request",
      request_id: "r",
      op: "prepare",
      payload: { unknown: true },
    }).success,
  );
  assert(
    appCredentialRequestSchema.safeParse({
      type: "app_credential_request",
      request_id: "r",
      app: `app_${suffix}`,
      release: `rel_${suffix}`,
      process: "process",
      mode: "production",
    }).success,
  );
  assert(
    !appCredentialRequestSchema.safeParse({
      type: "app_credential_request",
      request_id: "r",
      app: `rel_${suffix}`,
      release: `rel_${suffix}`,
      process: "process",
      mode: "production",
    }).success,
  );
  assert(
    appCredentialResponseSchema.safeParse({
      type: "app_credential_response",
      request_id: "r",
      credential: "private",
      credential_ref: "ref",
    }).success,
  );
});
Deno.test("platform/identity#R6: diagnostic은 고정 종류와 안전 계수·ID만 가진다", () => {
  assertEquals(DIAGNOSTIC_KINDS.length, 6);
  const loss = {
    type: "diagnostic",
    kind: "app_invocation_delivery_loss",
    payload: {
      app: `app_${suffix}`,
      lost_messages: 2,
      lost_bytes: 20,
      first_lost_at: "2026-10-04T00:00:00.000Z",
      reason: "memory_limit",
    },
  };
  assert(diagnosticSchema.safeParse(loss).success);
  assert(
    !diagnosticSchema.safeParse({
      ...loss,
      payload: { ...loss.payload, token: "raw" },
    }).success,
  );
  assert(
    !diagnosticSchema.safeParse({
      ...loss,
      payload: { ...loss.payload, lost_bytes: -1 },
    }).success,
  );
  assert(
    diagnosticSchema.safeParse({
      type: "diagnostic",
      kind: "app_log_line_loss",
      payload: {
        app: `app_${suffix}`,
        invocation: `inv_${suffix}`,
        dropped_lines: 1,
        reason: "buffer_limit",
      },
    }).success,
  );
  assert(
    !diagnosticSchema.safeParse({
      type: "diagnostic",
      kind: "unknown",
      payload: {},
    }).success,
  );
});
Deno.test("platform/identity#R2 platform/identity#R6: launch spec 권한·메모리 방식과 credential 없는 run metadata", () => {
  assert(
    kindLaunchSpecSchema.safeParse({
      kind: "documents",
      entry: "bundle/documents.ts",
      allow_read: ["bundle"],
      allow_write: ["derived"],
      allow_net: ["127.0.0.1:7431"],
      allow_run: ["/installed/deno"],
      allow_env: ["HOME"],
      policy: "always",
      memory_limit_bytes: 1024,
    }).success,
  );
  assert(
    !kindLaunchSpecSchema.safeParse({
      kind: "documents",
      entry: "bundle/documents.ts",
      allow_read: [],
      allow_write: [],
      allow_net: [],
      allow_run: ["*"],
      allow_env: ["HOME"],
      policy: "always",
      memory_limit_bytes: 1024,
    }).success,
  );
  for (const mode of ["hard", "soft", "unavailable"]) {
    assert(memoryLimitModeSchema.safeParse(mode).success);
  }
  const metadata = runMetadataSchema.parse({
    format: 1,
    api_port: 7431,
    core_epoch: "epoch",
    started_at: "2026-10-04T00:00:00.000Z",
    token: "raw",
  });
  assert(!("token" in metadata));
  assert(!runMetadataSchema.safeParse({ ...metadata, format: 2 }).success);
});
