import { assertEquals } from "@std/assert";
import { loadFixture } from "./fixture.ts";
import { type FakeProvider, startFakeProvider } from "./mod.ts";
import { recordFixture } from "./record-gate.ts";
import type { Script } from "./types.ts";

const FIXTURES = new URL("../../fixtures/model/", import.meta.url).pathname;

function serve(script: Script): FakeProvider {
  return startFakeProvider({ script, nowMs: () => 1_000, instant: true });
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

Deno.test("tools/fake-provider: 429 분류 header와 model 없음, 인증 거절을 보존한다", async () => {
  const provider = serve({
    steps: [
      {
        id: "soon",
        protocol: "messages",
        response: { status: 429, headers: { "retry-after": "10" }, body: "{}" },
      },
      {
        id: "later",
        protocol: "messages",
        response: {
          status: 429,
          headers: { "retry-after": "120" },
          body: "{}",
        },
      },
      {
        id: "reset",
        protocol: "responses",
        response: {
          status: 429,
          headers: { "x-ratelimit-reset": "soon" },
          body: "{}",
        },
      },
      {
        id: "ms",
        protocol: "messages",
        response: {
          status: 429,
          headers: { "retry-after-ms": "15000" },
          body: "{}",
        },
      },
      {
        id: "unknown",
        protocol: "chat_completions",
        response: { status: 429, body: "{}" },
      },
      {
        id: "missing",
        protocol: "chat_completions",
        response: { status: 404, body: '{"error":{"code":"model_not_found"}}' },
      },
      {
        id: "denied",
        protocol: "messages",
        response: {
          status: 401,
          body: '{"error":{"type":"authentication_error"}}',
        },
      },
    ],
  });
  try {
    for (
      const [path, header, value] of [
        ["/messages", "retry-after", "10"],
        ["/messages", "retry-after", "120"],
        ["/responses", "x-ratelimit-reset", "soon"],
      ] as const
    ) {
      const response = await post(provider.url, path, {});
      assertEquals(response.status, 429);
      assertEquals(response.headers.get(header), value);
    }
    const millis = await post(provider.url, "/messages", {});
    assertEquals(millis.status, 429);
    assertEquals(millis.headers.get("retry-after-ms"), "15000");
    assertEquals(
      (await post(provider.url, "/chat/completions", {})).headers.get(
        "retry-after",
      ),
      null,
    );
    assertEquals(
      (await post(provider.url, "/chat/completions", {})).status,
      404,
    );
    assertEquals((await post(provider.url, "/messages", {})).status, 401);
    provider.assertDone(7);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: usage를 빼거나 reasoning만 넣을 수 있다", async () => {
  const provider = serve({
    steps: [
      { id: "none", protocol: "messages", reply: { text: "ok" } },
      {
        id: "reasoning",
        protocol: "responses",
        reply: { text: "ok", usage: { output: 9, reasoning: 4 } },
      },
    ],
  });
  try {
    const none = await (await post(provider.url, "/messages", {})).json();
    assertEquals("usage" in none, false);
    const reasoning = await (await post(provider.url, "/responses", {})).json();
    assertEquals(reasoning.usage.output_tokens_details.reasoning_tokens, 4);
    assertEquals("input_tokens" in reasoning.usage, false);
    provider.assertDone(2);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 녹화 fixture를 재생하고 자동 녹화는 거절한다", async () => {
  const names = [
    "messages-text-tool.json",
    "messages-rate-limit.json",
    "responses-text-tool.json",
    "responses-incomplete.json",
    "chat-completions-text-tool.json",
    "chat-completions-unavailable.json",
  ];
  for (const name of names) {
    const steps = await loadFixture(`${FIXTURES}/${name}`);
    const provider = serve({ steps });
    try {
      const step = steps[0];
      const response = await post(
        provider.url,
        step.match?.path ?? "/",
        step.match?.body ?? {},
      );
      assertEquals(response.status, step.response?.status);
      provider.assertDone(1);
    } finally {
      await provider.close();
    }
  }

  const uninstructed = recordFixture({
    live: true,
    instructed: false,
    body: {},
    secrets: [],
  });
  assertEquals(uninstructed.ok, false);
  if (!uninstructed.ok) assertEquals(uninstructed.reason, "not_instructed");
  const disabled = recordFixture({
    live: false,
    instructed: true,
    body: {},
    secrets: [],
  });
  assertEquals(disabled.ok, false);
  if (!disabled.ok) assertEquals(disabled.reason, "live_disabled");
  const leaked = recordFixture({
    live: true,
    instructed: true,
    body: { note: "token sk-live-secret-value" },
    secrets: ["sk-live-secret-value"],
  });
  assertEquals(leaked.ok, false);
  if (!leaked.ok) assertEquals(leaked.reason, "secret");
  const clean = recordFixture({
    live: true,
    instructed: true,
    body: { access_token: "synthetic-access", text: "ok" },
    secrets: ["synthetic-access"],
  });
  assertEquals(clean.ok, true);
  if (clean.ok) {
    assertEquals(clean.body, { access_token: { present: true }, text: "ok" });
  }
});

Deno.test("tools/fake-provider: 첫 token은 gate를 풀기 전에는 오지 않는다", async () => {
  const provider = serve({
    steps: [{
      id: "slow",
      protocol: "responses",
      response: {
        status: 200,
        chunks: [{ bytes: "data: {}\n\n", gate: "first" }],
      },
    }],
  });
  try {
    const pending = post(provider.url, "/responses", {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(provider.requests()[0]?.matchedStep, "slow");
    provider.release("first");
    const response = await pending;
    assertEquals(await response.text(), "data: {}\n\n");
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 미완성 tool 인자는 완성 표시 없이 끊긴다", async () => {
  const provider = serve({
    steps: [{
      id: "partial-tool",
      protocol: "messages",
      response: {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        chunks: [{
          bytes:
            'event: content_block_delta\ndata: {"delta":{"partial_json":"{\\"value\\":"}}\n\n',
        }],
        end: "reset",
      },
    }],
  });
  try {
    const response = await post(provider.url, "/messages", {});
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body 없음");
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    assertEquals(text.includes("partial_json"), true);
    assertEquals(text.includes("content_block_stop"), false);
    let closed = false;
    try {
      const next = await reader.read();
      closed = next.done === true;
    } catch {
      closed = false;
    }
    assertEquals(closed, false);
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 추론 상태를 다음 요청이 되돌려 보냈는지 단언한다", async () => {
  const provider = serve({
    steps: [
      {
        id: "thinking",
        protocol: "messages",
        match: {
          body: {
            messages: [{
              role: "assistant",
              content: [
                { type: "thinking", thinking: "", signature: "sig-synthetic" },
                { type: "redacted_thinking", data: "redacted-synthetic" },
              ],
            }],
          },
        },
        reply: { text: "ok" },
      },
      {
        id: "encrypted",
        protocol: "responses",
        match: {
          body: {
            input: [{ type: "reasoning", encrypted_content: "enc-synthetic" }],
          },
        },
        reply: { text: "ok" },
      },
    ],
  });
  try {
    const missing = await post(provider.url, "/messages", { messages: [] });
    assertEquals(missing.status, 500);
  } finally {
    await provider.close();
  }

  const again = serve({
    steps: [
      {
        id: "thinking",
        protocol: "messages",
        match: {
          body: { signature: "sig-synthetic", redacted: "redacted-synthetic" },
        },
        reply: { text: "ok" },
      },
      {
        id: "encrypted",
        protocol: "responses",
        match: { body: { encrypted_content: "enc-synthetic" } },
        reply: { text: "ok" },
      },
    ],
  });
  try {
    assertEquals(
      (await post(again.url, "/messages", {
        signature: "sig-synthetic",
        redacted: "redacted-synthetic",
      })).status,
      200,
    );
    assertEquals(
      (await post(again.url, "/responses", {
        encrypted_content: "enc-synthetic",
      })).status,
      200,
    );
    again.assertDone(2);
  } finally {
    await again.close();
  }
});
