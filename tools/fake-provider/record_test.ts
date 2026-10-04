import { assertEquals } from "@std/assert";
import { recordFixture } from "./record-gate.ts";
import { decodeChunk } from "./stream.ts";
import type { ResponseChunk } from "./types.ts";

Deno.test("dev/stack#fake-provider: record는 SSE event와 split UTF-8/base64 secret을 redaction하고 malformed capture는 fail closed한다", () => {
  const record = (body: unknown, secrets = ["xy"]) =>
    recordFixture({ live: true, instructed: true, body, secrets });
  const text =
    'event: message\ndata: {"access_token":"\\u0078y","text":"안녕"}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const split = text.indexOf("0078") + 2;
  const chunks: ResponseChunk[] = [
    {
      bytes: btoa(String.fromCharCode(...bytes.subarray(0, split))),
      encoding: "base64",
      delayMs: 7,
    },
    {
      bytes: btoa(String.fromCharCode(...bytes.subarray(split))),
      encoding: "base64",
      gate: "next",
    },
  ];
  const result = record({
    response: {
      status: 200,
      headers: { "retry-after": "10" },
      chunks,
      end: "reset",
    },
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    const response = (result.body as {
      response: { chunks: ResponseChunk[]; end: string; headers: unknown };
    }).response;
    assertEquals(response.end, "reset");
    assertEquals(response.headers, { "retry-after": "10" });
    assertEquals(response.chunks[0].delayMs, 7);
    assertEquals(response.chunks[1].gate, "next");
    const decoded = response.chunks.map(decodeChunk);
    const output = new Uint8Array(
      decoded.reduce((n, chunk) => n + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of decoded) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    const safe = new TextDecoder().decode(output);
    assertEquals(safe.includes('"access_token":{"present":true}'), true);
    assertEquals(safe.includes("안녕"), true);
    assertEquals(safe.includes("xy"), false);
  }
  assertEquals(
    record({ response: { body: 'data: {"access_token":"xy"}\n\n' } }).ok,
    true,
  );
  assertEquals(
    record({ response: { body: 'data: {"text":"\\u0078y"}\n\n' } }),
    { ok: false, reason: "secret" },
  );
  assertEquals(
    record({
      response: {
        chunks: [{ bytes: 'data: {"text":"x' }, { bytes: 'y"}\n\n' }],
      },
    }),
    { ok: false, reason: "secret" },
  );
  assertEquals(record({ unknown: "x" }, ["x"]), {
    ok: false,
    reason: "secret",
  });
  for (
    const body of [
      { response: { body: 'data: {"access_token":"xy"}\n' } },
      { response: { body: "data: not-json\n\n" } },
      { response: { body: "not-json" } },
      { response: { chunks: [{ bytes: "/w==", encoding: "base64" }] } },
    ]
  ) assertEquals(record(body), { ok: false, reason: "invalid_capture" });
});

Deno.test("dev/stack#fake-provider: clean raw capture의 bytes, encoding, chunk timing과 classification header는 그대로 남는다", () => {
  const body = {
    response: {
      status: 429,
      headers: { "retry-after-ms": "15000", "x-ratelimit-reset": "unknown" },
      chunks: [
        {
          bytes:
            'event: error\ndata: { "error": { "type": "rate_limit_error" } }\n',
          delayMs: 50,
        },
        { bytes: "Cg==", encoding: "base64", gate: "next" },
      ],
      end: "reset",
    },
  };
  assertEquals(
    recordFixture({ live: true, instructed: true, secrets: [], body }),
    { ok: true, body },
  );
});
