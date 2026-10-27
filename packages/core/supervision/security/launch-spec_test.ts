import { assertEquals } from "@std/assert";
import { checkLaunchSpec } from "./launch-spec.ts";

function spec(kind: string, grant: Record<string, boolean> = {}) {
  return {
    kind,
    entry: "/opt/lophn/main.ts",
    allow_read: [],
    allow_write: [],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
    ...grant,
    policy: "always",
    memory_limit_bytes: 1024,
  };
}

Deno.test("net_any is allowed only for the apps supervisor", () => {
  assertEquals(
    checkLaunchSpec(spec("apps/supervisor", { net_any: true })).ok,
    true,
  );
  for (
    const kind of [
      "lophn-agent/runtime",
      "documents/worker",
      "apps/runner",
      "coding-agent/run",
    ]
  ) {
    assertEquals(
      checkLaunchSpec(spec(kind, { net_any: true })).ok,
      false,
      kind,
    );
  }
});

Deno.test("allow_all is allowed only for the agent runtime", () => {
  assertEquals(
    checkLaunchSpec(spec("lophn-agent/runtime", { allow_all: true })).ok,
    true,
  );
  for (
    const kind of [
      "apps/supervisor",
      "documents/worker",
      "apps/runner",
      "coding-agent/run",
    ]
  ) {
    assertEquals(
      checkLaunchSpec(spec(kind, { allow_all: true })).ok,
      false,
      kind,
    );
  }
});
