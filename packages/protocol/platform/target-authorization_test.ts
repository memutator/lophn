import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type { ReadSnapshot, Tx } from "./registration.ts";
import {
  TargetAuthorization,
  type TargetAuthorizer,
} from "./target-authorization.ts";

Deno.test("platform/identity#R3 platform/identity#R8: owner target 판정은 Tx·snapshot의 같은 port key로 꺼낸다", () => {
  assertEquals(TargetAuthorization.name, "TargetAuthorization");
  assert(Object.isFrozen(TargetAuthorization));
  const authorize: TargetAuthorizer = (ctx, _operation, target) =>
    ctx.scope.targets.project === target.project
      ? ok(undefined)
      : err({ code: "forbidden", message: "target outside scope" });
  const port = <T>(key: { name: string }): T => {
    assertEquals(key, TargetAuthorization);
    return authorize as T;
  };
  const tx = { port } as Pick<Tx, "port">;
  const snapshot = { port } as Pick<ReadSnapshot, "port">;
  const ctx = {
    principal: "p",
    actor: "user",
    scope: { operations: ["project.get"], targets: { project: "prj_a" } },
    conditions: {},
    credential_ref: "ref",
  };
  assert(
    tx.port(TargetAuthorization)(ctx, "project.get", { project: "prj_a" }).ok,
  );
  assert(
    !snapshot.port(TargetAuthorization)(ctx, "project.get", {
      project: "prj_b",
    })
      .ok,
  );
});
