import { assertEquals, assertThrows } from "@std/assert";
import { parseFixture } from "./fixture.ts";
import { type FakeProvider, startFakeProvider } from "./mod.ts";
import { sha256 } from "./normalize.ts";
import type { Script, Step } from "./types.ts";

function serve(
  script: Script,
  oauth?: { deviceExpiresAtMs?: number; rotateRefresh?: boolean },
): FakeProvider {
  return startFakeProvider({
    script,
    nowMs: () => 1_000,
    instant: true,
    oauth,
  });
}

async function post(
  url: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("tools/fake-provider: 세 protocol의 정상 text와 tool call을 비stream으로 낸다", async () => {
  const provider = serve({
    steps: (["messages", "responses", "chat_completions"] as const).map((
      protocol,
    ): Step => ({
      id: protocol,
      protocol,
      reply: {
        text: "fixture text",
        toolCalls: [{
          id: "call_1",
          name: "echo",
          arguments: '{"value":"ok"}',
        }],
        usage: { input: 10, cacheRead: 2, output: 4 },
      },
    })),
  });
  try {
    const messages = await post(provider.url, "/messages", {
      model: "fixture-model",
    });
    const responses = await post(provider.url, "/responses", {
      model: "fixture-model",
      store: false,
    });
    const chat = await post(provider.url, "/chat/completions", {
      model: "fixture-model",
    });
    const messageBody = await messages.json();
    const responseBody = await responses.json();
    const chatBody = await chat.json();
    assertEquals(messageBody.content[1].type, "tool_use");
    assertEquals(messageBody.usage.cache_read_input_tokens, 2);
    assertEquals(responseBody.output[1].type, "function_call");
    assertEquals(responseBody.usage.input_tokens_details.cached_tokens, 2);
    assertEquals(chatBody.choices[0].finish_reason, "tool_calls");
    assertEquals(chatBody.usage.prompt_tokens_details.cached_tokens, 2);
    provider.assertDone(3);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: stream chunk 경계와 reset header를 보존한다", async () => {
  const provider = serve({
    steps: [{
      id: "split",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream", "retry-after": "10" },
        chunks: [
          { bytes: 'event: content_block_delta\ndata: {"delta":{"text":"안' },
          { bytes: '녕"}}\n\n', delayMs: 30_000 },
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
    assertEquals(response.headers.get("retry-after"), "10");
    assertEquals(
      await response.text(),
      'event: content_block_delta\ndata: {"delta":{"text":"안녕"}}\n\n',
    );
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: UTF-8 바이트 경계 chunk를 base64로 그대로 보낸다", async () => {
  const provider = serve({
    steps: [{
      id: "bytes",
      protocol: "chat_completions",
      response: {
        status: 200,
        chunks: [
          { bytes: "7A==", encoding: "base64" },
          { bytes: "lYjrhZU=", encoding: "base64" },
        ],
      },
    }],
  });
  try {
    const response = await post(provider.url, "/chat/completions", {});
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertEquals(new TextDecoder().decode(bytes), "안녕");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: script와 다른 요청, 소진, 남은 응답, 0회 호출은 실패한다", async () => {
  const provider = serve({
    steps: [{
      id: "only",
      protocol: "messages",
      match: { body: { model: "fixture-model" } },
      reply: { text: "ok" },
    }],
  });
  try {
    const mismatch = await post(provider.url, "/messages", { model: "other" });
    assertEquals(mismatch.status, 500);
    assertThrows(() => provider.assertDone(1), Error, "script와 다른 요청");
  } finally {
    await provider.close();
  }

  const exhausted = serve({ steps: [] });
  try {
    const response = await post(exhausted.url, "/responses", {});
    assertEquals(response.status, 500);
    assertThrows(() => exhausted.assertDone(0), Error, "응답 소진");
  } finally {
    await exhausted.close();
  }

  const unused = serve({
    steps: [{ id: "left", protocol: "responses", reply: { text: "ok" } }],
  });
  try {
    assertThrows(() => unused.assertDone(0), Error, "남은 응답: left");
  } finally {
    await unused.close();
  }

  const idle = serve({ steps: [] });
  try {
    assertThrows(() => idle.assertDone(1), Error, "요청 수 0, 기대 1");
  } finally {
    await idle.close();
  }
});

Deno.test("tools/fake-provider: 인증 header 값은 log에 없고 종류만 남는다", async () => {
  const provider = serve({
    steps: [
      {
        id: "key",
        protocol: "messages",
        match: { headers: { "x-api-key": "api_key" } },
        reply: { text: "a" },
      },
      {
        id: "oauth",
        protocol: "responses",
        match: { headers: { authorization: "bearer" } },
        reply: { text: "b" },
      },
    ],
  });
  try {
    await post(provider.url, "/messages", { model: "m" }, {
      "x-api-key": "sk-synthetic",
      "user-agent": "lophn",
    });
    await post(provider.url, "/responses", { model: "m" }, {
      authorization: "Bearer synthetic-access",
      "user-agent": "lophn",
    });
    const [key, oauth] = provider.requests().filter((entry) =>
      entry.matchedStep
    );
    assertEquals(
      key.headers.find((header) => header.name === "x-api-key")?.kind,
      "api_key",
    );
    assertEquals(
      oauth.headers.find((header) => header.name === "authorization")?.kind,
      "bearer",
    );
    const text = JSON.stringify(provider.requests());
    assertEquals(text.includes("sk-synthetic"), false);
    assertEquals(text.includes("synthetic-access"), false);
    assertEquals(
      key.headers.find((header) => header.name === "user-agent")?.value,
      `sha256:${await sha256("lophn")}`,
    );
    assertEquals(
      oauth.headers.find((header) => header.name === "user-agent")?.value,
      `sha256:${await sha256("lophn")}`,
    );
    provider.assertDone(2);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 오류 status와 출력 한도 잘림, 문맥 초과를 raw로 낸다", async () => {
  const statuses = [500, 502, 503, 529];
  const provider = serve({
    steps: [
      ...statuses.map((status): Step => ({
        id: `status-${status}`,
        protocol: "messages",
        response: {
          status,
          headers: { "content-type": "application/json" },
          body: '{"error":{"type":"api_error"}}',
        },
      })),
      {
        id: "context",
        protocol: "responses",
        response: {
          status: 400,
          body: '{"error":{"code":"context_length_exceeded"}}',
        },
      },
      {
        id: "silent",
        protocol: "chat_completions",
        response: { status: 400, body: '{"error":{"message":"bad request"}}' },
      },
      {
        id: "cut-messages",
        protocol: "messages",
        reply: { text: "partial", stop: "max_tokens" },
      },
      {
        id: "cut-chat",
        protocol: "chat_completions",
        reply: { text: "partial", stop: "length" },
      },
      {
        id: "cut-responses",
        protocol: "responses",
        reply: { text: "partial", stop: "incomplete" },
      },
    ],
  });
  try {
    for (const status of statuses) {
      const response = await post(provider.url, "/messages", {});
      assertEquals(response.status, status);
    }
    assertEquals((await post(provider.url, "/responses", {})).status, 400);
    assertEquals(
      (await post(provider.url, "/chat/completions", {})).status,
      400,
    );
    const cut = await (await post(provider.url, "/messages", {})).json();
    assertEquals(cut.stop_reason, "max_tokens");
    const chat = await (await post(provider.url, "/chat/completions", {}))
      .json();
    assertEquals(chat.choices[0].finish_reason, "length");
    const responses = await (await post(provider.url, "/responses", {})).json();
    assertEquals(responses.status, "incomplete");
    provider.assertDone(9);
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: unsupported fixture version과 unknown field는 fail closed한다", () => {
  const base = {
    version: 1,
    synthetic: true,
    protocol: "messages",
    interactions: [],
  };
  for (const version of [undefined, null, "1", 2]) {
    assertThrows(() => parseFixture({ ...base, version }));
  }
  assertThrows(() => parseFixture({ ...base, unknown: true }));
  assertThrows(() =>
    parseFixture({
      ...base,
      interactions: [{ response: { status: 200 }, unknown: true }],
    })
  );
  assertEquals(parseFixture(base), []);
});
