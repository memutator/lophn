import { assert, assertEquals } from "@std/assert";
import {
  APP_SCOPE_CONCERNS,
  appScopeAllows,
  FORBIDDEN_ACTIONS,
  isForbiddenAction,
  registrationAllowed,
} from "./policy.ts";

Deno.test("coding-agent/connection#R5: app scope allows only that app's documents, app, problems, tickets, and shared formats, SDK, templates", () => {
  for (const concern of APP_SCOPE_CONCERNS) {
    assert(appScopeAllows(concern));
  }
  assertEquals(
    [...APP_SCOPE_CONCERNS],
    ["documents", "app", "problems", "tickets", "formats", "sdk", "templates"],
  );
  assert(!appScopeAllows("projects"));
  assert(!appScopeAllows("secrets"));
  assert(!appScopeAllows("backup"));
});

Deno.test("coding-agent/connection#R7: coding agent cannot decide approvals, change grants, read secrets, or perform the other forbidden actions", () => {
  const expected = [
    "approval.decide",
    "grant.change",
    "secret.read",
    "backup.read",
    "problem.close",
    "problem.ignore",
    "problem.confirm",
    "connection.create",
    "connection.revoke",
    "connection.widen",
    "project.register",
    "project.tracking",
    "context.define",
    "term.define",
    "assignment.change",
    "ticket.goal",
    "ticket.confirm",
    "test_result.write",
  ];
  assertEquals([...FORBIDDEN_ACTIONS], expected);
  for (const action of expected) assert(isForbiddenAction(action));
  assert(!isForbiddenAction("documents.read"));
  assert(!isForbiddenAction("ticket.claim"));
});

Deno.test("coding-agent/connection#R4: app registration is allowed only for scope all", () => {
  assert(registrationAllowed({ kind: "all", app: null }));
  assert(
    !registrationAllowed({
      kind: "app",
      app: "app_01arz3ndektsv4rrffq69g5fav",
    }),
  );
});
