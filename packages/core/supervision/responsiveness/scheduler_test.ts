import { assert, assertEquals } from "@std/assert";
import { createIoScheduler } from "./mod.ts";

function gate() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

Deno.test("platform/responsiveness#R4 concurrency, principal cap and round-robin", async () => {
  const scheduler = createIoScheduler();
  const gates = [gate(), gate()];
  const order: string[] = [];
  const jobs = [];
  try {
    for (let i = 0; i < 2; i++) {
      const admitted = scheduler.submit("busy", () => gates[i].promise);
      assert(admitted.ok);
      jobs.push(admitted.value);
    }
    for (const principal of ["a", "a", "a", "b", "b", "c"]) {
      const admitted = scheduler.submit(principal, () => {
        order.push(principal);
        return Promise.resolve();
      });
      assert(admitted.ok);
      jobs.push(admitted.value);
    }
    assertEquals(scheduler.active, 2);
    assertEquals(scheduler.queued, 6);
    const more = scheduler.submit("a", () => Promise.resolve());
    assert(more.ok);
    jobs.push(more.value);
    assertEquals(scheduler.submit("a", () => Promise.resolve()).ok, false);
    gates[0].resolve();
    gates[1].resolve();
    await Promise.all(jobs.map((job) => job.result));
    assertEquals(order, ["a", "b", "c", "a", "b", "a"]);
  } finally {
    gates.forEach((item) => item.resolve());
    scheduler.close();
  }
});

Deno.test("platform/responsiveness#R4 bounded queued admission and finite close", async () => {
  const scheduler = createIoScheduler();
  const gates = [gate(), gate()];
  const jobs = [];
  try {
    for (let i = 0; i < 34; i++) {
      const admitted = scheduler.submit(
        `p${i}`,
        i < 2 ? () => gates[i].promise : () => Promise.resolve(),
      );
      assert(admitted.ok);
      jobs.push(admitted.value);
    }
    assertEquals(scheduler.queued, 32);
    assertEquals(
      scheduler.submit("overflow", () => Promise.resolve()).ok,
      false,
    );
    scheduler.close();
    assertEquals(scheduler.queued, 0);
    assert(
      (await Promise.all(jobs.map((job) => job.result))).every((result) =>
        !result.ok
      ),
    );
    assertEquals(scheduler.submit("closed", () => Promise.resolve()).ok, false);
  } finally {
    gates.forEach((item) => item.resolve());
    await tick();
    scheduler.close();
  }
});

Deno.test("platform/responsiveness#R4 cancelled stuck work retains physical slot; unknown failure safe", async () => {
  const scheduler = createIoScheduler();
  const blocker = gate();
  try {
    const active = scheduler.submit("a", () => blocker.promise);
    assert(active.ok);
    active.value.cancel();
    assertEquals((await active.value.result).ok, false);
    assertEquals(scheduler.active, 1);
    const failed = scheduler.submit(
      "b",
      () => Promise.reject(new Error("credential secret")),
    );
    assert(failed.ok);
    assertEquals(await failed.value.result, {
      ok: false,
      error: { code: "unavailable", message: "worker failed" },
    });
    const small = scheduler.submit("c", () => Promise.resolve(42));
    assert(small.ok);
    assertEquals(await small.value.result, { ok: true, value: 42 });
  } finally {
    blocker.resolve();
    scheduler.close();
  }
});
