import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdleWatch, PAGE_HOST_IDLE_MS, type Schedule } from "./idle.ts";

function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fire: () => void }>();
  const schedule: Schedule = (fire, ms) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, fire });
    return () => {
      timers.delete(id);
    };
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, entry]) => entry.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      due[1].fire();
    }
  };
  return { schedule, advance, pending: () => timers.size };
}

test("열린 page가 없는 채로 5분 지나면 끝나고, page가 열리면 timer가 취소되었다가 모두 닫힌 뒤 다시 5분을 잰다", () => {
  const clock = fakeScheduler();
  let idleCount = 0;
  const watch = createIdleWatch({
    schedule: clock.schedule,
    onIdle: () => {
      idleCount += 1;
    },
  });

  // 시작 직후 4분 뒤 page가 열리면 끝나지 않는다.
  clock.advance(4 * 60_000);
  assert.equal(idleCount, 0);
  watch.setPages(1);
  assert.equal(clock.pending(), 0);

  // page가 열려 있는 동안은 5분이 훨씬 지나도 끝나지 않는다.
  clock.advance(20 * 60_000);
  assert.equal(idleCount, 0);

  // 마지막 page가 닫히면 그때부터 다시 5분을 잰다. 중복 0 알림은 기한을 늘리지 않는다.
  watch.setPages(0);
  clock.advance(3 * 60_000);
  watch.setPages(0);
  clock.advance(2 * 60_000 - 1);
  assert.equal(idleCount, 0);

  // 기한 전에 다시 page가 열리면 취소된다.
  watch.setPages(1);
  clock.advance(10_000);
  assert.equal(idleCount, 0);

  // 다시 0이 된 뒤 정확히 PAGE_HOST_IDLE_MS가 지나면 한 번만 끝난다.
  watch.setPages(0);
  clock.advance(PAGE_HOST_IDLE_MS - 1);
  assert.equal(idleCount, 0);
  clock.advance(1);
  assert.equal(idleCount, 1);

  // 끝난 뒤에는 다시 걸리지 않는다.
  watch.setPages(0);
  clock.advance(PAGE_HOST_IDLE_MS * 2);
  assert.equal(idleCount, 1);
});

test("stop 뒤에는 남은 timer가 취소되어 끝나지 않는다", () => {
  const clock = fakeScheduler();
  let idleCount = 0;
  const watch = createIdleWatch({
    schedule: clock.schedule,
    onIdle: () => {
      idleCount += 1;
    },
  });
  watch.stop();
  assert.equal(clock.pending(), 0);
  clock.advance(PAGE_HOST_IDLE_MS * 2);
  assert.equal(idleCount, 0);
});
