import { assert, assertEquals } from "@std/assert";
import {
  connectionPrincipal,
  connectionSchema,
  connectionScopeSchema,
} from "../../protocol/coding-agent/mod.ts";
import { nextState, principalFor, scopeColumns } from "./model.ts";
import { APP, CAC } from "./sqlite.ts";

Deno.test("coding-agent/connection#R2: all scope has a null app and app scope requires an app", () => {
  const all = connectionScopeSchema.parse({ kind: "all", app: null });
  const app = connectionScopeSchema.parse({ kind: "app", app: APP });
  assert(scopeColumns(all).ok);
  assert(scopeColumns(app).ok);
  assert(!connectionScopeSchema.safeParse({ kind: "all", app: APP }).success);
  assert(!connectionScopeSchema.safeParse({ kind: "app", app: null }).success);
  assert(!connectionScopeSchema.safeParse({ kind: "all" }).success);
  assert(!connectionScopeSchema.safeParse({ kind: "app" }).success);
});

Deno.test("coding-agent/connection#R2: principal is coding_agent:<id> and is not a request field", () => {
  assertEquals(principalFor(CAC), `coding_agent:${CAC}`);
  assertEquals(connectionPrincipal(CAC), principalFor(CAC));
  const connection = connectionSchema.parse({
    id: CAC,
    label: "claude",
    scope: { kind: "all", app: null },
    principal: principalFor(CAC),
    state: "active",
    revision: "1",
  });
  assertEquals(connection.principal, `coding_agent:${CAC}`);
  assert(
    !connectionSchema.safeParse({
      ...connection,
      principal: "coding_agent:other",
    }).success,
  );
});

Deno.test("coding-agent/connection#R8: state moves active to revoked and cannot be reactivated", () => {
  const revoked = nextState("active");
  assert(revoked.ok);
  if (revoked.ok) assertEquals(revoked.value, "revoked");
  const again = nextState("revoked");
  assert(!again.ok);
  if (!again.ok) assertEquals(again.error.code, "conflict");
});
