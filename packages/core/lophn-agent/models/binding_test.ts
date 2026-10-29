import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicPacker } from "./binding.ts";

// 넷을 넘으면 Anthropic이 요청을 모두 거절한다.
test("Anthropic 요청은 대화 끝 content block에 cache 표시를 달고 표시는 넷을 넘지 않는다", () => {
  const pack = anthropicPacker({
    model: "m",
    maxTokens: 1000,
    images: false,
    native: false,
  })({
    system: [
      { layer: "place_kind", text: "r", cache: true },
      { layer: "instructions", text: "i", cache: true },
      { layer: "skills", text: "s", cache: false },
      { layer: "place", text: "p", cache: true },
    ],
    tools: [{ name: "t", description: "d", input_schema: { type: "object" } }],
    messages: [
      { role: "user", parts: [{ kind: "text", text: "go" }] },
      {
        role: "assistant",
        parts: [{ kind: "tool_use", id: "u1", name: "t", input: {} }],
      },
      { role: "user", parts: [{ kind: "tool_result", id: "u1", text: "ok" }] },
    ],
  });
  const body = pack.body as { messages: Record<string, unknown>[] };

  const last = body.messages[2];
  const blocks = last.content as Record<string, unknown>[];
  assert.deepStrictEqual(blocks[blocks.length - 1].cache_control, {
    type: "ephemeral",
  });
  assert.deepStrictEqual("cache_control" in last, false);
  assert.deepStrictEqual(
    JSON.stringify(body).split('"cache_control"').length - 1,
    4,
  );
});
