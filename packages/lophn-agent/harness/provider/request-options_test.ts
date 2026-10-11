// option 값이 요청에 실리는 두 통로의 test다(harness/model#R22, R23). 요청 body에는 ResolvedModel의
// request_patch가 깊게 합쳐지고, 요청 header에는 request_headers가 더해진다. 보낼 model 이름은
// sent_model_name이 buildRequest의 model로 들어온다. 네트워크 없이 fake transport로 본다.

import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { SecretSendInput } from "../../../contracts/platform/mod.ts";
import type { JsonObject } from "../../../contracts/platform/mod.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
  type Transport,
  type TransportRequest,
} from "./adapters/auth-transport.ts";
import { buildRequest as buildChat } from "./adapters/chat-completions.ts";
import { buildRequest as buildMessages } from "./adapters/messages.ts";
import { mergeRequestPatch } from "./adapters/request-patch.ts";
import { buildRequest as buildResponses } from "./adapters/responses.ts";
import { withRequestHeaders } from "./adapters/transport.ts";
import { createInvokeModelCall } from "./invoke.ts";
import type { ModelCallInput } from "./work.ts";

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: a request patch merges deeply, wins over the adapter's scalar and leaves its inputs alone", () => {
  const body = {
    model: "m",
    reasoning: { include: ["reasoning.encrypted_content"] },
    tools: [{ name: "a" }],
    max_tokens: 10,
  };
  const patch: JsonObject = {
    reasoning: { effort: "high" },
    tools: [{ name: "b" }],
    max_tokens: 20,
    service_tier: "priority",
  };
  const merged = mergeRequestPatch(body, patch);
  assertEquals(merged, {
    model: "m",
    // 안쪽 object는 서로 합쳐진다.
    reasoning: { include: ["reasoning.encrypted_content"], effort: "high" },
    // 배열은 합치지 않고 patch의 것으로 바꾼다.
    tools: [{ name: "b" }],
    // 같은 키의 값은 사람이 고른 option의 patch가 이긴다.
    max_tokens: 20,
    service_tier: "priority",
  });
  // 입력은 바뀌지 않는다.
  assertEquals(body.reasoning, { include: ["reasoning.encrypted_content"] });
  assertEquals(patch.reasoning, { effort: "high" });
  // 빈 조각은 더할 것이 없다는 뜻이다(예: Standard).
  assertEquals(mergeRequestPatch(body, {}), body);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: the Messages request carries the patch and the sent model name", () => {
  const plain = buildMessages({
    model: "grok-4-fast",
    max_tokens: 64,
    messages: [{ role: "user", content: [{ type: "text", text: "질문" }] }],
  });
  const request = buildMessages({
    model: "grok-4-fast",
    max_tokens: 64,
    messages: [{ role: "user", content: [{ type: "text", text: "질문" }] }],
    request_patch: {
      thinking: { type: "enabled", budget_tokens: 8192 },
      speed: "fast",
    },
  });
  assertEquals(request.model, "grok-4-fast");
  assertEquals(request.thinking, { type: "enabled", budget_tokens: 8192 });
  assertEquals(request.speed, "fast");
  // patch 밖은 조각이 없을 때와 같다.
  assertEquals(request.messages, plain.messages);
  assertEquals(request.max_tokens, plain.max_tokens);
  // 조각이 없으면 body에 option 필드가 없다(R16).
  assertEquals("thinking" in plain, false);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: the Responses request merges the patch into the reasoning it already carries", () => {
  const request = buildResponses({
    model: "gpt-5-5",
    input: [{ role: "user", content: [{ type: "input_text", text: "질문" }] }],
    max_output_tokens: 64,
    reasoning: ["encrypted-1"],
    stateFree: { protocol: "openai-responses", reasoningRequired: false },
    request_patch: { reasoning: { effort: "xhigh" }, service_tier: "priority" },
  });
  assertEquals(request.body.model, "gpt-5-5");
  // 재전송용 include와 effort가 한 reasoning object에 함께 있다.
  assertEquals(request.body.reasoning, {
    include: ["reasoning.encrypted_content"],
    effort: "xhigh",
  });
  assertEquals(request.body.service_tier, "priority");
  assertEquals(request.body.store, false);
  assertEquals(request.body.stream, true);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: the Chat Completions request carries the patch", () => {
  const request = buildChat({
    model: "gpt-5-5",
    messages: [{ role: "user", content: "질문" }],
    max_tokens: 64,
    request_patch: { reasoning_effort: "low", service_tier: "default" },
  });
  assertEquals(request.model, "gpt-5-5");
  assertEquals(request.reasoning_effort, "low");
  assertEquals(request.service_tier, "default");
  assertEquals(request.stream, true);
});

