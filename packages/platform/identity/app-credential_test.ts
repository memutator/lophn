import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { manualClock, type RandomSource } from "../../base/mod.ts";
import { authorize } from "./model.ts";
import { CredentialRegistry } from "./registry.ts";
import { createAppCredentialIssuer } from "./app-credential.ts";

const APP = "app_00000000000000000000000000";
const OTHER_APP = "app_00000000000000000000000001";
const RELEASE = "rel_00000000000000000000000000";
const PROCESS = "app-runtime-1";
const NOW = Date.parse("2026-10-04T00:00:00.000Z");

// app 자격의 발급 상한. registry operation policy는 app actor를 받는다.
const POLICIES = [
  { name: "identity/current", actors: ["app"] as const, kind: "read" as const },
];

const random: RandomSource = {
  fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes),
};

function fresh(clockMs = NOW) {
  return new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(clockMs),
    random,
    operations: POLICIES,
  });
}

function clockAt(clockMs = NOW) {
  const clock = manualClock(clockMs);
  return {
    clock,
    registry: new CredentialRegistry({
      epoch: "core-one",
      clock,
      random,
      operations: POLICIES,
    }),
  };
}

function request(over: Record<string, unknown> = {}) {
  return {
    type: "app_credential_request",
    request_id: "req-1",
    app: APP,
    release: RELEASE,
    process: PROCESS,
    mode: "live",
    ...over,
  };
}

function issuer(
  registryInstance = fresh(),
  over: { operations?: readonly string[]; expires_at?: string } = {},
) {
  return createAppCredentialIssuer({
    registry: registryInstance,
    operations: ["identity/current"],
    ...over,
  });
}

function value<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value as T;
}

function code(result: { ok: boolean; error?: { code: string } }): string {
  assertFalse(result.ok);
  return result.error!.code;
}

