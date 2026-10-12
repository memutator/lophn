import { assert, assertEquals } from "@std/assert";
import { err, manualClock } from "../../../../base/mod.ts";
import {
  BROKER_ROUTES,
  type BrokerServices,
  createBrokerEndpoint,
  serveBroker,
} from "./server.ts";
import { createInvocationBroker } from "./invocations.ts";
import {
  APP,
  child,
  CREDENTIAL,
  RELEASE,
  withChild,
} from "../testing/broker.ts";

const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { authorization: CREDENTIAL },
): Request {
  return new Request(`http://lophn.invalid${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function endpoint(services: BrokerServices) {
  return createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services,
  });
}

const startFact = {
  operation: { kind: "command", command: "usage.save" },
  trigger: { kind: "direct" },
  caller: { kind: "direct" },
  actor: "user",
  started_at: "2026-10-06T00:00:00.000Z",
};

function invocations() {
  const queued: unknown[] = [];
  const broker = createInvocationBroker({
    clock: manualClock(0),
    queue: {
      enqueue: (message) => {
        queued.push(message);
      },
      pump: () => Promise.resolve(),
    },
  });
  return { queued, services: { invocations: broker } };
}

Deno.test("apps/permissions#R4: broker는 다섯 서비스 경로만 내고 core API proxy나 모르는 경로는 없는 경로와 같은 not_found다", async () => {
  const { services } = invocations();
  const broker = endpoint(services);
  const absent = await broker.handle(
    post("/_lophn/broker/not-a-service", withChild({})),
  );
  assertEquals(absent.status, 404);
  const absentBody = await absent.json();
  for (
    const path of [
      "/v1/apps/list",
      "/v1/grants/create",
      // 이 endpoint가 서비스를 달지 않은 경로는 없는 경로와 같다.
      BROKER_ROUTES.netFetch,
      BROKER_ROUTES.secretsUse,
      BROKER_ROUTES.documentsSave,
      BROKER_ROUTES.problemsReport,
      "/_lophn/broker/control/watch",
    ]
  ) {
    const response = await broker.handle(post(path, withChild({})));
    assertEquals(response.status, 404, path);
    assertEquals(await response.json(), absentBody, path);
  }
  const get = await broker.handle(
    new Request(`http://lophn.invalid${BROKER_ROUTES.invocationsSubmit}`, {
      method: "GET",
      headers: { authorization: CREDENTIAL },
    }),
  );
  assertEquals(get.status, 404);
});

Deno.test("apps/permissions#R4: 자식 credential이 없거나 틀리면 거절하고 본문의 nonce·mode가 연결과 다르면 거절한다", async () => {
  const { services, queued } = invocations();
  const broker = endpoint(services);
  const body = withChild({
    invocation: INV,
    fact: "start",
    summary: startFact,
  });
  const rejected: Record<string, string>[] = [
    {},
    { authorization: "other-credential" },
    { authorization: `${CREDENTIAL}x` },
    { authorization: `Bearer ${CREDENTIAL}x` },
  ];
  for (const headers of rejected) {
    const response = await broker.handle(
      post(BROKER_ROUTES.invocationsSubmit, body, headers),
    );
    assertEquals(response.status, 401, JSON.stringify(headers));
  }
  const otherNonce = await broker.handle(
    post(
      BROKER_ROUTES.invocationsSubmit,
      { ...body, process_nonce: "nonce-2" },
    ),
  );
  assertEquals(otherNonce.status, 401);
  const otherMode = await broker.handle(
    post(BROKER_ROUTES.invocationsSubmit, { ...body, mode: "preview" }),
  );
  assertEquals(otherMode.status, 401);
  const notJson = await broker.handle(
    post(BROKER_ROUTES.invocationsSubmit, "not json"),
  );
  assertEquals(notJson.status, 400);
  assertEquals(queued.length, 0);

  // Bearer 표기와 원문 표기 모두 같은 credential로 받는다.
  const bearer = await broker.handle(
    post(BROKER_ROUTES.invocationsSubmit, body, {
      authorization: `Bearer ${CREDENTIAL}`,
    }),
  );
  assertEquals(bearer.status, 200);
  assertEquals(await bearer.json(), { accepted: true });
  assertEquals(queued.length, 1);
});

Deno.test("apps/permissions#R4: 서비스가 던져도 오류 원문 없이 internal로 답한다", async () => {
  const broker = endpoint({
    problems: {
      report: () => {
        throw new Error("secret stack detail");
      },
    },
  });
  const response = await broker.handle(
    post(
      BROKER_ROUTES.problemsReport,
      withChild({ code: "calendar_failed" }),
    ),
  );
  assertEquals(response.status, 500);
  const text = await response.text();
  assert(!text.includes("secret stack detail"));
});

Deno.test("apps/permissions#R4: 오류는 상태와 envelope로 대응하고 허용되지 않은 권한은 permission 이름과 scope를 알린다", async () => {
  const broker = endpoint({
    problems: {
      report: () =>
        Promise.resolve(err({
          code: "forbidden",
          message: "net.fetch is not permitted for this scope",
          details: { permission: "net.fetch", scope: { host: "a", port: 1 } },
        })),
    },
  });
  const response = await broker.handle(
    post(BROKER_ROUTES.problemsReport, withChild({ code: "calendar_failed" })),
  );
  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    error: {
      code: "forbidden",
      message: "net.fetch is not permitted for this scope",
      details: { permission: "net.fetch", scope: { host: "a", port: 1 } },
    },
  });
});

Deno.test("apps/permissions#R4: 앱별 broker socket은 Unix socket HTTP로 자기 자식의 요청만 받는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-broker-" });
  const socket = `${dir}/b-test.sock`;
  const { services, queued } = invocations();
  const listener = serveBroker(socket, endpoint(services));
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: socket },
  });
  try {
    const fetched = (headers: Record<string, string>, body: unknown) =>
      fetch(`http://lophn.invalid${BROKER_ROUTES.invocationsSubmit}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        client,
      });
    const body = withChild({
      invocation: INV,
      fact: "start",
      summary: startFact,
    });
    const refused = await fetched({ authorization: "wrong" }, body);
    assertEquals(refused.status, 401);
    await refused.body?.cancel();
    const accepted = await fetched({ authorization: CREDENTIAL }, body);
    assertEquals(accepted.status, 200);
    assertEquals(await accepted.json(), { accepted: true });
    assertEquals(queued.length, 1);
    assert(
      JSON.stringify(queued[0]).includes(APP) &&
        JSON.stringify(queued[0]).includes(RELEASE),
    );
  } finally {
    client.close();
    await listener.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
