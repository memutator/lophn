import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import {
  createMemoryObserver,
  MEMORY_OVERRUN_WINDOW_MS,
  MEMORY_SAMPLE_INTERVAL_MS,
  type MemoryChild,
  type MemoryOverrun,
  procRssReader,
  rssKbOf,
  type RssReading,
  startTicksOf,
} from "./observations/memory.ts";

const CHILD: MemoryChild = {
  pid: 4242,
  processNonce: "nonce-1",
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
};
const MIB = 1024 * 1024;

// 시간표대로 값을 주는 reader. undefined는 측정하지 못한 표본이다.
function scripted(values: (number | undefined)[], ticks = "100") {
  let index = 0;
  return (_pid: number): Promise<RssReading | undefined> => {
    const value = values[Math.min(index++, values.length - 1)];
    return Promise.resolve(
      value === undefined ? undefined : { rssBytes: value, startTicks: ticks },
    );
  };
}

Deno.test("apps/runtime#R25: 표본 간격은 60초이고 start가 그 간격으로 반복 예약하며 stop이 취소한다", async () => {
  assertEquals(MEMORY_SAMPLE_INTERVAL_MS, 60_000);
  let scheduledMs = -1;
  let run: () => void = () => {};
  let cancelled = false;
  const clock = manualClock(0);
  const samples: number[] = [];
  const observer = createMemoryObserver({
    app: "app_x",
    nowMs: () => clock.nowMs(),
    read: scripted([10 * MIB, 11 * MIB]),
    schedule(fn, ms) {
      scheduledMs = ms;
      run = fn;
      return () => (cancelled = true);
    },
  });
  observer.setChild(CHILD);
  observer.start();
  assertEquals(scheduledMs, 60_000);
  run();
  await observer.sample().then((s) => s && samples.push(s.rss_bytes));
  assertEquals(samples, [11 * MIB]);
  observer.stop();
  assert(cancelled);
});

Deno.test("apps/runtime#R25: Linux에서는 실제 자식의 VmRSS를 읽고 독립적으로 읽은 값과 같은 크기다", async () => {
  if (Deno.build.os !== "linux") return;
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `const keep = new Uint8Array(80 * 1024 * 1024).fill(1);` +
      `console.log("ready", keep.length);` +
      `await new Promise(() => setInterval(() => {}, 1000));`,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  try {
    // 자식이 80MiB를 쓴 뒤에 읽는다.
    const reader = child.stdout.getReader();
    await reader.read();
    const read = procRssReader();
    assert(read !== undefined);
    const observer = createMemoryObserver({
      app: "app_x",
      nowMs: () => Date.now(),
      read,
    });
    observer.setChild({ ...CHILD, pid: child.pid });
    const sample = await observer.sample();
    assert(sample !== undefined);
    const status = await Deno.readTextFile(`/proc/${child.pid}/status`);
    const independent = rssKbOf(status)! * 1024;
    assert(sample.rss_bytes >= 70 * MIB, `rss ${sample.rss_bytes}`);
    assert(
      Math.abs(sample.rss_bytes - independent) < 0.1 * independent,
      `${sample.rss_bytes} vs ${independent}`,
    );
    // 시작 시각 field도 같은 pid의 /proc에서 읽힌다.
    assertEquals(
      startTicksOf(await Deno.readTextFile(`/proc/${child.pid}/stat`)) !==
        undefined,
      true,
    );
  } finally {
    child.kill("SIGKILL");
    await child.status;
  }
});

Deno.test("apps/runtime#R25: 다른 OS와 읽기 실패는 측정하지 않은 값이고 0으로 채우지 않는다", async () => {
  assertEquals(procRssReader("darwin"), undefined);
  assertEquals(procRssReader("windows"), undefined);
  const clock = manualClock(0);
  const unmeasured = createMemoryObserver({
    app: "app_x",
    nowMs: () => clock.nowMs(),
  });
  unmeasured.setChild(CHILD);
  assertEquals(await unmeasured.sample(), undefined);
  // 존재하지 않는 pid는 읽기 실패다.
  const read = procRssReader("linux");
  assert(read !== undefined);
  assertEquals(await read(2 ** 22 + 12345), undefined);
  // /proc 모양 해석: comm에 괄호·공백이 있어도 starttime을 맞게 읽는다.
  const stat =
    `7 (we ird) name) S 1 7 7 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 100`;
  assertEquals(startTicksOf(stat), "987654");
  assertEquals(rssKbOf("Name:\tx\nVmRSS:\t  2048 kB\n"), 2048);
  assertEquals(rssKbOf("Name:\tkernel\n"), undefined);
});

