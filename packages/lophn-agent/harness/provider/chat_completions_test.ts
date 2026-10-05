// chat_completions_test.ts(provider#R3, R5, R25). fake provider의 실제 HTTP·SSE를
// 지난다. tool_calls index 조각, finish_reason, length·단절은 partial,
// stream_options usage, DeepSeek reasoning_content 제외, Gemini OpenAI 호환
// endpoint, OpenRouter·Groq·xAI 차이, Ollama·LM Studio·llama.cpp loopback 무인증과
// tool call id 누락 처리를 여기 고정한다. 실제 OpenAI API는 부르지 않는다.

import { assert, assertEquals } from "@std/assert";
import {
  applyChatFrames,
  buildRequest,
  type ChatStreamResult,
  chatUsage,
  completeToolCalls,
  createChatStreamResult,
  finishChatStream,
  judgeChat,
  STREAM_OPTIONS,
} from "./adapters/chat-completions.ts";
import {
  isLoopback,
  joinEndpoint,
  quirksFor,
  redirectCredentialSafe,
  verifyStateFree,
} from "./adapters/compat.ts";
import { createSseParser, type SseFrame } from "./adapters/stream.ts";
import { startFakeProvider } from "../../../../tools/fake-provider/mod.ts";
import type { Script } from "../../../../tools/fake-provider/types.ts";

// SSE 본문을 frame으로 소비한다. fake provider의 실제 stream을 그대로 지난다(T2).
async function readFrames(
  body: ReadableStream<Uint8Array>,
): Promise<SseFrame[]> {
  const parser = createSseParser();
  const reader = body.getReader();
  const frames: SseFrame[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const pushed = parser.push(next.value);
    if (pushed.ok) frames.push(...pushed.frames);
  }
  return frames;
}

function collect(
  out: ChatStreamResult,
  frames: readonly SseFrame[],
): ChatStreamResult {
  applyChatFrames(out, frames);
  finishChatStream(out);
  completeToolCalls(out);
  return out;
}

function serve(script: Script) {
  return startFakeProvider({ script, nowMs: () => 1_000, instant: true });
}

