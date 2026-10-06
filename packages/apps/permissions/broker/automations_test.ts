import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import {
  AUTOMATION_CONCURRENCY_LIMIT,
  AUTOMATION_TIMEOUT_MS,
  type GrantPermissionScope,
} from "../../../contracts/apps/mod.ts";

import type { AutomationDeclarationFact } from "../declarations.ts";
import { createAutomationBroker } from "./automations.ts";
import { BROKER_ROUTES, createBrokerEndpoint } from "./server.ts";
import {
  createSecretUseService,
  type SecretDelivery,
  type SecretDeliveryRequest,
} from "./secrets.ts";
import {
  APP,
  child,
  createAccessFixture,
  CREDENTIAL,
  HASH,
  RELEASE,
  requirement,
  withChild,
} from "../testing/broker.ts";

// 전체 한도 4의 메모리 permit 대역이다. 실제 구현의 시험은 automations/permits_test.ts가 본다.
function createAutomationPermits() {
  const held = new Set<string>();
  return {
    get inUse() {
      return held.size;
    },
    tryAcquire(holder: { nonce: string; release: string; key: string }) {
      const id = JSON.stringify([holder.nonce, holder.release, holder.key]);
      if (held.has(id)) return "busy" as const;
      if (held.size >= AUTOMATION_CONCURRENCY_LIMIT) return "limit" as const;
      held.add(id);
      return "granted" as const;
    },
    release(holder: { nonce: string; release: string; key: string }) {
      return held.delete(
        JSON.stringify([holder.nonce, holder.release, holder.key]),
      );
    },
  };
}

const EVERY_MINUTE = { kind: "interval", interval_ms: 60_000 } as const;

function declared(
  key: string,
  over: Partial<AutomationDeclarationFact> = {},
): AutomationDeclarationFact {
  return {
    key,
    command: "sync",
    external: true,
    input_hash: HASH,
    when: EVERY_MINUTE,
    ...over,
  };
}

function runScope(
  fact: AutomationDeclarationFact,
): Extract<GrantPermissionScope, { kind: "automation.run" }> {
  return {
    kind: "automation.run",
    automation: fact.key,
    command: fact.command,
    input_hash: fact.input_hash,
    when: fact.when,
  };
}

function world(automations: AutomationDeclarationFact[]) {
  const access = createAccessFixture({ automations });
  const permits = createAutomationPermits();
  const broker = createAutomationBroker({ access, permits });
  const acquire = (key: string, over: Record<string, unknown> = {}) =>
    broker.tryAcquire(
      child(),
      withChild({ release: RELEASE, key, ...over }),
    );
  return { access, permits, broker, acquire };
}

Deno.test("apps/automations#R13: external automation은 켜는 승인 전에는 permit이 없고 승인 뒤 추가 확인 없이 돈다", async () => {
  const sync = declared("sync");
  const w = world([sync]);
  const before = await w.acquire("sync");
  assert(!before.ok);
  assertEquals(before.error.code, "forbidden");
  // 필요한 승인 범위를 알린다. 어느 쪽이 빠졌는지는 앱 코드가 추측하지 못한다.
  assertEquals(before.error.details, {
    permission: "automation.run",
    scope: {
      automation: "sync",
      command: "sync",
      input_hash: HASH,
      when: EVERY_MINUTE,
    },
  });
  assertEquals(w.permits.inUse, 0);

  const grant = w.access.grant(runScope(sync));
  for (let turn = 0; turn < 3; turn += 1) {
    const allowed = await w.acquire("sync");
    assert(allowed.ok);
    assertEquals(allowed.value, {
      permit: true,
      limit: AUTOMATION_CONCURRENCY_LIMIT,
      timeout_ms: AUTOMATION_TIMEOUT_MS,
    });
    // 회차가 끝나 permit을 돌려주면 다음 회차는 다시 permit을 받고 추가 확인이 없다.
    const released = await w.broker.release(
      child(),
      withChild({
        release: RELEASE,
        key: "sync",
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      }),
    );
    assert(released.ok);
  }

  // 끄면(grant 회수) 프로세스를 다시 띄우지 않아도 다음 회차부터 permit이 없다.
  w.access.revoke(grant);
  const off = await w.acquire("sync");
  assert(!off.ok);
  assertEquals(off.error.code, "forbidden");
  // 끈 뒤 다시 켜면 새 승인이다. 회수된 옛 승인은 다시 쓰이지 않는다.
  const stillOff = await w.acquire("sync");
  assert(!stillOff.ok);
  w.access.grant(runScope(sync));
  const on = await w.acquire("sync");
  assert(on.ok && on.value.permit);
});

