import { assertEquals, assertThrows } from "@std/assert";
import { startFakeProvider } from "./mod.ts";
import { parseScript, ScriptError } from "./script.ts";

Deno.test("dev/stack#fake-provider: form matcher와 OAuth는 secret presence-only log를 공유한다", async () => {
  const form = {
    grant_type: "refresh_token",
    refresh_token: "refresh-private",
    code_verifier: "private-verifier",
    code: "private-code",
    device_code: "private-device",
    client_secret: "private-client",
  };
  const provider = startFakeProvider({
    script: {
      steps: [{
        id: "form",
        protocol: "messages",
        match: { body: form },
        reply: {},
      }],
    },
  });
  try {
    const send = (path: string) =>
      fetch(`${provider.url}${path}?access_token=private-query`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          authorization: "Bearer private-header",
          "x-trace": "private-custom",
          referer: "https://example.invalid/?token=private-referrer",
          "user-agent": "private-UA",
        },
        body: new URLSearchParams(form),
      });
    const matched = await send("/messages");
    assertEquals(matched.status, 200);
    await matched.text();
    const token = await send("/oauth/token");
    assertEquals(token.status, 200);
    await token.text();
    for (const entry of provider.requests()) {
      const body = entry.body as Record<string, unknown>;
      for (
        const field of [
          "refresh_token",
          "code_verifier",
          "device_code",
          "client_secret",
        ]
      ) {
        assertEquals(body[field], { present: true });
      }
    }
    assertEquals(
      JSON.stringify(provider.requests()).includes("private"),
      false,
    );
    provider.assertDone(1);
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: malformed JSON과 unsupported raw body, query, header는 log와 error에 원문이 없다", async () => {
  const provider = startFakeProvider({
    script: {
      steps: [
        {
          id: "bad-json",
          protocol: "messages",
          match: { body: {} },
          reply: {},
        },
        { id: "raw", protocol: "responses", match: { body: {} }, reply: {} },
      ],
    },
  });
  try {
    for (
      const [path, type, body] of [
        ["/messages", "application/json", '{"access_token":"sensitive-value"'],
        ["/responses", "text/plain", "sensitive-value"],
        ["/sensitive-value", "text/plain", "sensitive-value"],
        ["/__fake/sensitive-value", "text/plain", "sensitive-value"],
      ]
    ) {
      const response = await fetch(
        `${provider.url}${path}?token=sensitive-value`,
        {
          method: "POST",
          headers: { "content-type": type, "x-token": "sensitive-value" },
          body,
        },
      );
      assertEquals(response.status, 500);
      assertEquals((await response.text()).includes("sensitive-value"), false);
    }
    const response = await fetch(`${provider.url}/__fake/log`);
    const text = await response.text();
    assertEquals(text.includes("sensitive-value"), false);
    assertEquals(text.includes('"omitted":true'), true);
    try {
      provider.assertDone(2);
    } catch (error) {
      assertEquals(String(error).includes("sensitive-value"), false);
    }
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: strict script는 모든 unknown field와 runtime 부정합을 실행 전에 거절한다", async () => {
  const wrap = (step: unknown) => ({ steps: [step] });
  const base = { id: "strict", protocol: "messages" };
  const invalid = [
    { steps: [], unknown: true },
    wrap({ ...base, reply: {}, typo: true }),
    wrap({ ...base, reply: {}, match: { heders: {} } }),
    wrap({ ...base, reply: { typo: true } }),
    wrap({
      ...base,
      reply: {
        toolCalls: [{ id: "a", name: "b", arguments: "{}", typo: true }],
      },
    }),
    wrap({ ...base, reply: { usage: { other: 1 } } }),
    ...["{", "[]", "null"].map((argumentsText) =>
      wrap({
        ...base,
        reply: {
          toolCalls: [{ id: "a", name: "b", arguments: argumentsText }],
        },
      })
    ),
    ...["length", "incomplete"].map((stop) =>
      wrap({ ...base, reply: { stop } })
    ),
    ...["max_tokens", "incomplete"].map((stop) =>
      wrap({ ...base, protocol: "chat_completions", reply: { stop } })
    ),
    ...[-1, 0.5, Infinity, NaN].map((output) =>
      wrap({ ...base, reply: { usage: { output } } })
    ),
    ...[199, 600, 200.5, Infinity, NaN].map((status) =>
      wrap({ ...base, response: { status } })
    ),
    wrap({ ...base, response: { status: 200, unknown: true } }),
    wrap({ ...base, response: { status: 200, body: "{}", chunks: [] } }),
    wrap({ ...base, response: { status: 200, end: "reset" } }),
    ...[204, 205, 304].flatMap((status) => [
      wrap({ ...base, response: { status, body: "" } }),
      wrap({ ...base, response: { status, chunks: [] } }),
    ]),
    ...["content-length", "transfer-encoding", "connection"].map((name) =>
      wrap({ ...base, response: { status: 200, headers: { [name]: "0" } } })
    ),
    wrap({ ...base, response: { status: 200, headers: { "bad name": "a" } } }),
    wrap({ ...base, response: { status: 200, headers: { "x-a": "a\r\nb" } } }),
    wrap({
      ...base,
      response: { status: 200, chunks: [{ bytes: "x", typo: true }] },
    }),
    ...["a===", "Zh==", "%%%%"].map((bytes) =>
      wrap({
        ...base,
        response: { status: 200, chunks: [{ bytes, encoding: "base64" }] },
      })
    ),
  ];
  for (const value of invalid) {
    assertThrows(() => parseScript(value), ScriptError);
  }
  // raw usage 이상값은 오류 주입 fixture이므로 byte 그대로 허용한다.
  parseScript(
    wrap({
      ...base,
      response: { status: 200, body: '{"usage":{"output_tokens":-1.5}}' },
    }),
  );
  const provider = startFakeProvider({ script: { steps: [] } });
  try {
    for (
      const value of invalid.filter((item) =>
        !JSON.stringify(item).includes("null")
      )
    ) {
      const response = await fetch(`${provider.url}/__fake/script`, {
        method: "POST",
        body: JSON.stringify(value),
      });
      assertEquals(response.status, 400);
      await response.text();
    }
    const valid = await fetch(`${provider.url}/__fake/script`, {
      method: "POST",
      body: JSON.stringify({
        steps: [
          ...[204, 205, 304].map((status) => ({
            ...base,
            id: String(status),
            response: { status },
          })),
        ],
      }),
    });
    assertEquals(valid.status, 200);
    await valid.text();
    for (const status of [204, 205, 304]) {
      const response = await fetch(`${provider.url}/messages`, {
        method: "POST",
      });
      assertEquals(response.status, status);
      assertEquals(await response.text(), "");
    }
    provider.assertDone(3);
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: protocol과 case-sensitive header mismatch는 FIFO step을 소진하지 않는다", async () => {
  const provider = startFakeProvider({
    script: {
      steps: [{
        id: "one",
        protocol: "messages",
        match: { headers: { "user-agent": "CaseSensitive" } },
        reply: {},
      }],
    },
  });
  try {
    for (
      const [path, ua, status] of [
        ["/responses", "CaseSensitive", 500],
        ["/messages", "casesensitive", 500],
        ["/messages", "CaseSensitive", 200],
      ] as const
    ) {
      const response = await fetch(`${provider.url}${path}`, {
        method: "POST",
        headers: { "user-agent": ua },
      });
      assertEquals(response.status, status);
      await response.text();
    }
    assertEquals(
      provider.requests().filter((entry) => entry.matchedStep).length,
      1,
    );
    // 실패는 이후 정상 요청으로 지워지지 않는다.
    assertThrows(() => provider.assertDone(3), Error, "script와 다른 요청");
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: OAuth malformed 입력은 400이고 token random source는 주입한다", async () => {
  const provider = startFakeProvider({
    script: { steps: [] },
    oauth: { randomBytes: () => new Uint8Array([0, 1, 2]) },
  });
  try {
    for (const path of ["/oauth/register", "/oauth/token"]) {
      for (
        const body of [
          "null",
          "{",
          '{"grant_type":"refresh_token","refresh_token":12}',
          "[]",
        ]
      ) {
        const response = await fetch(`${provider.url}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        assertEquals(response.status, 400);
        await response.text();
      }
    }
    const missing = await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
    });
    assertEquals(missing.status, 400);
    await missing.text();
    const token = await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=refresh-fixture",
    });
    assertEquals(token.status, 200);
    assertEquals((await token.json()).access_token, "access-000102");
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: concurrent 접수는 body read와 header hash 이후에도 FIFO다", async () => {
  const { FakeServer } = await import("./server.ts");
  const script = {
    steps: [
      { id: "first", protocol: "messages" as const, reply: {} },
      { id: "second", protocol: "responses" as const, reply: {} },
    ],
  };
  const fake = new FakeServer({ script });
  const first = fake.handle(
    new Request("http://127.0.0.1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  const second = fake.handle(
    new Request("http://127.0.0.1/responses", { method: "POST" }),
  );
  const direct = await Promise.all([first, second]);
  assertEquals(direct.map((response) => response.status), [200, 200]);
  assertEquals(
    fake.requests().map((entry) => [entry.seq, entry.path, entry.matchedStep]),
    [
      [1, "/messages", "first"],
      [2, "/responses", "second"],
    ],
  );
  fake.assertDone(2);
  // rejection도 admission tail을 poison하지 않는다.
  const rejected = new Request("http://127.0.0.1/messages", {
    method: "POST",
    body: "{}",
  });
  await rejected.text();
  try {
    await fake.handle(rejected);
  } catch { /* body가 이미 소비됨 */ }
  assertEquals(
    (await fake.handle(new Request("http://127.0.0.1/__fake/log"))).status,
    200,
  );

  let received!: () => void;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const provider = startFakeProvider({
    script: {
      steps: [
        {
          id: "first",
          protocol: "messages",
          response: {
            status: 200,
            chunks: [{ bytes: "first", gate: "first" }],
          },
        },
        { id: "second", protocol: "responses", reply: {} },
      ],
    },
    nowMs: () => {
      received();
      return 0;
    },
  });
  try {
    const a = fetch(`${provider.url}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await arrived;
    const b = await fetch(`${provider.url}/responses`, { method: "POST" });
    assertEquals(b.status, 200);
    await b.text();
    provider.release("first");
    assertEquals(await (await a).text(), "first");
    assertEquals(
      provider.requests().map((
        entry,
      ) => [entry.seq, entry.path, entry.matchedStep]),
      [
        [1, "/messages", "first"],
        [2, "/responses", "second"],
      ],
    );
    provider.assertDone(2);
  } finally {
    provider.release("first");
    await provider.close();
  }
});