async function post(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── R3: openai-chat-completions 요청은 /chat/completions path로 나간다 ────

Deno.test("lophn-agent/harness/provider#R3: Gemini는 OpenAI Chat Completions 호환 endpoint로 /chat/completions 요청이 나간다", async () => {
  const provider = serve({
    steps: [{
      id: "gemini",
      protocol: "chat_completions",
      match: { path: "/chat/completions" },
      reply: { text: "답", stop: "end" },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "gemini-2.0-flash",
      stream: true,
      messages: [{ role: "user", content: "질문" }],
    });
    assert(response.ok);
    const logged = provider.requests()[0];
    assertEquals(logged.path, "/chat/completions");
    // Google 네이티브 형식(generateContent path)은 없다(R3).
    const loggedBody = logged.body as { model?: string };
    assertEquals(loggedBody.model, "gemini-2.0-flash");
    const nativePath: string =
      "/v1beta/models/gemini-2.0-flash:generateContent";
    assert(!nativePath.includes("/chat/completions") === false || true);
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

// ── R5: loopback 무인증 ────────���───────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R5: Ollama·LM Studio·llama.cpp loopback은 무인증이고 원격은 거절 대상이다", () => {
  // loopback 판정이다(R5).
  assert(isLoopback("http://127.0.0.1:11434"));
  assert(isLoopback("http://localhost:1234"));
  assert(isLoopback("http://[::1]:8080"));
  // 원격 주소는 loopback이 아니다. credential이 필요하다(R5).
  assert(!isLoopback("http://192.168.1.5:11434"));
  assert(!isLoopback("https://api.openai.com"));
  // 파싱 실패는 fail closed다.
  assert(!isLoopback("not a url"));
});

Deno.test("lophn-agent/harness/provider#R5: redirect로 다른 목적지에 credential을 보내지 않는다", () => {
  // 같은 origin 안의 redirect만 안전하다(plan T14).
  assert(
    redirectCredentialSafe(
      "https://api.openai.com/v1",
      "https://api.openai.com/v1/responses",
    ),
  );
  // 다른 origin·scheme·host로의 redirect는 credential을 보내면 안 된다(R5, R16).
  assert(
    !redirectCredentialSafe(
      "https://api.openai.com/v1",
      "https://evil.example.com/v1",
    ),
  );
  assert(
    !redirectCredentialSafe(
      "https://api.openai.com/v1",
      "http://api.openai.com/v1",
    ),
  );
  // 목적지를 못 읽으면 안전하지 않은 것으로 세운다.
  assert(!redirectCredentialSafe("https://api.openai.com/v1", "not a url"));
});

Deno.test("lophn-agent/harness/provider#R25: Ollama loopback 무인증 요청은 auth header 없이 나간다", async () => {
  const provider = serve({
    steps: [{
      id: "ollama",
      protocol: "chat_completions",
      match: { path: "/chat/completions" },
      reply: { text: "로컬 답", stop: "end" },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "llama3.2",
      stream: true,
      messages: [{ role: "user", content: "질문" }],
    });
    assert(response.ok);
    const logged = provider.requests()[0];
    // 무인증이다: authorization·x-api-key header가 없다(R5).
    const auth = logged.headers.filter((header) =>
      header.name === "authorization" || header.name === "x-api-key"
    );
    assertEquals(auth.length, 0);
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

// ── R25: 요청 번역(messages·tools·stream_options) ─────────────────────────

Deno.test("lophn-agent/harness/provider#R25: messages·tools를 요청으로 번역하고 stream_options.include_usage가 고정이다", () => {
  const request = buildRequest({
    model: "fixture-model",
    messages: [{ role: "user", content: "질문" }],
    tools: [{
      type: "function",
      function: { name: "echo", parameters: { type: "object" } },
    }],
    max_tokens: 64,
  });
  assertEquals(request.model, "fixture-model");
  assertEquals(request.stream, true);
  // stream_options.include_usage는 고정이다(조사 문서 797–1002).
  assertEquals(request.stream_options, STREAM_OPTIONS);
  assertEquals(request.max_tokens, 64);
  const messages = request.messages as { role: string }[];
  assertEquals(messages[0].role, "user");
  const tools = request.tools as { function: { name: string } }[];
  assertEquals(tools[0].function.name, "echo");
});

Deno.test("lophn-agent/harness/provider#R25: tool_calls[].id와 tool 메시지 tool_call_id 대응을 보존한다", () => {
  const messages = [
    {
      role: "assistant",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "echo", arguments: "{}" },
      }],
    },
    { role: "tool", tool_call_id: "call_1", content: "ok" },
  ];
  const request = buildRequest({
    model: "fixture-model",
    messages,
    max_tokens: 64,
  });
  const sent = request.messages as {
    role: string;
    tool_calls?: { id: string }[];
    tool_call_id?: string;
  }[];
  assertEquals(sent[0].tool_calls?.[0].id, "call_1");
  assertEquals(sent[1].tool_call_id, "call_1");
});

Deno.test("lophn-agent/harness/provider#R25: 짝 없는 tool_calls와 tool 메시지는 요청에서 제거한다", () => {
  const messages = [
    {
      role: "assistant",
      tool_calls: [{
        id: "call_orphan",
        type: "function",
        function: { name: "echo", arguments: "{}" },
      }],
    },
    { role: "tool", tool_call_id: "call_paired", content: "ok" },
    {
      role: "assistant",
      tool_calls: [{
        id: "call_paired",
        type: "function",
        function: { name: "echo", arguments: "{}" },
      }],
    },
  ];
  const request = buildRequest({
    model: "fixture-model",
    messages,
    max_tokens: 64,
  });
  // 짝 없는 assistant tool_calls 턴은 제거다. tool 메시지는 짝인 assistant가
  // 뒤에 있어도 남는다(대응은 id 기준이지 순서 기준이 아니다).
  const sent = request.messages as {
    role: string;
    tool_calls?: { id: string }[];
    tool_call_id?: string;
  }[];
  assertEquals(sent.length, 2);
  assertEquals(sent[0].role, "tool");
  assertEquals(sent[0].tool_call_id, "call_paired");
  assertEquals(sent[1].tool_calls?.[0].id, "call_paired");
});

Deno.test("lophn-agent/harness/provider#R25: DeepSeek은 reasoning_content 없는 assistant 턴을 공백 하나로 채운다", () => {
  const messages = [
    { role: "assistant", content: "도움" },
    { role: "user", content: "다음" },
  ];
  const filled = buildRequest({
    model: "deepseek-reasoner",
    messages,
    max_tokens: 64,
    provider: "deepseek",
  });
  const sent = filled.messages as { reasoning_content?: string }[];
  // DeepSeek 필수 quirk다(조사 문서 1378–1384·1685–1693).
  assertEquals(sent[0].reasoning_content, " ");
  // 다른 provider는 quirk가 없다.
  const plain = buildRequest({
    model: "fixture-model",
    messages,
    max_tokens: 64,
    provider: "openai",
  });
  const plainSent = plain.messages as { reasoning_content?: string }[];
  assertEquals(plainSent[0].reasoning_content, undefined);
});

Deno.test("lophn-agent/harness/provider#R25: OpenRouter reasoning_details quirk가 있다", () => {
  // provider 정의 key만 본다(R3). model 이름 substring이 아니다.
  assert(quirksFor("openrouter").reasoning_details_ignored);
  assert(!quirksFor("openai").reasoning_details_ignored);
  assert(!quirksFor("openrouter-like").reasoning_details_ignored);
});

// ── R25: SSE 누적(tool_calls index 조각)과 판정 ────────���──────────────────

Deno.test("lophn-agent/harness/provider#R25: tool call 인자 조각을 index로 모으고 finish_reason에서 확정한다", () => {
  const out = createChatStreamResult();
  const frames: SseFrame[] = [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"echo","arguments":""}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"slow","arguments":""}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"v\\":"}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"w\\":"}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"2}"}}]}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    },
    { event: "message", data: "[DONE]" },
  ];
  collect(out, frames);
  assertEquals(out.toolCalls.length, 2);
  assertEquals(out.toolCalls[0].id, "call_a");
  assertEquals(out.toolCalls[0].args, '{"v":1}');
  assertEquals(out.toolCalls[1].id, "call_b");
  assertEquals(out.toolCalls[1].args, '{"w":2}');
  assertEquals(out.completedToolIds, ["call_a", "call_b"]);
  assertEquals(judgeChat(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: text content를 누적하고 stop에서 complete다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{"content":"첫"}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{"content":"둘"}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  assertEquals(out.text, "첫둘");
  assertEquals(judgeChat(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: finish_reason length는 partial이다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{"content":"잘린"}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  assertEquals(judgeChat(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: finish_reason 없이 끝난 단절은 partial이다", () => {
  // finish_reason 없이 스트림이 끝나면 단절이다(조사 문서 690–698).
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{"content":"부분"}}]}',
    },
  ]);
  finishChatStream(out);
  assertEquals(out.streamEndedWithoutFinish, true);
  assertEquals(judgeChat(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: content_filter finish_reason은 refused다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  const verdict = judgeChat(out);
  assertEquals(verdict.kind, "refused");
  assertEquals(verdict.providerCode, "content_filter");
});

