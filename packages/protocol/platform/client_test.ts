import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { createRpcClient, type RpcFetch } from "./client.ts";
import {
  defineCommand,
  defineFile,
  defineMemory,
  defineRead,
} from "./route.ts";

const command = defineCommand({
  resource: "documents",
  method: "save",
  name: "Save",
  input: z.strictObject({ title: z.string() }),
  output: z.object({ id: z.string(), note: z.string().optional() }),
  actors: ["user"],
  errors: ["conflict"],
});

const file = defineFile({
  resource: "documents",
  method: "read-file",
  name: "ReadFile",
  input: z.strictObject({ id: z.string() }),
  contentType: "text/markdown",
  actors: ["user"],
  errors: ["not_found"],
});

type Sent = { url: string; init: Parameters<RpcFetch>[1] };

function scripted(
  handler: (
    sent: Sent,
  ) => { status: number; body: string; type?: string } | "throw",
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

const request = (title: string) => ({
  input: { title },
  idempotency_key: "key-1",
  compare: {},
  prepared: [],
});

Deno.test(
  "platform/api#R1: client는 POST /v1/<resource>/<method>에 Bearer로 보내고 Origin을 넣지 않는다",
  async () => {
    const sent: Sent[] = [];
    const client = createRpcClient({
      baseUrl: "http://127.0.0.1:7431/",
      token: "tok",
      fetch: scripted((call) => {
        sent.push(call);
        return {
          status: 200,
          body: json({ id: "doc_1" }),
          type: "application/json",
        };
      }),
    });
    const result = await client.call(command, request("a"));
    assert(result.ok);
    if (result.ok) {
      assertEquals(result.value, { id: "doc_1" });
    }
    assertEquals(sent.length, 1);
    assertEquals(sent[0].url, "http://127.0.0.1:7431/v1/documents/save");
    assertEquals(sent[0].init.method, "POST");
    assertEquals(sent[0].init.headers["authorization"], "Bearer tok");
    assertEquals(sent[0].init.headers["content-type"], "application/json");
    assertEquals("origin" in sent[0].init.headers, false);
    assertEquals(sent[0].init.body, json(request("a")));
  },
);

Deno.test(
  "platform/api#R6: 입력이 schema에 안 맞으면 보내지 않고 invalid_input이다",
  async () => {
    let calls = 0;
    const client = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted(() => {
        calls += 1;
        return { status: 200, body: "{}" };
      }),
    });
    const result = await client.call(
      command,
      { ...request("a"), actor: "user" } as ReturnType<typeof request>,
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
    assertEquals(calls, 0);
  },
);

Deno.test(
  "platform/api#R3: 실패 status는 ErrorBody를 읽고 출력이 안 맞으면 internal이다",
  async () => {
    const failing = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted(() => ({
        status: 409,
        body: json({ error: { code: "conflict", message: "changed" } }),
      })),
    });
    const conflict = await failing.call(command, request("a"));
    assert(!conflict.ok);
    if (!conflict.ok) {
      assertEquals(conflict.error, { code: "conflict", message: "changed" });
    }

    const bare = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted(() => ({ status: 503, body: "down" })),
    });
    const unavailable = await bare.call(command, request("a"));
    assert(!unavailable.ok);
    if (!unavailable.ok) assertEquals(unavailable.error.code, "unavailable");

    const mismatched = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted(() => ({ status: 200, body: json({ nope: true }) })),
    });
    const internal = await mismatched.call(command, request("a"));
    assert(!internal.ok);
    if (!internal.ok) {
      assertEquals(internal.error.code, "internal");
      assertEquals(JSON.stringify(internal.error).includes("nope"), false);
    }
  },
);

Deno.test(
  "platform/api#R1: fetch 실패는 unavailable이고 재시도하지 않으며 file route는 바이트를 돌려준다",
  async () => {
    let calls = 0;
    const down = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: () => {
        calls += 1;
        return Promise.reject(new Error("connect refused"));
      },
    });
    const result = await down.call(command, request("a"));
    assert(!result.ok);
    if (!result.ok) {
      assertEquals(result.error.code, "unavailable");
      assertEquals(result.error.details, { reason: "transport_failed" });
    }
    assertEquals(calls, 1);

    const bytes = new TextEncoder().encode("# hi");
    const reading = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: (_url, init) => {
        assertEquals(init.body, undefined);
        assertEquals("content-type" in init.headers, false);
        return Promise.resolve({
          status: 200,
          headers: new Headers({ "content-type": "text/markdown" }),
          bytes,
        });
      },
    });
    const read = defineRead({
      resource: "documents",
      method: "list",
      name: "List",
      input: z.strictObject({}),
      output: z.object({ items: z.array(z.string()) }),
      actors: ["user"],
      errors: ["not_found"],
    });
    const fileResult = await reading.call(file, { id: "doc_1" });
    assert(fileResult.ok);
    if (fileResult.ok) {
      assertEquals(fileResult.value.bytes, bytes);
      assertEquals(fileResult.value.contentType, "text/markdown");
    }
    const listed = await createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted(() => ({
        status: 200,
        body: json({ items: [], extra: 1 }),
      })),
    }).call(read, {});
    assert(listed.ok);
    if (listed.ok) assertEquals(listed.value, { items: [] });
  },
);

Deno.test(
  "shell/workspace#R10: memory route는 ledger envelope 없이 raw JSON을 주고받는다",
  async () => {
    const memory = defineMemory({
      resource: "workspace",
      method: "read",
      name: "ReadView",
      input: z.strictObject({ session: z.string() }),
      output: z.strictObject({
        availability: z.literal("current"),
        summary: z.string(),
      }),
      actors: ["agent"],
      errors: ["not_found"],
    });
    const sent: Sent[] = [];
    const client = createRpcClient({
      baseUrl: "http://127.0.0.1:7431",
      token: "tok",
      fetch: scripted((call) => {
        sent.push(call);
        return {
          status: 200,
          body: json({ availability: "current", summary: "open notes" }),
        };
      }),
    });
    const result = await client.call(memory, { session: "ses_1" });
    assert(result.ok);
    if (result.ok) {
      assertEquals(result.value, {
        availability: "current",
        summary: "open notes",
      });
    }
    assertEquals(sent[0].url, "http://127.0.0.1:7431/v1/workspace/read");
    assertEquals(sent[0].init.body, json({ session: "ses_1" }));
    const rejected = await client.call(memory, {
      session: "ses_1",
      body: "document text",
    } as { session: string });
    assert(!rejected.ok);
    if (!rejected.ok) assertEquals(rejected.error.code, "invalid_input");
  },
);
