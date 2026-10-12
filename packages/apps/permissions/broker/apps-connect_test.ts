// broker `/_lophn/broker/apps/connect`(apps/connections#R1, R5, apps/runtime#R30). 신원은 자식
// 연결이 정하고 본문의 caller·source·actor 주장은 받지 않는다. 준비 서비스는 포트 대역이다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { AppConnectOutput } from "../../../protocol/apps/mod.ts";
import {
  type AppPairPreparer,
  type AppsConnectRequest,
  createAppsConnectService,
} from "./apps-connect.ts";
import { BROKER_ROUTES, createBrokerEndpoint } from "./server.ts";
import {
  APP,
  child,
  CREDENTIAL,
  RELEASE,
  withChild,
} from "../testing/broker.ts";

const TARGET = "app_01h455vb4pex5v6nkc6gd5fdw2";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";

function output(): AppConnectOutput {
  return {
    endpoint: "/run/lophn/a-1.sock",
    connection: {
      app: TARGET,
      release: RELEASE,
      bundle_hash: "ab".repeat(32),
      mode: "live",
      process_nonce: "target-nonce",
      actor: `app:${APP}`,
      credential_ref: "app-call:nonce-1",
      screens: [],
      screen_sizes: {},
      caller: null,
      commands: ["usage.read"],
      expires_at: "2026-10-06T00:10:00.000Z",
    },
    signature: "A".repeat(86),
  };
}

function setup(prepare?: AppPairPreparer["prepare"]) {
  const requests: AppsConnectRequest[] = [];
  const preparer: AppPairPreparer = {
    prepare: prepare ?? ((request) => {
      requests.push(request);
      return Promise.resolve(ok(output()));
    }),
  };
  const endpoint = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: { apps: createAppsConnectService({ preparer }) },
  });
  const post = (body: Record<string, unknown>) =>
    endpoint.handle(
      new Request(`http://lophn.invalid${BROKER_ROUTES.appsConnect}`, {
        method: "POST",
        headers: { authorization: CREDENTIAL },
        body: JSON.stringify(body),
      }),
    );
  return { requests, post, endpoint };
}

const request = {
  app: TARGET,
  commands: ["usage.read"],
  parent_invocation: INV,
};

Deno.test("apps/connections#R1: 준비 요청의 source는 자식 연결의 신원이고 본문이 아니다", async () => {
  const { requests, post } = setup();
  const response = await post(withChild(request));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).endpoint, "/run/lophn/a-1.sock");
  assertEquals(requests.length, 1);
  assertEquals(requests[0], {
    source: child(),
    app: TARGET,
    commands: ["usage.read"],
    parent_invocation: INV,
  });
});

Deno.test("apps/runtime#R30: 본문의 caller·source·actor 주장과 다른 자식의 nonce·mode는 준비로 가지 않는다", async () => {
  const { requests, post } = setup();
  for (
    const claim of [
      { caller: { kind: "app", app: TARGET } },
      { source: TARGET },
      { actor: "user" },
      { app_origin: { app: TARGET } },
    ]
  ) {
    const response = await post(withChild({ ...request, ...claim }));
    assertEquals(response.status, 400);
  }
  // 이 broker 연결의 nonce·mode가 아니면 신원이 맞지 않는다.
  const stranger = await post({
    ...request,
    process_nonce: "other",
    mode: "live",
  });
  assertEquals(stranger.status, 401);
  const wrongMode = await post(
    withChild(request, { ...child(), mode: "preview" }),
  );
  assertEquals(wrongMode.status, 401);
  // 빈 command 목록·중복 command·모르는 모양은 준비 전에 거절한다.
  assertEquals(
    (await post(withChild({ ...request, commands: [] }))).status,
    400,
  );
  assertEquals(
    (await post(withChild({ ...request, commands: ["a", "a"] }))).status,
    400,
  );
  assertEquals((await post(withChild({ app: TARGET }))).status, 400);
  assertEquals(requests.length, 0);
});

Deno.test("apps/connections#R1: 범위 밖 대상은 없는 앱과 같은 응답이고 준비 서비스 오류는 그대로 전해진다", async () => {
  const refuse = (code: "not_found" | "forbidden" | "unavailable") =>
    setup(() => Promise.resolve(err({ code, message: `${code} message` })));
  for (
    const [code, status] of [["not_found", 404], ["forbidden", 403], [
      "unavailable",
      503,
    ]] as const
  ) {
    const response = await refuse(code).post(withChild(request));
    assertEquals(response.status, status);
    assertEquals((await response.json()).error.code, code);
  }
});

Deno.test("apps/connections#R4: 서비스를 달지 않은 broker에는 이 경로가 없고 준비가 중계한 값은 contract를 지킨다", async () => {
  const bare = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: {},
  });
  const absent = await bare.handle(
    new Request(`http://lophn.invalid${BROKER_ROUTES.appsConnect}`, {
      method: "POST",
      headers: { authorization: CREDENTIAL },
      body: JSON.stringify(withChild(request)),
    }),
  );
  assertEquals(absent.status, 404);
  // 준비 서비스가 contract에 맞지 않는 값을 내면 그대로 내보내지 않고 internal로 막는다.
  const broken = setup(() =>
    Promise.resolve(ok({ endpoint: "x" } as unknown as AppConnectOutput))
  );
  const response = await broken.post(withChild(request));
  assertEquals(response.status, 500);
  assert((await response.json()).error.code === "internal");
});

Deno.test("apps/connections#R7: 받은 호출의 출처 식별은 준비로 전해지고 path 주장은 계약에서 거절된다", async () => {
  const { requests, post } = setup();
  const incoming = { app: TARGET, release: RELEASE, parent_invocation: null };
  const response = await post(withChild({ ...request, incoming }));
  assertEquals(response.status, 200);
  assertEquals(requests[0].incoming, incoming);
  const forged = await post(
    withChild({ ...request, incoming: { ...incoming, path: [TARGET] } }),
  );
  assertEquals(forged.status, 400);
  assertEquals(requests.length, 1);
});
