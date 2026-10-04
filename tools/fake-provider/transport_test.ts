import { assertEquals, assertThrows } from "@std/assert";
import { type FakeProvider, startFakeProvider } from "./mod.ts";
import type { Script } from "./types.ts";

function serve(script: Script): FakeProvider {
  return startFakeProvider({ script, nowMs: () => 1_000, instant: true });
}

async function post(
  url: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("tools/fake-provider: 첫 chunk를 받은 뒤에야 다음 gate를 기다린다", async () => {
  const provider = serve({
    steps: [{
      id: "paced",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [
          { bytes: "data: one\n\n" },
          { bytes: "data: two\n\n", gate: "next" },
        ],
      },
    }],
  });
  try {
    const response = await fetch(`${provider.url}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body 없음");
    const first = await reader.read();
    assertEquals(new TextDecoder().decode(first.value), "data: one\n\n");
    let second: ReadableStreamReadResult<Uint8Array> | undefined;
    const pending = reader.read().then((value) => {
      second = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEquals(second, undefined);
    provider.release("next");
    await pending;
    assertEquals(new TextDecoder().decode(second?.value), "data: two\n\n");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: reset은 받은 byte 뒤에 연결을 끊고 정상 close가 아니다", async () => {
  const provider = serve({
    steps: [{
      id: "drop",
      protocol: "chat_completions",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [{ bytes: "data: partial\n\n" }],
        end: "reset",
      },
    }],
  });
  try {
    const response = await fetch(`${provider.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body 없음");
    const first = await reader.read();
    assertEquals(new TextDecoder().decode(first.value), "data: partial\n\n");
    let failed = false;
    try {
      const next = await reader.read();
      failed = next.done === true;
    } catch {
      failed = false;
    }
    assertEquals(failed, false);
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 잘못된 script는 거절하고 응답을 순환하지 않는다", async () => {
  const provider = serve({ steps: [] });
  try {
    const rejected = await fetch(`${provider.url}/__fake/script`, {
      method: "POST",
      body: JSON.stringify({ steps: [{ id: "bad" }] }),
    });
    assertEquals(rejected.status, 400);
    const once = await fetch(`${provider.url}/__fake/script`, {
      method: "POST",
      body: JSON.stringify({
        steps: [{ id: "only", protocol: "messages", reply: { text: "once" } }],
      }),
    });
    assertEquals(once.status, 200);
    assertEquals((await post(provider.url, "/messages", {})).status, 200);
    assertEquals((await post(provider.url, "/messages", {})).status, 500);
    assertThrows(() => provider.assertDone(1), Error, "응답 소진");
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: 세 protocol 정상 SSE의 text, 두 tool, 종료 sequence를 HTTP로 그대로 낸다", async () => {
  const event = (type: string, fields: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
  const message = {
    id: "m",
    type: "message",
    role: "assistant",
    model: "fixture-model",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  const responseText = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "ok", annotations: [] }],
  };
  const responseTools = [1, 2].map((index) => ({
    id: `fc_${index}`,
    type: "function_call",
    status: "completed",
    call_id: `call_${index}`,
    name: "echo",
    arguments: '{"value":"ok"}',
  }));
  const response = {
    id: "r",
    object: "response",
    created_at: 1,
    model: "fixture-model",
    status: "in_progress",
    output: [],
    error: null,
    incomplete_details: null,
  };
  let sequence = 0;
  const responseEvent = (type: string, fields: Record<string, unknown>) =>
    event(type, { sequence_number: sequence++, ...fields });
  const chat = (delta: unknown, finish_reason: string | null = null) =>
    `data: ${
      JSON.stringify({
        id: "c",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        choices: [{ index: 0, delta, finish_reason }],
      })
    }\n\n`;
  const fixtures = [
    {
      protocol: "messages" as const,
      path: "/messages",
      frames: [
        event("message_start", { message }),
        event("content_block_start", {
          index: 0,
          content_block: { type: "text", text: "" },
        }),
        event("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        }),
        event("content_block_stop", { index: 0 }),
        ...[1, 2].flatMap((index) => [
          event("content_block_start", {
            index,
            content_block: {
              type: "tool_use",
              id: `call_${index}`,
              name: "echo",
              input: {},
            },
          }),
          event("content_block_delta", {
            index,
            delta: { type: "input_json_delta", partial_json: '{"value":' },
          }),
          event("content_block_delta", {
            index,
            delta: { type: "input_json_delta", partial_json: '"ok"}' },
          }),
          event("content_block_stop", { index }),
        ]),
        event("message_delta", {
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 4 },
        }),
        event("message_stop", {}),
      ],
    },
    {
      protocol: "responses" as const,
      path: "/responses",
      frames: [
        responseEvent("response.created", { response }),
        responseEvent("response.in_progress", { response }),
        responseEvent("response.output_item.added", {
          output_index: 0,
          item: { ...responseText, status: "in_progress", content: [] },
        }),
        responseEvent("response.content_part.added", {
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        }),
        responseEvent("response.output_text.delta", {
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "ok",
          logprobs: [],
        }),
        responseEvent("response.output_text.done", {
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          text: "ok",
          logprobs: [],
        }),
        responseEvent("response.content_part.done", {
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          part: responseText.content[0],
        }),
        responseEvent("response.output_item.done", {
          output_index: 0,
          item: responseText,
        }),
        ...responseTools.flatMap((item, offset) => [
          responseEvent("response.output_item.added", {
            output_index: offset + 1,
            item: { ...item, status: "in_progress", arguments: "" },
          }),
          responseEvent("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: offset + 1,
            delta: '{"value":',
          }),
          responseEvent("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: offset + 1,
            delta: '"ok"}',
          }),
          responseEvent("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: offset + 1,
            arguments: item.arguments,
          }),
          responseEvent("response.output_item.done", {
            output_index: offset + 1,
            item,
          }),
        ]),
        responseEvent("response.completed", {
          response: {
            ...response,
            status: "completed",
            output: [responseText, ...responseTools],
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          },
        }),
      ],
    },
    {
      protocol: "chat_completions" as const,
      path: "/chat/completions",
      frames: [
        chat({ role: "assistant", content: "" }),
        chat({ content: "ok" }),
        ...[0, 1].flatMap((index) => [
          chat({
            tool_calls: [{
              index,
              id: `call_${index}`,
              type: "function",
              function: { name: "echo", arguments: "" },
            }],
          }),
          chat({
            tool_calls: [{ index, function: { arguments: '{"value":' } }],
          }),
          chat({ tool_calls: [{ index, function: { arguments: '"ok"}' } }] }),
        ]),
        chat({}, "tool_calls"),
        "data: [DONE]\n\n",
      ],
    },
  ];
  const provider = serve({
    steps: fixtures.map((fixture) => ({
      id: fixture.protocol,
      protocol: fixture.protocol,
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: fixture.frames.map((bytes) => ({ bytes })),
      },
    })),
  });
  try {
    for (const fixture of fixtures) {
      const response = await post(provider.url, fixture.path, {});
      assertEquals(response.headers.get("content-type"), "text/event-stream");
      assertEquals(await response.text(), fixture.frames.join(""));
    }
    provider.assertDone(3);
  } finally {
    await provider.close();
  }
});
