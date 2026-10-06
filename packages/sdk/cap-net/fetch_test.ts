import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type BrokerResponse,
  CapabilityError,
  type CapHost,
  checkDeclaration,
  createNetClient,
} from "./mod.ts";

const CALL = {
  command: "sync",
  inputHash: "ab".repeat(32),
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
};

type Script = (
  attempt: number,
  signal: AbortSignal | undefined,
) => Promise<BrokerResponse> | BrokerResponse;

function host(script: Script, inCommand = true) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const fake: CapHost = {
    mode: "live",
    post(path, body, options) {
      posts.push({ path, body });
      return Promise.resolve(script(posts.length, options?.signal));
    },
    call: () => inCommand ? CALL : null,
  };
  return { fake, posts };
}

function answered(status: number, body: unknown = null): BrokerResponse {
  return { status: 200, body: { status, body } };
}

function failure(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): BrokerResponse {
  return { status, body: { error: { code, message: `${code}!`, ...extra } } };
}

function client(fake: CapHost) {
  const sleeps: number[] = [];
  return {
    net: createNetClient({
      host: fake,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }),
    sleeps,
  };
}

Deno.test("apps/sdk#R24: cap-net sends the exact destination, command and invocation and returns status and body", async () => {
  const { fake, posts } = host(() => answered(200, { items: [1] }));
  const { net } = client(fake);
  const response = await net.fetch({
    host: "api.example.test",
    port: 443,
    path: "/items",
  });
  assertEquals(response, { status: 200, body: { items: [1] } });
  assertEquals(posts, [{
    path: "/_lophn/broker/net/fetch",
    body: {
      invocation: CALL.invocation,
      command: "sync",
      host: "api.example.test",
      port: 443,
      method: "GET",
      path: "/items",
    },
  }]);
});

Deno.test("apps/sdk#R24: cap-net retries a read after a transient failure with backoff and then succeeds", async () => {
  const { fake, posts } = host((attempt) =>
    attempt < 3 ? failure(503, "unavailable") : answered(200, "ok")
  );
  const { net, sleeps } = client(fake);
  const response = await net.fetch({ host: "h.test", port: 443, path: "/r" });
  assertEquals(response.status, 200);
  assertEquals(posts.length, 3);
  assertEquals(sleeps, [200, 400]);
});

Deno.test("apps/sdk#R24: cap-net retries a read that the target answered 503 and returns the last answer when it keeps failing", async () => {
  const { fake, posts } = host(() => answered(503, "busy"));
  const { net } = client(fake);
  const response = await net.fetch({ host: "h.test", port: 443, path: "/r" });
  assertEquals(response, { status: 503, body: "busy" });
  assertEquals(posts.length, 3);
});

Deno.test("apps/sdk#R24: cap-net does not retry a write by default and marks the outcome unknown", async () => {
  const { fake, posts } = host(() => failure(503, "unavailable"));
  const { net, sleeps } = client(fake);
  const error = await assertRejects(
    () =>
      net.fetch({ host: "h.test", port: 443, path: "/orders", method: "POST" }),
    CapabilityError,
  );
  assertEquals(error.code, "unavailable");
  assertEquals(error.outcome, "unknown");
  assertEquals(posts.length, 1);
  assertEquals(sleeps, []);
});

Deno.test("apps/sdk#R24: cap-net retries a write only when the app asks for it explicitly", async () => {
  const { fake, posts } = host((attempt) =>
    attempt < 2 ? failure(503, "unavailable") : answered(201)
  );
  const { net } = client(fake);
  const response = await net.fetch(
    { host: "h.test", port: 443, path: "/orders", method: "PUT" },
    { retries: 1 },
  );
  assertEquals(response.status, 201);
  assertEquals(posts.length, 2);
});

Deno.test("apps/sdk#R24: cap-net times out a stalled attempt, aborts it and retries a read", async () => {
  const signals: (AbortSignal | undefined)[] = [];
  const { fake, posts } = host((attempt, signal) => {
    signals.push(signal);
    return attempt === 1
      ? new Promise<BrokerResponse>(() => {})
      : answered(200, "late but fine");
  });
  const { net } = client(fake);
  const response = await net.fetch(
    { host: "h.test", port: 443, path: "/slow" },
    { timeoutMs: 20 },
  );
  assertEquals(response.body, "late but fine");
  assertEquals(posts.length, 2);
  assert(signals[0]?.aborted);
});

Deno.test("apps/sdk#R24: cap-net reports a lost transport as unavailable after the retries", async () => {
  const { fake, posts } = host(() => {
    throw new Error("socket closed");
  });
  const { net } = client(fake);
  const error = await assertRejects(
    () => net.fetch({ host: "h.test", port: 443, path: "/r" }),
    CapabilityError,
  );
  assertEquals(error.code, "unavailable");
  assertEquals(posts.length, 3);
});

Deno.test("apps/sdk#R23: cap-net refusal carries the permission name and scope and is never retried", async () => {
  const { fake, posts } = host(() =>
    failure(403, "forbidden", {
      details: {
        permission: "net.fetch",
        scope: { host: "evil.test", port: 443 },
      },
    })
  );
  const { net } = client(fake);
  const error = await assertRejects(
    () => net.fetch({ host: "evil.test", port: 443, path: "/x" }),
    CapabilityError,
  );
  assertEquals(error.code, "forbidden");
  assertEquals(error.permission, "net.fetch");
  assertEquals(error.scope, { host: "evil.test", port: 443 });
  assert(error.message.includes("net.fetch"));
  assert(error.message.includes("evil.test"));
  assertEquals(posts.length, 1);
});

Deno.test("apps/sdk#R22: cap-net without any grant has no way to reach the network", async () => {
  // host가 없으면 import만으로 아무것도 나가지 않는다. 전역 fetch로 우회하지도 않는다.
  const net = createNetClient();
  const error = await assertRejects(
    () => net.fetch({ host: "h.test", port: 443, path: "/x" }),
    CapabilityError,
  );
  assertEquals(error.code, "unavailable");
});

Deno.test("apps/sdk#R24: cap-net rejects malformed requests before sending anything", async () => {
  const { fake, posts } = host(() => answered(200));
  const { net } = client(fake);
  for (
    const request of [
      { host: "", port: 443, path: "/x" },
      { host: "h.test", port: 0, path: "/x" },
      { host: "h.test", port: 443, path: "x" },
      { host: "h.test", port: 443, path: "/x", method: "TRACE" },
    ]
  ) {
    await assertRejects(() => net.fetch(request), CapabilityError);
  }
  const outside = client(host(() => answered(200), false).fake).net;
  await assertRejects(
    () => outside.fetch({ host: "h.test", port: 443, path: "/x" }),
    CapabilityError,
  );
  assertEquals(posts.length, 0);
});

Deno.test("apps/sdk#R22: a declaration that uses cap-net without net.fetch is rejected", () => {
  const using = [{ name: "@lophn/cap-net" }];
  const refused = checkDeclaration({
    sdk_dependencies: using,
    permissions: [{ kind: "fs.read" }],
  });
  assert(!refused.ok);
  assertEquals(refused.error.permissions, ["net.fetch"]);
  assert(
    checkDeclaration({
      sdk_dependencies: using,
      permissions: [{ kind: "net.fetch" }],
    }).ok,
  );
});