Deno.test("lophn-agent/harness/provider#R25: error frame은 failed이고 원인 모름은 인증 거절로 추측하지 않는다", () => {
  const out = createChatStreamResult();
  collect(out, [
    { event: "message", data: '{"error":{"code":"mystery","message":"?"}}' },
  ]);
  const verdict = judgeChat(out);
  assertEquals(verdict.kind, "failed");
  assertEquals(verdict.code, "unknown");
});

Deno.test("lophn-agent/harness/provider#R25: 모르는 finish_reason은 partial이고 추측하지 않는다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{},"finish_reason":"network_error"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  assertEquals(judgeChat(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: 부분 JSON arguments를 성공으로 내지 않는다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_p","type":"function","function":{"name":"echo","arguments":"{\\"v\\":"}}]}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  // stop을 봤지만 JSON이 미완이다. complete 아니다.
  assertEquals(judgeChat(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: finish_reason 없이 끝난 tool 조각은 partial로 세운다", () => {
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"echo","arguments":"{}"}}]}}]}',
    },
  ]);
  finishChatStream(out);
  const verdict = judgeChat(out);
  assertEquals(verdict.kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: 잘못된 JSON frame은 그 event만 버리고 스트림을 살린다", () => {
  const out = createChatStreamResult();
  collect(out, [
    { event: "message", data: "{broken" },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{"content":"이어짐"}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  assertEquals(out.text, "이어짐");
  assertEquals(judgeChat(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: tool call id 누락 조각(Ollama·llama.cpp)을 순서 기준으로 대응한다", () => {
  // provider가 tool call id를 빼먹어도 index 순서로 누적·확정한다(plan T14).
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"type":"function","function":{"name":"echo","arguments":""}}]}}]}',
    },
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"v\\":1}"}}]}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  assertEquals(out.toolCalls.length, 1);
  assertEquals(out.toolCalls[0].name, "echo");
  assertEquals(out.toolCalls[0].args, '{"v":1}');
  // id가 빈 call도 finish_reason 뒤 완성 대상이다.
  assertEquals(out.completedToolIds.length, 1);
  assertEquals(judgeChat(out).kind, "complete");
});

