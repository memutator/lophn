import { assert, assertEquals } from "@std/assert";
import { manualClock, ok } from "../../../base/mod.ts";
import {
  BROKER_ROUTES,
  type BrokerChild,
  createBrokerEndpoint,
  createInvocationBroker,
  createProblemReportService,
  type ProblemReportRequest,
} from "../permissions/mod.ts";
import {
  createPreviewBrokerServices,
  type PreviewScope,
  previewScopeOf,
} from "./mod.ts";
import { FIXTURE_APP, FIXTURE_RELEASE } from "./world_test.ts";

const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const HASH = "ab".repeat(32);
const NONCE = "nonce-preview-1";
const CREDENTIAL = "preview-credential";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";

const scope: PreviewScope = {
  secrets: ["calendar_token"],
  net: [{ host: "api.example.com", port: 443 }],
  documents: ["notes"],
};

function child(overrides: Partial<BrokerChild> = {}): BrokerChild {
  return {
    app: FIXTURE_APP,
    release: null,
    mode: "preview",
    processNonce: NONCE,
    ...overrides,
  };
}

function withChild(
  body: Record<string, unknown>,
  mode: string = "preview",
): Record<string, unknown> {
  return { process_nonce: NONCE, mode, ...body };
}

const secretBody = (overrides: Record<string, unknown> = {}) =>
  withChild({
    release: FIXTURE_RELEASE,
    invocation: null,
    command: "usage.save",
    input_hash: HASH,
    name: "calendar_token",
    destination: { scheme: "https", host: "api.example.com", port: 443 },
    ...overrides,
  });

Deno.test("apps/preview#R4: secret 대역은 선언한 이름과 선언한 목적지만 받고 사용 요청만 남기며 값은 어디에도 없다", async () => {
  const { secrets } = createPreviewBrokerServices({ scope });
  const used = await secrets.use(child(), secretBody());
  assert(used.ok);
  assertEquals(used.value, { used: true });
  assertEquals(secrets.uses, [{
    name: "calendar_token",
    destination: { host: "api.example.com", port: 443 },
    command: "usage.save",
  }]);
  // 선언하지 않은 이름과 선언하지 않은 목적지는 운영 broker와 같은 모양으로 거절한다.
  const undeclared = await secrets.use(
    child(),
    secretBody({ name: "other_token" }),
  );
  assert(!undeclared.ok);
  assertEquals(undeclared.error.code, "forbidden");
  assertEquals(undeclared.error.details, {
    permission: "secret.use",
    scope: { name: "other_token" },
  });
  const elsewhere = await secrets.use(
    child(),
    secretBody({
      destination: { scheme: "https", host: "evil.example.net", port: 443 },
    }),
  );
  assert(!elsewhere.ok);
  assertEquals(elsewhere.error.details, {
    permission: "net.fetch",
    scope: { host: "evil.example.net", port: 443 },
  });
  assertEquals(secrets.uses.length, 1);
  assert(!JSON.stringify(secrets.uses).includes("secret-value"));
  const malformed = await secrets.use(child(), withChild({ name: "x" }));
  assert(!malformed.ok);
  assertEquals(malformed.error.code, "invalid_input");
});

Deno.test("apps/preview#R4: 외부 전송 대역은 네트워크에 나가지 않고 선언한 host만 받으며 loopback은 선언해도 받지 않는다", async () => {
  const withLoopback: PreviewScope = {
    ...scope,
    net: [...scope.net, { host: "127.0.0.1", port: 8080 }],
  };
  const { external } = createPreviewBrokerServices({ scope: withLoopback });
  const body = (overrides: Record<string, unknown> = {}) =>
    withChild({
      invocation: null,
      command: "usage.save",
      host: "api.example.com",
      port: 443,
      method: "post",
      path: "/events",
      ...overrides,
    });
  const sent = await external.request(child(), body());
  assert(sent.ok);
  assertEquals(sent.value, { status: 200, body: null });
  assertEquals(external.requests, [{
    host: "api.example.com",
    port: 443,
    method: "POST",
    path: "/events",
    command: "usage.save",
  }]);
  for (
    const refused of [
      body({ host: "other.example.com" }),
      body({ port: 444 }),
      body({ host: "127.0.0.1", port: 8080 }),
      body({ host: "localhost", port: 443 }),
    ]
  ) {
    const result = await external.request(child(), refused);
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
  }
  assertEquals(external.requests.length, 1);
});

