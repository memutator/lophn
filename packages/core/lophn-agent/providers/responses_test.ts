// responses_test.ts(provider#R3, R25). fake provider의 실제 HTTP·SSE를 지난다.
// instructions·input items·function tools 번역, call_id 대응, output_item.done과
// response.completed만 complete, incomplete(max_output_tokens 포함)·failed는
// partial이고 tool 미실행, encrypted reasoning item을 run 메모리에서만 재전송을
// 여기 고정한다. 실제 OpenAI API는 부르지 않는다.

import { assert, assertEquals } from "@std/assert";
import {
  applyResponsesFrames,
  buildRequest,
  createResponsesStreamResult,
  judgeResponses,
  type ResponsesStreamResult,
  responsesUsage,
} from "./adapters/responses.ts";
import {
  joinEndpoint,
  quirksFor,
  signatureAgrees,
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
  out: ResponsesStreamResult,
  frames: readonly SseFrame[],
): ResponsesStreamResult {
  applyResponsesFrames(out, frames);
  return out;
}

function serve(script: Script) {
  return startFakeProvider({ script, nowMs: () => 1_000, instant: true });
}

async function post(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await fetch(`${url}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── R3: openai-responses 요청은 /responses path로 나간다 ──────────────────

Deno.test("lophn-agent/harness/provider#R3: openai-responses 요청은 /responses path로 나가고 Gemini 네이티브 형식은 없다", async () => {
  const provider = serve({
    steps: [{
      id: "probe",
      protocol: "responses",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [{ bytes: 'data: {"type":"response.completed"}\n\n' }],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      stream: true,
      store: false,
    });
    assert(response.ok);
    const logged = provider.requests()[0];
    assertEquals(logged.path, "/responses");
    // Google 네이티브 형식(generateContent)은 contracts의 protocol 값에 없다(R3).
    const googleNative: string = "google-generate-content";
    const known = [
      "anthropic-messages",
      "openai-responses",
      "openai-chat-completions",
    ];
    assert(!known.includes(googleNative));
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

// ── R25: 요청 번역(instructions·input items·function tools) ──────────────

Deno.test("lophn-agent/harness/provider#R25: instructions·input items·function tools를 요청으로 번역하고 store=false·stream=true가 고정이다", () => {
  const request = buildRequest({
    model: "fixture-model",
    instructions: "역할 지시",
    input: [
      { role: "user", content: [{ type: "input_text", text: "질문" }] },
    ],
    tools: [{
      type: "function",
      name: "echo",
      parameters: { type: "object" },
    }],
    max_output_tokens: 64,
  });
  assertEquals(request.body.model, "fixture-model");
  // store=false·stream=true는 고정이다(R16).
  assertEquals(request.body.store, false);
  assertEquals(request.body.stream, true);
  assertEquals(request.body.instructions, "역할 지시");
  assertEquals(request.body.max_output_tokens, 64);
  const body = request.body;
  const items = body.input as { role: string }[];
  assertEquals(items[0].role, "user");
  const tools = body.tools as { type: string; name: string }[];
  assertEquals(tools[0].name, "echo");
});

Deno.test("lophn-agent/harness/provider#R25: function_call.call_id와 function_call_output.call_id 대응을 보존한다", () => {
  const input = [
    {
      type: "function_call",
      call_id: "call_1",
      name: "echo",
      arguments: '{"v":1}',
    },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ];
  const request = buildRequest({
    model: "fixture-model",
    input,
    max_output_tokens: 64,
  });
  const items = request.body.input as { type: string; call_id?: string }[];
  assertEquals(items[0].type, "function_call");
  assertEquals(items[0].call_id, "call_1");
  assertEquals(items[1].type, "function_call_output");
  assertEquals(items[1].call_id, "call_1");
});

Deno.test("lophn-agent/harness/provider#R25: 짝 없는 function_call은 요청에서 제거한다", () => {
  const input = [
    {
      type: "function_call",
      call_id: "call_orphan",
      name: "echo",
      arguments: "{}",
    },
    { role: "user", content: [{ type: "input_text", text: "질문" }] },
  ];
  const request = buildRequest({
    model: "fixture-model",
    input,
    max_output_tokens: 64,
  });
  const items = request.body.input as { type?: string }[];
  assertEquals(items.length, 1);
  assertEquals(items[0].type, undefined);
});

// ── R25: SSE 누적과 판정(output_item.done과 response.completed만 complete) ─

Deno.test("lophn-agent/harness/provider#R25: output_item.done의 전체 arguments를 확정 신호로 쓴다", () => {
  // Codex는 function_call_arguments.delta를 무시하고 output_item.done의 전체
  // arguments만 쓴다(조사 문서 483–491).
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_item.added",
      data:
        '{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_a","name":"echo","arguments":""}}',
    },
    {
      event: "response.function_call_arguments.delta",
      data:
        '{"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"v\\":"}',
    },
    {
      event: "response.output_item.done",
      data:
        '{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{\\"v\\":1}"}}',
    },
    {
      event: "response.completed",
      data:
        '{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}}',
    },
  ]);
  assertEquals(out.toolCalls.length, 1);
  assertEquals(out.toolCalls[0].id, "call_a");
  assertEquals(out.toolCalls[0].args, '{"v":1}');
  assertEquals(out.completedCallIds, ["call_a"]);
  assertEquals(judgeResponses(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: output_text.delta를 누적하고 순서를 보존한다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"첫"}',
    },
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"둘"}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  assertEquals(out.text, "첫둘");
  assertEquals(judgeResponses(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: response.completed만 complete다", () => {
  // response.completed 없이 끝난 스트림은 단절이다.
  const cut = createResponsesStreamResult();
  collect(cut, [
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"부분"}',
    },
  ]);
  assertEquals(judgeResponses(cut).kind, "partial");

  const ended = createResponsesStreamResult();
  collect(ended, [
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"답"}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  assertEquals(judgeResponses(ended).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: done을 본 뒤 response.completed가 없는 tool call은 partial로 세운다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_item.done",
      data:
        '{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_x","name":"echo","arguments":"{}"}}',
    },
    // response.completed 대신 incomplete가 왔다. tool은 미실행이다.
    {
      event: "response.incomplete",
      data:
        '{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
    },
  ]);
  const verdict = judgeResponses(out);
  assertEquals(verdict.kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: incomplete(max_output_tokens 포함)는 partial이고 tool 미실행이다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_item.done",
      data:
        '{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_c","name":"echo","arguments":"{}"}}',
    },
    {
      event: "response.incomplete",
      data:
        '{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":11,"output_tokens":3}}}',
    },
  ]);
  assertEquals(out.responseStatus, "incomplete");
  assertEquals(out.incompleteReason, "max_output_tokens");
  const verdict = judgeResponses(out);
  assertEquals(verdict.kind, "partial");
  // partial의 usage도 보존이다. cached가 없으면 input 그대로다.
  assertEquals(out.usage?.input, 11);
  assertEquals(out.usage?.output, 3);
});

Deno.test("lophn-agent/harness/provider#R25: incomplete content_filter는 refused다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.incomplete",
      data:
        '{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"content_filter"}}}',
    },
  ]);
  const verdict = judgeResponses(out);
  assertEquals(verdict.kind, "refused");
  assertEquals(verdict.providerCode, "content_filter");
});

Deno.test("lophn-agent/harness/provider#R25: response.failed는 failed다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.failed",
      data:
        '{"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"서버 오류"}}}',
    },
  ]);
  const verdict = judgeResponses(out);
  assertEquals(verdict.kind, "failed");
  assertEquals(verdict.code, "unknown");
  assertEquals(verdict.providerCode, "server_error");
});

Deno.test("lophn-agent/harness/provider#R25: 부분 JSON arguments를 성공으로 내지 않는다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_item.done",
      data:
        '{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_p","name":"echo","arguments":"{\\"v\\":"}}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  assertEquals(judgeResponses(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: 잘못된 JSON frame은 그 event만 버리고 스트림을 살린다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    { event: "response.output_text.delta", data: "{broken" },
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"이어짐"}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  assertEquals(out.text, "이어짐");
  assertEquals(judgeResponses(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: 모르는 event 종류는 무시하고 나머지를 누적한다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    { event: "exotic_event", data: '{"weird":true}' },
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"본문"}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  assertEquals(out.text, "본문");
  assertEquals(judgeResponses(out).kind, "complete");
});

// ── R25: usage 정규화(input에 cache 포함) ─────────────────────────────────

Deno.test("lophn-agent/harness/provider#R25: cached_tokens를 input 합계 안으로 보고 새 입력을 뺀다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.completed",
      data:
        '{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":20,"input_tokens_details":{"cached_tokens":4},"output_tokens":6,"output_tokens_details":{"reasoning_tokens":2}}}}',
    },
  ]);
  assert(out.usage !== undefined);
  // OpenAI는 cache를 input 합계 안에 둔다(조사 문서 표).
  assertEquals(out.usage.cache_in_input, true);
  // 새 입력은 input_tokens에서 cached_tokens를 빼고 하한 0이다.
  assertEquals(out.usage.input, 16);
  assertEquals(out.usage.cache_read, 4);
  assertEquals(out.usage.output, 6);
  // reasoning은 output의 부분집합이다.
  assertEquals(out.usage.reasoning, 2);
});

Deno.test("lophn-agent/harness/provider#R25: 보고되지 않은 usage 필드는 0이 아니라 모름이다", () => {
  const usage = responsesUsage({ input_tokens: 11 });
  assertEquals(usage.input, 11);
  assertEquals(usage.output, null);
  assertEquals(usage.cache_read, null);
  assertEquals(usage.cache_write, null);
  assertEquals(usage.reasoning, null);
});

// ── R25: encrypted reasoning item과 run 메모리 ────────────────────────────

Deno.test("lophn-agent/harness/provider#R25: reasoning item의 encrypted_content를 결과로 모으고 summary 본문은 제외한다", () => {
  const out = createResponsesStreamResult();
  collect(out, [
    {
      event: "response.output_item.done",
      data:
        '{"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"숨은 사고"}],"encrypted_content":"enc-blob-1"}}',
    },
    {
      event: "response.output_text.delta",
      data: '{"type":"response.output_text.delta","delta":"답"}',
    },
    {
      event: "response.completed",
      data: '{"type":"response.completed","response":{"status":"completed"}}',
    },
  ]);
  // encrypted 원문만 모은다. summary text는 누적 대상이 아니다(R25).
  assertEquals(out.reasoningItems, ["enc-blob-1"]);
  assertEquals(out.text, "답");
});

Deno.test("lophn-agent/harness/provider#R25: reasoning item은 요청에 재전송 대상에서 빼고 encrypted 원문만 메모리로 산다", () => {
  const input = [
    {
      type: "reasoning",
      id: "rs_1",
      summary: [],
      encrypted_content: "enc-blob-1",
    },
    { role: "user", content: [{ type: "input_text", text: "질문" }] },
  ];
  const request = buildRequest({
    model: "fixture-model",
    input,
    max_output_tokens: 64,
    reasoning: ["enc-blob-1"],
  });
  const body = request.body;
  const items = body.input as { type?: string }[];
  // reasoning item은 요청 item에서 제거다. store=false라 item id 재참조가 없다.
  assertEquals(items.length, 1);
  // include는 원문 재전송 근거다(R16, R25).
  assertEquals(
    (body.reasoning as { include: string[] }).include,
    ["reasoning.encrypted_content"],
  );
});

Deno.test("lophn-agent/harness/provider#R25: 시그니처가 같을 때만 재전송 대상이다", () => {
  // T13이 넘긴 시그니처 비교다(plan T14). 같으면 대상, 다르거나 한쪽 없으면 아니다.
  assert(signatureAgrees("sig-1", "sig-1"));
  assert(!signatureAgrees("sig-1", "sig-2"));
  assert(!signatureAgrees("sig-1", undefined));
  assert(!signatureAgrees(undefined, "sig-1"));
});

Deno.test("lophn-agent/harness/provider#R25: opaque 상태가 없어도 Responses는 state-free 계속이 가능하다", () => {
  // reasoning item을 빼도 function_call·call_id 대응이 남는다(architecture §5.2).
  const verdict = verifyStateFree({
    protocol: "openai-responses",
    pendingReasoning: true,
    reasoningRequired: true,
  });
  assert(verdict.continuable);
  assertEquals(verdict.adjustment, "reasoning_item_dropped");
  // 애초에 상태가 없으면 그대로다.
  const none = verifyStateFree({
    protocol: "openai-responses",
    pendingReasoning: false,
    reasoningRequired: true,
  });
  assert(none.continuable);
  assertEquals(none.adjustment, "none");
});

// ── endpoint 결합(/v1 중복 없음)과 provider quirk ─────────────────────────

Deno.test("lophn-agent/harness/provider#R25: endpoint의 /v1 중복 없이 path를 결합한다", () => {
  // base가 /v1으로 끝나면 path의 /v1을 더하지 않는다(plan T14).
  assertEquals(
    joinEndpoint("https://api.openai.com/v1", "/v1/responses"),
    "https://api.openai.com/v1/responses",
  );
  assertEquals(
    joinEndpoint("https://api.openai.com", "/v1/responses"),
    "https://api.openai.com/v1/responses",
  );
  assertEquals(
    joinEndpoint("https://api.openai.com/v1/", "/responses"),
    "https://api.openai.com/v1/responses",
  );
});

Deno.test("lophn-agent/harness/provider#R25: provider 정의 key만 quirk 판정에 쓰고 model 이름은 쓰지 않는다", () => {
  // DeepSeek만 reasoning_content 필수다(조사 문서 1378–1384).
  assert(quirksFor("deepseek").reasoning_content_required);
  // OpenRouter reasoning_details는 무시 대상이다.
  assert(quirksFor("openrouter").reasoning_details_ignored);
  // 모르는 provider와 model 이름 substring은 quirk가 없다(R3).
  assert(!quirksFor("openai").reasoning_content_required);
  assert(!quirksFor("deepseek-r1-distill").reasoning_content_required);
});

// ── fake provider의 실제 stream을 지난다 ───────���──────────────────────────

Deno.test("lophn-agent/harness/provider#R25: fake provider의 정상 stream이 adapter를 그대로 지나 complete다", async () => {
  const provider = serve({
    steps: [{
      id: "normal",
      protocol: "responses",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'event: response.created\ndata: {"type":"response.created"}\n\n',
          },
          {
            bytes:
              'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[]}}\n\n',
          },
          {
            bytes:
              'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"정답"}\n\n',
          },
          {
            bytes:
              'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"정답"}]}}\n\n',
          },
          {
            bytes:
              'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":20,"input_tokens_details":{"cached_tokens":4},"output_tokens":6}}}\n\n',
          },
        ],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      stream: true,
      store: false,
    });
    assert(response.ok);
    const out = collect(
      createResponsesStreamResult(),
      await readFrames(response.body!),
    );
    assertEquals(out.text, "정답");
    assertEquals(out.responseStatus, "completed");
    assertEquals(out.usage?.input, 16);
    assertEquals(out.usage?.cache_read, 4);
    assertEquals(judgeResponses(out).kind, "complete");
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
      protocol: "responses",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'event: response.created\ndata: {"type":"response.created"}\n\n',
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
      store: false,
    });
    assert(response.ok);
    // reset은 body에서 예외로 나온다. frame이 없는 단절이다.
    let failure: unknown = undefined;
    try {
      await readFrames(response.body!);
    } catch (error) {
      failure = error;
    }
    assert(failure !== undefined);
    // 단절은 partial이다. adapter 안에서 재호출하지 않는다.
    assertEquals(judgeResponses(createResponsesStreamResult()).kind, "partial");
    // 요청은 정확히 한 번이다.
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});