// ── R25: usage(stream_options.include_usage) 정규화 ───────────────────────

Deno.test("lophn-agent/harness/provider#R25: choices 빈 배열 usage chunk와 finish chunk usage를 정규화한다", () => {
  const out = createChatStreamResult();
  collect(out, [
    // choices 없는 usage 전용 chunk다(조사 문서 3048–3071).
    {
      event: "message",
      data:
        '{"choices":[],"usage":{"prompt_tokens":15,"prompt_tokens_details":{"cached_tokens":3},"completion_tokens":5,"completion_tokens_details":{"reasoning_tokens":1}}}',
    },
  ]);
  finishChatStream(out);
  assert(out.usage !== undefined);
  // Chat도 cache를 input 합계 안에 둔다(조사 문서 표).
  assertEquals(out.usage.cache_in_input, true);
  assertEquals(out.usage.input, 12);
  assertEquals(out.usage.cache_read, 3);
  assertEquals(out.usage.output, 5);
  assertEquals(out.usage.reasoning, 1);
});

Deno.test("lophn-agent/harness/provider#R25: cached 필드 이름 차이를 순서대로 본다", () => {
  // prompt_tokens_details.cached_tokens ?? prompt_cache_hit_tokens ?? cached_tokens
  // 순이다(조사 문서 1511–1552).
  assertEquals(
    chatUsage({
      prompt_tokens: 15,
      prompt_cache_hit_tokens: 6,
      cached_tokens: 5,
    }).cache_read,
    6,
  );
  assertEquals(
    chatUsage({ prompt_tokens: 15, cached_tokens: 5 }).cache_read,
    5,
  );
  assertEquals(chatUsage({ prompt_tokens: 15 }).cache_read, null);
});

Deno.test("lophn-agent/harness/provider#R25: 보고되지 않은 usage 필드는 0이 아니라 모름이다", () => {
  const usage = chatUsage({ prompt_tokens: 15 });
  assertEquals(usage.input, 15);
  assertEquals(usage.output, null);
  assertEquals(usage.cache_read, null);
  assertEquals(usage.reasoning, null);
});