Deno.test("apps/preview#R4: 문서 저장 대역은 선언한 key만 받고 기대 version 충돌과 재전송을 운영과 같게 지킨다", async () => {
  const { documents } = createPreviewBrokerServices({ scope });
  const save = (overrides: Record<string, unknown> = {}) =>
    documents.save(
      child(),
      withChild({
        key: "notes",
        base_version: null,
        idempotency_key: "k1",
        ...overrides,
      }),
    );
  const first = await save();
  assert(first.ok && first.value.version !== null);
  const retry = await save();
  assert(retry.ok);
  assertEquals(retry.value, first.value);
  const stale = await save({ idempotency_key: "k2" });
  assert(!stale.ok);
  assertEquals(stale.error.code, "conflict");
  const next = await save({
    base_version: first.value.version,
    idempotency_key: "k3",
  });
  assert(next.ok && next.value.version !== first.value.version);
  assertEquals(documents.versions.get("notes")?.length, 2);
  const undeclared = await save({ key: "secret-notes" });
  assert(!undeclared.ok);
  assertEquals(undeclared.error.code, "forbidden");
  assertEquals(undeclared.error.details, {
    permission: "document.save",
    scope: { key: "secret-notes" },
  });
});

Deno.test("apps/preview#R4: 다른 앱 조회 대역은 가짜 connection을 만들지 않고 대상이 있든 없든 같은 거절이다", async () => {
  const { apps } = createPreviewBrokerServices({ scope });
  const connect = (app: string) =>
    apps.connect(
      child(),
      withChild({ app, commands: ["usage.read"], parent_invocation: null }),
    );
  const known = await connect(OTHER_APP);
  const unknown = await connect("app_01arz3ndektsv4rrffq69g5fax");
  assert(!known.ok && !unknown.ok);
  assertEquals(known.error.code, "forbidden");
  assertEquals(known.error.message, unknown.error.message);
  assertEquals(apps.attempts.map((attempt) => attempt.app), [
    OTHER_APP,
    "app_01arz3ndektsv4rrffq69g5fax",
  ]);
  const malformed = await apps.connect(child(), withChild({ app: "x" }));
  assert(!malformed.ok);
  assertEquals(malformed.error.code, "invalid_input");
});

Deno.test("apps/preview#R4: 대역은 운영(live) 자식 요청을 받지 않는다", async () => {
  const services = createPreviewBrokerServices({ scope });
  const live = child({ mode: "live", release: FIXTURE_RELEASE });
  const results = [
    await services.secrets.use(live, secretBody()),
    await services.external.request(
      live,
      withChild({
        invocation: null,
        command: "usage.save",
        host: "api.example.com",
        port: 443,
        method: "GET",
        path: "/",
      }, "live"),
    ),
    await services.documents.save(
      live,
      withChild({
        key: "notes",
        base_version: null,
        idempotency_key: "k",
      }, "live"),
    ),
  ];
  for (const result of results) {
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
  }
  assertEquals(services.secrets.uses.length, 0);
  assertEquals(services.external.requests.length, 0);
  assertEquals(services.documents.versions.size, 0);
});

Deno.test("apps/preview#R4: broker endpoint에 올리면 mode와 nonce가 맞는 자식만 대역에 닿고 모르는 경로는 없는 경로다", async () => {
  const { services } = createPreviewBrokerServices({ scope });
  const endpoint = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services,
  });
  const post = (path: string, body: unknown, credential = CREDENTIAL) =>
    endpoint.handle(
      new Request(`http://lophn.invalid${path}`, {
        method: "POST",
        headers: { authorization: credential },
        body: JSON.stringify(body),
      }),
    );
  const used = await post(BROKER_ROUTES.secretsUse, secretBody());
  assertEquals(used.status, 200);
  assertEquals(await used.json(), { used: true });
  // 본문의 mode가 연결과 다르면(운영 mode를 주장하면) 대역에 닿지 못한다.
  const claimed = await post(
    BROKER_ROUTES.secretsUse,
    secretBody({ mode: "live" }),
  );
  assertEquals(claimed.status, 401);
  const wrong = await post(BROKER_ROUTES.secretsUse, secretBody(), "other");
  assertEquals(wrong.status, 401);
  // 다른 앱 조회는 broker 서비스 자리가 아직 없다. 없는 경로와 같다.
  const apps = await post(
    "/_lophn/broker/apps/connect",
    withChild({
      app: OTHER_APP,
      commands: ["usage.read"],
      parent_invocation: null,
    }),
  );
  assertEquals(apps.status, 404);
});