Deno.test("platform/identity#R2: 앱 supervisor가 고정 app·release·process·mode로 app credential을 감독 pipe 요청으로 받는다", async () => {
  const registry = fresh();
  const appIssuer = issuer(registry);
  const responded = await appIssuer.request(request());
  assert(
    responded.ok,
    responded.ok ? undefined : JSON.stringify(responded.error),
  );
  assertMatch(responded.value.credential, /^[A-Za-z0-9_-]{43}$/);
  assertMatch(responded.value.credential_ref, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(responded.value.type, "app_credential_response");
  assertEquals(responded.value.request_id, "req-1");
  const ctx = value(await registry.authenticate(responded.value.credential));
  assertEquals(ctx.actor, `app:${APP}`);
  assertEquals(ctx.principal, `app:${APP}`);
  assertEquals(ctx.conditions, {
    app: APP,
    release: RELEASE,
    process: PROCESS,
    mode: "live",
  });
  assertEquals(ctx.scope.targets, {
    app: APP,
    release: RELEASE,
    process: PROCESS,
    mode: "live",
  });
});

Deno.test("platform/identity#R4: 감독 pipe가 아닌 요청 모양은 발급하지 않는다", async () => {
  const appIssuer = issuer();
  const badType = await appIssuer.request(request({ type: "session.message" }));
  assertEquals(code(badType), "invalid_input");
  const missingMode = await appIssuer.request(request({ mode: undefined }));
  assertEquals(code(missingMode), "invalid_input");
  const wrongId = await appIssuer.request(request({ app: "not-an-app-id" }));
  assertEquals(code(wrongId), "invalid_input");
});

Deno.test("platform/identity#R4: 발급 상한 밖 operation은 거절한다", async () => {
  const registry = fresh();
  const rogue = issuer(registry, { operations: ["approval/decide"] });
  const refused = await rogue.request(request());
  assertEquals(code(refused), "invalid_input");
});

Deno.test("platform/identity#R7: 종료·판 교체·회수에 app credential을 폐기한다", async () => {
  const registry = fresh();
  const appIssuer = issuer(registry);
  const first = value(await appIssuer.request(request({ request_id: "r1" })));
  const second = value(await appIssuer.request(request({ request_id: "r2" })));
  // 판 교체: 그 supervisor process의 자격만 폐기한다.
  assertEquals(appIssuer.endProcess(PROCESS), 2);
  assertEquals((await registry.authenticate(first.credential)).ok, false);
  assertEquals((await registry.authenticate(second.credential)).ok, false);
  // 회수는 credential_ref로만 한다.
  const third = value(await appIssuer.request(request({ request_id: "r3" })));
  assert(appIssuer.revoke(third.credential_ref).ok);
  assertEquals((await registry.authenticate(third.credential)).ok, false);
  assertEquals(appIssuer.endProcess(PROCESS), 0);
});

Deno.test("platform/identity#R10: 앱 credential의 다른 앱 대상 조회는 존재와 무관한 not_found다", async () => {
  const registry = fresh();
  const appIssuer = issuer(registry);
  const responded = value(await appIssuer.request(request()));
  const ctx = value(await registry.authenticate(responded.credential));
  const outside = authorize(ctx, "identity/current", { app: OTHER_APP });
  const absent = authorize(ctx, "identity/current", {
    app: "app_77777777777777777777777777",
  });
  assertEquals(outside, absent);
  assertEquals(code(outside), "not_found");
});

Deno.test("platform/identity#R7: 응답 기한이 지나면 같은 registry의 인증이 unauthorized다", async () => {
  const { clock, registry } = clockAt();
  const expires_at = new Date(NOW + 60_000).toISOString();
  const appIssuer = issuer(registry, { expires_at });
  const responded = value(await appIssuer.request(request()));
  const before = await registry.authenticate(responded.credential);
  assert(before.ok);
  assertEquals(before.value.expires_at, expires_at);
  // 주입 clock을 기한 뒤로 흐른다. 같은 registry에서 unauthorized가 된다.
  clock.advance(61_000);
  const late = await registry.authenticate(responded.credential);
  assertEquals(late.ok, false);
  assertEquals(late.ok ? undefined : late.error.code, "unauthorized");
});

Deno.test("platform/identity#R7: 판 교체·앱 종료 때 그 release·app의 모든 app credential을 폐기한다", async () => {
  const registry = fresh();
  const appIssuer = issuer(registry);
  // 같은 app·release의 process A·B.
  const processA = value(
    await appIssuer.request(request({ request_id: "rA", process: "proc-a" })),
  );
  const processB = value(
    await appIssuer.request(request({ request_id: "rB", process: "proc-b" })),
  );
  // 다른 release의 credential은 유지된다.
  const otherRelease = "rel_00000000000000000000000001";
  const other = value(
    await appIssuer.request(
      request({ request_id: "rC", release: otherRelease, process: "proc-c" }),
    ),
  );
  assert((await registry.authenticate(processA.credential)).ok);
  assert((await registry.authenticate(processB.credential)).ok);
  assert((await registry.authenticate(other.credential)).ok);
  // 판 교체: 그 release의 모든 app credential이 폐기된다.
  assertEquals(appIssuer.endRelease(RELEASE), 2);
  assertEquals((await registry.authenticate(processA.credential)).ok, false);
  assertEquals((await registry.authenticate(processB.credential)).ok, false);
  assert((await registry.authenticate(other.credential)).ok);
  // 앱 종료: 그 앱의 남은 credential도 폐기된다.
  assertEquals(appIssuer.endApp(APP), 1);
  assertEquals((await registry.authenticate(other.credential)).ok, false);
  assertEquals(appIssuer.endRelease(otherRelease), 0);
  assertEquals(appIssuer.endApp(APP), 0);
});

Deno.test("platform/identity#R2: 요청마다 새 credential이고 이전 token도 살아 있다", async () => {
  const registry = fresh();
  const appIssuer = issuer(registry);
  const first = value(await appIssuer.request(request({ request_id: "r1" })));
  const second = value(await appIssuer.request(request({ request_id: "r2" })));
  assert(first.credential !== second.credential);
  assert(first.credential_ref !== second.credential_ref);
  assert((await registry.authenticate(first.credential)).ok);
  assert((await registry.authenticate(second.credential)).ok);
});
