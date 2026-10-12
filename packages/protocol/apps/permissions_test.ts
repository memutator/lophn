import { assert, assertEquals } from "@std/assert";
import {
  permissionRequirementSchema,
  permissionScopeSchema,
} from "./permissions.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";

Deno.test("apps/permissions#R5: fs write scope does not imply a read scope", () => {
  const write = permissionScopeSchema.parse({
    kind: "fs.write",
    path: "/tmp/notes",
    recursive: false,
  });
  assertEquals(write.kind, "fs.write");
  const prefix = permissionRequirementSchema.safeParse({
    kind: "fs.read",
    scope: { path: "/tmp/notes-other", recursive: true },
    reason: "read notes",
  });
  assert(prefix.success);
  assert(
    permissionScopeSchema.safeParse({
      kind: "fs.read",
      path: "tmp/notes",
      recursive: false,
    }).success === false,
  );
});

Deno.test("apps/permissions#R8: wildcard host and port 0 are rejected", () => {
  assert(
    permissionScopeSchema.safeParse({
      kind: "net.fetch",
      host: "*.example.com",
      port: 443,
    }).success === false,
  );
  assert(
    permissionScopeSchema.safeParse({
      kind: "net.fetch",
      host: "example.com",
      port: 0,
    }).success === false,
  );
  assert(
    permissionScopeSchema.safeParse({
      kind: "net.fetch",
      host: "127.0.0.1",
      port: 443,
    }).success,
  );
});

Deno.test("apps/permissions#R9: listen allows only exact loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    assert(
      permissionScopeSchema.safeParse({
        kind: "net.listen",
        host,
        port: 1455,
      }).success,
    );
  }
  assert(
    permissionScopeSchema.safeParse({
      kind: "net.listen",
      host: "0.0.0.0",
      port: 1455,
    }).success === false,
  );
});

Deno.test("apps/permissions#R10: localhost and 127.0.0.1 stay distinct", () => {
  const localhost = permissionScopeSchema.parse({
    kind: "net.listen",
    host: "localhost",
    port: 1455,
  });
  const address = permissionScopeSchema.parse({
    kind: "net.listen",
    host: "127.0.0.1",
    port: 1455,
  });
  assertEquals(localhost.kind === "net.listen" && localhost.host, "localhost");
  assertEquals(address.kind === "net.listen" && address.host, "127.0.0.1");
});

Deno.test("apps/permissions#R26: app call scope names the target and exact commands", () => {
  const scope = permissionScopeSchema.parse({
    kind: "app.call",
    app: APP,
    commands: ["save", "list"],
  });
  assert(scope.kind === "app.call");
  assertEquals(scope.commands, ["save", "list"]);
  assert(
    permissionScopeSchema.safeParse({
      kind: "app.call",
      app: APP,
      commands: ["save", "save*"],
    }).success === false,
  );
});

Deno.test("apps/automations#R13: automation.run scope binds command input and when", () => {
  const scope = permissionScopeSchema.parse({
    kind: "automation.run",
    automation: "sync",
    command: "send",
    input_hash: "ab".repeat(32),
    when: { kind: "on_start" },
  });
  assertEquals(scope.kind, "automation.run");
  assert(
    permissionScopeSchema.safeParse({
      kind: "automation.run",
      automation: "sync",
      command: "send",
      input_hash: "ab".repeat(32),
      when: { kind: "interval", interval_ms: 59999 },
    }).success === false,
  );
});
