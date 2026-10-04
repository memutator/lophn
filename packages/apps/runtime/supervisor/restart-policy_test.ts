import { assert, assertEquals } from "@std/assert";
import {
  BACKOFF_MAX_MS,
  backoffMs,
  CRASH_WINDOW_MS,
  crashLoop,
  recentExits,
} from "./restart-policy.ts";

Deno.test("apps/runtime#R19: backoff는 1·2·4초부터 두 배씩 최대 300초다", () => {
  assertEquals(backoffMs(1), 1_000);
  assertEquals(backoffMs(2), 2_000);
  assertEquals(backoffMs(3), 4_000);
  assertEquals(backoffMs(4), 8_000);
  assertEquals(backoffMs(9), 256_000);
  assertEquals(backoffMs(10), BACKOFF_MAX_MS);
  assertEquals(backoffMs(20), BACKOFF_MAX_MS);
});

Deno.test("apps/runtime#R19: 600초 안의 종료가 5회를 넘으면 재시작을 멈춘다", () => {
  const exits = [0, 60_000, 120_000, 180_000, 240_000, 300_000].map((atMs) => ({
    atMs,
  }));
  assert(crashLoop(exits, 300_000));
  assertEquals(recentExits(exits, 300_000).length, 6);
  // 창 밖으로 밀려난 종료는 세지 않는다.
  assertEquals(crashLoop(exits, 300_000 + CRASH_WINDOW_MS), false);
});
