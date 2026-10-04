import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  defineCommand,
  type RpcFetch,
} from "../../../contracts/platform/mod.ts";
import { createCoreClient } from "./core.ts";

const save = defineCommand({
  resource: "documents",
  method: "save",
  name: "Save",
  input: z.strictObject({ title: z.string() }),
  output: z.object({ id: z.string() }),
  actors: ["user"],
  errors: [],
});

type Sent = { url: string; init: Parameters<RpcFetch>[1] };

function scripted(
  handler: (sent: Sent) =>
    | { status: number; body: string; type?: string }
    | "throw",
): RpcFetch {
  return (url, init) => {
    const outcome = handler({ url, init });
    if (outcome === "throw") {
      return Promise.reject(new Error("connect refused"));
    }
    return Promise.resolve({
      status: outcome.status,
      headers: new Headers(
        outcome.type ? { "content-type": outcome.type } : {},
      ),
      bytes: new TextEncoder().encode(outcome.body),
    });
  };
}

const json = (value: unknown) => JSON.stringify(value);

const commandResponses = (
  first: { status: number; body: string } | "throw",
  rest: Array<{ status: number; body: string }>,
): RpcFetch => {
  const queue = [first, ...rest];
  return scripted(() => {
    const next = queue.shift();
    assert(next !== undefined, "예상하지 못한 호출이다");
    return next === "throw" ? "throw" : { ...next, type: "application/json" };
  });
};

const providerAlways = (token: string) => () =>
  Promise.resolve({ ok: true as const, value: { token } });

Deno.test(
  "coding-agent/connection#R15: core client는 POST /v1/<resource>/<method>에 Authorization과 idempotency key를 전달한다",
  async () => {
    const sent: Sent[] = [];
    const client = createCoreClient({
      baseUrl: "http://127.0.0.1:7431/",
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      provider: () => Promise.resolve({ ok: true, value: { token: "tok" } }),
      fetch: scripted((call) => {
        sent.push(call);
        return {
          status: 200,
          body: json({
            result: { id: "doc_1" },
            replayed: false,
            first_seq: "7",
            last_seq: "7",
          }),
          type: "application/json",
        };
      }),
    });
    const result = await client.command(save, {
      input: { title: "a" },
      idempotency_key: "key-1",
    });
    assert(result.ok);
    // command는 rpc client의 command envelope을 그대로 돌려준다.
    assertEquals(result.value, {
      result: { id: "doc_1" },
      replayed: false,
      first_seq: "7",
      last_seq: "7",
    });
    assertEquals(sent[0].url, "http://127.0.0.1:7431/v1/documents/save");
    assertEquals(sent[0].init.method, "POST");
    assertEquals(sent[0].init.headers["authorization"], "Bearer tok");
    const body = JSON.parse(String(sent[0].init.body));
    // envelope은 command 계약의 strict object다. key와 input 이외의 필드는
    // 계약 기본값(compare 빈 object, prepared 빈 array)으로 채워 보낸다.
    assertEquals(body, {
      input: { title: "a" },
      idempotency_key: "key-1",
      compare: {},
      prepared: [],
    });
  },
);

Deno.test(
  "coding-agent/connection#R9: provider 실패는 재발급 없이 unavailable이다",
  async () => {
    let providerCalls = 0;
    const client = createCoreClient({
      baseUrl: "http://127.0.0.1:7431",
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      provider: () => {
        providerCalls += 1;
        return Promise.resolve({ ok: false, error: "locked" });
      },
      fetch: scripted(() => {
        throw new Error("호출되면 안 된다");
      }),
    });
    const result = await client.command(save, {
      input: { title: "a" },
      idempotency_key: "key-1",
    });
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
    assertEquals(result.error.details, { reason: "locked" });
    assertEquals(providerCalls, 1);
  },
);

Deno.test(
  "coding-agent/connection#R6: 쓰기 응답 유실은 같은 key로 대상 read를 다시 본다",
  async () => {
    const client = createCoreClient({
      baseUrl: "http://127.0.0.1:7431",
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      provider: providerAlways("tok"),
      fetch: commandResponses(
        "throw",
        [{
          status: 200,
          body: json({
            as_of_seq: "7",
            next_cursor: null,
            result: {
              principal: "user",
              idempotency_key: "key-1",
              fingerprint: "a".repeat(64),
              result: { id: "doc_1" },
              first_seq: "1",
              last_seq: "3",
              at: "2026-10-05T00:00:00.000Z",
            },
          }),
        }],
      ),
    });
    const result = await client.command(save, {
      input: { title: "a" },
      idempotency_key: "key-1",
    });
    assert(result.ok);
    // 회수는 같은 대상 read의 확정 command result다.
    assertEquals(result.value, {
      principal: "user",
      idempotency_key: "key-1",
      fingerprint: "a".repeat(64),
      result: { id: "doc_1" },
      first_seq: "1",
      last_seq: "3",
      at: "2026-10-05T00:00:00.000Z",
    });
  },
);

Deno.test(
  "coding-agent/connection#R6: 유실 뒤 대상 read가 비었으면 effect_unknown 진단이다",
  async () => {
    const calls: Sent[] = [];
    const client = createCoreClient({
      baseUrl: "http://127.0.0.1:7431",
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      provider: providerAlways("tok"),
      fetch: scripted((call) => {
        calls.push(call);
        // 첫 호출은 전송 유실이고 두 번째는 대상 read다.
        if (calls.length === 1) return "throw";
        if (call.url.endsWith("/v1/documents/save")) return "throw";
        return {
          status: 200,
          body: json({ as_of_seq: "7", next_cursor: null, result: null }),
          type: "application/json",
        };
      }),
    });
    const result = await client.command(save, {
      input: { title: "a" },
      idempotency_key: "key-1",
    });
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
    assertEquals(
      (result.error.details as { diagnosis: string }).diagnosis,
      "effect_unknown",
    );
    assertEquals(
      (result.error.details as { idempotency_key: string }).idempotency_key,
      "key-1",
    );
    // 원래 key로 대상 read를 다시 본 traces가 남는다.
    assertEquals(calls[1].url, "http://127.0.0.1:7431/v1/commands/result");
    const readBody = JSON.parse(String(calls[1].init.body));
    assertEquals(readBody, { idempotency_key: "key-1" });
  },
);
