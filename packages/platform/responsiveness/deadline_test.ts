import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import type { ChildMessage } from "../../protocol/platform/mod.ts";
import { armTimer, settledWithin, valueWithin } from "./deadline.ts";
import { createSupervisor, type SupervisorOptions } from "./supervisor.ts";
import {
  type FakeOptions,
  fakeProcess,
  hello,
  spec,
  tracker,
  waitFor,
} from "./supervisor-fixture.ts";

function faked(options: FakeOptions, over: Partial<SupervisorOptions> = {}) {
  const track = tracker();
  const processes: Array<ReturnType<typeof fakeProcess>> = [];
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 30,
    stopMs: 20,
    teardownMs: 100,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: () => {
      const process = fakeProcess(track, options);
      processes.push(process);
      return process;
    },
    ...over,
  });
  return { supervised, track, processes };
}

// Deno test sanitizer가 남은 timer를 잡는다. 이 test들이 통과하면 완료 뒤 timer가 없다.
Deno.test("platform/security#R2: armTimer는 injected clock이 멈춰도 실제 경과로 timeout한다", async () => {
  const start = performance.now();
  const timer = armTimer(40);
  assertEquals(await timer.promise, "timeout");
  const elapsed = performance.now() - start;
  assert(elapsed >= 35, `too early: ${elapsed}ms`);
  assert(elapsed < 1_000, `too late: ${elapsed}ms`);
});

Deno.test("platform/security#R2: 끝난 기한 helper는 timer를 남기지 않는다", async () => {
  const timer = armTimer(20);
  timer.cancel();
  let fired = false;
  timer.promise.then(() => {
    fired = true;
  });
  assertEquals(await settledWithin(Promise.resolve(1), 10_000), true);
  assertEquals(
    await settledWithin(Promise.reject(new Error("x")), 10_000),
    true,
  );
  assertEquals(await settledWithin(new Promise(() => {}), 10), false);
  assertEquals(await valueWithin(() => Promise.resolve(7), 10_000, 0), 7);
  assertEquals(
    await valueWithin(
      () => {
        throw new Error("sync");
      },
      10_000,
      0,
    ),
    0,
  );
  assertEquals(await valueWithin(() => new Promise(() => {}), 10, 0), 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assertEquals(fired, false);
});

Deno.test("platform/security#R2: exit·stdio·group 종료 확인이 영원히 unresolved여도 bounded하게 fail-closed한다", async () => {
  const begun = performance.now();
  const { supervised, track } = faked({
    ready: false,
    neverExit: true,
    hangStdio: true,
    terminate: "hang",
  });
  const result = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  const elapsed = performance.now() - begun;
  assertEquals(result.ok ? "" : result.code, "unavailable");
  // ready 30ms + teardown 100ms + stderr drain 1s 안쪽이다.
  assert(elapsed < 3_000, `teardown took too long: ${elapsed}ms`);
  assertEquals(
    supervised.observation("platform/io").reason,
    "teardown unconfirmed",
  );
  // 겹쳐 새 child를 띄우지 않는다.
  const again = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assertEquals(again.ok ? "" : again.code, "unavailable");
  assertEquals(track.spawned, 1);
  assertEquals(await supervised.stop("platform/io"), false);
});

Deno.test("platform/security#R2: hello 쓰기가 막혀도 ready 기한에 끝내고 다음 기동은 앞선 종료 확인 뒤다", async () => {
  const { supervised, track } = faked({ blockWrites: "all" });
  const result = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assertEquals(result.ok ? "" : result.code, "unavailable");
  assertEquals(
    supervised.observation("platform/io").reason,
    "ready timed out",
  );
  assertEquals(track.spawned, 4);
  assertEquals(track.maxLive, 1);
  assertEquals(track.live, 0);
});

Deno.test("platform/security#R2: ready 뒤 leader가 끝나고 stdout이 계속 열려 있어도 drain 기한 뒤 끝낸다", async () => {
  const messages: ChildMessage[] = [];
  const { supervised, track, processes } = faked({}, {
    // 재기동 sleep은 영원히 끝나지 않는다.
    sleep: () => new Promise(() => {}),
  });
  const started = await supervised.start(spec(), hello(), {
    onMessage: (message) => messages.push(message),
  });
  assert(started.ok);
  processes[0].exit(0);
  await waitFor(() => track.live === 0, 400);
  assertEquals(supervised.observation("platform/io").available, false);
  assertEquals(
    supervised.observation("platform/io").reason,
    "exited after ready",
  );
  assertEquals(track.spawned, 1);
  assertEquals(messages.length, 0);
  // 재기동 대기 중의 stop은 띄운 것이 없으니 바로 확인된다.
  assert(await supervised.stop("platform/io"));
});

Deno.test("platform/security#R3: group kill adapter가 없거나 확인이 던지면 새 child를 띄우지 않는다", async () => {
  const checks: Array<() => Promise<boolean>> = [
    () => Promise.resolve(false),
    () => Promise.reject(new Error("adapter rejected")),
    () => {
      throw new Error("adapter threw");
    },
  ];
  for (const check of checks) {
    const { supervised, track } = faked({}, { checkGroupKillAdapter: check });
    const result = await supervised.start(spec(), hello(), {
      onMessage: () => {},
    });
    assertEquals(result.ok ? "" : result.code, "unavailable");
    assertEquals(track.spawned, 0);
    assertEquals(
      supervised.observation("platform/io").reason,
      "group kill adapter unavailable",
    );
    // spec 변경도 띄우지 않는다.
    assertEquals((await supervised.updateSpec(spec(), hello())).ok, false);
    assertEquals(track.spawned, 0);
  }
});
