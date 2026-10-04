import { assertEquals } from "@std/assert";
import { hostOf } from "./blueprint-scope.ts";
import { validateBlueprint } from "./blueprint.ts";
import {
  permissionRequirementSchema,
  permissionScopeSchema,
} from "./permissions.ts";

const HOSTS: Array<[string, boolean]> = [
  ["localhost", true],
  ["example.com", true],
  ["127.0.0.1", true],
  ["::1", true],
  ["2001:db8::1", true],
  ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", true],
  ["2001:db8:85a3::8a2e:370:7334", true],
  ["::ffff:192.0.2.1", true],
  ["1:2:3:4:5:6:192.0.2.1", true],
  ["0:0:0:0:0:ffff:192.0.2.1", true],
  ["192.0.2.1::", false],
  ["1:2:192.0.2.1::", false],
  ["127.0.0.999", false],
  ["256.0.0.1", false],
  ["127.00.0.1", false],
  [":", false],
  ["2001:db8:85a3:0:0:8a2e:370:7334:extra", false],
  ["2001::db8::1", false],
  ["fe80::1%eth0", false],
  ["[::1]:80", false],
  ["*.example.com", false],
  ["example.com.", false],
];

function requirement(kind: "net.fetch" | "net.listen", host: string) {
  return validateBlueprint({
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [],
    commands: [{
      key: "read",
      label: "read",
      description: "read purpose",
      effect: "read",
      confirm: false,
      input: null,
      revert: { supported: false },
    }],
    automatic_tasks: [],
    permissions: [{
      kind,
      reason: "reach the host",
      scope: { host, port: 443 },
    }],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  });
}

Deno.test("apps/permissions#R8: fetch hosts match across pure and grant schemas", () => {
  for (const [host, ok] of HOSTS) {
    assertEquals(hostOf(host) === undefined, ok, host);
    assertEquals(requirement("net.fetch", host).ok, ok, host);
    assertEquals(
      permissionRequirementSchema.safeParse({
        kind: "net.fetch",
        scope: { host, port: 443 },
        reason: "reach the host",
      }).success,
      ok,
      host,
    );
    assertEquals(
      permissionScopeSchema.safeParse({
        kind: "net.fetch",
        host,
        port: 443,
      }).success,
      ok,
      host,
    );
  }
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    assertEquals(requirement("net.listen", host).ok, true, host);
    assertEquals(
      permissionScopeSchema.safeParse({
        kind: "net.listen",
        host,
        port: 1,
      }).success,
      true,
    );
  }
  assertEquals(requirement("net.listen", "2001:db8::1").ok, false);
  assertEquals(
    permissionScopeSchema.safeParse({
      kind: "net.fetch",
      host: "example.com",
      port: 0,
    }).success,
    false,
  );
});

// node:net isIP(4/6)와 맞춘 corpus. 제품 코드는 node import가 없다.
Deno.test("apps/permissions#R8: exact addresses match the isIP corpus", () => {
  const ipv4 = ["127.0.0.1", "192.0.2.1", "255.255.255.255", "0.0.0.0"];
  const ipv6 = [
    "::1",
    "2001:db8::1",
    "::ffff:192.0.2.1",
    "1:2:3:4:5:6:192.0.2.1",
    "0:0:0:0:0:ffff:192.0.2.1",
  ];
  const rejected = [
    "127.0.0.999",
    "256.0.0.1",
    "127.00.0.1",
    "01.2.3.4",
    "192.0.2.1::",
    "1:2:192.0.2.1::",
  ];
  for (const address of [...ipv4, ...ipv6]) {
    assertEquals(hostOf(address), undefined, address);
  }
  for (const address of rejected) {
    assertEquals(hostOf(address) === undefined, false, address);
  }
});
