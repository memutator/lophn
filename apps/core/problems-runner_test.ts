import { assert, assertEquals } from "@std/assert";
import { testRunnerSpec } from "./problems-runner.ts";

Deno.test("problems/tests#R13 R14: runner launch spec은 Deno만 실행하고 작업 root만 쓴다", () => {
  const spec = testRunnerSpec({
    dataRoot: "/tmp/lophn-home",
    deno: "/usr/bin/deno",
  });
  assert(spec);
  assertEquals(spec.kind, "problems/test-runner");
  assertEquals(spec.allow_run, ["/usr/bin/deno"]);
  assertEquals(spec.allow_write, ["/tmp/lophn-home/work/problems/tests"]);
  // `problems.work` 반응기가 core loopback으로만 닿는다.
  assertEquals(spec.allow_net, ["127.0.0.1"]);
  assertEquals(spec.allow_env, ["LOPHN_HOME", "LOPHN_WORKER_KIND"]);
  assertEquals(spec.policy, "always");
  assert(!spec.allow_read.some((path) => path.includes("keychain")));
  assertEquals(
    testRunnerSpec({ dataRoot: "relative", deno: "/usr/bin/deno" }),
    undefined,
  );
});