Deno.test("apps/preview#R8: preview 보고는 mode=preview와 release 없음으로 collector에 가고 운영 problem 상태를 바꾸는 통로가 없다", async () => {
  const calls: ProblemReportRequest[] = [];
  const problems = createProblemReportService({
    access: {
      current: () => Promise.resolve(ok(null)),
    },
    problems: {
      report(request) {
        calls.push(request);
        return Promise.resolve(
          ok({
            report: "rpt_01h455vb4pex5v6nkc6gd5fdw1",
            snapshot: "snp_01h455vb4pex5v6nkc6gd5fdw1",
            problem: "prb_01h455vb4pex5v6nkc6gd5fdw1",
            diagnostic_scope: null,
          }),
        );
      },
    },
  });
  const { services } = createPreviewBrokerServices({ scope, problems });
  const endpoint = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services,
  });
  const report = (body: Record<string, unknown>) =>
    endpoint.handle(
      new Request(`http://lophn.invalid${BROKER_ROUTES.problemsReport}`, {
        method: "POST",
        headers: { authorization: CREDENTIAL },
        body: JSON.stringify(withChild(body)),
      }),
    );
  const sent = await report({ code: "calendar_failed" });
  assertEquals(sent.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].mode, "preview");
  assertEquals(calls[0].release, null);
  assertEquals(calls[0].app, FIXTURE_APP);
  // 본문이 신원이나 닫기를 주장해도 받지 않는다.
  for (const extra of [{ mode_override: "live" }, { close: true }]) {
    const forged = await report({ code: "calendar_failed", ...extra });
    assertEquals(forged.status, 400);
  }
  assertEquals(calls.length, 1);
});

Deno.test("apps/preview#R9: release 없는 preview의 호출 사실은 invocation 기록으로 가지 않고 release 있는 preview는 mode=preview로 남는다", async () => {
  const queued: { fact: string; body: { input: Record<string, unknown> } }[] =
    [];
  const invocations = createInvocationBroker({
    clock: manualClock(0),
    queue: {
      enqueue: (message) => {
        queued.push(message as never);
      },
      pump: () => Promise.resolve(),
    },
  });
  const { services } = createPreviewBrokerServices({ scope, invocations });
  const submit = (who: BrokerChild) =>
    createBrokerEndpoint({
      session: { child: who, credential: CREDENTIAL },
      services,
    }).handle(
      new Request(`http://lophn.invalid${BROKER_ROUTES.invocationsSubmit}`, {
        method: "POST",
        headers: { authorization: CREDENTIAL },
        body: JSON.stringify(withChild({
          invocation: INV,
          fact: "start",
          summary: {
            operation: { kind: "command", command: "usage.save" },
            trigger: { kind: "direct" },
            caller: { kind: "direct" },
            actor: "user",
            started_at: "2026-10-06T00:00:00.000Z",
          },
        })),
      }),
    );
  const bare = await submit(child());
  assertEquals(bare.status, 200);
  // 받았다고만 답하고 ledger로 가는 기록은 꾸며 만들지 않는다.
  assertEquals(queued.length, 0);
  const released = await submit(child({ release: FIXTURE_RELEASE }));
  assertEquals(released.status, 200);
  assertEquals(queued.length, 1);
  assertEquals(queued[0].body.input["mode"], "preview");
  assertEquals(queued[0].body.input["release"], FIXTURE_RELEASE);
});

Deno.test("apps/preview#R4: blueprint 선언에서 대역이 검사할 secret·net·문서 선언을 뽑는다", () => {
  const found = previewScopeOf({
    permissions: [
      { kind: "secret.use", scope: { name: "calendar_token" }, reason: "r" },
      {
        kind: "net.fetch",
        scope: { host: "api.example.com", port: 443 },
        reason: "r",
      },
      { kind: "document.save", scope: { key: "notes" }, reason: "r" },
      { kind: "fs.read", scope: { path: "/x", recursive: false }, reason: "r" },
      {
        kind: "net.listen",
        scope: { host: "127.0.0.1", port: 9000 },
        reason: "r",
      },
    ],
  } as never);
  assertEquals(found, {
    secrets: ["calendar_token"],
    net: [{ host: "api.example.com", port: 443 }],
    documents: ["notes"],
  });
});
