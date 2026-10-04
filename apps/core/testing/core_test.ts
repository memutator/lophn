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

Deno.test("platform/install-and-update#R12: harness는 다섯 actor의 지정 scope 테스트 credential을 만든다", async () => {
  const opened = await createCoreHarness();
  assert(opened.ok);
  const harness = opened.value;
  try {
    const actors = [
      {
        actor: "user" as const,
        principal: "user",
        scope: { operations: ["platform/status"], targets: {} },
        conditions: { process: "test" },
      },
      {
        actor: "machine" as const,
        principal: "task:check",
        scope: { operations: ["platform/status"], targets: {} },
        conditions: { task: "check", process: "test" },
      },
      {
        actor: "agent" as const,
        principal: "agent:one",
        scope: { operations: ["platform/status"], targets: {} },
        conditions: {},
      },
      {
        actor: "app" as const,
        principal: "app:one",
        scope: { operations: ["platform/health"], targets: {} },
        conditions: {},
      },
      {
        actor: "coding_agent" as const,
        principal: "coding-agent:one",
        scope: { operations: ["platform/status"], targets: {} },
        conditions: {},
      },
    ];
    for (const input of actors) {
      const issued = await harness.credential(input);
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      const response = await fetch(
        `http://127.0.0.1:${harness.port}/v1/platform/status`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${issued.value.token}`,
          },
          body: "{}",
        },
      );
      assertEquals(response.status, 200, input.actor);
    }
  } finally {
    await harness.close();
  }
});
