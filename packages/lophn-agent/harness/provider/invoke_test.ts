// lophn-agent/harness/provider#R19–R23, R25: 실제 HTTP로 fake provider를 불러
// 응답·오류를 분류한다. 실제 provider는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { startFakeProvider } from "../../../../tools/fake-provider/mod.ts";
import type { Script, Step } from "../../../../tools/fake-provider/types.ts";
import type { SecretSendInput } from "../../../contracts/platform/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
} from "./adapters/auth-transport.ts";
import { createFetchTransport } from "./adapters/transport.ts";
import { createInvokeModelCall } from "./invoke.ts";
import type { ModelCallInput, ModelCallOutput } from "./work.ts";

const NOW = Date.UTC(2026, 0, 1);
const KEY = "sk-test-secret-value";

const attach: SecretAttachLike = {
  send: async (_input, transmit) => await transmit(KEY),
};

type Protocol = ModelCallInput["model"]["protocol"];
const FAKE_PROTOCOL = {
  "anthropic-messages": "messages",
  "openai-responses": "responses",
  "openai-chat-completions": "chat_completions",
} as const;
const HEADER = {
  "anthropic-messages": "x-api-key",
  "openai-responses": "authorization",
  "openai-chat-completions": "authorization",
} as const;

function modelFor(protocol: Protocol): ModelCallInput["model"] {
  return {
    provider: "pvd_01arz3ndektsv4rrffq69g5fav",
    name: "fixture-model",
    protocol,
    credential_key: "key-a",
    credential_revision: 1,
    options: {},
    requested_reasoning: null,
    applied_reasoning: null,
    limits: {
      context_limit: 1000,
      input_limit: 900,
      output_limit: 100,
      supports_tools: true,
    },
    catalog_basis: {},
    price_basis: null,
    billing_route: "api",
  };
}

function invoker(protocol: Protocol) {
  const transport = createAuthTransport({
    attach,
    transport: createFetchTransport(),
    context: {} as SecretSendInput["context"],
    use: {} as SecretSendInput["use"],
    operation: "model.call",
    headerName: HEADER[protocol],
    kind: protocol === "anthropic-messages" ? "api_key" : "bearer",
  });
  return createInvokeModelCall({
    transport,
    nowMs: () => NOW,
    at: (ms) => new Date(ms).toISOString(),
  });
}

async function call(
  protocol: Protocol,
  steps: Step[],
  options: { signal?: AbortSignal; endpoint?: string; timeoutMs?: number } = {},
): Promise<
  {
    output: ModelCallOutput;
    requests: number;
    provider: ReturnType<typeof serve>;
  }
> {
  const provider = serve({ steps });
  try {
    const result = await invoker(protocol)({
      callId: "mcl_01arz3ndektsv4rrffq69g5fav",
      run: null,
      session: null,
      purpose: "connection_test",
      model: modelFor(protocol),
      endpoint: options.endpoint ?? provider.url,
      inputHash: "a".repeat(64),
      contextBasisHash: "a".repeat(64),
      body: { model: "fixture-model" },
      timeoutMs: options.timeoutMs ?? 5000,
      usageRevision: "rev",
    }, options.signal ?? new AbortController().signal);
    assert(result.ok, JSON.stringify(result));
    return {
      output: result.value,
      requests: provider.requests().length,
      provider,
    };
  } finally {
    await provider.close();
  }
}

function serve(script: Script) {
  return startFakeProvider({ script, nowMs: () => NOW, instant: true });
}

