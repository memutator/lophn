import { assert, assertEquals } from "@std/assert";
import { RUNNER_SLOTS, runnerSockets, testRunnerSpec } from "./runner.ts";

Deno.test("problems/tests#R13 R14: runner launch spec은 Deno만 실행하고 작업 root만 쓴다", () => {
  const spec = testRunnerSpec({
    dataRoot: "/tmp/lophn-home",
    deno: "/usr/bin/deno",
  });
  assert(spec);
  assertEquals(spec.kind, "problems/test-runner");
  // Deno와 자식에 메모리 경계·프로세스 그룹을 거는 platform 도구만 실행한다. 화면 검사 host는 없다.
  assertEquals(spec.allow_run, [
    "/usr/bin/deno",
    "/usr/bin/setsid",
    "/usr/bin/systemd-run",
    "/usr/bin/prlimit",
  ]);
  assertEquals(spec.allow_write, ["/tmp/lophn-home/work/problems/tests"]);
  // net은 고정 socket 자리 두 slot, 가상 host와 `problems.work` 반응기·runner service가 닿는
  // core loopback이다(Unix socket은 정확한 경로만 허락된다).
  assertEquals(spec.allow_net[0], "lophn.invalid");
  assertEquals(spec.allow_net[1], "127.0.0.1");
  assertEquals(spec.allow_net.length, 2 + 3 * RUNNER_SLOTS.length);
  assert(
    spec.allow_net.slice(2).every((entry) =>
      entry.startsWith("unix:/tmp/lophn-home/work/problems/tests/sock/")
    ),
  );
  assertEquals(
    spec.allow_net.slice(2, 5),
    Object.values(runnerSockets("/tmp/lophn-home", 0)).map((path) =>
      `unix:${path}`
    ),
  );
  assert(spec.allow_env.includes("LOPHN_HOME"));
  assert(spec.allow_env.includes("DBUS_SESSION_BUS_ADDRESS"));
  assert(!spec.allow_env.includes("LOPHN_CREDENTIAL"));
  // 화면 검사 host를 주면 그 절대 경로 하나가 더해진다.
  const withHost = testRunnerSpec({
    dataRoot: "/tmp/lophn-home",
    deno: "/usr/bin/deno",
    screenHost: "/opt/lophn/desktop/lophn-desktop",
  });
  assert(withHost?.allow_run.includes("/opt/lophn/desktop/lophn-desktop"));
  assertEquals(spec.policy, "always");
  assert(!spec.allow_read.some((path) => path.includes("keychain")));
  assertEquals(
    testRunnerSpec({ dataRoot: "relative", deno: "/usr/bin/deno" }),
    undefined,
  );
});
