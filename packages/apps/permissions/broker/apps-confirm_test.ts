// broker `/_lophn/broker/apps/confirm/{request,poll}`(apps/connections#R3). 신원은 자식 연결이
// 정하고 본문은 caller·입력 지문을 주장하지 못한다. poll의 기다림은 짧게 제한된다. 준비 서비스는
// 포트 대역이다.
import { assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import { APPS_CONFIRM_POLL_WAIT_MAX_MS } from "../../../contracts/apps/mod.ts";
import {
  type AppPairConfirmer,
  createAppsConfirmService,
} from "./apps-confirm.ts";
import { BROKER_ROUTES, createBrokerEndpoint } from "./server.ts";
import { child, CREDENTIAL, RELEASE, withChild } from "../testing/broker.ts";

const TARGET = "app_01h455vb4pex5v6nkc6gd5fdw2";
const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

const request = {
  app: TARGET,
  command: "usage.purge",
  input: { amount: 1 },
  target_release: RELEASE,
  target_process_nonce: "target-nonce",
  parent_invocation: null,
};

function setup(overrides: Partial<AppPairConfirmer> = {}) {
  const seen: { request: unknown[]; poll: unknown[] } = {
    request: [],
    poll: [],
  };
  const confirmer: AppPairConfirmer = {
    request: (input) => {
      seen.request.push(input);
      return Promise.resolve(
        ok({ approval: APPROVAL, input_hash: HASH, state: "pending" as const }),
      );
    },
    poll: (input) => {
      seen.poll.push(input);
      return Promise.resolve(ok({ state: "pending" as const }));
    },
    ...overrides,
  };
  const endpoint = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: { appsConfirm: createAppsConfirmService({ confirmer }) },
  });
  const post = (path: string, body: Record<string, unknown>) =>
    endpoint.handle(
      new Request(`http://lophn.invalid${path}`, {
        method: "POST",
        headers: { authorization: CREDENTIAL },
        body: JSON.stringify(body),
      }),
    );
  return { seen, post, endpoint };
}

Deno.test("apps/connections#R3: confirm 요청의 source는 자식 연결의 신원이고 본문의 caller·입력 지문 주장은 받지 않는다", async () => {
  const { seen, post } = setup();
  const response = await post(
    BROKER_ROUTES.appsConfirmRequest,
    withChild(request),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).approval, APPROVAL);
  assertEquals(seen.request, [{ source: child(), ...request }]);
  for (
    const claim of [
      { caller: { kind: "app", app: TARGET } },
      { input_hash: HASH },
      { source: TARGET },
      { approval: APPROVAL },
    ]
  ) {
    const refused = await post(
      BROKER_ROUTES.appsConfirmRequest,
      withChild({ ...request, ...claim }),
    );
    assertEquals(refused.status, 400);
  }
  // 이 broker 연결의 nonce·mode가 아니면 신원이 맞지 않는다.
  const stranger = await post(BROKER_ROUTES.appsConfirmRequest, {
    ...request,
    process_nonce: "other",
    mode: "live",
  });
  assertEquals(stranger.status, 401);
  assertEquals(seen.request.length, 1);
});

Deno.test("apps/connections#R3: poll은 approval 상태를 그대로 전하고 기다림은 짧게 제한되며 서비스 오류는 그대로 전해진다", async () => {
  const states = [
    { state: "pending" },
    { state: "rejected" },
    { state: "expired" },
  ];
  for (const state of states) {
    const { post } = setup({ poll: () => Promise.resolve(ok(state as never)) });
    const response = await post(
      BROKER_ROUTES.appsConfirmPoll,
      withChild({ approval: APPROVAL }),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), state);
  }
  const { seen, post } = setup();
  await post(BROKER_ROUTES.appsConfirmPoll, withChild({ approval: APPROVAL }));
  await post(
    BROKER_ROUTES.appsConfirmPoll,
    withChild({ approval: APPROVAL, wait_ms: APPS_CONFIRM_POLL_WAIT_MAX_MS }),
  );
  assertEquals(
    seen.poll.map((entry) => (entry as { wait_ms: number }).wait_ms),
    [0, APPS_CONFIRM_POLL_WAIT_MAX_MS],
  );
  // 소켓을 오래 잡는 기다림은 계약에서 거절된다.
  const long = await post(
    BROKER_ROUTES.appsConfirmPoll,
    withChild({
      approval: APPROVAL,
      wait_ms: APPS_CONFIRM_POLL_WAIT_MAX_MS + 1,
    }),
  );
  assertEquals(long.status, 400);

  const refusing = setup({
    request: () =>
      Promise.resolve(err({ code: "conflict", message: "stale target" })),
    poll: () =>
      Promise.resolve(
        err({ code: "not_found", message: "approval not found" }),
      ),
  });
  const conflict = await refusing.post(
    BROKER_ROUTES.appsConfirmRequest,
    withChild(request),
  );
  assertEquals(conflict.status, 409);
  const missing = await refusing.post(
    BROKER_ROUTES.appsConfirmPoll,
    withChild({ approval: APPROVAL }),
  );
  assertEquals(missing.status, 404);
});

Deno.test("apps/connections#R3: granted는 서명된 proof가 있어야 하고 contract에 맞지 않는 값은 내보내지 않는다", async () => {
  const broken = setup({
    poll: () => Promise.resolve(ok({ state: "granted" } as never)),
  });
  const response = await broken.post(
    BROKER_ROUTES.appsConfirmPoll,
    withChild({ approval: APPROVAL }),
  );
  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, "internal");
  // 서비스를 달지 않은 broker에는 이 경로가 없다.
  const bare = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: {},
  });
  const absent = await bare.handle(
    new Request(`http://lophn.invalid${BROKER_ROUTES.appsConfirmPoll}`, {
      method: "POST",
      headers: { authorization: CREDENTIAL },
      body: JSON.stringify(withChild({ approval: APPROVAL })),
    }),
  );
  assertEquals(absent.status, 404);
});
