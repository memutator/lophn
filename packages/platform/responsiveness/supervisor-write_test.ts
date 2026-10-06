import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
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
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 30,
    writeMs: 60,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: () => fakeProcess(track, options),
    ...over,
  });
  return { supervised, track };
}

Deno.test("platform/responsiveness#R3: child가 읽지 않아 쓰기가 멈추면 기한 안에 이유를 달아 실패하고 그 child를 끝낸다", async () => {
  const { supervised, track } = faked({ blockWrites: "data" });
  let ends = 0;
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
    onEnd: () => ends += 1,
  });
  assert(started.ok);
  const begun = performance.now();
  const sent = await supervised.send("platform/io", { type: "worker_request" });
  assert(performance.now() - begun < 5_000);
  assertEquals(sent.ok, false);
  if (!sent.ok) {
    assertEquals(sent.code, "unavailable");
    assert(sent.reason?.includes("timed out"), sent.reason);
  }
  // 끊긴 pipe에는 더 쓰지 않는다. 이후 쓰기도 같은 자리에서 바로 실패한다.
  const bytes = await supervised.sendBytes(
    "platform/io",
    1,
    new Uint8Array([1]),
  );
  assertEquals(bytes.ok, false);
  // 멈춘 child는 끝나고 감독이 새 child를 띄운다(막힌 child를 ready로 두지 않는다).
  await waitFor(() => track.spawned >= 2);
  assert(ends >= 1);
  await supervised.stopAll();
  assertEquals(track.live, 0);
});

Deno.test("platform/responsiveness#R3: 같은 pipe에 줄 선 쓰기가 여럿이어도 전체가 쓰기 기한 하나 안에 끝난다", async () => {
  const { supervised } = faked({ blockWrites: "data" }, { writeMs: 80 });
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assert(started.ok);
  const begun = performance.now();
  const all = await Promise.all([
    supervised.send("platform/io", { n: 1 }),
    supervised.send("platform/io", { n: 2 }),
    supervised.sendBytes("platform/io", 1, new Uint8Array([1, 2, 3])),
    supervised.sendEnd("platform/io", 1),
  ]);
  assert(performance.now() - begun < 3_000);
  assert(all.every((result) => !result.ok));
  await supervised.stopAll();
});

Deno.test("platform/responsiveness#R3: 정상으로 읽는 child에는 쓰기 기한이 걸리지 않는다", async () => {
  const { supervised, track } = faked({}, { writeMs: 60 });
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assert(started.ok);
  const sent = await supervised.send("platform/io", { type: "worker_request" });
  assertEquals(sent.ok, true);
  assertEquals(track.spawned, 1);
  await supervised.stopAll();
});

Deno.test("platform/responsiveness#R3: onEnd는 기동마다 한 번이고 새 child가 뜨기 전에 불린다", async () => {
  const order: string[] = [];
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 30,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: () => {
      order.push(`spawn${track.spawned + 1}`);
      return fakeProcess(track, { exitAfterReady: true });
    },
  });
  await supervised.start(spec(), hello(), {
    onMessage: () => {},
    onEnd: () => order.push("end"),
    onGiveUp: (reason) => order.push(`giveup:${reason}`),
  });
  await waitFor(() => order.includes("giveup:restart limit reached"));
  // 4번 떴고 4번 끝났으며, 끝은 다음 기동보다 먼저다. 포기는 마지막에 한 번이다.
  assertEquals(order, [
    "spawn1",
    "end",
    "spawn2",
    "end",
    "spawn3",
    "end",
    "spawn4",
    "end",
    "giveup:restart limit reached",
  ]);
});

Deno.test("platform/responsiveness#R3: 정지로 끝난 kind에는 onGiveUp이 불리지 않는다", async () => {
  const { supervised } = faked({});
  const gaveUp: string[] = [];
  let ended = 0;
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
    onEnd: () => ended += 1,
    onGiveUp: (reason) => gaveUp.push(reason),
  });
  assert(started.ok);
  assert(await supervised.stop("platform/io"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEquals(ended, 1);
  assertEquals(gaveUp, []);
});
