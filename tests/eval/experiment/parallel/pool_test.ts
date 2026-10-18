import { assertEquals } from "@std/assert";
import { type Budget, createPool, type Job } from "./mod.ts";

function fakeBudget(limit: number): Budget & { added: number[] } {
  const added: number[] = [];
  const total = () => added.reduce((a, b) => a + b, 0);
  return {
    added,
    add: (usd) => added.push(usd),
    exceeded: () => total() >= limit,
    total,
  };
}

// 손으로 푸는 job. started는 run이 불린 뒤 true다.
function manualJob(id: string, kind: "judgment" | "coding", cost = 1) {
  let finish!: () => void;
  const job: Job<string> & { started: boolean } = {
    id,
    kind,
    started: false,
    run() {
      job.started = true;
      return new Promise((resolve) => {
        finish = () => resolve({ value: id, cost_usd: cost });
      });
    },
  };
  return { job, finish: () => finish() };
}

const tick = () => new Promise<void>((r) => queueMicrotask(r));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

Deno.test("kind별 동시 수 한도를 넘겨 띄우지 않고, 한 kind가 차도 다른 kind는 막히지 않는다", async () => {
  const pool = createPool({ budget: fakeBudget(1000) });
  const j = Array.from({ length: 6 }, (_, i) => manualJob(`j${i}`, "judgment"));
  const c = Array.from({ length: 3 }, (_, i) => manualJob(`c${i}`, "coding"));
  const results = [...j, ...c].map((x) => pool.submit(x.job));
  await settle();
  assertEquals(j.map((x) => x.job.started), [
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
  assertEquals(c.map((x) => x.job.started), [true, true, false]);
  assertEquals(pool.running(), { judgment: 4, coding: 2 });

  j[0].finish();
  await settle();
  assertEquals(j[4].job.started, true);
  assertEquals(j[5].job.started, false);

  for (const x of [...j, ...c]) {
    x.finish();
    await settle();
  }
  assertEquals(
    (await Promise.all(results)).map((r) => r.status),
    Array(9).fill("done"),
  );
});

Deno.test("예산이 차거나 stop이면 줄의 job을 띄우지 않고 skipped로 돌리며, 도는 job은 끝까지 가서 비용이 남는다", async () => {
  const budget = fakeBudget(5);
  const pool = createPool({ budget, limits: { judgment: 1 } });
  const a = manualJob("a", "judgment", 7);
  const b = manualJob("b", "judgment");
  const ra = pool.submit(a.job);
  const rb = pool.submit(b.job);
  await settle();
  assertEquals(pool.halted(), null);
  a.finish();
  assertEquals(await ra, { status: "done", id: "a", value: "a", cost_usd: 7 });
  assertEquals(await rb, { status: "skipped", id: "b", reason: "budget" });
  assertEquals(b.job.started, false);
  assertEquals(budget.added, [7]);
  assertEquals(pool.halted(), "budget");

  const pool2 = createPool({
    budget: fakeBudget(1000),
    limits: { judgment: 1 },
  });
  const c = manualJob("c", "judgment", 2);
  const d = manualJob("d", "judgment");
  const rc = pool2.submit(c.job);
  const rd = pool2.submit(d.job);
  pool2.stop();
  assertEquals(await rd, { status: "skipped", id: "d", reason: "stopped" });
  assertEquals(pool2.halted(), "stopped");
  c.finish();
  assertEquals((await rc).status, "done");
  assertEquals(await pool2.submit(manualJob("e", "coding").job), {
    status: "skipped",
    id: "e",
    reason: "stopped",
  });
});
