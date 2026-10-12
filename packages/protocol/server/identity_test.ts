import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import { formatActor, parseActor } from "../base/actor.ts";
import {
  authenticatedContextSchema,
  credentialConditionsSchema,
  credentialScopeSchema,
} from "./identity.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const scope = {
  operations: ["ReadDocument"],
  targets: { app: `app_${suffix}` },
};
Deno.test("platform/identity#R1: 다섯 actor를 기존 schema로 parse·format한다", () => {
  for (
    const actor of [
      "user",
      "machine",
      `coding_agent:cac_${suffix}`,
      `agent:asg_${suffix}`,
      `app:app_${suffix}`,
    ]
  ) {
    const parts = parseActor(actor);
    assert(parts);
    assertEquals(formatActor(parts), actor);
    assert(
      authenticatedContextSchema.safeParse({
        principal: "p",
        actor,
        scope,
        conditions: {},
        credential_ref: "ref",
      }).success,
    );
  }
  assertEquals(parseActor(`agent:app_${suffix}`), undefined);
});
Deno.test("platform/identity#R2 platform/identity#R3 platform/ledger#R11: scope와 시작 조건의 모양을 제한한다", () => {
  assert(credentialScopeSchema.safeParse(scope).success);
  assert(
    !credentialScopeSchema.safeParse({
      ...scope,
      operations: ["ReadDocument", "ReadDocument"],
    }).success,
  );
  const conditions = {
    run: `run_${suffix}`,
    assignment: `asg_${suffix}`,
    app: `app_${suffix}`,
    release: `rel_${suffix}`,
    process: "process-ref",
    mode: "production",
    task: "task-ref",
  };
  assert(credentialConditionsSchema.safeParse(conditions).success);
  assert(
    credentialConditionsSchema.safeParse({
      ...conditions,
      bundle_hash: "b".repeat(64),
      diagnostic_scope: "apps/worker/problems/report-collector",
    }).success,
  );
  assert(
    credentialConditionsSchema.safeParse({
      ...conditions,
      bundle_hash: null,
      diagnostic_scope: null,
    }).success,
  );
  assert(
    !credentialConditionsSchema.safeParse({
      ...conditions,
      bundle_hash: "xyz",
    }).success,
  );
  assert(
    !credentialConditionsSchema.safeParse({
      ...conditions,
      diagnostic_scope: "  ",
    }).success,
  );
  assert(
    !credentialConditionsSchema.safeParse({
      ...conditions,
      run: `asg_${suffix}`,
    }).success,
  );
  assert(
    !credentialConditionsSchema.safeParse({ ...conditions, override: true })
      .success,
  );
});
Deno.test("platform/identity#R3 documents/projects#R9: cwd 시작 조건은 정규 절대 경로만 받는다", () => {
  for (
    const cwd of ["/home/me/src", "C:\\work\\repo", "\\\\host\\share\\repo"]
  ) {
    assert(credentialConditionsSchema.safeParse({ cwd }).success, cwd);
  }
  for (
    const cwd of ["", "src", "./src", "/home/me/../etc", "/a/./b", "/a\u0000b"]
  ) {
    assert(!credentialConditionsSchema.safeParse({ cwd }).success, cwd);
  }
});
Deno.test("platform/identity#R2 platform/identity#R3: target restriction의 own JSON key를 context에서도 보존한다", () => {
  const targets = JSON.parse(
    '{"__proto__":{"run":"required"},"nested":{"__proto__":{"app":"required"}},"constructor":{"prototype":false}}',
  );
  const scoped = { operations: ["ReadDocument"], targets };
  const parsedScope = credentialScopeSchema.parse(scoped);
  const parsedContext = authenticatedContextSchema.parse({
    principal: "test",
    actor: "user",
    scope: scoped,
    conditions: {},
    credential_ref: "ref",
  });
  for (const parsed of [parsedScope, parsedContext.scope]) {
    assertEquals(
      Object.keys(parsed.targets).sort(),
      Object.keys(targets).sort(),
    );
    assertEquals(
      Object.entries(parsed.targets).sort(([a], [b]) => a.localeCompare(b)),
      Object.entries(targets).sort(([a], [b]) => a.localeCompare(b)),
    );
    assertEquals(canonicalize(parsed.targets), canonicalize(targets));
    assertEquals(Object.getPrototypeOf(parsed.targets), Object.prototype);
  }
});
Deno.test("platform/identity#R2 platform/identity#R3: parsed credential target은 caller와 서로 mutation을 공유하지 않는다", () => {
  const targets = JSON.parse(
    '{"__proto__":{"run":"required"},"nested":{"__proto__":[{"app":"required"}]}}',
  );
  const scoped = { operations: ["ReadDocument"], targets };
  const parsedScope = credentialScopeSchema.parse(scoped);
  const parsedContext = authenticatedContextSchema.parse({
    principal: "test",
    actor: "user",
    scope: scoped,
    conditions: {},
    credential_ref: "ref",
  });
  const original = canonicalize(targets);
  parsedScope.targets.extra = "parsed-only";
  targets.__proto__.run = "changed";
  targets.nested.__proto__[0].app = "changed";
  assertEquals(canonicalize(parsedContext.scope.targets), original);
  assertEquals(
    canonicalize(parsedScope.targets),
    canonicalize({
      ...JSON.parse(original),
      extra: "parsed-only",
    }),
  );
  assert(!Object.hasOwn(targets, "extra"));
  parsedContext.scope.targets.extra = "context-only";
  assert(!Object.hasOwn(targets, "extra"));
  assertEquals(parsedScope.targets.extra, "parsed-only");
});
Deno.test("platform/identity#R2 platform/identity#R3: target scope는 JSON object만 받고 값을 변환하지 않는다", () => {
  for (
    const targets of [null, [], { value: undefined }, { value: Infinity }, {
      value: 1n,
    }, new Date()]
  ) {
    assert(!credentialScopeSchema.safeParse({ ...scope, targets }).success);
    assert(
      !authenticatedContextSchema.safeParse({
        principal: "test",
        actor: "user",
        scope: { ...scope, targets },
        conditions: {},
        credential_ref: "ref",
      }).success,
    );
  }
});
Deno.test("platform/identity#R6 platform/identity#R14: context는 credential_ref만 가지며 token·클릭 증거를 받지 않는다", () => {
  const context = {
    principal: "p",
    actor: "user",
    scope,
    conditions: {},
    credential_ref: "opaque-ref",
    expires_at: "2026-10-04T00:00:00.000Z",
  };
  assert(authenticatedContextSchema.safeParse(context).success);
  for (
    const field of ["token", "user_token", "clicked", "digest", "confirmation"]
  ) {
    assert(
      !authenticatedContextSchema.safeParse({ ...context, [field]: "raw" })
        .success,
    );
  }
});
