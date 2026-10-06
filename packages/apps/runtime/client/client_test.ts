// Deno runtime client. 실제 core(임시 LOPHN_HOME)에서 connect하고 실제 앱 자식 프로세스에
// Unix socket HTTP로 호출한다. 전송 단절은 앱 프로세스를 실제로 끝내서 만든다.
import { assert, assertEquals } from "@std/assert";
import { openWorld, type World } from "../testing/world.ts";
import { createRuntimeClient } from "./mod.ts";
import {
  type DirectTransport,
  NotSent,
  ResultLost,
  unixDirectTransport,
} from "./unix-http.ts";

async function withWorld(run: (world: World) => Promise<void>) {
  const world = await openWorld();
  try {
    await world.allow();
    await run(world);
  } finally {
    await world.close();
  }
}

function clientOf(
  world: World,
  token = world.user.token,
  direct?: DirectTransport,
) {
  return createRuntimeClient({
    core: { baseUrl: `http://127.0.0.1:${world.harness.port}`, token },
    ...(direct ? { direct } : {}),
  });
}

function request(world: World) {
  return {
    app: world.app,
    mode: "live" as const,
    screens: ["usage"],
    screen_sizes: { usage: ["full" as const] },
    commands: ["usage.read", "usage.save", "slow", "fail"],
  };
}

function ran(output: string, command: string): number {
  return output.split("\n").filter((line) => line.endsWith(`ran ${command}`))
    .length;
}

Deno.test("apps/runtime#R10: Unix socket HTTP로 invoke·status·cancel을 core를 지나지 않고 부른다", async () => {
  await withWorld(async (world) => {
    await world.start();
    const connected = await clientOf(world).connect(request(world));
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const session = connected.value;
    assertEquals(session.connection.app, world.app);
    const invoked = await session.invoke({
      command: "usage.save",
      request_key: "save-1",
    });
    assert(invoked.ok, invoked.ok ? "" : invoked.error.message);
    assertEquals(invoked.value.kind, "result");
    if (invoked.value.kind !== "result") return;
    const invocation = invoked.value.output.invocation;
    assert(invocation !== undefined, "write command has an invocation");
    assertEquals(invoked.value.output.mode, "live");
    const status = await session.status("save-1", invocation);
    assert(status.ok, status.ok ? "" : status.error.message);
    assertEquals(status.value.progress, "succeeded");
    // 다른 request_key로 같은 호출을 묻는 status는 모른다.
    const other = await session.status("other-key", invocation);
    assert(other.ok);
    assertEquals(other.value.progress, "unknown");
    const cancelled = await session.cancel("save-1", invocation);
    assert(cancelled.ok, cancelled.ok ? "" : cancelled.error.message);
    assertEquals(cancelled.value.accepted, true);
    const unknown = await session.cancel("other-key", invocation);
    assert(unknown.ok);
    assertEquals(unknown.value.accepted, false);
  });
});

Deno.test("apps/runtime#R10: connection에 없는 command와 범위 밖 요청은 앱이 오류로 돌려준다", async () => {
  await withWorld(async (world) => {
    await world.start();
    const connected = await clientOf(world).connect({
      ...request(world),
      commands: ["usage.read"],
    });
    assert(connected.ok);
    const outside = await connected.value.invoke({ command: "usage.save" });
    assert(!outside.ok);
    assertEquals(outside.error.code, "forbidden");
    const undeclared = await connected.value.invoke({ command: "nothing" });
    assert(!undeclared.ok);
    assertEquals(undeclared.error.code, "invalid_input");
    // 인증 없는 core 호출은 거절한다.
    const refused = await clientOf(world, "x".repeat(43)).connect(
      request(world),
    );
    assert(!refused.ok);
    assertEquals(refused.error.code, "unauthorized");
  });
});

