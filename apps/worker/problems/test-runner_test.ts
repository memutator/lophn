import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../packages/base/mod.ts";
import { applyMemoryLimit } from "../../../packages/platform/security/mod.ts";
import {
  acceptRun,
  forwardChildReport,
  platformMemory,
  stopChildren,
} from "./test-runner.ts";

const HASH = "a".repeat(64);

Deno.test("problems/tests#R20: runner는 platform 메모리 경계를 그대로 쓰고 없으면 띄우지 않는다", async () => {
  const none = await applyMemoryLimit("deno", ["test"], {
    cgroup: () => Promise.resolve(false),
    addressSpace: () => Promise.resolve(false),
  });
  assert(!none.ok);

  const soft = await platformMemory.limit("deno", ["test"]);
  if (soft.ok) {
    assert(soft.value.mode === "hard" || soft.value.mode === "soft");
    assert(soft.value.args.includes("--"));
  }

  let killed = 0;
  stopChildren([{
    pid: 1,
    killGroup() {
      killed += 1;
    },
  }]);
  assertEquals(killed, 1);

  let committed = false;
  const blocked = await acceptRun({
    request_key: "key",
    prepare: {
      method: {
        argv: ["test", "child_test.ts"],
        cwd: ".",
        timeout_ms: 1_000,
        expected_exit_code: 0,
        environment: HASH,
      },
      source: "/bundle/source",
      scratch: "/work/scratch",
      reads: [],
      env: {},
      deno: "/usr/bin/deno",
    },
    test_hash: HASH,
    side: "single",
    start_attempt_at: "2026-10-05T00:00:00.000Z",
    running: 0,
    preparing: 0,
  }, {
    commit: () => {
      committed = true;
      return Promise.resolve(err({ code: "conflict", message: "미확정" }));
    },
  });
  assert(!blocked.ok);
  assertEquals(blocked.error.code, "conflict");
  assert(committed);

  const refused = await acceptRun({
    request_key: "key",
    prepare: {
      method: {
        argv: ["test", "child_test.ts"],
        cwd: ".",
        timeout_ms: 1_000,
        expected_exit_code: 0,
        environment: HASH,
      },
      source: "/bundle/source",
      scratch: "/work/scratch",
      reads: [],
      env: { LOPHN_HOME: "/home/person" },
      deno: "/usr/bin/deno",
    },
    test_hash: HASH,
    side: "single",
    start_attempt_at: "2026-10-05T00:00:00.000Z",
    running: 0,
    preparing: 0,
  });
  assert(!refused.ok);

  const frame = new TextEncoder().encode(JSON.stringify({
    report_id: "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
    code: "save_failed",
    observed_at: "2026-10-05T00:00:00.000Z",
  }));
  const forwarded = await forwardChildReport(frame, "app-test-1", (report) => {
    assertEquals(report.mode, "test");
    assertEquals(report.scope, "app-test-1");
    return Promise.resolve(ok({ accepted: true }));
  });
  assert(forwarded.ok);
});