function overrunHarness(
  options: { limit?: number; reads: (number | undefined)[] },
) {
  const clock = manualClock(0);
  const overruns: MemoryOverrun[] = [];
  const observer = createMemoryObserver({
    app: "app_x",
    ...(options.limit === undefined ? {} : { limitBytes: options.limit }),
    nowMs: () => clock.nowMs(),
    read: scripted(options.reads),
    onOverrun: (overrun) => overruns.push(overrun),
  });
  observer.setChild(CHILD);
  return { clock, observer, overruns };
}

// 60초마다 표본을 읽으며 시간을 흘린다.
async function run(
  env: ReturnType<typeof overrunHarness>,
  samples: number,
): Promise<void> {
  for (let index = 0; index < samples; index++) {
    await env.observer.sample();
    env.clock.advance(MEMORY_SAMPLE_INTERVAL_MS);
  }
}

Deno.test("apps/runtime#R29: 한도의 85%를 넘는 상태가 10분 이어질 때만 수치와 기간을 관측으로 남긴다", async () => {
  const limit = 100 * MIB;
  const env = overrunHarness({ limit, reads: [90 * MIB] });
  // 10분 직전까지(표본 0~9분)는 남기지 않는다.
  await run(env, 10);
  assertEquals(env.overruns.length, 0);
  assertEquals(env.observer.overrunning, true);
  // 정확히 10분째 표본에서 남긴다.
  await run(env, 1);
  assertEquals(env.overruns.length, 1);
  assertEquals(env.overruns[0].rss_bytes, 90 * MIB);
  assertEquals(env.overruns[0].limit_bytes, limit);
  assertEquals(env.overruns[0].duration_ms, MEMORY_OVERRUN_WINDOW_MS);
  assertEquals(env.overruns[0].since, new Date(0).toISOString());
  // 같은 지속 구간에서 반복해 남기지 않는다.
  await run(env, 5);
  assertEquals(env.overruns.length, 1);
});

Deno.test("apps/runtime#R29: 85% 이하로 내려오거나 표본이 빠지면 지속이 끊기고 다시 10분을 채워야 한다", async () => {
  const limit = 100 * MIB;
  // 85MiB는 85%와 같으므로 초과가 아니다.
  const dip = overrunHarness({
    limit,
    reads: [90 * MIB, 90 * MIB, 90 * MIB, 85 * MIB, 90 * MIB],
  });
  await run(dip, 14);
  assertEquals(dip.overruns.length, 0);
  // 끊긴 뒤 10분을 다시 채우면 남긴다.
  await run(dip, 8);
  assertEquals(dip.overruns.length, 1);
  assertEquals(dip.overruns[0].since, new Date(4 * 60_000).toISOString());

  // 표본 누락도 지속을 끊는다.
  const missing = overrunHarness({
    limit,
    reads: [
      90 * MIB,
      90 * MIB,
      90 * MIB,
      90 * MIB,
      90 * MIB,
      undefined,
      90 * MIB,
    ],
  });
  await run(missing, 12);
  assertEquals(missing.overruns.length, 0);
  assertEquals(missing.observer.overrunning, true);
});

Deno.test("apps/runtime#R29: 한도가 없거나 RSS를 측정하지 못했거나 자식이 바뀌면 임계치를 넘었다고 주장하지 않는다", async () => {
  const noLimit = overrunHarness({ reads: [10_000 * MIB] });
  await run(noLimit, 30);
  assertEquals(noLimit.overruns.length, 0);
  assertEquals(noLimit.observer.overrunning, false);

  const unmeasured = overrunHarness({ limit: 100 * MIB, reads: [undefined] });
  await run(unmeasured, 30);
  assertEquals(unmeasured.overruns.length, 0);

  // 자식이 교체되면 새 자식 기준으로 다시 센다.
  const swapped = overrunHarness({ limit: 100 * MIB, reads: [99 * MIB] });
  await run(swapped, 9);
  swapped.observer.setChild({ ...CHILD, pid: 9, processNonce: "nonce-2" });
  await run(swapped, 5);
  assertEquals(swapped.overruns.length, 0);

  // 같은 pid가 다른 프로세스(시작 시각이 다름)가 되면 그 값을 버린다.
  const ticks = ["1", "1", "2", "2"];
  let index = 0;
  const clock = manualClock(0);
  const reused = createMemoryObserver({
    app: "app_x",
    limitBytes: 100 * MIB,
    nowMs: () => clock.nowMs(),
    read: () =>
      Promise.resolve({ rssBytes: 99 * MIB, startTicks: ticks[index++] }),
  });
  reused.setChild(CHILD);
  assert(await reused.sample() !== undefined);
  assert(await reused.sample() !== undefined);
  assertEquals(await reused.sample(), undefined);
  assertEquals(reused.overrunning, false);
});
