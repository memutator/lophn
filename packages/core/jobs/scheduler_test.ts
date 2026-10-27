import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { JobTurn } from "../../protocol/jobs/mod.ts";
import type { JobSchedulerStore, JobStarter } from "./ports.ts";
import { createJobScheduler } from "./scheduler.ts";

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const JOB_RUN = "jbr_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"jbr">;
const INSTANCE = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"wfi">;

// 차례가 온 순간의 겹침 판정이 지금 instance 상태를 보려면 끝난 instance의 줄을 claim 앞에서 닫아야 한다.
for (const [state, closedAs] of [
  ["ended", "done"],
  ["stopped", "cancelled"],
] as const) {
  test(`a workflow job run stays open while its instance runs and closes as ${closedAs} once it is ${state}`, async () => {
    const calls: string[] = [];
    const timers: { run: () => void; ms: number }[] = [];
    let instance: "running" | "ended" | "stopped" = "running";
    const open = {
      job: { action: { kind: "workflow_start" } },
      job_run: { id: JOB_RUN, state: "running", instance: INSTANCE },
    } as unknown as JobTurn;
    const store: JobSchedulerStore = {
      open: () => {
        calls.push("open");
        return Promise.resolve(ok([open]));
      },
      claimDue: (startup) => {
        calls.push(`claimDue:${startup}`);
        return Promise.resolve(ok({ start: [], next_due_at: null }));
      },
      started: () => Promise.resolve(ok(undefined)),
      ended: (jobRun, ended) => {
        calls.push(`ended:${jobRun}:${ended}`);
        return Promise.resolve(ok(undefined));
      },
    };
    const starter: JobStarter = {
      start: () => Promise.reject(new Error("unused")),
      waitRun: () => Promise.reject(new Error("unused")),
      runState: () => Promise.reject(new Error("unused")),
      instanceState: () => {
        calls.push("instanceState");
        return Promise.resolve(ok(instance));
      },
    };
    const scheduler = createJobScheduler({
      clock: manualClock(Date.parse("2026-01-01T00:00:00.000Z")),
      timers: {
        set: (run, ms) => timers.push({ run, ms }),
        clear: () => {},
      },
      store,
      starter,
    });

    await scheduler.start();
    assert.deepStrictEqual(calls, ["open", "instanceState", "claimDue:true"]);
    assert.deepStrictEqual(timers.length, 1);
    assert.deepStrictEqual(timers[0]!.ms <= 60_000, true);

    instance = state;
    calls.length = 0;
    timers[0]!.run();
    await flush();
    assert.deepStrictEqual(calls, [
      "open",
      "instanceState",
      `ended:${JOB_RUN}:${closedAs}`,
      "claimDue:false",
    ]);
    await scheduler.stop();
  });
}
