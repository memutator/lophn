import { assert, assertEquals } from "@std/assert";
import { type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import { authorize, authorizeConditions } from "./mod.ts";

function code(result: Result<unknown>): string {
  assert(!result.ok);
  return result.error.code;
}

const PROJECT = "prj_00000000000000000000000000";

function scoped(): AuthenticatedContext {
  return {
    principal: "owner-1",
    actor: "user",
    credential_ref: "cred-1",
    scope: {
      operations: ["RecordDomain"],
      targets: { project: PROJECT, mode: "edit" },
    },
    conditions: { mode: "edit" },
  };
}

Deno.test("platform/identity#R3 platform/identity#R8: 입구 gate는 domain target을 건너뛰고 고정 조건만 판정한다", () => {
  const ctx = scoped();
  assert(authorizeConditions(ctx, "RecordDomain", { mode: "edit" }).ok);
  assertEquals(
    code(authorize(ctx, "RecordDomain", { mode: "edit" })),
    "forbidden",
  );
  assertEquals(
    code(authorizeConditions(ctx, "RecordDomain", { mode: "view" })),
    "forbidden",
  );
  assertEquals(code(authorizeConditions(ctx, "RecordDomain")), "forbidden");
});
