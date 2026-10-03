import { assert, assertEquals } from "@std/assert";
import { formatActor, parseActor } from "./actor.ts";
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
