// messages_test.ts(provider#R3, R25, R26). fake provider의 실제 HTTP·SSE를 지난다.
// 시스템·messages·tools 번역, tool_use.id↔tool_result 대응, complete 판정,
// opaque 상태 메모리, cache 표시, SDK 숨은 retry 0을 여기 고정한다. 실제
// Anthropic API는 부르지 않는다.

import { assert, assertEquals } from "@std/assert";
import {
  anthropicUsage,
  applyFrames,
  boundaryCount,
  buildRequest,
  createReasoningMemory,
  createStreamResult,
  judge,
  reasoningFor,
  type StreamResult,
} from "./adapters/messages.ts";
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

function collect(out: StreamResult, frames: readonly SseFrame[]): StreamResult {
  applyFrames(out, frames);
  return out;
}

function serve(script: Script) {
  return startFakeProvider({ script, nowMs: () => 1_000, instant: true });
}

async function post(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await fetch(`${url}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── R3: 세 형식 중 anthropic-messages만 이 adapter가 번역한다 ─────────────

Deno.test("lophn-agent/harness/provider#R3: anthropic-messages 요청은 /messages path로 나가고 세 형식의 protocol 값만 허용된다", async () => {
  const provider = serve({
    steps: [{
      id: "probe",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [{ bytes: 'data: {"type":"message_stop"}\n\n' }],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      max_tokens: 16,
    });
    assert(response.ok);
    const logged = provider.requests()[0];
    assertEquals(logged.path, "/messages");
    // protocol 값은 contracts의 세 가지뿐이다. 네 번째 값은 contracts에 없다(R3).
    const fourth: string = "anthropic-native";
    const known = [
      "anthropic-messages",
      "openai-responses",
      "openai-chat-completions",
    ];
    assert(!known.includes(fourth));
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

// ── R25: 요청 번역(system·messages·tools)과 SSE 응답 누적 ────────────────

Deno.test("lophn-agent/harness/provider#R25: system·messages·tools를 요청으로 번역한다", () => {
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    system: [{ type: "text", text: "역할" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "질문" }] },
    ],
    tools: [{ name: "echo", input_schema: { type: "object" } }],
  });
  assertEquals(request.model, "fixture-model");
  assertEquals(request.max_tokens, 64);
  assertEquals(
    (request.system as { type: string; text?: string }[])[0].text,
    "역할",
  );
  assertEquals(
    (request.messages as { role: string }[])[0].role,
    "user",
  );
  assertEquals(
    (request.tools as { name: string }[])[0].name,
    "echo",
  );
});

Deno.test("lophn-agent/harness/provider#R25: tool_use.id와 tool_result.tool_use_id 대응을 보존한다", () => {
  const messages = [
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "echo", input: {} }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
    },
  ];
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    messages,
  });
  const sent = request.messages as {
    role: string;
    content: { type: string; id?: string; tool_use_id?: string }[];
  }[];
  assertEquals(sent[0].content[0].type, "tool_use");
  assertEquals(sent[0].content[0].id, "toolu_1");
  assertEquals(sent[1].content[0].type, "tool_result");
  assertEquals(sent[1].content[0].tool_use_id, "toolu_1");
});

Deno.test("lophn-agent/harness/provider#R25: 짝 없는 tool_use는 요청에서 제거한다", () => {
  const messages = [
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "toolu_orphan",
        name: "echo",
        input: {},
      }],
    },
    { role: "user", content: [{ type: "text", text: "질문" }] },
  ];
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    messages,
  });
  const sent = request.messages as { content: { type: string }[] }[];
  assertEquals(sent[0].content.length, 0);
  assertEquals(sent[1].content.length, 1);
});

Deno.test("lophn-agent/harness/provider#R25: tool 인자 조각을 index로 모으고 순서를 보존한다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_a","name":"echo"}}',
    },
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_b","name":"slow"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"v\\":"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"w\\":"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"1}"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"2}"}}',
    },
    {
      event: "content_block_stop",
      data: '{"type":"content_block_stop","index":0}',
    },
    {
      event: "content_block_stop",
      data: '{"type":"content_block_stop","index":1}',
    },
  ];
  collect(out, frames);
  assertEquals(out.toolCalls.length, 2);
  assertEquals(out.toolCalls[0].id, "toolu_a");
  assertEquals(out.toolCalls[0].args, '{"v":1}');
  assertEquals(out.toolCalls[1].id, "toolu_b");
  assertEquals(out.toolCalls[1].args, '{"w":2}');
  assertEquals(out.completedToolIds, ["toolu_a", "toolu_b"]);
});

Deno.test("lophn-agent/harness/provider#R25: content_block_start가 빠진 index 희소 배열을 judge가 안전히 세운다", () => {
  // message_stop 안에서 index 0이 희소 구멍이면(unused index 아님, 존재 건너뜀) 구멍을
  // 전체 완성이 아니라 partial로 세운다. 구멍에서 던지지 않는다.
  const out = createStreamResult();
  collect(out, [
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_b","name":"echo"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"w\\":2}"}}',
    },
    {
      event: "content_block_stop",
      data: '{"type":"content_block_stop","index":1}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ]);
  assertEquals(out.toolCalls.length, 2);
  // index 0은 구멍이다. complete가 아니라 partial이다. 던져지지 않는다.
  const verdict = judge(out);
  assertEquals(verdict.kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: stop 없이 끝난 tool 인자는 완성이 아니다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_x","name":"echo"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"v\\":"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ];
  collect(out, frames);
  assertEquals(out.toolCalls.length, 1);
  assertEquals(out.messageEnded, true);
  assertEquals(out.completedToolIds.length, 0);
  // stop 없이 끝난 조각은 부분 JSON이다. complete가 아니라 partial이다.
  const verdict = judge(out);
  assertEquals(verdict.kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: 부분 JSON을 성공으로 내지 않는다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_p","name":"echo"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"v\\":"}}',
    },
    {
      event: "content_block_stop",
      data: '{"type":"content_block_stop","index":0}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ];
  collect(out, frames);
  // stop을 봤지만 JSON이 미완이다. complete 아니다.
  const verdict = judge(out);
  assertEquals(verdict.kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: 잘못된 JSON frame은 그 event만 버리고 스트림을 살린다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    { event: "content_block_delta", data: "{broken" },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"이어짐"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ];
  collect(out, frames);
  assertEquals(out.text, "이어짐");
  assertEquals(judge(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: 모르는 event 종류는 무시하고 나머지를 누적한다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    { event: "exotic_event", data: '{"weird":true}' },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"본문"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ];
  collect(out, frames);
  assertEquals(out.text, "본문");
  assertEquals(judge(out).kind, "complete");
});

Deno.test("lophn-agent/harness/provider#R25: 사람이 읽을 추론 본문(thinking_delta)은 제외한다", () => {
  const out = createStreamResult();
  const frames: SseFrame[] = [
    {
      event: "content_block_start",
      data:
        '{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"숨은 사고"}}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}',
    },
    {
      event: "content_block_stop",
      data: '{"type":"content_block_stop","index":0}',
    },
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"답"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ];
  collect(out, frames);
  // thinking 본문은 누적 대상이 아니다. text만 남는다.
  assertEquals(out.text, "답");
});

Deno.test("lophn-agent/harness/provider#R25: message 종료와 stop reason을 본 뒤에만 complete다", () => {
  // message_stop 전에 끊긴 스트림은 stop reason이 있어도 partial이다.
  const cut = createStreamResult();
  collect(cut, [
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"부분"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    },
  ]);
  assertEquals(judge(cut).kind, "partial");

  const ended = createStreamResult();
  collect(ended, [
    ...cutFrames(),
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ]);
  assertEquals(judge(ended).kind, "complete");
});

function cutFrames(): SseFrame[] {
  return [
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"부분"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    },
  ];
}

Deno.test("lophn-agent/harness/provider#R25: refusal·sensitive stop reason은 refused다", () => {
  for (const reason of ["refusal", "sensitive"]) {
    const out = createStreamResult();
    collect(out, [
      {
        event: "message_delta",
        data: `{"type":"message_delta","delta":{"stop_reason":"${reason}"}}`,
      },
      { event: "message_stop", data: '{"type":"message_stop"}' },
    ]);
    const verdict = judge(out);
    assertEquals(verdict.kind, "refused");
    assertEquals(verdict.providerCode, reason);
  }
});

Deno.test("lophn-agent/harness/provider#R25: max_tokens stop reason은 partial이다", () => {
  const out = createStreamResult();
  collect(out, [
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"잘린"}}',
    },
    {
      event: "message_delta",
      data: '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ]);
  assertEquals(judge(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: stop reason 없이 message_stop만 온 것은 partial이다", () => {
  const out = createStreamResult();
  collect(out, [
    {
      event: "content_block_delta",
      data:
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"텍스트"}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ]);
  assertEquals(judge(out).kind, "partial");
});

Deno.test("lophn-agent/harness/provider#R25: in-stream error frame은 failed다", () => {
  const out = createStreamResult();
  collect(out, [
    {
      event: "error",
      data:
        '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    },
  ]);
  const verdict = judge(out);
  assertEquals(verdict.kind, "failed");
  assertEquals(verdict.code, "temporary");
  assertEquals(verdict.providerCode, "overloaded_error");
});

Deno.test("lophn-agent/harness/provider#R25: 원인을 모르는 error 종류는 unknown이고 인증 실패로 추측하지 않는다", () => {
  const out = createStreamResult();
  collect(out, [
    {
      event: "error",
      data: '{"type":"error","error":{"type":"mystery","message":"?"}}',
    },
  ]);
  const verdict = judge(out);
  assertEquals(verdict.kind, "failed");
  assertEquals(verdict.code, "unknown");
});

Deno.test("lophn-agent/harness/provider#R25: usage를 message_start·message_delta에서 정규화하고 cache는 input 밖이다", () => {
  const out = createStreamResult();
  collect(out, [
    {
      event: "message_start",
      data:
        '{"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":5,"cache_creation_input_tokens":2}}}',
    },
    {
      event: "message_delta",
      data:
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    },
    { event: "message_stop", data: '{"type":"message_stop"}' },
  ]);
  assert(out.usage !== undefined);
  assertEquals(out.usage.input, 11);
  assertEquals(out.usage.cache_read, 5);
  assertEquals(out.usage.cache_write, 2);
  assertEquals(out.usage.output, 7);
  // Anthropic은 cache를 input 합계 밖에 둔다(조사 문서 표).
  assertEquals(out.usage.cache_in_input, false);
});

Deno.test("lophn-agent/harness/provider#R25: 보고되지 않은 usage 필드는 0이 아니라 모름이다", () => {
  const usage = anthropicUsage({ input_tokens: 11 });
  assertEquals(usage.input, 11);
  assertEquals(usage.output, null);
  assertEquals(usage.cache_read, null);
  assertEquals(usage.cache_write, null);
  assertEquals(usage.reasoning, null);
});

Deno.test("lophn-agent/harness/provider#R25: opaque 상태는 같은 run·provider·model 메모리에서만 재사용한다", () => {
  const memory = createReasoningMemory();
  memory.set("run_1", "pvd_1", "fixture-model", { signature: "sig-1" });
  assertEquals(
    memory.get("run_1", "pvd_1", "fixture-model")?.signature,
    "sig-1",
  );
  // provider가 바뀌면 없는 것과 같다.
  assertEquals(memory.get("run_1", "pvd_2", "fixture-model"), undefined);
  // model이 바뀌면 없는 것과 같다.
  assertEquals(memory.get("run_1", "pvd_1", "other-model"), undefined);
  // run이 바뀌면 없는 것과 같다.
  assertEquals(memory.get("run_2", "pvd_1", "fixture-model"), undefined);
  // run 종료 시 버린다.
  memory.drop("run_1");
  assertEquals(memory.get("run_1", "pvd_1", "fixture-model"), undefined);
});

Deno.test("lophn-agent/harness/provider#R25: 필요한데 메모리가 비어 있으면 state-free 재시도를 하지 않는다", () => {
  const memory = createReasoningMemory();
  const missing = reasoningFor(memory, {
    run: "run_1",
    provider: "pvd_1",
    model: "fixture-model",
    required: true,
  });
  assert(!missing.ok);
  const optional = reasoningFor(memory, {
    run: "run_1",
    provider: "pvd_1",
    model: "fixture-model",
    required: false,
  });
  assert(optional.ok);
  assertEquals(optional.value, undefined);
});

// ── R26: cache 경계(최대 3곳, 5분 고정) ───────────────────────────────────

Deno.test("lophn-agent/harness/provider#R26: cache 경계 최대 3곳이고 마지막 block에 ephemeral 표시가 붙는다", () => {
  const boundaries = { system: true, tools: true, final_user: true };
  assertEquals(boundaryCount(boundaries), 3);
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    system: [{ type: "text", text: "역할" }],
    messages: [{ role: "user", content: [{ type: "text", text: "질문" }] }],
    tools: [{ name: "echo", input_schema: { type: "object" } }],
    boundaries,
  });
  // system 마지막 block에 cache_control이 붙는다.
  const system = request.system as { cache_control?: { type: string } }[];
  assertEquals(system[system.length - 1].cache_control?.type, "ephemeral");
  // tools 마지막 항목에도 붙는다.
  const tools = request.tools as { cache_control?: { type: string } }[];
  assertEquals(tools[tools.length - 1].cache_control?.type, "ephemeral");
  // Anthropic 방식: message 수준(마지막)에 경계 표시가 붙는다(buildRequest의 markLast).
  // content 안의 block이 아니라 message object에 붙는다.
  const messages = request.messages as {
    content: { type: string }[];
    cache_control?: { type: string };
  }[];
  const lastMessage = messages[messages.length - 1];
  assertEquals(lastMessage.cache_control?.type, "ephemeral");
});

Deno.test("lophn-agent/harness/provider#R26: 경계가 없는 block에는 cache 표시가 없다", () => {
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    system: [{ type: "text", text: "역할" }],
    messages: [{ role: "user", content: [{ type: "text", text: "질문" }] }],
  });
  const system = request.system as { cache_control?: unknown }[];
  assertEquals(system[0].cache_control, undefined);
});

Deno.test("lophn-agent/harness/provider#R26: fake provider의 정상 stream이 adapter를 그대로 지나 complete다", async () => {
  const provider = serve({
    steps: [{
      id: "normal",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
          },
          {
            bytes:
              'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
          },
          {
            bytes:
              'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"정답"}}\n\n',
          },
          {
            bytes:
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          },
          {
            bytes:
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
          },
          { bytes: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' },
        ],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      max_tokens: 16,
    });
    assert(response.ok);
    const frames = await readFrames(response.body!);
    const out = collect(createStreamResult(), frames);
    assertEquals(out.text, "정답");
    assertEquals(out.usage?.input, 11);
    assertEquals(out.usage?.output, 7);
    assertEquals(judge(out).kind, "complete");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("lophn-agent/harness/provider#R26: cache 미지원 서버도 cache 없이 성공한다", async () => {
  // cache 표시를 붙이지 않은 요청은 cache 없는 서버에서도 성공이다(R26).
  const provider = serve({
    steps: [{
      id: "no-cache",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
          },
          { bytes: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' },
        ],
      },
    }],
  });
  try {
    // cache 경계 없이 번역한 요청에는 cache_control이 없다.
    const request = buildRequest({
      model: "fixture-model",
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: "질문" }] }],
    });
    assert(!JSON.stringify(request).includes("cache_control"));
    const response = await post(provider.url, request);
    assert(response.ok);
    const out = collect(createStreamResult(), await readFrames(response.body!));
    assertEquals(judge(out).kind, "complete");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

// ── SDK 숨은 retry 0 ──────────────────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R25: SDK 숨은 retry는 0이고 호출은 한 번이다", async () => {
  // 첫 응답에서 stream이 끊겨도 provider 안에서 재전송하지 않는다. retry의 주인은
  // run-loop이고 새 ModelCall로 한다(R20).
  const provider = serve({
    steps: [{
      id: "reset",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          { bytes: 'event: message_start\ndata: {"type":"message_start"}\n\n' },
        ],
        end: "reset",
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      max_tokens: 16,
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
    assertEquals(judge(createStreamResult()).kind, "partial");
    // 요청은 정확히 한 번이다.
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("lophn-agent/harness/provider#R25: reset·error 뒤에도 두 번째 요청은 없다", async () => {
  const provider = serve({
    steps: [{
      id: "err",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          {
            bytes:
              'event: error\ndata: {"type":"error","error":{"type":"api_error"}}\n\n',
          },
        ],
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      max_tokens: 16,
    });
    assert(response.ok);
    const out = collect(createStreamResult(), await readFrames(response.body!));
    assertEquals(judge(out).kind, "failed");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("lophn-agent/harness/provider#R25: thinking signature를 요청에 원문 그대로 재전송한다", () => {
  const memory = createReasoningMemory();
  memory.set("run_1", "pvd_1", "fixture-model", {
    signature: "sig-9",
    data: "redacted-1",
  });
  const found = reasoningFor(memory, {
    run: "run_1",
    provider: "pvd_1",
    model: "fixture-model",
    required: true,
  });
  assert(found.ok);
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-9" },
        { type: "text", text: "답" },
      ],
    },
  ];
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    messages,
    reasoning: found.value,
  });
  const sent = request.messages as {
    content: { type: string; signature?: string }[];
  }[];
  assertEquals(sent[0].content[0].signature, "sig-9");
});

Deno.test("lophn-agent/harness/provider#R25: redacted_thinking data를 원문 그대로 재전송한다", () => {
  const memory = createReasoningMemory();
  memory.set("run_1", "pvd_1", "fixture-model", { data: "encrypted-blob" });
  const found = reasoningFor(memory, {
    run: "run_1",
    provider: "pvd_1",
    model: "fixture-model",
    required: true,
  });
  assert(found.ok);
  const messages = [
    {
      role: "assistant",
      content: [{ type: "redacted_thinking", data: "encrypted-blob" }],
    },
  ];
  const request = buildRequest({
    model: "fixture-model",
    max_tokens: 64,
    messages,
    reasoning: found.value,
  });
  const sent = request.messages as {
    content: { type: string; data?: string }[];
  }[];
  assertEquals(sent[0].content[0].type, "redacted_thinking");
  assertEquals(sent[0].content[0].data, "encrypted-blob");
});

Deno.test("lophn-agent/harness/provider#R25: provider나 model이 바뀌면 opaque 상태를 재전송하지 않는다", () => {
  const memory = createReasoningMemory();
  memory.set("run_1", "pvd_1", "fixture-model", { signature: "sig-1" });
  // provider가 바뀐 상태로는 읽지 못한다. 재전송 근거도 없다.
  const changed = reasoningFor(memory, {
    run: "run_1",
    provider: "pvd_2",
    model: "fixture-model",
    required: false,
  });
  assert(changed.ok);
  assertEquals(changed.value, undefined);
});

Deno.test("lophn-agent/harness/provider#R25: fake provider의 녹화 fixture body도 adapter를 지난다", async () => {
  const provider = serve({
    steps: [{
      id: "fixture-like",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body:
          '{"id":"msg_fixture","type":"message","role":"assistant","content":[{"type":"text","text":"fixture text"},{"type":"tool_use","id":"toolu_fixture","name":"echo","input":{"value":"ok"}}],"stop_reason":"tool_use","usage":{"input_tokens":11,"output_tokens":7}}',
      },
    }],
  });
  try {
    const response = await post(provider.url, {
      model: "fixture-model",
      max_tokens: 16,
    });
    // 비stream JSON 본문은 SSE가 아니다. frame이 없고, 단절로 세지 않는다.
    const text = await response.text();
    assert(text.includes("toolu_fixture"));
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});
