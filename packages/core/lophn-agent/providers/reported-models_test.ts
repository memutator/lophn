import assert from "node:assert/strict";
import { test } from "node:test";
import { entitlementAllows } from "../../../protocol/lophn-agent/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import {
  parseReportedModels,
  readProviderModels,
  readReportedModels,
} from "./reported-models.ts";

// 응답이 어떤 모양이든 보이는 model을 숨기지 않는다. 읽지 못한 것은 null(거르지 않음)이다.
test("계정 model 목록 응답이 틀리면 null이고, 맞으면 숨긴 것만 빠진다", async () => {
  const cases: [string, Response, string[] | null][] = [
    [
      "list와 visibility 없음은 남는다",
      Response.json({
        data: [
          { id: "b", visibility: "list" },
          { id: "a" },
          {
            id: "c",
            visibility: "hide",
          },
        ],
      }),
      ["a", "b"],
    ],
    ["200이 아님", new Response("{}", { status: 401 }), null],
    ["JSON 아님", new Response("<html>"), null],
    [
      "Codex 꼴 models[].slug",
      Response.json({
        models: [{ slug: "b" }, { slug: "a", visibility: "hide" }],
      }),
      ["b"],
    ],
    ["목록 칸 없음", Response.json({ items: [{ id: "a" }] }), null],
    ["Codex 꼴인데 slug 없음", Response.json({ models: [{ id: "a" }] }), null],
    ["id 없음", Response.json({ data: [{ name: "a" }] }), null],
    [
      "보이는 항목 0개",
      Response.json({ data: [{ id: "a", visibility: "hide" }] }),
      null,
    ],
  ];
  for (const [name, response, expected] of cases) {
    const got = await readReportedModels(
      () => Promise.resolve(response),
      "https://example.test/models",
      "t",
    );
    assert.deepStrictEqual(got, expected, name);
  }
  assert.deepStrictEqual(
    await readReportedModels(
      () => Promise.reject(new Error("deadline")),
      "https://example.test/models",
      "t",
    ),
    null,
  );
  assert.deepStrictEqual(parseReportedModels('{"data":[]}'), null);
  assert.deepStrictEqual(entitlementAllows("oauth", null, "anything"), true);
  assert.deepStrictEqual(entitlementAllows("oauth", ["a"], "b"), false);
});

// OpenCode Go 셋은 family를 싣는 OpenAI base의 목록 하나에서 자기 wire만 고른다. wire를 모르는 model과
// Gemini model은 어느 정의에도 들어가지 않는다.
test("OpenCode Go 목록은 model의 api가 가리키는 wire만 남기고 gateway header를 싣는다", async () => {
  const body = {
    data: [
      { id: "glm-5.3", api: { "chat-completions": { base_url: "x" } } },
      { id: "gpt-6-luna", api: { responses: { base_url: "x" } } },
      { id: "claude-haiku-5-5", api: { messages: { base_url: "x" } } },
      { id: "gemini-4-argon", api: { "generate-content": { base_url: "x" } } },
      { id: "mystery" },
    ],
  };
  const sent: { url: string; headers: Headers }[] = [];
  const http = (url: string, init: RequestInit) => {
    sent.push({ url, headers: new Headers(init.headers) });
    return Promise.resolve(Response.json(body));
  };
  const cases: [string, string, string[]][] = [
    ["opencode-go-chat", "openai-chat-completions", ["glm-5.3"]],
    ["opencode-go-responses", "openai-responses", ["gpt-6-luna"]],
    ["opencode-go-messages", "anthropic-messages", ["claude-haiku-5-5"]],
  ];
  for (const [key, protocol, expected] of cases) {
    const definition = builtinProviderDefinition(key);
    assert.ok(definition.ok, key);
    const got = await readProviderModels(
      http,
      {
        definition: definition.value,
        endpoint: "https://opencode.ai/inference/go/openai/v1",
        kind: "api_key",
        account: null,
      },
      "SECRET-KEY",
    );
    assert.deepStrictEqual(got, expected, key);
    assert.equal(protocol, definition.value.protocols[0], key);
    assert.deepStrictEqual(sent.at(-1), {
      url: "https://opencode.ai/inference/go/openai/v1/models",
      headers: new Headers({
        accept: "application/json",
        "user-agent": "lophn",
        authorization: "Bearer SECRET-KEY",
      }),
    });
  }
  // api가 없는 model만 있으면 그 wire의 목록을 읽지 못한 것으로 본다.
  const chat = builtinProviderDefinition("opencode-go-chat");
  assert.ok(chat.ok);
  assert.equal(
    await readProviderModels(
      () => Promise.resolve(Response.json({ data: [{ id: "mystery" }] })),
      {
        definition: chat.value,
        endpoint: "https://opencode.ai/inference/go/openai/v1",
        kind: "api_key",
        account: null,
      },
      "k",
    ),
    null,
  );
});
