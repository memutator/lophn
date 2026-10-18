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

const asking: Snapshot = {
  ...quiet,
  waiting: [{ session: "ses_a", questions: 1, permissions: 0 }],
};

Deno.test("waitUntilIdle: with a human role, waiting and pending approvals block idle until it acts, then graceMs applies", async () => {
  // 처음 세 번은 보류 허락(session 상태에 안 드러난다), 그다음 ask 대기, 이후 조용하다.
  const reads = (call: number): Snapshot =>
    call < 3 ? { ...quiet, pendingApprovals: 1 } : call < 5 ? asking : quiet;
  const h = harness(reads);
  let acts = 0;
  // 사람 역할이 call 2와 call 4에서 처리한다.
  const act = () => Promise.resolve(++acts === 3 || acts === 5);
  const result = await waitUntilIdle(h.read, h, {
    quietMs: 1_000,
    pollMs: 250,
    hooks: { act, graceMs: 4_000 },
  });
  assertEquals(result.kind, "idle");
  // 마지막 처리는 call 4(t=1000). call 5에서 조용함이 시작(t=1250)하고 graceMs 뒤 t=5250에 idle이다.
  assertEquals(h.clock.nowMs(), 5_250);

  // 사람 역할이 없으면 waiting은 그대로 조용함이다.
  const plain = harness(() => asking);
  assertEquals(
    await waitUntilIdle(plain.read, plain, { quietMs: 1_000 }),
    { kind: "idle", waiting: asking.waiting },
  );
});

Deno.test("waitUntilIdle: stuckMs cuts an input that never became a turn, timeoutMs the rest, over cuts at once", async () => {
  const stuckInput: Snapshot = {
    ...quiet,
    unstarted: [{ session: "ses_a", message: "msg_a" }],
  };
  const stuck = harness(() => stuckInput);
  assertEquals(
    (await waitUntilIdle(stuck.read, stuck, {
      timeoutMs: 100_000,
      stuckMs: 2_000,
    })).kind,
    "timeout",
  );
  assertEquals(stuck.clock.nowMs(), 2_000);

  // running은 turn이 돌고 있는 것이라 stuckMs에 안 걸리고 timeoutMs에 끊긴다.
  const running = harness(() => ({ ...quiet, running: ["ses_a"] }));
  await waitUntilIdle(running.read, running, {
    timeoutMs: 5_000,
    stuckMs: 2_000,
  });
  assertEquals(running.clock.nowMs(), 5_000);

  const lines: string[] = [];
  const spent = harness(() => ({ ...quiet, running: ["ses_a"] }));
  const result = await waitUntilIdle(
    spent.read,
    { ...spent, log: (line) => lines.push(line) },
    { hooks: { over: () => Promise.resolve("비용 상한") } },
  );
  assertEquals(result.kind, "timeout");
  assertEquals(spent.clock.nowMs(), 0);
  assertEquals(lines, ["비용 상한"]);
});