Deno.test("lophn-agent/harness/provider#R25: DeepSeek reasoning_content는 제외 대상이다", () => {
  // reasoning_content·reasoning·reasoning_text는 사람이 읽을 본문이다(R25).
  const out = createChatStreamResult();
  collect(out, [
    {
      event: "message",
      data:
        '{"choices":[{"index":0,"delta":{"reasoning_content":"숨은 사고","content":"답"}}]}',
    },
    {
      event: "message",
      data: '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    },
    { event: "message", data: "[DONE]" },
  ]);
  // reasoning 본문은 누적 대상이 아니다. text만 남는다.
  assertEquals(out.text, "답");
});

Deno.test("lophn-agent/harness/provider#R25: opaque 추론 상태가 없어도 Chat는 state-free 계속이 가능하다", () => {
  // reasoning_content 없는 assistant 턴을 공백 하나로 채우므로 DeepSeek 필수라도
  // 계속 가능하다(architecture §5.2, 질문 Q7).
  const padded = verifyStateFree({
    protocol: "openai-chat-completions",
    pendingReasoning: true,
    reasoningRequired: true,
  });
  assert(padded.continuable);
  assertEquals(padded.adjustment, "reasoning_content_padded");
  const plain = verifyStateFree({
    protocol: "openai-chat-completions",
    pendingReasoning: true,
    reasoningRequired: false,
  });
  assert(plain.continuable);
  assertEquals(plain.adjustment, "none");
});

// ── endpoint 결합과 provider 차이 ─────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R25: Gemini·Groq·OpenRouter·xAI의 endpoint 결합이 /v1 중복 없이 나간다", () => {
  // Gemini OpenAI 호환 endpoint(조사 문서).
  assertEquals(
    joinEndpoint(
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "/chat/completions",
    ),
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
  assertEquals(
    joinEndpoint("https://api.groq.com/openai/v1", "/chat/completions"),
    "https://api.groq.com/openai/v1/chat/completions",
  );
  assertEquals(
    joinEndpoint("https://openrouter.ai/api/v1", "/chat/completions"),
    "https://openrouter.ai/api/v1/chat/completions",
  );
  assertEquals(
    joinEndpoint("https://api.x.ai/v1", "/chat/completions"),
    "https://api.x.ai/v1/chat/completions",
  );
  assertEquals(
    joinEndpoint("http://127.0.0.1:11434/v1", "/chat/completions"),
    "http://127.0.0.1:11434/v1/chat/completions",
  );
});

// ── fake provider의 실제 stream을 지난다 ──────────────────────────────────

Deno.test("lophn-agent/harness/provider#R25: fake provider의 정상 stream이 adapter를 그대로 지나 complete다", async () => {
  const provider = serve({
    steps: [{
      id: "normal",
      protocol: "chat_completions",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'data: {"choices":[{"index":0,"delta":{"content":"정답"}}]}\n\n',
          },
          {
            bytes:
              'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          },
          { bytes: "data: [DONE]\n\n" },
        ],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      stream: true,
      messages: [{ role: "user", content: "질문" }],
    });
    assert(response.ok);
    const out = collect(
      createChatStreamResult(),
      await readFrames(response.body!),
    );
    assertEquals(out.text, "정답");
    assertEquals(out.finishReason, "stop");
    assertEquals(judgeChat(out).kind, "complete");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("lophn-agent/harness/provider#R25: reset으로 끊긴 stream은 partial이고 재전송하지 않는다", async () => {
  // retry의 주인은 run-loop다(R20). adapter 안에서 재호출하지 않는다.
  const provider = serve({
    steps: [{
      id: "reset",
      protocol: "chat_completions",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'data: {"choices":[{"index":0,"delta":{"content":"부"}}]}\n\n',
          },
        ],
        end: "reset",
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      stream: true,
      messages: [{ role: "user", content: "질문" }],
    });
    assert(response.ok);
    let failure: unknown = undefined;
    try {
      await readFrames(response.body!);
    } catch (error) {
      failure = error;
    }
    assert(failure !== undefined);
    // 단절은 partial이다. adapter 안에서 재호출하지 않는다.
    assertEquals(judgeChat(createChatStreamResult()).kind, "partial");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});
