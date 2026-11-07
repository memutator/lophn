import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { CallModel } from "../../../protocol/lophn-agent/mod.ts";
import type { AuthTransport } from "./adapters/auth-transport.ts";
import { createInvokeModelCall } from "./invoke.ts";
import type { ModelCallInput } from "./work.ts";

function input(protocol: CallModel["protocol"]): ModelCallInput {
  return {
    callId: "mcl_1",
    turn: null,
    session: null,
    purpose: "judgment",
    model: { protocol } as CallModel,
    endpoint: "https://provider.test/v1",
    inputHash: "h",
    contextBasisHash: "h",
    body: {},
    usageRevision: "r1",
  };
}

function invoker(response: {
  status: number;
  headers: Record<string, string>;
  stream?: string;
  json?: string;
}) {
  const transport: AuthTransport = {
    send: () =>
      Promise.resolve(
        ok({
          status: response.status,
          headers: new Headers(response.headers),
          stream:
            response.stream === undefined
              ? null
              : new Response(response.stream).body,
          json: response.json ?? null,
        }),
      ),
  };
  return createInvokeModelCall({
    transport,
    nowMs: () => 0,
    at: (ms) => new Date(ms).toISOString(),
  });
}

// secret 경계: 기록에 남는 것은 allow-list header 값과 판정 길뿐이다. 인증 header와 오류 본문은 남지 않는다.
test("실패한 호출의 기록에는 allow-list header 값만 있고 본문과 secret이 없다", async () => {
  const invoke = invoker({
    status: 401,
    headers: {
      authorization: "Bearer sk-header-secret",
      "set-cookie": "session=cookie-secret",
      "x-api-key": "sk-api-key-secret",
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "req_abc123",
    },
    json: JSON.stringify({
      error: {
        code: "invalid_api_key",
        message: "Incorrect API key provided: sk-body-secret",
      },
    }),
  });
  const result = await invoke(
    input("openai-responses"),
    new AbortController().signal,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.outcome.evidence, {
    verdict_path: "http_status",
    content_type: "application/json",
    request_id: "req_abc123",
    unknown_events: [],
  });
  assert.doesNotMatch(
    JSON.stringify(result.value.outcome),
    /secret|Bearer|cookie/,
  );
});

// Responses의 최상위 error event는 모르는 event가 아니라 stream 실패다.
test("Responses의 최상위 error event는 code를 단 실패다", async () => {
  const invoke = invoker({
    status: 200,
    headers: { "x-oai-request-id": "req_stream" },
    stream:
      'data: {"type":"error","code":"server_error","message":"boom"}\n\n' +
      'data: {"type":"response.something_new"}\n\n',
  });
  const result = await invoke(
    input("openai-responses"),
    new AbortController().signal,
  );
  assert.ok(result.ok);
  const outcome = result.value.outcome;
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.provider_code, "server_error");
  assert.equal(outcome.evidence?.request_id, "req_stream");
  assert.deepEqual(outcome.evidence?.unknown_events, [
    "response.something_new",
  ]);
});