function httpStep(
  protocol: Protocol,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Step {
  return {
    id: "reply",
    protocol: FAKE_PROTOCOL[protocol],
    response: {
      status,
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  };
}

const PROTOCOLS: Protocol[] = [
  "anthropic-messages",
  "openai-responses",
  "openai-chat-completions",
];

for (const protocol of PROTOCOLS) {
  Deno.test(`lophn-agent/harness/provider#R25: ${protocol} batch JSON 성공을 stream과 같은 판정으로 읽고 usage를 남긴다`, async () => {
    const { output, provider } = await call(protocol, [{
      id: "ok",
      protocol: FAKE_PROTOCOL[protocol],
      reply: { text: "ok", usage: { input: 7, output: 3 } },
    }]);
    assertEquals(output.outcome.kind, "complete");
    assertEquals(output.text, "ok");
    assertEquals(output.usage?.output, 3);
    assertEquals(output.usage?.definition_revision, "rev");
    // 인증 값은 요청 log에 값으로 남지 않고 종류만 남는다.
    assert(!JSON.stringify(provider.requests()).includes(KEY));
  });

  Deno.test(`lophn-agent/harness/provider#R20: ${protocol} HTTP 503은 일시 실패이고 시도는 한 번뿐이다(숨은 retry 없음)`, async () => {
    const { output, requests } = await call(protocol, [
      httpStep(protocol, 503, { error: { message: "busy" } }),
    ]);
    assertEquals(output.outcome.kind, "failed");
    assertEquals(output.outcome.code, "temporary");
    assertEquals(output.outcome.http_status, 503);
    assertEquals(requests, 1);
  });

  Deno.test(`lophn-agent/harness/provider#R20: ${protocol} 429는 retry-after 5초면 일시 실패이고 시각을 전달한다`, async () => {
    const { output } = await call(protocol, [
      httpStep(protocol, 429, { error: { code: "rate_limit_exceeded" } }, {
        "retry-after": "5",
      }),
    ]);
    assertEquals(output.outcome.code, "temporary");
    assertEquals(output.outcome.retry_at, new Date(NOW + 5000).toISOString());
  });

  Deno.test(`lophn-agent/harness/provider#R21: ${protocol} 401은 credential 사용 불가(인증)이고 시각 미상 429는 1시간 사용량 대기다`, async () => {
    const auth = await call(protocol, [
      httpStep(protocol, 401, { error: { message: "bad key" } }),
    ]);
    assertEquals(auth.output.outcome.code, "credential_unavailable");
    assertEquals(auth.output.verdict?.unavailable_reason, "authentication");
    const waiting = await call(protocol, [
      httpStep(protocol, 429, { error: { message: "slow" } }),
    ]);
    assertEquals(waiting.output.outcome.code, "credential_unavailable");
    assertEquals(waiting.output.verdict?.unavailable_reason, "quota");
    assertEquals(waiting.output.verdict?.until_ms, NOW + 3_600_000);
  });

  Deno.test(`lophn-agent/harness/provider#R22: ${protocol} model_not_found는 model 사용 불가다`, async () => {
    const { output } = await call(protocol, [
      httpStep(protocol, 404, { error: { code: "model_not_found" } }),
    ]);
    assertEquals(output.outcome.code, "model_unavailable");
  });

  Deno.test(`lophn-agent/harness/provider#R23: ${protocol} 문맥 초과 code·문구는 context_exceeded다`, async () => {
    const byCode = await call(protocol, [
      httpStep(protocol, 400, { error: { code: "context_length_exceeded" } }),
    ]);
    assertEquals(byCode.output.outcome.code, "context_exceeded");
    const byText = await call(protocol, [
      httpStep(protocol, 400, {
        type: "error",
        error: { type: "invalid_request_error", message: "prompt is too long" },
      }),
    ]);
    assertEquals(byText.output.outcome.code, "context_exceeded");
  });

  Deno.test(`lophn-agent/harness/provider#R19: ${protocol} 원인 불명 오류는 unknown이고 오류 본문을 남기지 않는다`, async () => {
    const secret = "SECRET-BODY-FRAGMENT-9f3";
    const { output } = await call(protocol, [
      httpStep(protocol, 418, { error: { message: secret } }),
    ]);
    assertEquals(output.outcome.code, "unknown");
    assertEquals(output.outcome.provider_code, null);
    assert(!JSON.stringify(output).includes(secret));
    // 400 검증 실패는 invalid_request다.
    const invalid = await call(protocol, [
      httpStep(protocol, 400, {
        error: { type: "invalid_request_error", message: "bad field" },
      }),
    ]);
    assertEquals(invalid.output.outcome.code, "invalid_request");
  });

  Deno.test(`lophn-agent/harness/provider#R20: ${protocol} 연결 실패는 일시 실패다`, async () => {
    const provider = serve({ steps: [] });
    const url = provider.url;
    await provider.close();
    const result = await invoker(protocol)({
      callId: "mcl_01arz3ndektsv4rrffq69g5fav",
      run: null,
      session: null,
      purpose: "connection_test",
      model: modelFor(protocol),
      endpoint: url,
      inputHash: "a".repeat(64),
      contextBasisHash: "a".repeat(64),
      body: {},
      timeoutMs: 2000,
      usageRevision: "rev",
    }, new AbortController().signal);
    assert(result.ok);
    assertEquals(result.value.outcome.code, "temporary");
  });

  Deno.test(`lophn-agent/harness/provider#R23: ${protocol} 사람 취소는 cancelled이고 credential을 막지 않는다`, async () => {
    const controller = new AbortController();
    controller.abort();
    const { output } = await call(protocol, [
      httpStep(protocol, 200, "{}"),
    ], { signal: controller.signal });
    assertEquals(output.outcome.kind, "cancelled");
    assertEquals(output.outcome.code, null);
    assertEquals(output.verdict, undefined);
  });
}

Deno.test("lophn-agent/harness/provider#R25: SSE 성공 stream을 같은 판정으로 읽는다", async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  const { output } = await call("anthropic-messages", [{
    id: "sse",
    protocol: "messages",
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: frames.map((bytes) => ({ bytes })),
    },
  }]);
  assertEquals(output.outcome.kind, "complete");
  assertEquals(output.text, "hi");
  assertEquals(output.usage?.input, 4);
});