Deno.test("apps/automations#R13: command·고정 입력·주기를 바꾸면 이전 승인은 맞지 않고 새 승인을 요구한다", async () => {
  const original = declared("sync");
  const w = world([original]);
  w.access.grant(runScope(original));
  const first = await w.acquire("sync");
  assert(first.ok && first.value.permit);
  await w.broker.release(
    child(),
    withChild({
      release: RELEASE,
      key: "sync",
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
    }),
  );

  const changes: Partial<AutomationDeclarationFact>[] = [
    { input_hash: "cd".repeat(32) },
    { command: "push" },
    { when: { kind: "interval", interval_ms: 120_000 } },
    { when: { kind: "on_start" } },
  ];
  for (const change of changes) {
    w.access.declarations = {
      ...w.access.declarations!,
      commands: ["sync", "push"],
      automations: [declared("sync", change)],
    };
    const outcome = await w.acquire("sync");
    assert(!outcome.ok, JSON.stringify(change));
    assertEquals(outcome.error.code, "forbidden");
  }
  // 바뀐 선언에 대한 새 승인이 있어야 돈다.
  const changed = declared("sync", { command: "push" });
  w.access.declarations = {
    ...w.access.declarations!,
    automations: [changed],
  };
  w.access.grant(runScope(changed));
  const renewed = await w.acquire("sync");
  assert(renewed.ok && renewed.value.permit);
});

Deno.test("apps/automations#R13: external이 아닌 automation은 승인 없이 permit을 받고 실행 허용은 clock이 연 통로를 따른다", async () => {
  const lookup = declared("lookup", { command: "lookup", external: false });
  const w = world([lookup]);
  const outcome = await w.acquire("lookup");
  assert(outcome.ok && outcome.value.permit);
  // 선언 밖 key는 같은 앱의 거절이다. 어떤 automation이 있는지 추측시키지 않는 일반 거절이다.
  const unknown = await w.acquire("missing");
  assert(!unknown.ok);
  assertEquals(unknown.error.code, "invalid_input");
});

Deno.test("apps/automations#R13: grant가 있는 secret을 쓰는 command는 automation에서도 실행되고 회수하면 거절한다", async () => {
  const sync = declared("sync");
  const access = createAccessFixture({
    automations: [sync],
    permissions: [
      requirement("secret.use", { name: "calendar.token" }),
      requirement("net.fetch", { host: "127.0.0.1", port: 8443 }),
    ],
  });
  access.grant(runScope(sync));
  const secret = access.grant({ kind: "secret.use", name: "calendar.token" });
  access.grant({ kind: "net.fetch", host: "127.0.0.1", port: 8443 });
  const permits = createAutomationPermits();
  const automations = createAutomationBroker({ access, permits });
  const used: SecretDeliveryRequest[] = [];
  const delivery: SecretDelivery = {
    use(request) {
      used.push(request);
      return Promise.resolve(ok({ sent: true as const }));
    },
  };
  const secrets = createSecretUseService({
    access,
    delivery,
    redaction: { ensure: () => ok(undefined) },
    platformPorts: [],
  });
  const body = (over: Record<string, unknown> = {}) =>
    withChild({
      release: RELEASE,
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      command: "sync",
      input_hash: HASH,
      name: "calendar.token",
      destination: { scheme: "https", host: "127.0.0.1", port: 8443 },
      ...over,
    });
  // automation 회차가 permit을 받은 뒤 그 command가 secret을 쓴다. automation이라는 이유로 막지 않는다.
  const permit = await automations.tryAcquire(
    child(),
    withChild({ release: RELEASE, key: "sync" }),
  );
  assert(permit.ok && permit.value.permit);
  const sent = await secrets.use(child(), body());
  assert(sent.ok);
  assertEquals(used.length, 1);
  access.revoke(secret);
  const after = await secrets.use(child(), body());
  assert(!after.ok);
  assertEquals(after.error.code, "forbidden");
  assertEquals(used.length, 1);
});

