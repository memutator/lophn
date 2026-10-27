import assert from "node:assert/strict";
import { test } from "node:test";

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

test("waitUntilIdle: quiet must last quietMs before idle", async () => {
  // 처음 두 번은 입력이 turn이 되지 않은 틈이다. 그 뒤 조용해져도 quietMs가 차야 한다.
  const h = harness((call) =>
    call < 2
      ? { ...quiet, unstarted: [{ session: "ses_a", message: "msg_a" }] }
      : quiet,
  );
  const result = await waitUntilIdle(h.read, h, {
    quietMs: 1_000,
    pollMs: 250,
  });
  assert.deepStrictEqual(result.kind, "idle");
  // call 2에서 조용함이 시작(t=500)하고 t=1500에 idle이다.
  assert.deepStrictEqual(h.clock.nowMs(), 1_500);
});

test("waitUntilIdle: an input that never becomes a turn ends as timeout naming it", async () => {
  const h = harness(() => ({
    ...quiet,
    unstarted: [{ session: "ses_a", message: "msg_a" }],
  }));
  const result = await waitUntilIdle(h.read, h, { timeoutMs: 5_000 });
  assert.deepStrictEqual(result, {
    kind: "timeout",
    unstarted: ["msg_a", "ses_a"],
    running: [],
  });
});

test("waitUntilIdle: stuckMs cuts an input that never became a turn, timeoutMs the rest, over cuts at once", async () => {
  const stuckInput: Snapshot = {
    ...quiet,
    unstarted: [{ session: "ses_a", message: "msg_a" }],
  };
  const stuck = harness(() => stuckInput);
  assert.deepStrictEqual(
    (
      await waitUntilIdle(stuck.read, stuck, {
        timeoutMs: 100_000,
        stuckMs: 2_000,
      })
    ).kind,
    "timeout",
  );
  assert.deepStrictEqual(stuck.clock.nowMs(), 2_000);

  // running은 turn이 돌고 있는 것이라 stuckMs에 안 걸리고 timeoutMs에 끊긴다.
  const running = harness(() => ({ ...quiet, running: ["ses_a"] }));
  await waitUntilIdle(running.read, running, {
    timeoutMs: 5_000,
    stuckMs: 2_000,
  });
  assert.deepStrictEqual(running.clock.nowMs(), 5_000);

  const lines: string[] = [];
  const spent = harness(() => ({ ...quiet, running: ["ses_a"] }));
  const result = await waitUntilIdle(
    spent.read,
    { ...spent, log: (line) => lines.push(line) },
    { hooks: { over: () => Promise.resolve("비용 상한") } },
  );
  assert.deepStrictEqual(result.kind, "timeout");
  assert.deepStrictEqual(spent.clock.nowMs(), 0);
  assert.deepStrictEqual(lines, ["비용 상한"]);
});
