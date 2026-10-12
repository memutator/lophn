import { assertEquals } from "@std/assert";
import type { PromptRequest } from "../../packages/core/lophn-agent/prompt-assembly/mod.ts";
import {
  anthropicPacker,
  chatPacker,
  responsesPacker,
} from "./model-binding.ts";

// provider#R3: 같은 provider 중립 요청이 OpenAI Responses와 Chat Completions의 요청 모양으로 번역되고
// tool 호출과 결과의 id 대응·순서가 그대로다.

const REQUEST: PromptRequest = {
  system: [
    { layer: "product", text: "product rules" },
    { layer: "role_agent", text: "role rules" },
  ],
  tools: [{
    name: "project.list",
    description: "Lists projects.",
    input_schema: { type: "object", properties: {} },
  }],
  messages: [
    { role: "user", parts: [{ kind: "text", text: "list" }] },
    {
      role: "assistant",
      parts: [
        { kind: "text", text: "Looking." },
        { kind: "tool_use", id: "call_1", name: "project.list", input: {} },
      ],
    },
    {
      role: "user",
      parts: [
        { kind: "tool_result", id: "call_1", text: "[]" },
        { kind: "text", text: "thanks" },
      ],
    },
  ],
};

Deno.test("lophn-agent/harness/provider#R3: Responses 요청은 instructions·input item·function tool이고 call_id가 대응한다", () => {
  const { body } = responsesPacker({ model: "gpt-5", maxTokens: 100 })(
    REQUEST,
  );
  assertEquals(body, {
    model: "gpt-5",
    store: false,
    stream: true,
    instructions: "product rules\n\nrole rules",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "list" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Looking." }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "project.list",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call_1", output: "[]" },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "thanks" }],
      },
    ],
    max_output_tokens: 100,
    tools: [{
      type: "function",
      name: "project.list",
      description: "Lists projects.",
      parameters: { type: "object", properties: {} },
    }],
  });
});

Deno.test("lophn-agent/harness/provider#R3: Chat Completions 요청은 system·user·assistant·tool message이고 tool_calls.id와 tool_call_id가 대응한다", () => {
  const { body } = chatPacker({
    model: "gpt-5",
    maxTokens: 100,
    provider: "openai",
  })(REQUEST);
  assertEquals(body, {
    model: "gpt-5",
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: "product rules\n\nrole rules" },
      { role: "user", content: "list" },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "project.list", arguments: "{}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "[]" },
      { role: "user", content: "thanks" },
    ],
    max_tokens: 100,
    tools: [{
      type: "function",
      function: {
        name: "project.list",
        description: "Lists projects.",
        parameters: { type: "object", properties: {} },
      },
    }],
  });
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: 세 packer 모두 request_patch를 요청에 합치고 patch가 없으면 같은 요청이다", () => {
  const packers = [
    {
      plain: anthropicPacker({ model: "m", maxTokens: 100, requestPatch: {} }),
      patched: anthropicPacker({
        model: "m",
        maxTokens: 100,
        requestPatch: { thinking: { type: "adaptive" }, extra: 1 },
      }),
      key: "thinking",
    },
    {
      plain: responsesPacker({ model: "m", maxTokens: 100, requestPatch: {} }),
      patched: responsesPacker({
        model: "m",
        maxTokens: 100,
        requestPatch: { thinking: { type: "adaptive" }, extra: 1 },
      }),
      key: "thinking",
    },
    {
      plain: chatPacker({
        model: "m",
        maxTokens: 100,
        provider: "openai",
        requestPatch: {},
      }),
      patched: chatPacker({
        model: "m",
        maxTokens: 100,
        provider: "openai",
        requestPatch: { thinking: { type: "adaptive" }, extra: 1 },
      }),
      key: "thinking",
    },
  ];
  for (const { plain, patched, key } of packers) {
    const base = plain(REQUEST).body as Record<string, unknown>;
    const body = patched(REQUEST).body as Record<string, unknown>;
    assertEquals(body[key], { type: "adaptive" });
    assertEquals(body.extra, 1);
    assertEquals(key in base, false);
    // patch 밖은 patch가 없을 때와 같다.
    const { thinking: _thinking, extra: _extra, ...rest } = body;
    assertEquals(rest, base);
  }
});
