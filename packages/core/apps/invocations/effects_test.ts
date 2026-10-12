// 효과의 한계(apps/invocations#R10, R11, R12)를 실제 앱 runtime entrypoint와 실제 core의 기록으로 본다.
// 실패·중단·취소 요청은 부분 저장이나 외부 효과가 없다는 뜻으로 남지 않고, 결과를 모르거나 기록이
// 빠졌다는 이유로 업무를 다시 부르지 않는다. 사람 데이터 root는 열지 않고 core는 temp 홈에서 뜬다.
import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../testing/core.ts";
import { createLedgerRegistration } from "../register.ts";
import { coreAccess, gatedSend } from "./testing/mod.ts";
import { installHandlers, openRuntimeWorld, REL } from "./world_test.ts";
import { readStagePort } from "./mod.ts";

const behavior = {
  sync: undefined as (() => Promise<unknown>) | undefined,
  calls: { sync: 0, save: 0 },
};

installHandlers([
  {
    command: "usage.sync",
    handle: async () => {
      behavior.calls.sync += 1;
      return await behavior.sync?.();
    },
  },
  {
    command: "usage.save",
    handle: () => {
      behavior.calls.save += 1;
      return { saved: true };
    },
  },
]);

async function openCore() {
  behavior.sync = undefined;
  behavior.calls = { sync: 0, save: 0 };
  const opened = await createCoreHarness({
    teams: [{ createLedgerRegistration }],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
    nowMs: Date.parse("2026-10-04T00:00:00.000Z"),
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  return opened.value;
}

const sync = (key: string) => ({
  request_key: key,
  release: REL,
  command: "usage.sync",
});

Deno.test("apps/invocations#R11: 로컬 저장 뒤 외부 전송이 실패하면 저장 완료와 전송 실패가 따로 남고 부분 저장이 없다는 표시는 없다", async () => {
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const world = openRuntimeWorld({ clock: harness.clock, send: access.send });
    behavior.sync = () => {
      const stages = readStagePort();
      assert(stages, "stage port가 있어야 한다");
      stages.stage("local_save", "completed");
      stages.stage("external_send", "failed");
      return Promise.reject(new Error("smtp refused for secret-token-123"));
    };
    const reply = await world.invoke(sync("fail-1"));
    assertEquals(reply.status, 500);
    await world.delivery.queue.pump();
    const [row] = await access.invocations();
    assertEquals(row["status"], "failed");
    const summary = row["summary"] as Record<string, unknown>;
    assertEquals(summary["stages"], [
      { name: "local_save", state: "completed" },
      { name: "external_send", state: "failed" },
    ]);
    // 실패는 효과 없음이 아니라 효과를 확인하지 못한 것으로 남는다.
    assertEquals(summary["effects"], "unconfirmed");
    // 원문 오류와 비밀은 요약에 없다.
    assert(!JSON.stringify(row).includes("secret-token-123"));
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R11: 취소 요청 접수는 효과 취소로 남지 않고 결과도 모름으로 보인다", async () => {
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const world = openRuntimeWorld({ clock: harness.clock, send: access.send });
    let finish: () => void = () => {};
    behavior.sync = () =>
      new Promise((resolve) => {
        const stages = readStagePort();
        stages?.stage("local_save", "completed");
        finish = () => resolve({ sent: true });
      });
    const running = world.invoke(sync("slow"));
    const id = await started(world, "slow");
    const asked = await handleCancel(world, "slow", id);
    assertEquals(asked, { accepted: true });
    // 취소를 요청했을 뿐이라 진행 상태는 취소 완료가 아니라 모름이다.
    const status = await handleStatus(world, "slow", id);
    assertEquals((status as { progress: string }).progress, "unknown");
    finish();
    const reply = await running;
    assertEquals(reply.status, 200);
    await world.delivery.queue.pump();
    const row = await access.invocation(id);
    assertEquals(row?.["status"], "succeeded");
    const summary = row?.["summary"] as Record<string, unknown>;
    assertEquals(summary["cancel_requested"], true);
    assert(!JSON.stringify(row).includes("cancelled"));
    assertEquals(behavior.calls.sync, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R12 #R5: 전달이 끊기거나 결과를 모르는 호출은 같은 요청이 와도 업무를 다시 부르지 않고 기록 메시지만 남는다", async () => {
  const harness = await openCore();
  try {
    // core로 가는 전달이 전부 끊겨 있다.
    const world = openRuntimeWorld({
      clock: harness.clock,
      send: () => Promise.resolve({ ok: false, code: "unavailable" }),
    });
    behavior.sync = () => Promise.resolve({ sent: true });
    const first = await world.invoke(sync("ext-1"));
    assertEquals(first.status, 200);
    // 응답이 유실된 것처럼 같은 요청을 다시 보내도 외부 전송은 반복되지 않는다.
    const again = await world.invoke(sync("ext-1"));
    assertEquals(again.status, 200);
    assertEquals(behavior.calls.sync, 1);
    await world.delivery.queue.pump();
    // 기록 메시지는 남아 있고(재전송 대상), 기록이 없다고 해서 업무가 다시 불리지 않는다.
    assertEquals(world.delivery.queue.size().messages, 2);
    harness.clock.advance(60_000);
    await world.delivery.queue.pump();
    assertEquals(behavior.calls.sync, 1);
    // 모르는 호출의 status는 모름이고 업무를 부르지 않는다.
    const status = await handleStatus(
      world,
      "never-seen",
      "inv_01h455vb4pex5v6nkc6gd5fdw9",
    );
    assertEquals((status as { progress: string }).progress, "unknown");
    assertEquals(behavior.calls.sync, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R10 #R12: 결과를 전달하기 전에 프로세스가 끝나면 알려진 호출만 미확인으로 확정하고 모르는 호출은 만들지 않으며 업무는 다시 부르지 않는다", async () => {
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const gated = gatedSend(access.send, true);
    const world = openRuntimeWorld({ clock: harness.clock, send: gated.send });
    behavior.sync = () => new Promise(() => {});
    const hung = world.invoke(sync("dies"));
    const id = await started(world, "dies");
    // handler가 끝나지 않은 채 시작 사실만 core에 닿았다.
    await world.delivery.queue.pump();
    assertEquals((await access.invocation(id))?.["status"], "running");
    // 앱 프로세스 종료를 supervisor가 관측했다.
    harness.clock.advance(3000);
    assertEquals(world.delivery.broker.childExited("nonce-1"), 1);
    await world.delivery.queue.pump();
    const row = await access.invocation(id);
    assertEquals(row?.["status"], "unknown");
    assertEquals(
      (row?.["summary"] as Record<string, unknown>)["reason"],
      "process_exited",
    );
    assert(row?.["started_at"] !== null);
    // 결과를 모를 뿐 성공이나 실패로 꾸미지 않고 업무도 다시 부르지 않는다.
    assertEquals(behavior.calls.sync, 1);
    // 이 프로세스가 시작을 알린 적 없는 호출은 지어내지 않는다.
    assertEquals(world.delivery.broker.childExited("nonce-1"), 0);
    assertEquals(
      await access.invocation("inv_01h455vb4pex5v6nkc6gd5fdw7"),
      null,
    );
    assertEquals((await access.invocations()).length, 1);
    void hung;
  } finally {
    await harness.close();
  }
});

// handler가 시작해 호출이 기록될 때까지 기다린다.
async function started(
  world: ReturnType<typeof openRuntimeWorld>,
  requestKey: string,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const id = world.state.byRequest.get(requestKey);
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("handler did not start");
}

// cancel·status는 direct socket의 같은 호출 경로다.
async function handleCancel(
  world: ReturnType<typeof openRuntimeWorld>,
  requestKey: string,
  invocation: string,
) {
  return await reference(
    world,
    "/_lophn/commands/cancel",
    requestKey,
    invocation,
  );
}

async function handleStatus(
  world: ReturnType<typeof openRuntimeWorld>,
  requestKey: string,
  invocation: string,
) {
  return await reference(
    world,
    "/_lophn/commands/status",
    requestKey,
    invocation,
  );
}

async function reference(
  world: ReturnType<typeof openRuntimeWorld>,
  path: string,
  requestKey: string,
  invocation: string,
): Promise<unknown> {
  const reply = await world.call(path, {
    request_key: requestKey,
    invocation,
  });
  assertEquals(reply.status, 200, JSON.stringify(reply));
  return reply.body;
}
