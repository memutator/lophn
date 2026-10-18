import { assertEquals } from "@std/assert";
import { checkLaunchSpec } from "./launch-spec.ts";

function spec(kind: string) {
  return {
    kind,
    entry: "/opt/lophn/main.ts",
    allow_read: [],
    allow_write: [],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
    net_any: true,
    policy: "always",
    memory_limit_bytes: 1024,
  };
}

Deno.test("net_any is allowed only for the agent runtime and apps supervisor", () => {
  assertEquals(checkLaunchSpec(spec("lophn-agent/runtime")).ok, true);
  assertEquals(checkLaunchSpec(spec("apps/supervisor")).ok, true);
  for (const kind of ["documents/worker", "apps/runner", "coding-agent/run"]) {
    assertEquals(checkLaunchSpec(spec(kind)).ok, false, kind);
  }
});