Deno.test("apps/automations#R6: 한도에 닿으면 permit false이고 대기열 없이 오류도 아니다", async () => {
  const keys = ["a", "b", "c", "d", "e"];
  const w = world(keys.map((key) => declared(key, { external: false })));
  const outcomes: boolean[] = [];
  for (const key of keys) {
    const outcome = await w.acquire(key);
    assert(outcome.ok);
    outcomes.push(outcome.value.permit);
  }
  assertEquals(outcomes, [true, true, true, true, false]);
  // 같은 automation의 둘째 요청도 오류가 아니라 permit false다.
  const again = await w.acquire("a");
  assert(again.ok);
  assertEquals(again.value.permit, false);
  assertEquals(w.permits.inUse, 4);
});

Deno.test("apps/automations#R4: preview·test 자식과 교체된 release의 옛 자식은 permit을 받지 못한다", async () => {
  const w = world([declared("lookup", { external: false })]);
  for (const mode of ["preview", "test"] as const) {
    const outcome = await w.broker.tryAcquire(
      child({ mode, release: null }),
      withChild({ release: RELEASE, key: "lookup" }, child({ mode })),
    );
    assert(!outcome.ok, mode);
    assertEquals(outcome.error.code, "unavailable");
  }
  // 자식의 release와 본문 release가 다르면 거절한다.
  const mismatch = await w.acquire("lookup", {
    release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
  });
  assert(!mismatch.ok);
  assertEquals(mismatch.error.code, "conflict");
  // 지금 release가 바뀐 뒤 옛 release의 자식은 새 회차를 시작하지 못한다.
  w.access.declarations = {
    ...w.access.declarations!,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw9",
  };
  const stale = await w.acquire("lookup");
  assert(!stale.ok);
  assertEquals(stale.error.code, "conflict");
  assertEquals(w.permits.inUse, 0);
  // 본문의 process nonce가 연결과 다르면 거절한다.
  const forged = await w.broker.tryAcquire(
    child(),
    withChild({ release: RELEASE, key: "lookup" }, {
      processNonce: "other",
      mode: "live",
    }),
  );
  assert(!forged.ok);
  assertEquals(forged.error.code, "unauthorized");
});

Deno.test("apps/automations#R5: broker 경로는 자식 credential에 묶이고 서비스가 없으면 없는 경로와 같다", async () => {
  const sync = declared("sync", { external: false });
  const access = createAccessFixture({ automations: [sync] });
  const permits = createAutomationPermits();
  const withService = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: { automations: createAutomationBroker({ access, permits }) },
  });
  const post = (path: string, body: unknown, credential = CREDENTIAL) =>
    new Request(`http://lophn.invalid${path}`, {
      method: "POST",
      headers: { authorization: credential },
      body: JSON.stringify(body),
    });
  const acquired = await withService.handle(
    post(
      BROKER_ROUTES.automationsTryAcquire,
      withChild({ release: RELEASE, key: "sync" }),
    ),
  );
  assertEquals(acquired.status, 200);
  assertEquals((await acquired.json()).permit, true);
  const wrong = await withService.handle(
    post(
      BROKER_ROUTES.automationsTryAcquire,
      withChild({ release: RELEASE, key: "sync" }),
      "other-credential",
    ),
  );
  assertEquals(wrong.status, 401);
  const released = await withService.handle(
    post(
      BROKER_ROUTES.automationsRelease,
      withChild({
        release: RELEASE,
        key: "sync",
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      }),
    ),
  );
  assertEquals(released.status, 200);
  assertEquals(await released.json(), { released: true });
  assertEquals(permits.inUse, 0);

  const without = createBrokerEndpoint({
    session: { child: child(), credential: CREDENTIAL },
    services: {},
  });
  const absent = await without.handle(
    post(
      BROKER_ROUTES.automationsTryAcquire,
      withChild({ release: RELEASE, key: "sync" }),
    ),
  );
  assertEquals(absent.status, 404);
  // 본문이 다른 앱을 주장해도 신원은 연결이 정한다: 알 수 없는 field는 거절된다.
  const claimed = await withService.handle(
    post(
      BROKER_ROUTES.automationsTryAcquire,
      withChild({ release: RELEASE, key: "sync", app: APP }),
    ),
  );
  assertEquals(claimed.status, 400);
});