Deno.test("apps/runtime#R12: request_key를 다시 쓰면 같은 결과를 돌려주고 handler를 다시 실행하지 않는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await clientOf(world).connect(request(world));
    assert(connected.ok);
    const first = await connected.value.invoke({
      command: "usage.save",
      request_key: "same-key",
    });
    const second = await connected.value.invoke({
      command: "usage.save",
      request_key: "same-key",
    });
    assert(first.ok && second.ok);
    assertEquals(first.value, second.value);
    assertEquals(ran(child.output(), "usage.save"), 1);
    // 다른 request_key는 새 호출이다.
    const third = await connected.value.invoke({ command: "usage.save" });
    assert(third.ok);
    assertEquals(ran(child.output(), "usage.save"), 2);
  });
});

Deno.test("apps/runtime#R12: 응답을 받기 전 전송이 끊기면 결과 모름이고 자동으로 다시 부르지 않는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const calls: string[] = [];
    // 요청은 앱이 받아 처리했고 응답만 끊긴 것을 만든다.
    const lossy: DirectTransport = async (endpoint, request) => {
      calls.push(`${request.method} ${request.path}`);
      await unixDirectTransport(endpoint, request);
      throw new ResultLost();
    };
    const connected = await clientOf(world, world.user.token, lossy).connect(
      request(world),
    );
    assert(connected.ok);
    const lost = await connected.value.invoke({
      command: "usage.save",
      request_key: "lost-1",
    });
    assert(lost.ok, lost.ok ? "" : lost.error.message);
    assertEquals(lost.value, { kind: "unknown", request_key: "lost-1" });
    // 한 번만 보냈고 handler도 한 번만 돌았다.
    assertEquals(calls.length, 1);
    assertEquals(ran(child.output(), "usage.save"), 1);
    // 호출자가 같은 key로 다시 물으면 앱이 같은 결과를 돌려준다(두 번째 실행 없음).
    const direct = await clientOf(world).connect(request(world));
    assert(direct.ok);
    const again = await direct.value.invoke({
      command: "usage.save",
      request_key: "lost-1",
    });
    assert(again.ok);
    assertEquals(again.value.kind, "result");
    assertEquals(ran(child.output(), "usage.save"), 1);
  });
});

Deno.test("apps/runtime#R12: 처리 중 앱 프로세스가 끝나면 결과 모름이고 앱이 없으면 보내지 않았다고 답한다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await clientOf(world).connect(request(world));
    assert(connected.ok);
    // 느린 command가 도는 동안 프로세스를 끝낸다. 응답은 오지 않는다.
    const pending = connected.value.invoke({
      command: "slow",
      request_key: "slow-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    Deno.kill(child.pid, "SIGKILL");
    const lost = await pending;
    assert(lost.ok, lost.ok ? "" : lost.error.message);
    assertEquals(lost.value, { kind: "unknown", request_key: "slow-1" });
    await child.exited;
    // 이제 socket이 없으니 요청은 나가지 않았다. 결과 모름이 아니라 오류다.
    const unsent = await connected.value.invoke({
      command: "usage.read",
      request_key: "after-1",
    });
    assert(!unsent.ok);
    assertEquals(unsent.error.code, "unavailable");
    const direct = unixDirectTransport(child.endpoint, {
      method: "GET",
      path: "/_lophn/commands/status",
      authorization: "",
    });
    await direct.then(
      () => assert(false, "the socket is gone"),
      (error) => assert(error instanceof NotSent),
    );
  });
});

Deno.test("apps/runtime#R10: 연결을 받은 뒤 앱 호출은 core가 멈춰도 응답한다", async () => {
  const world = await openWorld();
  try {
    await world.allow();
    await world.start();
    const connected = await clientOf(world).connect(request(world));
    assert(connected.ok);
    // core(API·ledger·writer)를 끝낸다. 앱 프로세스는 그대로 살아 있다.
    await world.harness.close();
    const invoked = await connected.value.invoke({ command: "usage.read" });
    assert(invoked.ok, invoked.ok ? "" : invoked.error.message);
    assertEquals(invoked.value.kind, "result");
  } finally {
    for (const child of world.children) await child.stop();
  }
});
