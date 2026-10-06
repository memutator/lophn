import { assertEquals } from "@std/assert";
import { closeWithin } from "./runtime.ts";

Deno.test("platform/ledger#R21: writer 닫기가 기한 안에 답하지 않으면 Worker를 끝내고 기다림을 멈춘다", async () => {
  let expired = 0;
  const started = performance.now();
  await closeWithin(
    () => new Promise<never>(() => {}),
    30,
    () => expired++,
  );
  assertEquals(expired, 1);
  assertEquals(performance.now() - started < 5_000, true);
});

Deno.test("platform/ledger#R21: writer가 기한 안에 닫히면 Worker를 끝내지 않는다", async () => {
  let expired = 0;
  await closeWithin(() => Promise.resolve("closed"), 10_000, () => expired++);
  assertEquals(expired, 0);
});