// === header: transport 바깥 한 겹 ===

const attach: SecretAttachLike = {
  send: async (_input, transmit) => await transmit("sk-test-secret-value"),
};

function modelInput(): ModelCallInput {
  return {
    callId: "mcl_01arz3ndektsv4rrffq69g5fav",
    run: null,
    session: null,
    purpose: "connection_test",
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      name: "fixture-model",
      protocol: "anthropic-messages",
      credential_key: "key-a",
      credential_revision: 1,
      option_values: { requested: {}, applied: {} },
      limits: {
        context_limit: 1000,
        input_limit: 900,
        output_limit: 100,
        supports_tools: true,
      },
      catalog_basis: {},
      price_basis: null,
      billing_route: "api",
    },
    endpoint: "http://127.0.0.1:1/v1",
    inputHash: "a".repeat(64),
    contextBasisHash: "a".repeat(64),
    body: { model: "fixture-model" },
    timeoutMs: 5000,
    usageRevision: "rev",
  };
}

// 보낸 요청을 기록하고 일부러 실패 응답을 돌려주는 transport다. 네트워크를 쓰지 않는다.
function capture() {
  const seen: TransportRequest[] = [];
  const transport: Transport = (request: TransportRequest) => {
    seen.push(request);
    return Promise.resolve(
      ok({
        status: 500,
        headers: new Headers(),
        stream: null,
        json: "{}",
      }),
    );
  };
  return { seen, transport };
}

function invokeWith(
  headers: Record<string, string>,
  transport: Transport,
) {
  const authed = createAuthTransport({
    attach,
    transport,
    context: {} as SecretSendInput["context"],
    use: {} as SecretSendInput["use"],
    operation: "model.call",
    headerName: "x-api-key",
    kind: "api_key",
  });
  return createInvokeModelCall({
    transport: withRequestHeaders(authed, headers),
    nowMs: () => 0,
    at: (ms) => new Date(ms).toISOString(),
  });
}

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: request headers ride the request without replacing the adapter's own or the credential header", async () => {
  const { seen, transport } = capture();
  const invoke = invokeWith({
    "anthropic-beta": "fast-mode-2026-02-01",
    // 호출 형식이 정한 header와 인증 header는 option이 바꾸지 못한다.
    "content-type": "text/plain",
    "x-api-key": "stolen",
  }, transport);
  const result = await invoke(modelInput(), new AbortController().signal);
  assert(result.ok);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].headers["anthropic-beta"], "fast-mode-2026-02-01");
  assertEquals(seen[0].headers["content-type"], "application/json");
  assertEquals(seen[0].headers["x-api-key"], "sk-test-secret-value");
  assertEquals(seen[0].headers["anthropic-version"], "2023-06-01");
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: with no request headers the request carries only its own headers", async () => {
  const { seen, transport } = capture();
  const invoke = invokeWith({}, transport);
  await invoke(modelInput(), new AbortController().signal);
  assertEquals(Object.keys(seen[0].headers).sort(), [
    "accept",
    "anthropic-version",
    "content-type",
    "x-api-key",
  ]);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: a transport failure passes through the header layer unchanged", async () => {
  const wrapped = withRequestHeaders({
    send: () =>
      Promise.resolve(
        err({ code: "unavailable", message: "connection failed" }),
      ),
  }, { "anthropic-beta": "x" });
  const sent = await wrapped.send({
    url: "http://127.0.0.1:1/v1/messages",
    method: "POST",
    headers: {},
    body: "{}",
  });
  assertEquals(sent.ok, false);
});