Deno.test("lophn-agent/harness/provider#R20: 200 stream 안의 overloaded_error는 일시 실패다", async () => {
  const { output } = await call("anthropic-messages", [{
    id: "sse",
    protocol: "messages",
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [{
        bytes:
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"x"}}\n\n',
      }],
    },
  }]);
  assertEquals(output.outcome.kind, "failed");
  assertEquals(output.outcome.code, "temporary");
});

Deno.test("lophn-agent/harness/provider#R21: 200 stream 안의 insufficient_quota는 credential 사용 불가다", async () => {
  const { output } = await call("openai-responses", [{
    id: "sse",
    protocol: "responses",
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [{
        bytes:
          'data: {"type":"response.failed","response":{"error":{"code":"insufficient_quota","message":"q"}}}\n\n',
      }],
    },
  }]);
  assertEquals(output.outcome.code, "credential_unavailable");
  assertEquals(output.verdict?.unavailable_reason, "quota");
});

Deno.test("lophn-agent/harness/provider#R19: 모르는 stream 오류 type은 unknown이고 인증 실패로 올리지 않는다", async () => {
  const { output } = await call("anthropic-messages", [{
    id: "sse",
    protocol: "messages",
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [{
        bytes:
          'event: error\ndata: {"type":"error","error":{"type":"weird_error","message":"x"}}\n\n',
      }],
    },
  }]);
  assertEquals(output.outcome.code, "unknown");
  assertEquals(output.outcome.http_status, null);
});

Deno.test("lophn-agent/harness/provider#R25: 읽을 수 없는 200 JSON 본문은 unknown이다", async () => {
  const { output } = await call("openai-chat-completions", [
    httpStep("openai-chat-completions", 200, "not json"),
  ]);
  assertEquals(output.outcome.code, "unknown");
});

