import assert from "node:assert/strict";
import { test } from "node:test";
import { entitlementAllows } from "../../../protocol/lophn-agent/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import {
  parseReportedRoster,
  readProviderModels,
  readReportedRoster,
  type ReportedModelRoster,
} from "./reported-models.ts";

// 응답이 어떤 모양이든 보이는 model을 숨기지 않는다. 읽지 못한 것은 null(거르지 않음)이다. Codex 꼴 row가 밝힌
// token 한도는 함께 읽고, 양의 정수가 아닌 값은 버린다.
test("계정 model 목록 응답이 틀리면 null이고, 맞으면 숨긴 것만 빠진다", async () => {
  const cases: [string, Response, ReportedModelRoster | null][] = [
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
      { models: ["a", "b"], limits: {} },
    ],
    ["200이 아님", new Response("{}", { status: 401 }), null],
    ["JSON 아님", new Response("<html>"), null],
    [
      "Codex 꼴 models[].slug와 한도",
      Response.json({
        models: [
          {
            slug: "b",
            context_window: 272000,
            max_context_window: 400000,
            max_output_tokens: 128000,
          },
          { slug: "a", visibility: "hide" },
        ],
      }),
      {
        models: ["b"],
        limits: {
          b: {
            context_limit: 272000,
            max_context_limit: 400000,
            output_limit: 128000,
          },
        },
      },
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
  const access = "SECRET-ACCESS";
  for (const [name, response, expected] of cases) {
    const got = await readReportedRoster(
      () => Promise.resolve(response),
      "https://example.test/models",
      access,
    );
    assert.deepStrictEqual(got, expected, name);
    if (got !== null) assert.ok(!JSON.stringify(got).includes(access), name);
  }
  assert.deepStrictEqual(
    await readReportedRoster(
      () => Promise.reject(new Error("deadline")),
      "https://example.test/models",
      "t",
    ),
    null,
  );
  assert.deepStrictEqual(parseReportedRoster('{"data":[]}'), null);
  // 밝히지 않은 한도 칸과 양의 정수가 아닌 값은 버린다.
  assert.deepStrictEqual(
    parseReportedRoster(
      JSON.stringify({
        models: [
          {
            slug: "m",
            context_window: 1000,
            max_context_window: 0,
            max_output_tokens: "9",
          },
          { slug: "n", context_window: -1 },
        ],
      }),
    ),
    {
      models: ["m", "n"],
      limits: {
        m: { context_limit: 1000, max_context_limit: null, output_limit: null },
      },
    },
  );
  assert.deepStrictEqual(entitlementAllows("oauth", null, "anything"), true);
  assert.deepStrictEqual(entitlementAllows("oauth", ["a"], "b"), false);
});

// OpenCode Go 목록은 model마다 native wire를 싣는다. lophn이 부를 수 있는 wire의 model만 남기고, wire를 모르는
// model과 generateContent만 있는 Gemini model은 뺀다. gateway는 SDK 기본 User-Agent를 막는다.
test("OpenCode Go 목록은 부를 수 있는 wire의 model만 남기고 gateway header를 싣는다", async () => {
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
  const definition = builtinProviderDefinition("opencode-go");
  assert.ok(definition.ok);
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
  assert.deepStrictEqual(got, {
    models: ["claude-haiku-5-5", "glm-5.3", "gpt-6-luna"],
    limits: {},
  });
  assert.deepStrictEqual(sent, [
    {
      url: "https://opencode.ai/inference/go/openai/v1/models",
      headers: new Headers({
        accept: "application/json",
        "user-agent": "lophn",
        authorization: "Bearer SECRET-KEY",
      }),
    },
  ]);
});
