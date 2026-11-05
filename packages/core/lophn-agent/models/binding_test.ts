import assert from "node:assert/strict";
import { test } from "node:test";
import type { PromptRequest, WirePacker } from "../prompt-assembly/mod.ts";
import {
  anthropicPacker,
  chatPacker,
  cloudCodePacker,
  responsesPacker,
} from "./binding.ts";

const IMAGE_OMITTED = "(image omitted: this model does not accept image input)";

// 넷을 넘으면 Anthropic이 요청을 모두 거절한다.
test("Anthropic 요청은 대화 끝 content block에 cache 표시를 달고 표시는 넷을 넘지 않는다", () => {
  const pack = anthropicPacker({
    model: "m",
    maxTokens: 1000,
    images: false,
  })({
    system: [
      { layer: "workspace_kind", text: "r", cache: true },
      { layer: "instructions", text: "i", cache: true },
      { layer: "skills", text: "s", cache: false },
      { layer: "workspace", text: "p", cache: true },
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

// 사람이 보낸 이미지는 같은 입력이면 같은 wire JSON이어야 prompt cache가 이어진다. 이미지를 못 받는 model에는 base64가 가지 않는다.
test("네 packer는 user 이미지를 같은 입력에서 같은 wire JSON으로 싣고 images가 false면 고정 글이다", () => {
  const request: PromptRequest = {
    system: [{ layer: "workspace_kind", text: "r" }],
    tools: [],
    messages: [
      {
        role: "user",
        parts: [
          { kind: "text", text: "see" },
          { kind: "image", media_type: "image/png", data_base64: "QUJD" },
          { kind: "text", text: "\n</lophn-call>" },
        ],
      },
    ],
  };
  const packers = (images: boolean): [string, WirePacker][] => [
    ["anthropic", anthropicPacker({ model: "m", maxTokens: 10, images })],
    ["responses", responsesPacker({ model: "m", maxTokens: 10, images })],
    [
      "chat",
      chatPacker({ model: "m", maxTokens: 10, images, provider: "openai" }),
    ],
    ["cloud code", cloudCodePacker({ model: "gemini-x", images })],
  ];
  for (const [name, pack] of packers(true)) {
    const first = JSON.stringify(pack(request).body);
    assert.deepStrictEqual(first, JSON.stringify(pack(request).body), name);
    assert.ok(first.includes("QUJD"), name);
    assert.ok(!first.includes(IMAGE_OMITTED), name);
  }
  for (const [name, pack] of packers(false)) {
    const wire = JSON.stringify(pack(request).body);
    assert.ok(wire.includes(IMAGE_OMITTED), name);
    assert.ok(!wire.includes("QUJD"), name);
  }
});
