import { assert, assertEquals, assertThrows } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { DIAGNOSTIC_ROUTES } from "./diagnostics.ts";
import {
  DIAGNOSTICS_WRITE_OP,
  diagnosticsWrite,
  diagnosticsWriteInputSchema,
  diagnosticsWriteOutputSchema,
  diagnosticsWriteRequestSchema,
  diagnosticsWriteResponseSchema,
} from "./write.ts";
import { PIPE_OPS } from "../storage/pipe-ops.ts";
import { ROUTES } from "../registry.ts";
import { routePath } from "../base/route.ts";
import {
  CONTROL_MAX_BYTES,
  encodeFrame,
  FrameDecoder,
} from "../supervision/supervision.ts";

const observedAt = "2026-10-04T00:00:00.000Z";
const observation = { component: "platform/io", observed_at: observedAt };

function fixedRecord(index: number) {
  return {
    type: "diagnostic",
    kind: "lophn_internal",
    payload: {
      ...observation,
      error_class: "internal_exception",
      location: "supervisor.ready",
      count: index + 1,
    },
  };
}

function requestOf(records: readonly unknown[], dropped = 0) {
  return {
    type: "worker_request",
    request_id: "write-1",
    op: DIAGNOSTICS_WRITE_OP,
    payload: { records, dropped },
  };
}

// 이 테스트는 wire 모양만 본다. queue 적재·redaction·현재 인증은 여기서 일어나지 않는다.
Deno.test("platform/diagnostics#R4 platform/diagnostics#R7: op 이름과 channel은 고정이다", () => {
  assertEquals(diagnosticsWrite.op, "platform.diagnostics.write");
  assert(diagnosticsWriteRequestSchema.safeParse(requestOf([])).success);
  for (
    const op of [
      "diagnostics.write",
      "platform/diagnostics.write",
      "secret.prepare",
      "blob.prepare",
      "platform.diagnostics.write ",
    ]
  ) {
    assert(
      !diagnosticsWriteRequestSchema.safeParse({ ...requestOf([]), op })
        .success,
    );
  }
  for (const channel of [1, 7, -1, 0.5, 0x100000000]) {
    assert(
      !diagnosticsWriteRequestSchema.safeParse({ ...requestOf([]), channel })
        .success,
    );
  }
  const request = diagnosticsWriteRequestSchema.parse(
    requestOf([fixedRecord(1)], 12),
  );
  assertEquals(request.payload.dropped, 12);
  for (
    const invalid of [
      { ...requestOf([]), payload: { records: [], dropped: 0, op: "x" } },
      { ...requestOf([]), payload: null },
      { ...requestOf([]), request_id: "" },
      { ...requestOf([]), type: "worker_response" },
    ]
  ) {
    assert(!diagnosticsWriteRequestSchema.safeParse(invalid).success);
  }
});

Deno.test("platform/diagnostics#R4: 응답은 queue 수용 수만 담고 공통 failure를 그대로 쓴다", () => {
  const response = diagnosticsWriteResponseSchema.parse({
    type: "worker_response",
    request_id: "write-1",
    ok: true,
    payload: { accepted: 1, dropped: 0 },
  });
  assert(response.ok && response.payload.accepted === 1);
  for (
    const durable of [
      { durable: true },
      { written: 1 },
      { committed: true },
      { ledger_seq: "9" },
    ]
  ) {
    assert(
      !diagnosticsWriteResponseSchema.safeParse({
        type: "worker_response",
        request_id: "write-1",
        ok: true,
        payload: { accepted: 1, dropped: 0, ...durable },
      }).success,
    );
  }
  const failure = diagnosticsWriteResponseSchema.parse({
    type: "worker_response",
    request_id: "write-1",
    ok: false,
    error: { code: "unavailable", message: "worker busy" },
  });
  assert(!failure.ok && failure.error.code === "unavailable");
  for (const code of ERROR_CODES) {
    assert(
      diagnosticsWriteResponseSchema.safeParse({
        type: "worker_response",
        request_id: "write-1",
        ok: false,
        error: { code, message: "x" },
      }).success,
    );
  }
  for (
    const invalid of [
      { code: "dropped", message: "x" },
      { code: "unavailable", message: "x", stack: "raw" },
    ]
  ) {
    assert(
      !diagnosticsWriteResponseSchema.safeParse({
        type: "worker_response",
        request_id: "write-1",
        ok: false,
        error: invalid,
      }).success,
    );
  }
});

Deno.test("platform/diagnostics#R3: op payload는 JSON control frame 위를 돈다", () => {
  const request = diagnosticsWriteRequestSchema.parse(
    requestOf([fixedRecord(0), fixedRecord(5)], 3),
  );
  const response = diagnosticsWriteResponseSchema.parse({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload: { accepted: 2, dropped: 3 },
  });
  const frames = [
    { kind: "json" as const, channel: 0 as const, payload: request },
    { kind: "json" as const, channel: 0 as const, payload: response },
  ];
  const decoder = new FrameDecoder();
  assertEquals(
    frames.flatMap((frame) => decoder.push(encodeFrame(frame))),
    frames,
  );
  decoder.finish();
  assertEquals(CONTROL_MAX_BYTES, 256 * 1024);
  // wire shape가 유효해도 전체 JSON control frame byte 상한을 넘길 수는 없다.
  const record = fixedRecord(0);
  const oversized = diagnosticsWriteRequestSchema.parse(requestOf([{
    ...record,
    payload: { ...record.payload, location: "x".repeat(CONTROL_MAX_BYTES) },
  }]));
  assertThrows(() =>
    encodeFrame({
      kind: "json",
      channel: 0,
      payload: oversized,
    })
  );
  assert(
    encodeFrame({
      kind: "json",
      channel: 0,
      payload: request,
    }).length < CONTROL_MAX_BYTES + 9,
  );
});

Deno.test("platform/diagnostics#R2 platform/diagnostics#R8: 이 op는 공개 route·pipe registry에 없다", () => {
  assertEquals(diagnosticsWrite.op, DIAGNOSTICS_WRITE_OP);
  assertEquals(diagnosticsWrite.input, diagnosticsWriteInputSchema);
  assertEquals(diagnosticsWrite.output, diagnosticsWriteOutputSchema);
  assertEquals(diagnosticsWrite.request, diagnosticsWriteRequestSchema);
  assertEquals(diagnosticsWrite.response, diagnosticsWriteResponseSchema);
  for (const route of ROUTES) {
    assert(route.name !== DIAGNOSTICS_WRITE_OP);
  }
  for (const op of PIPE_OPS) {
    assert(op.name !== DIAGNOSTICS_WRITE_OP);
  }
  assertEquals(
    DIAGNOSTIC_ROUTES.map(routePath),
    ["/v1/diagnostics/list", "/v1/diagnostics/check"],
  );
  assert(
    !ROUTES.some((route) =>
      routePath(route).startsWith("/v1/platform/diagnostics")
    ),
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "diagnostics").length,
    2,
  );
});
