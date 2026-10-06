// 앱 통로 coding agent 쪽 테스트다(T21, mcp#R29, cli#R31). socket을 열지 않고 transport를
// 주입해 연결 요청의 모양, 요청이 나갔는지의 구별, 결과 불명을 본다.
import { assert, assertEquals } from "@std/assert";
import { createAppDirect, NotSent } from "./app-direct.ts";
import { scriptedFlow } from "./testing/mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const INV = "inv_01arz3ndektsv4rrffq69g5fav";
const SIGNATURE = "A".repeat(86);

function grant(release: string | null) {
  return {
    endpoint: "/tmp/lophn-app.sock",
    connection: { release },
    signature: SIGNATURE,
  };
}

const REQUEST = {
  app: APP,
  environment: "preview" as const,
  command: "usage.read",
  input: { month: 10 },
  request_key: "rk-1",
  preview_nonce: "n1",
};

Deno.test("coding-agent/mcp-server#R29: 연결은 환경·command·preview nonce만 요청하고 core를 지나지 않는 요청은 서명 envelope를 쓴다", async () => {
  const flow = scriptedFlow({ "app.connect": grant(null) });
  const sent: { endpoint: string; request: unknown }[] = [];
  const direct = createAppDirect({
    client: flow.client,
    transport: (endpoint, request) => {
      sent.push({ endpoint, request });
      return Promise.resolve({
        status: 200,
        body: {
          result: { result: { total: 3 } },
          invocation: INV,
          mode: "preview",
        },
      });
    },
  });
  const outcome = await direct.invoke(REQUEST);
  assert(outcome.ok);
  assertEquals(outcome.value.kind, "result");
  assertEquals(flow.calls("app.connect")[0].input, {
    app: APP,
    mode: "preview",
    screens: ["main"],
    screen_sizes: {},
    commands: ["usage.read"],
    preview_nonce: "n1",
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].endpoint, "/tmp/lophn-app.sock");
  const request = sent[0].request as {
    method: string;
    path: string;
    authorization: string;
    body: Record<string, unknown>;
  };
  assertEquals(request.path, "/_lophn/commands/invoke");
  assertEquals(JSON.parse(request.authorization), {
    payload: { release: null },
    signature: SIGNATURE,
  });
  // release가 없는 preview 연결은 가짜 release를 보내지 않는다.
  assertEquals(request.body, {
    request_key: "rk-1",
    command: "usage.read",
    input: { month: 10 },
  });
});

Deno.test("coding-agent/mcp-server#R29: live 연결은 connection이 고정한 release를 보낸다", async () => {
  const flow = scriptedFlow({ "app.connect": grant(REL) });
  const bodies: unknown[] = [];
  const direct = createAppDirect({
    client: flow.client,
    transport: (_endpoint, request) => {
      bodies.push(request.body);
      return Promise.resolve({
        status: 200,
        body: { result: { result: null }, mode: "live" },
      });
    },
  });
  await direct.invoke({
    ...REQUEST,
    environment: "live",
    preview_nonce: undefined,
  });
  assertEquals((bodies[0] as { release: string }).release, REL);
  assertEquals(flow.calls("app.connect")[0].input, {
    app: APP,
    mode: "live",
    screens: ["main"],
    screen_sizes: {},
    commands: ["usage.read"],
  });
});

Deno.test("coding-agent/cli#R31: 연결을 열지 못한 것과 보낸 뒤 응답을 잃은 것을 구별하고 다시 보내지 않는다", async () => {
  const flow = scriptedFlow({ "app.connect": grant(null) });
  let attempts = 0;
  const unreachable = createAppDirect({
    client: flow.client,
    transport: () => {
      attempts += 1;
      throw new NotSent();
    },
  });
  const notSent = await unreachable.invoke(REQUEST);
  assert(!notSent.ok);
  assertEquals(notSent.error.code, "unavailable");
  assertEquals(attempts, 1);

  const lost = createAppDirect({
    client: flow.client,
    transport: () => {
      attempts += 1;
      return Promise.reject(new Error("connection reset"));
    },
  });
  const unknown = await lost.invoke(REQUEST);
  assert(unknown.ok);
  assertEquals(unknown.value, { kind: "unknown", request_key: "rk-1" });
  assertEquals(attempts, 2);

  // 읽을 수 없는 응답도 결과 불명이다.
  const garbled = createAppDirect({
    client: flow.client,
    transport: () => Promise.resolve({ status: 200, body: { nope: true } }),
  });
  const parsed = await garbled.invoke(REQUEST);
  assert(parsed.ok);
  assertEquals(parsed.value.kind, "unknown");
});

Deno.test("coding-agent/cli#R31: 앱의 오류 응답은 오류 코드 그대로고 연결 실패는 앱 통로를 부르지 않는다", async () => {
  const flow = scriptedFlow({ "app.connect": grant(null) });
  const denied = createAppDirect({
    client: flow.client,
    transport: () =>
      Promise.resolve({
        status: 403,
        body: { error: { code: "forbidden", message: "confirm command다" } },
      }),
  });
  const refused = await denied.invoke(REQUEST);
  assert(!refused.ok);
  assertEquals(refused.error.code, "forbidden");

  const closed = scriptedFlow({
    "app.connect": { ok: false, error: { code: "not_found", message: "없다" } },
  });
  let called = 0;
  const direct = createAppDirect({
    client: closed.client,
    transport: () => {
      called += 1;
      return Promise.resolve({ status: 200, body: {} });
    },
  });
  const gone = await direct.invoke(REQUEST);
  assert(!gone.ok);
  assertEquals(gone.error.code, "not_found");
  assertEquals(called, 0);
});
