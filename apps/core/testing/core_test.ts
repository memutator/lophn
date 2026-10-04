import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "./core.ts";

Deno.test("platform/install-and-update#R7: 테스트 harness는 임시 데이터 root로 core를 띄운다", async () => {
  const opened = await createCoreHarness();
  assert(opened.ok);
  const harness = opened.value;
  try {
    assert(harness.port > 0);
    assert(harness.epoch.length > 0);
    const ledger = await Deno.stat(`${harness.dataRoot}/lophn.db`);
    assert(ledger.isFile);
    const anonymous = await fetch(
      `http://127.0.0.1:${harness.port}/v1/platform/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assertEquals(anonymous.status, 401);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/install-and-update#R12: harness는 지정 scope의 user·machine 테스트 credential을 만든다", async () => {
  const opened = await createCoreHarness();
  assert(opened.ok);
  const harness = opened.value;
  try {
    const user = await harness.credential({
      actor: "user",
      principal: "user",
      scope: { operations: ["platform/status"], targets: {} },
      conditions: { process: "test" },
    });
    assert(user.ok);
    assert(user.value.token.length > 0);

    const machine = await harness.credential({
      actor: "machine",
      principal: "task:check",
      scope: { operations: ["task/result"], targets: { task: "check" } },
      conditions: { task: "check", process: "test" },
    });
    assert(machine.ok);

    const agent = await harness.credential({
      actor: "agent",
      principal: "agent:one",
      scope: { operations: [], targets: {} },
      conditions: {},
    });
    assert(!agent.ok);
  } finally {
    await harness.close();
  }
});