Deno.test("lophn-agent/harness/provider#R25: state-free 계속 검증을 통과하면 요청을 보낸다", async () => {
  const provider = serve({
    steps: [{
      id: "ok",
      protocol: "responses",
      reply: { text: "ok" },
    }],
  });
  try {
    const result = await invoker("openai-responses")({
      callId: "mcl_01arz3ndektsv4rrffq69g5fav",
      run: null,
      session: null,
      purpose: "connection_test",
      model: modelFor("openai-responses"),
      endpoint: provider.url,
      inputHash: "a".repeat(64),
      contextBasisHash: "a".repeat(64),
      body: {},
      timeoutMs: 2000,
      usageRevision: "rev",
      continuation: { pendingReasoning: true, reasoningRequired: false },
    }, new AbortController().signal);
    assert(result.ok);
    assertEquals(result.value.outcome.kind, "complete");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

const TOOL_ARGS = '{"note":"hello","n":2}';

function sse(frames: string[]): Step {
  return {
    id: "sse",
    protocol: "messages",
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: frames.map((bytes) => ({ bytes })),
    },
  };
}

Deno.test("lophn-agent/harness/provider#R25: 설명 text 뒤의 tool_use 고정 응답(JSON)이 완성된 tool call 하나다", async () => {
  const { output } = await call("anthropic-messages", [{
    id: "reply",
    protocol: "messages",
    reply: {
      text: "I will record a note.",
      toolCalls: [{ id: "toolu_1", name: "record_note", arguments: TOOL_ARGS }],
      usage: { input: 5, output: 4 },
      stop: "tool_calls",
    },
  }]);
  assertEquals(output.outcome.kind, "complete");
  assertEquals(output.outcome.finish_reason, "tool_use");
  assertEquals(output.text, "I will record a note.");
  assertEquals(output.toolCalls, [
    { id: "toolu_1", name: "record_note", args: TOOL_ARGS },
  ]);
});

Deno.test("lophn-agent/harness/provider#R25: text 없는 tool_use 고정 응답도 완성된 tool call이다", async () => {
  const { output } = await call("anthropic-messages", [{
    id: "reply",
    protocol: "messages",
    reply: {
      toolCalls: [{ id: "toolu_1", name: "record_note", arguments: TOOL_ARGS }],
      stop: "tool_calls",
    },
  }]);
  assertEquals(output.outcome.kind, "complete");
  assertEquals(output.toolCalls.length, 1);
  assertEquals(output.toolCalls[0].args, TOOL_ARGS);
});

Deno.test("lophn-agent/harness/provider#R25: text block 뒤 tool_use의 SSE stream은 input_json_delta를 모아 content_block_stop에서 완성된다", async () => {
  const { output } = await call("anthropic-messages", [sse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Recording."}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"record_note","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"note\\":\\"hel"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"lo\\",\\"n\\":2}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ])]);
  assertEquals(output.outcome.kind, "complete");
  assertEquals(output.text, "Recording.");
  assertEquals(output.toolCalls, [
    { id: "toolu_1", name: "record_note", args: TOOL_ARGS },
  ]);
});

Deno.test("lophn-agent/harness/provider#R25: thinking block 뒤 두 tool_use의 SSE stream은 둘 다 완성이다", async () => {
  const { output } = await call("anthropic-messages", [sse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_a","name":"one","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"v\\":1}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_b","name":"two","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"w\\":2}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":2}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ])]);
  assertEquals(output.outcome.kind, "complete");
  assertEquals(output.toolCalls.map((call) => call.id), ["toolu_a", "toolu_b"]);
});

Deno.test("lophn-agent/harness/provider#R25: content_block_stop 없이 끊긴 tool_use SSE는 partial이고 tool call을 내지 않는다", async () => {
  const { output } = await call("anthropic-messages", [sse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"record_note","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"note\\":"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ])]);
  assertEquals(output.outcome.kind, "partial");
  assertEquals(output.toolCalls, []);
});
