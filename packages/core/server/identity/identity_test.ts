import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { createLogger, err, ok, sha256Hex } from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  type CredentialScope,
  identityCurrent,
} from "../../../protocol/platform/mod.ts";
import {
  authorize,
  constantTimeDigestEqual,
  type CredentialIssue,
  CredentialRegistry,
  identityCurrentRead,
  intersectScope,
  operationCeiling,
} from "./mod.ts";
import {
  APP,
  code,
  fixture,
  MACHINE,
  OTHER_APP,
  POLICIES,
  SNAPSHOT,
  USER,
  value,
} from "./fixtures_test.ts";

Deno.test("platform/identity#R1: actor 주장은 credential record를 바꾸지 못한다", async () => {
  const { registry } = fixture();
  const issued = value(await registry.issue(MACHINE));
  const ctx = value(await registry.authenticate(issued.token));
  assertEquals(ctx.actor, "machine");
  assertEquals(ctx.principal, "task:build");
  const forged = {
    ...ctx,
    actor: "user",
    scope: USER.scope,
    principal: "user",
    body: { actor: "user" },
    headers: { actor: "user" },
    environment: { actor: "user" },
  };
  assertEquals(value(registry.revalidate(forged)).actor, "machine");
  assertEquals(
    code(registry.authorize(forged, "approval/decide")),
    "forbidden",
  );
  ctx.actor = "user";
  ctx.scope.operations.push("approval/decide");
  assertEquals(
    value(await registry.authenticate(issued.token)).actor,
    "machine",
  );
});
Deno.test("platform/identity#R2: user는 epoch마다 한 번이고 잘못된 종류와 scope 확대는 거절한다", async () => {
  const { registry } = fixture();
  const results = await Promise.all([
    registry.issue(USER),
    registry.issue(USER),
  ]);
  assertEquals(results.filter((result) => result.ok).length, 1);
  assertEquals(code(results.find((result) => !result.ok)!), "conflict");
  const issued = value(results.find((result) => result.ok)!);
  value(registry.revoke(issued.credential_ref));
  assertEquals(code(await registry.issue(USER)), "conflict");
  assertEquals(
    code(await registry.issue({ ...USER, conditions: {} })),
    "invalid_input",
  );
  assertEquals(
    code(
      await registry.issue({
        ...MACHINE,
        scope: { ...MACHINE.scope, targets: { app: APP, task: "other" } },
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    code(
      await registry.issue(
        { ...MACHINE, actor: `app:${APP}` } as unknown as CredentialIssue,
      ),
    ),
    "invalid_input",
  );
  assertEquals(
    code(
      await registry.issue({
        ...MACHINE,
        scope: { ...MACHINE.scope, operations: ["approval/decide"] },
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    code(await registry.issue({ ...MACHINE, conditions: {} })),
    "invalid_input",
  );
  assertEquals(
    code(
      await registry.issue({
        ...MACHINE,
        scope: { operations: [], targets: {} },
      }),
    ),
    "invalid_input",
  );
});
Deno.test("platform/identity#R3: machine 작업과 대상과 결과 command는 발급 때 고정된다", async () => {
  const { registry } = fixture();
  const input = structuredClone(MACHINE);
  const issued = value(await registry.issue(input));
  input.scope.operations.push("task/other");
  input.scope.targets.app = OTHER_APP;
  input.conditions.task = "another-task";
  const ctx = value(await registry.authenticate(issued.token));
  value(registry.authorize(ctx, "task/result", { app: APP, task: "build" }));
  assertEquals(
    code(registry.authorize(ctx, "task/other", { app: APP, task: "build" })),
    "forbidden",
  );
  assertEquals(
    code(registry.authorize(ctx, "task/result", { app: APP, task: "other" })),
    "forbidden",
  );
  assertEquals(code(registry.authorize(ctx, "task/result")), "forbidden");
  assertEquals(
    code(
      await registry.issue({
        ...MACHINE,
        scope: { ...MACHINE.scope, operations: ["tests/result"] },
      }),
    ),
    "invalid_input",
  );
  const runner = value(
    await registry.issue({
      ...MACHINE,
      test_runner: true,
      scope: { ...MACHINE.scope, operations: ["tests/result"] },
    }),
  );
  value(
    registry.authorize(
      value(await registry.authenticate(runner.token)),
      "tests/result",
      { app: APP, task: "build" },
    ),
  );
  assertFalse(
    operationCeiling("machine", POLICIES).includes("identity/current"),
  );
  assertFalse(
    operationCeiling(`app:${APP}`, POLICIES).includes("approval/decide"),
  );
});
Deno.test("platform/identity#R3: 현재 scope와 conditions를 매 요청에 재검사하며 시작 상한을 넓히지 않는다", async () => {
  const { clock, random } = fixture();
  let scope: CredentialScope = structuredClone(MACHINE.scope);
  let task = "build";
  let active = true;
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random,
    operations: POLICIES,
    current: () =>
      active
        ? ok({ scope, conditions: { task } })
        : err({ code: "forbidden", message: "stopped" }),
  });
  const issued = value(await registry.issue(MACHINE));
  const ctx = value(await registry.authenticate(issued.token));
  scope.operations.push("task/other");
  assertEquals(
    value(await registry.authenticate(issued.token)).scope.operations,
    ["task/result"],
  );
  scope.operations = [];
  assertEquals(
    code(registry.authorize(ctx, "task/result", { app: APP, task: "build" })),
    "forbidden",
  );
  scope = structuredClone(MACHINE.scope);
  task = "other";
  assertEquals(code(await registry.authenticate(issued.token)), "unauthorized");
  task = "build";
  active = false;
  assertEquals(code(registry.revalidate(ctx)), "unauthorized");
  assertEquals(
    intersectScope(
      { operations: ["read"], targets: { app: [APP, OTHER_APP] } },
      { operations: ["read", "write"], targets: { app: [APP] } },
    ),
    { operations: ["read"], targets: { app: [APP] } },
  );
  assertEquals(
    intersectScope(MACHINE.scope, {
      operations: ["task/result"],
      targets: { app: OTHER_APP },
    }).operations,
    [],
  );
});
Deno.test("platform/identity#R4: 일반 identity read에는 credential 전달 경로가 없다", async () => {
  const { registry } = fixture();
  const issued = value(await registry.issue(USER));
  const ctx = value(await registry.authenticate(issued.token));
  const read = identityCurrentRead(registry);
  const output = value(read.handle(SNAPSHOT, ctx, {}));
  assertEquals(Object.keys(output).sort(), [
    "actor",
    "as_of_seq",
    "conditions",
    "next_cursor",
    "scope",
  ]);
  assert(identityCurrent.output.safeParse(output).success);
  assertFalse(JSON.stringify(output).includes(issued.token));
  assertFalse(JSON.stringify(output).includes(issued.credential_ref));
  value(registry.revoke(issued.credential_ref));
  assertEquals(code(read.handle(SNAPSHOT, ctx, {})), "unauthorized");
});
Deno.test("platform/identity#R6: 32 bytes token만 인증하고 digest와 ref는 인증 값이 아니다", async () => {
  const { registry } = fixture();
  const issued = value(await registry.issue(USER));
  assertMatch(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(
    atob(issued.token.replaceAll("-", "+").replaceAll("_", "/") + "=").length,
    32,
  );
  assertEquals(
    code(await registry.authenticate(await sha256Hex(issued.token))),
    "unauthorized",
  );
  assertEquals(
    code(await registry.authenticate(issued.credential_ref)),
    "unauthorized",
  );
  assertEquals(
    code(await registry.authenticate("Bearer " + issued.token)),
    "unauthorized",
  );
  assertEquals(code(await registry.authenticate("")), "unauthorized");
  const bytes = new Uint8Array(32);
  assert(constantTimeDigestEqual(bytes, new Uint8Array(32)));
  for (let i = 0; i < 32; i++) {
    const changed = new Uint8Array(bytes);
    changed[i] = 1;
    assertFalse(constantTimeDigestEqual(bytes, changed));
  }
  assertFalse(constantTimeDigestEqual(bytes, new Uint8Array(31)));
});
Deno.test("platform/identity#R6: token과 digest는 오류와 logger와 조회 결과에 나오지 않는다", async () => {
  const { clock, random } = fixture();
  const logs: unknown[] = [];
  const logger = createLogger({
    now: () => clock.now(),
    sink: (record) => {
      logs.push(record);
    },
  });
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random,
    operations: POLICIES,
    logger,
  });
  const issued = value(await registry.issue(USER));
  const digest = await sha256Hex(issued.token);
  const ctx = value(await registry.authenticate(issued.token));
  value(registry.end(issued.credential_ref));
  const failures = [
    await registry.authenticate(issued.token),
    await registry.authenticate(digest),
    registry.revalidate(ctx),
  ];
  await logger.flush();
  const text = JSON.stringify({ failures, logs, ctx });
  assert(logs.length > 0);
  assertFalse(text.includes(issued.token));
  assertFalse(text.includes(digest));
  assertEquals(Object.keys(ctx).sort(), [
    "actor",
    "conditions",
    "credential_ref",
    "principal",
    "scope",
  ]);
});
Deno.test("platform/identity#R7: 회수와 종료와 감독 상실과 새 epoch는 이전 자격을 즉시 막는다", async () => {
  const { registry, clock, random } = fixture();
  const issued = value(await registry.issue(MACHINE));
  const ctx = value(await registry.authenticate(issued.token));
  value(registry.revoke(issued.credential_ref));
  value(registry.end(issued.credential_ref));
  assertEquals(code(await registry.authenticate(issued.token)), "unauthorized");
  assertEquals(
    code(registry.authorize(ctx, "task/result", { app: APP, task: "build" })),
    "unauthorized",
  );
  const second = value(await registry.issue(MACHINE));
  assertEquals(registry.endBy("process", "worker-generation"), 1);
  assertEquals(registry.endBy("process", "worker-generation"), 0);
  assertEquals(code(await registry.authenticate(second.token)), "unauthorized");
  const third = value(await registry.issue(MACHINE));
  assertEquals(registry.endBy("task", "build"), 1);
  assertEquals(code(await registry.authenticate(third.token)), "unauthorized");
  const user = value(await registry.issue(USER));
  assertEquals(registry.endBy("process", "main-generation"), 1);
  assertEquals(code(await registry.authenticate(user.token)), "unauthorized");
  const restarted = new CredentialRegistry({
    epoch: "core-two",
    clock,
    random,
    operations: POLICIES,
  });
  assertEquals(code(await restarted.authenticate(third.token)), "unauthorized");
  value(await restarted.issue(USER));
});
Deno.test("platform/identity#R7: 기한은 context에 포함되고 만료 시점부터 unauthorized다", async () => {
  const { registry, clock } = fixture();
  const expires_at = "2026-10-04T00:00:01.000Z";
  const issued = value(await registry.issue({ ...MACHINE, expires_at }));
  const ctx = value(await registry.authenticate(issued.token));
  assertEquals(ctx.expires_at, expires_at);
  clock.advance(1000);
  assertEquals(code(await registry.authenticate(issued.token)), "unauthorized");
  assertEquals(code(registry.revalidate(ctx)), "unauthorized");
  assertEquals(
    code(await registry.issue({ ...MACHINE, expires_at })),
    "invalid_input",
  );
});
Deno.test("platform/identity#R10: 앱 범위 밖은 존재와 무관한 not_found이고 금지 동작은 forbidden이다", async () => {
  const { registry } = fixture();
  const issued = value(await registry.issue(MACHINE));
  const ctx = value(await registry.authenticate(issued.token));
  const outside = registry.authorize(ctx, "task/result", {
    app: OTHER_APP,
    task: "build",
  });
  const absent = registry.authorize(ctx, "task/result", {
    app: "missing",
    task: "build",
  });
  assertEquals(outside, absent);
  assertEquals(code(outside), "not_found");
  assertEquals(
    code(registry.authorize(ctx, "approval/decide", { app: APP })),
    "forbidden",
  );
  const appCtx: AuthenticatedContext = {
    ...ctx,
    actor: `app:${APP}`,
    conditions: {},
    scope: { operations: ["identity/current"], targets: {} },
  };
  assertEquals(
    code(authorize(appCtx, "identity/current", { app: OTHER_APP })),
    "not_found",
  );
  assertEquals(code(await registry.authenticate("missing")), "unauthorized");
});
