import { assertEquals } from "@std/assert";
import { manualClock } from "../../../packages/base/mod.ts";
import { type Snapshot, waitUntilIdle } from "./idle.ts";

const quiet: Snapshot = { running: [], waiting: [], unstarted: [] };

function harness(reads: (call: number) => Snapshot) {
  const clock = manualClock(0);
  let calls = 0;
  return {
    clock,
    sleep: (ms: number) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    read: () => Promise.resolve(reads(calls++)),
  };
}

Deno.test("waitUntilIdle: quiet must last quietMs before idle", async () => {
  // 처음 두 번은 입력이 turn이 되지 않은 틈이다. 그 뒤 조용해져도 quietMs가 차야 한다.
  const h = harness((call) =>
    call < 2
      ? { ...quiet, unstarted: [{ session: "ses_a", message: "msg_a" }] }
      : quiet
  );
  const result = await waitUntilIdle(h.read, h, {
    quietMs: 1_000,
    pollMs: 250,
  });
  assertEquals(result.kind, "idle");
  // call 2에서 조용함이 시작(t=500)하고 t=1500에 idle이다.
  assertEquals(h.clock.nowMs(), 1_500);
});

Deno.test("waitUntilIdle: an input that never becomes a turn ends as timeout naming it", async () => {
  const h = harness(() => ({
    ...quiet,
    unstarted: [{ session: "ses_a", message: "msg_a" }],
  }));
  const result = await waitUntilIdle(h.read, h, { timeoutMs: 5_000 });
  assertEquals(result, {
    kind: "timeout",
    unstarted: ["msg_a", "ses_a"],
    running: [],
  });
});
