import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import {
  agentCredentialEndSchema,
  agentCredentialRequestSchema,
  agentCredentialResponseSchema,
  appCredentialRequestSchema,
  appCredentialResponseSchema,
  BLOB_PREPARE_CREDIT_WINDOW,
  blobPrepareRequestSchema,
  blobPrepareResultSchema,
  childMessageSchema,
  coreToMainMessageSchema,
  DIAGNOSTIC_KINDS,
  diagnosticSchema,
  encodeFrame,
  type Frame,
  FrameDecoder,
  helloSchema,
  INTERNAL_ERROR_CLASSES,
  kindLaunchSpecSchema,
  mainToCoreMessageSchema,
  memoryLimitModeSchema,
  parentMessageSchema,
  PROCESS_KINDS,
  processKindSchema,
  readySchema,
  redactRequestSchema,
  redactResponseSchema,
  runMetadataSchema,
  secretSendRequestSchema,
  secretSendResponseSchema,
  stoppedSchema,
  stopSchema,
  STREAM_CHUNK_MAX_BYTES,
  streamCreditSchema,
  workerRequestSchema,
  workerResponseSchema,
} from "./supervision.ts";
const suffix = "01arz3ndektsv4rrffq69g5fav";
const observedAt = "2026-10-04T00:00:00.000Z";
const observation = { component: "platform/io", observed_at: observedAt };
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
    kind: "documents/worker",
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
    appCredentialRequestSchema.safeParse({
      type: "app_credential_request",
      request_id: "r",
      app: `app_${suffix}`,
      release: `rel_${suffix}`,
      process: "process",
      mode: "production",
      bundle_hash: "a".repeat(64),
      diagnostic_scope: "worker/problems/report-collector",
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
      bundle_hash: null,
      diagnostic_scope: null,
    }).success,
  );
  assert(
    !appCredentialRequestSchema.safeParse({
      type: "app_credential_request",
      request_id: "r",
      app: `app_${suffix}`,
      release: `rel_${suffix}`,
      process: "process",
      mode: "production",
      bundle_hash: "not-a-hash",
    }).success,
  );
  assert(
    !appCredentialRequestSchema.safeParse({
      type: "app_credential_request",
      request_id: "r",
      app: `app_${suffix}`,
      release: `rel_${suffix}`,
      process: "process",
      mode: "production",
      diagnostic_scope: "   ",
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
Deno.test("platform/identity#R2: kind는 소유 팀 namespace에서 확장한다", () => {
  for (
    const kind of [...PROCESS_KINDS, "apps/release", "coding-agent/worker"]
  ) {
    assert(processKindSchema.safeParse(kind).success);
  }
  for (
    const kind of [
      "core",
      "documents",
      "shell/main",
      "apps/Release",
      "apps/a_b",
      "apps/1",
      "apps/a/b",
      "apps/",
    ]
  ) {
    assert(!processKindSchema.safeParse(kind).success);
  }
});
Deno.test("platform/identity#R3: worker envelope은 요청 channel에 stream을 묶고 소유 payload를 다시 검사한다", () => {
  const request = {
    type: "worker_request",
    request_id: "r",
    op: "prepare",
    channel: 7,
    payload: { owner_id: "id" },
  };
  const response = {
    type: "worker_response",
    request_id: "r",
    ok: true,
    payload: { owner_id: "id" },
  };
  const failure = {
    type: "worker_response",
    request_id: "r",
    ok: false,
    error: { code: "unavailable", message: "busy", details: { retry: false } },
  };
  assert(parentMessageSchema.safeParse(request).success);
  assert(childMessageSchema.safeParse(response).success);
  assert(childMessageSchema.safeParse(failure).success);
  const frames = new FrameDecoder().push(concat([
    encodeFrame({ kind: "json", channel: 0, payload: request }),
    encodeFrame({
      kind: "bytes",
      channel: request.channel,
      payload: new Uint8Array([1]),
    }),
    encodeFrame({ kind: "end", channel: request.channel }),
  ]));
  assert(frames[0].kind === "json");
  assertEquals(frames[0].payload, request);
  assertEquals(frames.slice(1).map((frame) => frame.channel), [
    request.channel,
    request.channel,
  ]);
  const payload = z.strictObject({ owner_id: z.string() });
  assert(workerRequestSchema(payload).safeParse(request).success);
  assert(workerResponseSchema(payload).safeParse(failure).success);
  assert(parentMessageSchema.safeParse({ ...request, payload: null }).success);
  assert(
    !workerRequestSchema(payload).safeParse({ ...request, payload: null })
      .success,
  );
  assert(
    !workerResponseSchema(payload).safeParse({ ...response, payload: null })
      .success,
  );
  for (const channel of [0, -1, 1.5, 0x100000000]) {
    assert(!parentMessageSchema.safeParse({ ...request, channel }).success);
  }
  for (
    const value of [
      { ...response, op: "prepare" },
      { ...response, ok: false },
      { ...failure, payload: {} },
      { ...failure, error: { code: "raw_error", message: "bad" } },
      { ...failure, error: { ...failure.error, stack: "raw" } },
    ]
  ) {
    assert(!childMessageSchema.safeParse(value).success);
  }
});
Deno.test("platform/diagnostics#R2 platform/diagnostics#R6 platform/diagnostics#R7: 내부 diagnostic에는 등록 분류·위치만 있고 모든 종류에 관측 정보가 있다", () => {
  const internal = {
    type: "diagnostic",
    kind: "lophn_internal",
    payload: {
      ...observation,
      error_class: "internal_exception",
      location: "supervisor.ready",
      count: 1,
    },
  };
  for (const error_class of INTERNAL_ERROR_CLASSES) {
    assert(
      diagnosticSchema.safeParse({
        ...internal,
        payload: { ...internal.payload, error_class },
      }).success,
    );
  }
  for (
    const extra of [
      { message: "secret" },
      { stack: "raw" },
      { error_class: "TypeError" },
      { location: "/private/path" },
      { component: "core" },
      { observed_at: "yesterday" },
    ]
  ) {
    assert(
      !diagnosticSchema.safeParse({
        ...internal,
        payload: { ...internal.payload, ...extra },
      }).success,
    );
  }
  const payloads = [internal.payload, { ...observation, count: 1 }, {
    ...observation,
    report: `rpt_${suffix}`,
    count: 1,
  }, {
    ...observation,
    view_id: "view",
    generation: 1,
    created: 1,
    hidden: 0,
    replaced: 0,
    disposed: 0,
    attached: 1,
  }, {
    ...observation,
    app: `app_${suffix}`,
    lost_messages: 1,
    lost_bytes: 1,
    first_lost_at: observedAt,
    reason: "memory_limit",
  }, {
    ...observation,
    app: `app_${suffix}`,
    dropped_lines: 1,
    reason: "buffer_limit",
  }];
  DIAGNOSTIC_KINDS.forEach((kind, index) => {
    const payload = payloads[index];
    assert(
      diagnosticSchema.safeParse({ type: "diagnostic", kind, payload }).success,
    );
    for (const field of ["component", "observed_at"]) {
      const missing = Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== field),
      );
      assert(
        !diagnosticSchema.safeParse({
          type: "diagnostic",
          kind,
          payload: missing,
        }).success,
      );
    }
  });
});
Deno.test("platform/identity#R3 platform/diagnostics#R2: main↔core의 hello·ready·diagnostic·종료 방향을 고정한다", () => {
  const hello = { user_token: "private", api_port: 7431, core_epoch: "epoch" };
  const lifetime = {
    type: "diagnostic",
    kind: "shell_view_lifetime",
    payload: {
      ...observation,
      component: "platform/shell-main",
      view_id: "view",
      generation: 1,
      created: 1,
      hidden: 0,
      replaced: 0,
      disposed: 0,
      attached: 1,
    },
  };
  for (const value of [hello, { type: "ready" }]) {
    assert(coreToMainMessageSchema.safeParse(value).success);
    assert(!mainToCoreMessageSchema.safeParse(value).success);
    assert(
      !coreToMainMessageSchema.safeParse({ ...value, extra: true }).success,
    );
  }
  for (const value of [lifetime, { type: "stop", grace_ms: 5000 }]) {
    assert(mainToCoreMessageSchema.safeParse(value).success);
    assert(!coreToMainMessageSchema.safeParse(value).success);
    assert(
      !mainToCoreMessageSchema.safeParse({ ...value, extra: true }).success,
    );
  }
});
Deno.test("platform/backup-and-migration#R13: 복원 통로는 main→core 요청과 core→main 응답으로 나뉘고 정해진 field만 받는다", () => {
  const at = "2024-01-02T03:04:05.000Z";
  const requests = [
    { type: "restore_plan_request", created_at: at },
    { type: "restore_request", created_at: at, confirmation: "c".repeat(43) },
  ];
  const responses = [
    {
      type: "restore_plan",
      created_at: at,
      through_seq: "2",
      current_through_seq: "4",
      lost: { from_seq: "3", through_seq: "4", events: 2 },
      target: at,
      content_hash: "a".repeat(64),
    },
    {
      type: "restore_result",
      created_at: at,
      restored_through_seq: "2",
      previous_through_seq: null,
    },
    {
      type: "restore_failed",
      stage: "restore",
      created_at: at,
      code: "unavailable",
      message: "복원하지 못했다",
      restarted: true,
    },
  ];
  for (const value of requests) {
    assert(mainToCoreMessageSchema.safeParse(value).success);
    assert(!coreToMainMessageSchema.safeParse(value).success);
    assert(
      !mainToCoreMessageSchema.safeParse({ ...value, extra: true }).success,
    );
  }
  for (const value of responses) {
    assert(coreToMainMessageSchema.safeParse(value).success);
    assert(!mainToCoreMessageSchema.safeParse(value).success);
    assert(
      !coreToMainMessageSchema.safeParse({ ...value, extra: true }).success,
    );
  }
});
Deno.test("platform/identity#R2 platform/identity#R6: launch spec 권한·메모리 방식과 credential 없는 run metadata", () => {
  assert(
    kindLaunchSpecSchema.safeParse({
      kind: "documents/worker",
      entry: "bundle/documents.ts",
      allow_read: ["bundle"],
      allow_write: ["derived"],
      allow_net: ["127.0.0.1:7431"],
      allow_run: ["/installed/deno"],
      allow_sys: ["statfs"],
      allow_env: ["HOME"],
      policy: "always",
      memory_limit_bytes: 1024,
    }).success,
  );
  assert(
    !kindLaunchSpecSchema.safeParse({
      kind: "documents/worker",
      entry: "bundle/documents.ts",
      allow_read: [],
      allow_write: [],
      allow_net: [],
      allow_run: ["*"],
      allow_sys: [],
      allow_env: ["HOME"],
      policy: "always",
      memory_limit_bytes: 1024,
    }).success,
  );
  // sys 항목도 와일드카드를 받지 않는다.
  assert(
    !kindLaunchSpecSchema.safeParse({
      kind: "documents/worker",
      entry: "bundle/documents.ts",
      allow_read: [],
      allow_write: [],
      allow_net: [],
      allow_run: [],
      allow_sys: ["*"],
      allow_env: ["HOME"],
      policy: "always",
      memory_limit_bytes: 1024,
    }).success,
  );
  for (const mode of ["hard", "soft", "unavailable"]) {
    assert(memoryLimitModeSchema.safeParse(mode).success);
  }
  const metadata = {
    format: 1,
    api_port: 7431,
    core_epoch: "epoch",
    started_at: observedAt,
  };
  assert(runMetadataSchema.safeParse(metadata).success);
  assert(!runMetadataSchema.safeParse({ ...metadata, token: "raw" }).success);
  assert(!runMetadataSchema.safeParse({ ...metadata, format: 2 }).success);
});

Deno.test("platform/blob-store#R1 platform/api#R5: 자식의 blob 준비 요청은 channel·purpose·선언 크기만 갖고 principal·hash 주장은 거절한다", () => {
  const request = {
    type: "blob_prepare_request",
    request_id: "r1",
    channel: 3,
    purpose: "document_files",
    size_bytes: 10,
  };
  assert(blobPrepareRequestSchema.safeParse(request).success);
  assert(childMessageSchema.safeParse(request).success);
  assert(
    !blobPrepareRequestSchema.safeParse({ ...request, principal: "user-1" })
      .success,
  );
  assert(
    !blobPrepareRequestSchema.safeParse({
      ...request,
      expected_hash: "a".repeat(64),
    }).success,
  );
  assert(
    !blobPrepareRequestSchema.safeParse({ ...request, channel: 0 }).success,
  );
  assert(
    !blobPrepareRequestSchema.safeParse({ ...request, size_bytes: -1 }).success,
  );
  assert(
    !blobPrepareRequestSchema.safeParse({
      ...request,
      size_bytes: 1024 * 1024 * 1024 + 1,
    }).success,
  );
  assert(
    !blobPrepareRequestSchema.safeParse({ ...request, purpose: "Bad Purpose" })
      .success,
  );
  assert(BLOB_PREPARE_CREDIT_WINDOW >= STREAM_CHUNK_MAX_BYTES);
});

Deno.test("platform/blob-store#R1 platform/api#R4: 부모의 blob 준비 결과는 준비 참조 또는 고정 오류 code만 싣는다", () => {
  const ok = {
    type: "blob_prepare_result",
    request_id: "r1",
    ok: true,
    prepared: {
      preparation: "prep-1",
      principal: "machine",
      purpose: "document_files",
      hash: "a".repeat(64),
      size_bytes: 10,
    },
  };
  assert(blobPrepareResultSchema.safeParse(ok).success);
  assert(parentMessageSchema.safeParse(ok).success);
  assert(
    !blobPrepareResultSchema.safeParse({
      ...ok,
      prepared: { ...ok.prepared, hash: "not-a-hash" },
    }).success,
  );
  const failure = {
    type: "blob_prepare_result",
    request_id: "r1",
    ok: false,
    error: { code: "forbidden", message: "blob prepare is not allowed" },
  };
  assert(blobPrepareResultSchema.safeParse(failure).success);
  assert(
    !blobPrepareResultSchema.safeParse({
      ...failure,
      error: { code: "not_found", message: "x" },
    }).success,
  );
});

Deno.test("apps/preview#R9: app_credential_request는 release 없는 preview를 위해 release null을 받고 모양이 다른 release는 거절한다", () => {
  const suffix = "01arz3ndektsv4rrffq69g5fav";
  const base = {
    type: "app_credential_request",
    request_id: "r",
    app: `app_${suffix}`,
    process: "process",
    mode: "preview",
    bundle_hash: "a".repeat(64),
  };
  assert(
    appCredentialRequestSchema.safeParse({ ...base, release: null }).success,
  );
  assert(
    appCredentialRequestSchema.safeParse({ ...base, release: `rel_${suffix}` })
      .success,
  );
  assert(
    !appCredentialRequestSchema.safeParse({ ...base, release: "rel_x" })
      .success,
  );
  assert(!appCredentialRequestSchema.safeParse(base).success);
});

Deno.test("lophn-agent/harness/run-loop#R8: agent credential 요청·응답·종료는 run과 assignment ID를 정확히 묶고 child·parent 합집합에 들어 있다", () => {
  const suffix = "01arz3ndektsv4rrffq69g5fav";
  const request = {
    type: "agent_credential_request",
    request_id: "r",
    run: `run_${suffix}`,
    assignment: `asg_${suffix}`,
    operations: ["ReadRun"],
    scope: { role: "lophn" },
  };
  assert(agentCredentialRequestSchema.safeParse(request).success);
  assert(childMessageSchema.safeParse(request).success);
  assert(
    !agentCredentialRequestSchema.safeParse({ ...request, run: "run_x" })
      .success,
  );
  assert(
    !agentCredentialRequestSchema.safeParse({ ...request, extra: 1 }).success,
  );
  const response = {
    type: "agent_credential_response",
    request_id: "r",
    credential: "token",
    credential_ref: "ref",
  };
  assert(agentCredentialResponseSchema.safeParse(response).success);
  assert(parentMessageSchema.safeParse(response).success);
  const end = { type: "agent_credential_end", run: `run_${suffix}` };
  assert(agentCredentialEndSchema.safeParse(end).success);
  assert(childMessageSchema.safeParse(end).success);
  assert(!parentMessageSchema.safeParse(end).success);
});

Deno.test("lophn-agent/harness/run-loop#R8: 안전화 요청은 조각 수와 합 크기를 제한하고 응답은 자리만 싣는다", () => {
  const request = {
    type: "redact_request",
    request_id: "r",
    windows: ["a secret", "b"],
  };
  assert(redactRequestSchema.safeParse(request).success);
  assert(childMessageSchema.safeParse(request).success);
  assert(!parentMessageSchema.safeParse(request).success);
  assert(!redactRequestSchema.safeParse({ ...request, windows: [] }).success);
  assert(
    !redactRequestSchema.safeParse({
      ...request,
      windows: Array.from({ length: 129 }, () => "x"),
    }).success,
  );
  assert(
    !redactRequestSchema.safeParse({
      ...request,
      windows: ["x".repeat(32_769)],
    }).success,
  );
  const ok = {
    type: "redact_response",
    request_id: "r",
    ok: true,
    spans: [[{ index: 2, length: 6 }], []],
  };
  assert(redactResponseSchema.safeParse(ok).success);
  assert(parentMessageSchema.safeParse(ok).success);
  assert(
    redactResponseSchema.safeParse({
      type: "redact_response",
      request_id: "r",
      ok: false,
    }).success,
  );
  assert(!redactResponseSchema.safeParse({ ...ok, text: "raw" }).success);
});

Deno.test("lophn-agent/harness/provider#R7 platform/secrets#R5: secret 전송 요청은 값 없이 참조·판·목적지만 싣고 값은 성공 응답 한 곳에만 있다", () => {
  const request = {
    type: "secret_send_request",
    request_id: "s1",
    use: {
      sealed_ref: "sealed-1",
      revision: 1,
      purpose: "provider_credential",
      destination: { kind: "https", origin: "https://api.example.test" },
    },
    operation: "model.call",
    url: "https://api.example.test/responses",
    method: "POST",
  };
  assert(secretSendRequestSchema.safeParse(request).success);
  assert(childMessageSchema.safeParse(request).success);
  assert(!parentMessageSchema.safeParse(request).success);
  assert(
    !secretSendRequestSchema.safeParse({ ...request, value: "v" }).success,
  );
  // 앱 secret 외의 coding connection 용도는 이 통로로 받지 못한다.
  assert(
    !secretSendRequestSchema.safeParse({
      ...request,
      use: { ...request.use, purpose: "coding_connection_credential" },
    }).success,
  );
  assert(
    secretSendRequestSchema.safeParse({
      ...request,
      use: {
        ...request.use,
        destination: {
          kind: "loopback_http",
          origin: "http://127.0.0.1:11434",
        },
      },
    }).success,
  );
  assert(
    !secretSendRequestSchema.safeParse({
      ...request,
      use: {
        ...request.use,
        destination: { kind: "loopback_http", origin: "http://example.test" },
      },
    }).success,
  );
  const granted = {
    type: "secret_send_response",
    request_id: "s1",
    ok: true,
    value: "v",
  };
  assert(secretSendResponseSchema.safeParse(granted).success);
  assert(parentMessageSchema.safeParse(granted).success);
  assert(!childMessageSchema.safeParse(granted).success);
  const denied = {
    type: "secret_send_response",
    request_id: "s1",
    ok: false,
    error: { code: "unavailable", message: "no" },
  };
  assert(secretSendResponseSchema.safeParse(denied).success);
  assert(
    !secretSendResponseSchema.safeParse({ ...denied, value: "v" }).success,
  );
});
