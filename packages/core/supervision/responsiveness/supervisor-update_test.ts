import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import type { Spawned, SpawnRequest } from "./process.ts";
import { createSupervisor } from "./supervisor.ts";
import {
  type FakeOptions,
  fakeProcess,
  hello,
  spec,
  type Tracker,
  tracker,
} from "./supervisor-fixture.ts";

// kind마다 따로 센다. 같은 kind의 handle이 둘 이상 살아 있으면 겹친 것이다.
function perKind(
  options: (kind: string, nth: number) => FakeOptions,
) {
  const tracks = new Map<string, Tracker>();
  const spawn = (request: SpawnRequest): Spawned => {
    const kind = request.env.KIND;
    const track = tracks.get(kind) ?? tracker();
    tracks.set(kind, track);
    return fakeProcess(track, options(kind, track.spawned + 1));
  };
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 30,
    teardownMs: 150,
    checkGroupKillAdapter: () => Promise.resolve(true),
    env: (kind) => ({ KIND: kind }),
    spawn,
  });
  const of = (kind: string) => tracks.get(kind) ?? tracker();
  return { supervised, of };
}

const NEXT = spec({ allow_read: ["/opt/lophn/next"] });

Deno.test("platform/security#R3: 옛 child의 exit·stdio가 영원히 안 끝나고 group 정리가 실패하면 updateSpec은 새로 띄우지 않는다", async () => {
  const { supervised, of } = perKind(() => ({
    exitOnStop: false,
    neverExit: true,
    hangStdio: false,
    terminate: false,
  }));
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  const updated = await supervised.updateSpec(NEXT, hello());
  assertEquals(updated.ok ? "" : updated.code, "unavailable");
  assertEquals(of("platform/io").spawned, 1);
  assertEquals(
    supervised.observation("platform/io").reason,
    "teardown unconfirmed",
  );
  // 옛 handle을 쥔 채로 남는다. start·updateSpec 어느 쪽도 겹쳐 띄우지 않는다.
  const again = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assertEquals(again.ok ? "" : again.code, "unavailable");
  assertEquals((await supervised.updateSpec(NEXT, hello())).ok, false);
  assertEquals(await supervised.stop("platform/io"), false);
  assertEquals(of("platform/io").spawned, 1);
});

Deno.test("platform/security#R3: group 종료 확인이 영원히 답하지 않거나 던져도 bounded하게 unavailable이다", async () => {
  for (const terminate of ["hang", "throw"] as const) {
    const { supervised, of } = perKind(() => ({
      exitOnStop: false,
      neverExit: true,
      hangStdio: true,
      terminate,
    }));
    const started = supervised.start(spec(), hello(), { onMessage: () => {} });
    assert((await started).ok);
    const begun = performance.now();
    const updated = await supervised.updateSpec(NEXT, hello());
    assert(performance.now() - begun < 3_000);
    assertEquals(updated.ok ? "" : updated.code, "unavailable", terminate);
    assertEquals(of("platform/io").spawned, 1);
  }
});

Deno.test("platform/security#R3: 같은 kind의 updateSpec 두 개와 stop이 동시에 와도 child가 겹치지 않는다", async () => {
  const { supervised, of } = perKind(() => ({}));
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  const [first, second, stopped] = await Promise.all([
    supervised.updateSpec(NEXT, hello()),
    supervised.updateSpec(spec({ allow_read: ["/opt/lophn/last"] }), hello()),
    supervised.stop("platform/io"),
  ]);
  const track = of("platform/io");
  assertEquals(track.maxLive, 1);
  assertEquals(track.spawned, 3);
  // 부른 순서대로 줄에 선다: 첫 update의 child는 둘째 update가, 둘째의 child는 stop이 끝낸다.
  // 첫 update는 ready가 먼저 오면 ok, 둘째에 먼저 밀리면 unavailable이다. 겹침은 어느 쪽도 없다.
  assert(first.ok || first.code === "unavailable");
  assertEquals(second.ok, false);
  assertEquals(stopped, true);
  assertEquals(track.live, 0);
  assertEquals(supervised.observation("platform/io").reason, "stopped");
  // 확인된 정지 뒤에는 다시 띄울 수 있다.
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  assertEquals(of("platform/io").maxLive, 1);
  assert(await supervised.stopAll());
});

