import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import { createNetFetchService } from "./net-fetch.ts";

const INV1 = "inv_01hzzzzzzzzzzzzzzzzzzzzzz1";
const INV2 = "inv_01hzzzzzzzzzzzzzzzzzzzzzz2";

const CHILD = {
  app: "demo",
  release: "r1",
  mode: "live" as const,
  processNonce: "n1",
};

function setup(
  granted: { host: string; port: number }[],
  respond: (url: URL) => Response,
  secrets?: (
    invocation: string,
    host: string,
    port: number,
  ) => string | undefined,
) {
  const urls: string[] = [];
  const authorization: (string | null)[] = [];
  const sent: { headers: Headers; body: unknown }[] = [];
  const service = createNetFetchService({
    access: {
      current: () =>
        Promise.resolve(
          ok({
            release: "r1",
            scope: {
              access: granted.map((scope) => ({ kind: "net.fetch", scope })),
              app_calls: [],
            },
            tools: ["demo.run"],
          }),
        ),
    },
    ...(secrets === undefined ? {} : { secrets }),
    transport: (input, init) => {
      const url = new URL(String(input));
      urls.push(url.href);
      authorization.push(new Headers(init?.headers).get("authorization"));
      sent.push({ headers: new Headers(init?.headers), body: init?.body });
      return Promise.resolve(respond(url));
    },
    platformPorts: [4000],
  });
  const fetch = (
    host: string,
    port: number,
    path = "/x",
    invocation: string | null = null,
    extra: Record<string, unknown> = {},
  ) =>
    service.request(CHILD, {
      process_nonce: "n1",
      mode: "live",
      invocation,
      command: "demo.run",
      host,
      port,
      method: "GET",
      path,
      ...extra,
    });
  return { urls, authorization, sent, fetch };
}

test("loopback host goes out as http, others as https, platform ports stay blocked", async () => {
  const { urls, fetch } = setup(
    [
      { host: "127.0.0.1", port: 8080 },
      { host: "127.0.0.1", port: 4000 },
      { host: "api.example.com", port: 443 },
    ],
    () => new Response("ok"),
  );
  assert.deepStrictEqual((await fetch("127.0.0.1", 8080)).ok, true);
  assert.deepStrictEqual((await fetch("api.example.com", 443)).ok, true);
  const platform = await fetch("127.0.0.1", 4000);
  assert.deepStrictEqual(!platform.ok && platform.error.code, "forbidden");
  assert.deepStrictEqual(urls, [
    "http://127.0.0.1:8080/x",
    "https://api.example.com/x",
  ]);
});

test("redirect from https down to loopback http is refused", async () => {
  const { urls, fetch } = setup(
    [
      { host: "127.0.0.1", port: 8080 },
      { host: "api.example.com", port: 443 },
    ],
    (url) =>
      url.protocol === "https:"
        ? new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1:8080/y" },
          })
        : new Response("ok"),
  );
  const result = await fetch("api.example.com", 443);
  assert.deepStrictEqual(!result.ok && result.error.code, "forbidden");
  assert.deepStrictEqual(urls, ["https://api.example.com/x"]);
});

test("secret value is attached only to the same invocation's exact destination", async () => {
  const { authorization, fetch } = setup(
    [
      { host: "127.0.0.1", port: 8080 },
      { host: "127.0.0.1", port: 9090 },
      { host: "api.example.com", port: 443 },
    ],
    (url) =>
      url.pathname === "/hop"
        ? new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1:9090/y" },
          })
        : new Response("ok"),
    (invocation, host, port) =>
      invocation === INV1 && host === "127.0.0.1" && port === 8080
        ? "TOKEN"
        : undefined,
  );
  await fetch("127.0.0.1", 8080, "/x", INV1);
  await fetch("127.0.0.1", 8080, "/x", INV2);
  await fetch("127.0.0.1", 8080, "/x", null);
  await fetch("api.example.com", 443, "/x", INV1);
  // 목적지가 바뀐 redirect hop에는 붙지 않는다.
  await fetch("127.0.0.1", 8080, "/hop", INV1);
  assert.deepStrictEqual(authorization, [
    "Bearer TOKEN",
    null,
    null,
    null,
    "Bearer TOKEN",
    null,
  ]);
});

test("app headers cannot carry credentials, and the secret is the only Authorization", async () => {
  const { sent, fetch } = setup(
    [{ host: "127.0.0.1", port: 8080 }],
    () => new Response("ok"),
    () => "TOKEN",
  );
  for (const name of ["Authorization", "cookie", "HOST", "Content-Length"]) {
    const refused = await fetch("127.0.0.1", 8080, "/x", INV1, {
      method: "POST",
      body: "x",
      headers: { [name]: "evil" },
    });
    assert.deepStrictEqual(!refused.ok && refused.error.code, "invalid_input");
  }
  assert.deepStrictEqual(sent.length, 0);
  const sentOk = await fetch("127.0.0.1", 8080, "/x", INV1, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  assert.deepStrictEqual(sentOk.ok, true);
  assert.deepStrictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].body, "{}");
  assert.deepStrictEqual(
    sent[0].headers.get("content-type"),
    "application/json",
  );
  assert.deepStrictEqual(sent[0].headers.get("authorization"), "Bearer TOKEN");
});