Deno.test("platform/security#R3: 같은 kind의 start 두 개가 동시에 와도 하나만 띄운다", async () => {
  const { supervised, of } = perKind(() => ({}));
  const results = await Promise.all([
    supervised.start(spec(), hello(), { onMessage: () => {} }),
    supervised.start(spec(), hello(), { onMessage: () => {} }),
  ]);
  assertEquals(results.filter((result) => result.ok).length, 1);
  assertEquals(of("platform/io").spawned, 1);
  assert(await supervised.stopAll());
});

Deno.test("platform/security#R3: 한 kind의 종료 확인이 막혀도 다른 kind는 따로 띄우고 멈춘다", async () => {
  const { supervised, of } = perKind((kind) =>
    kind === "platform/io"
      ? { exitOnStop: false, neverExit: true, terminate: "hang" }
      : {}
  );
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  let stuckDone = false;
  const stuck = supervised.updateSpec(NEXT, hello()).finally(() => {
    stuckDone = true;
  });
  const other = spec({ kind: "documents/worker" });
  const started = await supervised.start(other, hello("documents/worker"), {
    onMessage: () => {},
  });
  assert(started.ok);
  assert(await supervised.stop("documents/worker"));
  // platform/io의 줄(teardown 한도 대기)이 끝나기 전에 다른 kind는 이미 끝났다.
  assertEquals(stuckDone, false);
  assertEquals((await stuck).ok, false);
  assertEquals(of("documents/worker").maxLive, 1);
  assertEquals(of("platform/io").spawned, 1);
});

function held(
  over: Partial<Parameters<typeof createSupervisor>[0]>,
  options: FakeOptions = {},
) {
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 30,
    teardownMs: 150,
    spawn: () => fakeProcess(track, options),
    ...over,
  });
  return { supervised, track };
}

Deno.test("platform/security#R3: stopAll은 adapter 확인을 기다리던 start까지 멈춘 뒤 돌아온다", async () => {
  let release: (ok: boolean) => void = () => {};
  const { supervised, track } = held({
    checkGroupKillAdapter: () => new Promise((resolve) => release = resolve),
  });
  const started = supervised.start(spec(), hello(), { onMessage: () => {} });
  const other = supervised.start(
    spec({ kind: "documents/worker" }),
    hello("documents/worker"),
    { onMessage: () => {} },
  );
  let stopped = false;
  const all = supervised.stopAll().then((confirmed) => {
    stopped = true;
    return confirmed;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(stopped, false);
  release(true);
  assertEquals(await all, true);
  // 돌아온 시점에 들어와 있던 child는 하나도 살아 있지 않다.
  assertEquals(track.live, 0);
  assertEquals(track.spawned, 2);
  assertEquals((await started).ok, false);
  assertEquals((await other).ok, false);
  assertEquals(supervised.observation("platform/io").reason, "stopped");
  // stopAll 뒤에 새로 부른 start는 막지 않는다(core 종료의 입장 차단은 따로다).
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  assert(await supervised.stopAll());
});

Deno.test("platform/security#R3: 답하지 않는 adapter 확인도 bounded하게 unavailable이고 같은 kind 줄을 붙들지 않는다", async () => {
  const { supervised, track } = held({
    checkGroupKillAdapter: () => new Promise(() => {}),
  });
  const begun = performance.now();
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assertEquals(started.ok ? "" : started.code, "unavailable");
  assert(performance.now() - begun < 5_000);
  assertEquals(await supervised.stop("platform/io"), true);
  assertEquals(track.spawned, 0);
  assertEquals(
    supervised.observation("platform/io").reason,
    "group kill adapter unavailable",
  );
});

Deno.test("platform/security#R2: 재기동 sleep이 거절하거나 던지면 그 kind만 unavailable로 알린다", async () => {
  const sleeps: Array<() => Promise<void>> = [
    () => Promise.reject(new Error("sleep rejected")),
    () => {
      throw new Error("sleep threw");
    },
  ];
  for (const sleep of sleeps) {
    const { supervised, track } = held({
      sleep,
      checkGroupKillAdapter: () => Promise.resolve(true),
    }, { dieAtStart: true });
    const started = await supervised.start(spec(), hello(), {
      onMessage: () => {},
    });
    assertEquals(started.ok ? "" : started.code, "unavailable");
    assertEquals(track.spawned, 1);
    assertEquals(track.live, 0);
    assertEquals(
      supervised.observation("platform/io").reason,
      "restart wait failed",
    );
  }
});
